const ExcelJS = require('exceljs');

const FIELD_ALIASES = {
  requester: ['comercial', 'comercio', '请求人', '申请人'],
  country: ['país a importar', 'pais a importar', '国家'],
  requestDate: ['fecha de solicitud', 'fecha', '申请日期'],
  importType: ['tipo de impotación', 'tipo de importación', '进口方式'],
  deliveryType: ['tipo de entrega', '交付方式'],
  deliveryDate: ['fecha de entrega', '交付日期'],
  client: ['cliente', '客户'],
  ltc: ['ltc'],
  code: ['código', 'codigo', 'pn', '代码'],
  description: ['descripción en español', 'descripcion en espanol', 'descripción específica', 'descripcion especifica', 'descripción', 'descripcion', '产品描述', '描述'],
  quantity: ['cantidad', 'cant', '数量'],
  unit: ['unidad de medida', 'unidad', 'und', '单位'],
  paymentType: ['forma de pago', '付款方式'],
  personalized: ['¿mercancía personalizada?', 'mercancía personalizada', '是否定制'],
  observation: ['observación', 'observacion', '备注']
};

function normalize(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[：:]$/, '')
    .replace(/\s+/g, ' ');
}

function matchesAlias(value, alias) {
  const text = normalize(value);
  const target = normalize(alias);
  return text === target || text.startsWith(`${target} `) || text.startsWith(`${target} (`);
}

function cellValue(cell) {
  if (!cell) return null;
  const value = cell.value;
  if (value && typeof value === 'object') {
    if (value.text) return value.text;
    if (value.result != null) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
    if (value.hyperlink) return value.text || value.hyperlink;
  }
  return value;
}

function findHeader(sheet) {
  let best = null;
  const maxRows = Math.min(sheet.rowCount, 40);
  for (let rowNo = 1; rowNo <= maxRows; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const mapping = {};
    row.eachCell({ includeEmpty: false }, (cell, colNo) => {
      const header = normalize(cellValue(cell));
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (!mapping[field] && aliases.some(alias => matchesAlias(header, alias))) mapping[field] = colNo;
      }
    });
    const score = Object.keys(mapping).length;
    if (!best || score > best.score) best = { rowNo, mapping, score };
  }
  if (!best || best.score < 3 || !best.mapping.description) {
    throw new Error('未能识别询价单表头，请确认至少包含描述、数量、国家或请求人等字段');
  }
  return best;
}

function findHeaders(sheet) {
  const headers = [];
  const maxRows = Math.max(1, sheet.rowCount);
  for (let rowNo = 1; rowNo <= maxRows; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const mapping = {};
    row.eachCell({ includeEmpty: false }, (cell, colNo) => {
      const header = normalize(cellValue(cell));
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (!mapping[field] && aliases.some(alias => matchesAlias(header, alias))) mapping[field] = colNo;
      }
    });
    const score = Object.keys(mapping).length;
    if (score >= 3 && mapping.description) {
      const previous = headers[headers.length - 1];
      // 同一表头被合并单元格或空行重复时只保留一次。
      if (!previous || rowNo - previous.rowNo > 1) headers.push({ rowNo, mapping, score });
    }
  }
  return headers;
}

function findAdjacentValue(sheet, aliases, maxRow) {
  for (let rowNo = 1; rowNo <= maxRow; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    for (let colNo = 1; colNo <= sheet.columnCount; colNo += 1) {
      const label = cellValue(row.getCell(colNo));
      if (!aliases.some(alias => normalize(label) === normalize(alias))) continue;
      for (let valueCol = colNo + 1; valueCol <= Math.min(sheet.columnCount, colNo + 8); valueCol += 1) {
        const candidate = cellValue(row.getCell(valueCol));
        if (candidate == null || String(candidate).trim() === '') continue;
        if (normalize(candidate) === normalize(label)) continue;
        return candidate;
      }
    }
  }
  return null;
}

