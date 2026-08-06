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
  let selected;
  for (const sheet of workbook.worksheets) {
    try {
      const header = findHeader(sheet);
      if (!selected || header.score > selected.header.score) selected = { sheet, header };
    } catch (_) {}
  }
  if (!selected) throw new Error('工作簿中没有可识别的询价明细表');

  const { sheet, header } = selected;
  const items = [];
  const metadata = extractMetadataAboveHeader(sheet, header.rowNo);
  let consecutiveEmptyRows = 0;
  for (let rowNo = header.rowNo + 1; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const get = field => header.mapping[field] ? cellValue(row.getCell(header.mapping[field])) : null;
    const description = String(get('description') || '').trim();
    const quantityRaw = get('quantity');
    const quantity = quantityRaw === null || quantityRaw === undefined || String(quantityRaw).trim() === ''
      ? null
      : Number(quantityRaw);
    if (!description && !Number.isFinite(quantity)) {
      consecutiveEmptyRows += 1;
      if (consecutiveEmptyRows >= 8 && items.length > 0) break;
      continue;
    }
    consecutiveEmptyRows = 0;
    if (!metadata.requester) metadata.requester = get('requester');
    if (!metadata.country) metadata.country = get('country');
    if (!metadata.requestDate) metadata.requestDate = excelDate(get('requestDate'));
    if (!metadata.importType) metadata.importType = get('importType');
    if (!metadata.deliveryType) metadata.deliveryType = get('deliveryType');
    if (!metadata.client) metadata.client = get('client');
    if (!metadata.paymentType) metadata.paymentType = get('paymentType');
    items.push({
      lineNo: items.length + 1,
      sourceRow: rowNo,
      description,
      quantity: Number.isFinite(quantity) ? quantity : null,
      unit: get('unit'),
      code: get('code'),
      ltc: get('ltc'),
      observation: get('observation'),
      source: {
        deliveryDate: excelDate(get('deliveryDate')),
        personalized: get('personalized')
      }
    });
  }
  if (!items.length) throw new Error('已识别表头，但没有找到产品明细');
  return { sheetName: sheet.name, headerRow: header.rowNo, metadata, items };
}

module.exports = { importRfqWorkbook, FIELD_ALIASES };