function extractMetadataAboveHeader(sheet, headerRow) {
  const maxRow = Math.max(1, headerRow - 1);
  return {
    requester: findAdjacentValue(sheet, ['comercial', 'comercio', '请求人', '申请人'], maxRow),
    client: findAdjacentValue(sheet, ['cliente', '客户'], maxRow),
    requestDate: excelDate(findAdjacentValue(sheet, ['fecha de solicitud', 'fecha', '申请日期'], maxRow)),
    country: findAdjacentValue(sheet, ['país a importar', 'pais a importar', '国家'], maxRow),
    deliveryType: findAdjacentValue(sheet, ['tipo de entrega', 'tipo', '交付方式'], maxRow),
    paymentType: findAdjacentValue(sheet, ['forma de pago', '付款方式'], maxRow)
  };
}

function excelDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  return text || null;
}

async function importRfqWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sections = [];
  for (const sheet of workbook.worksheets) {
    for (const header of findHeaders(sheet)) sections.push({ sheet, header });
  }
  if (!sections.length) throw new Error('工作簿中没有可识别的询价明细表');

  const items = [];
  const metadata = {};
  const tables = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const { sheet, header } = sections[sectionIndex];
    const next = sections.slice(sectionIndex + 1).find(candidate => candidate.sheet.name === sheet.name);
    const endRow = next ? next.header.rowNo - 1 : sheet.rowCount;
    const sectionMetadata = extractMetadataAboveHeader(sheet, header.rowNo);
    for (const [key, value] of Object.entries(sectionMetadata)) if (!metadata[key] && value) metadata[key] = value;
    const sectionItems = [];
    let consecutiveEmptyRows = 0;
    for (let rowNo = header.rowNo + 1; rowNo <= endRow; rowNo += 1) {
      const row = sheet.getRow(rowNo);
      const get = field => header.mapping[field] ? cellValue(row.getCell(header.mapping[field])) : null;
      const description = String(get('description') || '').trim();
      const quantityRaw = get('quantity');
      const quantity = quantityRaw === null || quantityRaw === undefined || String(quantityRaw).trim() === ''
        ? null
        : Number(quantityRaw);
      if (!description && !Number.isFinite(quantity)) {
        consecutiveEmptyRows += 1;
        if (consecutiveEmptyRows >= 8 && sectionItems.length > 0) break;
        continue;
      }
      consecutiveEmptyRows = 0;
      const item = {
        lineNo: items.length + sectionItems.length + 1,
        sourceRow: rowNo,
        sourceSheetName: sheet.name,
        sourceHeaderRow: header.rowNo,
        description,
        quantity: Number.isFinite(quantity) ? quantity : null,
        unit: get('unit'),
        code: get('code'),
        ltc: get('ltc'),
        observation: get('observation'),
        source: {
          deliveryDate: excelDate(get('deliveryDate')),
          personalized: get('personalized'),
          sourceSheetName: sheet.name,
          sourceHeaderRow: header.rowNo
        }
      };
      sectionItems.push(item);
      for (const [key, value] of Object.entries({
        requester: get('requester'), country: get('country'), requestDate: excelDate(get('requestDate')),
        importType: get('importType'), deliveryType: get('deliveryType'), client: get('client'), paymentType: get('paymentType')
      })) if (!metadata[key] && value) metadata[key] = value;
    }
    if (sectionItems.length) {
      items.push(...sectionItems);
      tables.push({ sheetName: sheet.name, headerRow: header.rowNo, itemCount: sectionItems.length });
    }
  }
  if (!items.length) throw new Error('已识别表头，但没有找到产品明细');
  return {
    sheetName: tables[0].sheetName,
    headerRow: tables[0].headerRow,
    tableCount: tables.length,
    tables,
    metadata,
    items
  };
}

module.exports = { importRfqWorkbook, FIELD_ALIASES };
