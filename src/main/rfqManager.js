const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');

const FIELD_ALIASES = {
  itemNumber: ['item', 'ítem', 'numero item', 'número item', '序号'],
  productType: ['tipo', '产品类型', '类型'],
  image: ['imagen de referencia', 'imagen', 'foto', '产品图片', '图片'],
  reference: ['referencia', 'modelo', 'model', '型号', '产品型号'],
  code: ['codigo', 'código', '产品编码', '编码'],
  description: [
    'descripcion especifica',
    'descripción específica',
    'descripcion',
    'descripción',
    '产品描述',
    '产品名称'
  ],
  link: ['link de referencia', 'enlace de referencia', 'link', '参考链接', '链接'],
  marked: ['marcado con latic', 'marca latic', 'latic标识', '是否贴标'],
  unitPriceUsd: [
    'precio unitario antes de iva usd',
    'precio unitario usd',
    '美金成本',
    '美元成本',
    '美元单价'
  ],
  quantity: ['cantidad', '数量'],
  unit: ['unidad de medida', 'unidad', '单位'],
  totalPriceUsd: [
    'precio total antes de iva usd',
    'precio total usd',
    '美元总价',
    '美金总价'
  ],
  paymentTerms: ['forma de pago', '付款方式', '付款条件'],
  country: ['pais', 'país', '国家'],
  importType: ['tipo de importacion', 'tipo de importación', '进口方式', '运输方式'],
  deliveryTime: [
    'tiempo de importacion',
    'tiempo de importación',
    '交期',
    '交货期',
    '进口时间'
  ],
  incoterm: ['incoterm', 'fob', 'cif', 'ddp', '贸易条款', '美金成本(FOB)'],
  supplierName: ['proveedor', 'supplier', '供应商', '供应商名称', '公司名称'],
  totalRmb: ['总价', '人民币总价', '含税含运', '含税价格', '含税运总价', '含税运总价(¥)'],
  notes: ['observaciones', 'observación', 'nota', 'notas', '备注']
};

const REQUIRED_HEADER_FIELDS = new Set([
  'itemNumber',
  'reference',
  'description',
  'quantity',
  'unitPriceUsd'
]);

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\{\{|\}\}/g, '')
    .replace(/[\s/\\()（）【】\[\]：:、,_\-—–.]+/g, '')
    .trim();
}

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(FIELD_ALIASES).map(([field, aliases]) => [
    field,
    aliases.map(normalizeText).filter(Boolean)
  ])
);

function detectField(label) {
  const normalized = normalizeText(label);
  if (!normalized) return null;
  for (const [field, aliases] of Object.entries(NORMALIZED_ALIASES)) {
    if (aliases.includes(normalized)) return field;
  }
  return null;
}

function cellText(cell) {
  if (!cell) return '';
  const value = cell.value;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    if (value.result !== undefined && value.result !== null) {
      return String(value.result);
    }
    if (value.text !== undefined && value.text !== null) {
      return String(value.text);
    }
    if (Array.isArray(value.richText)) {
      return value.richText.map(part => String(part?.text || '')).join('');
    }
    if (value.hyperlink) return String(value.text || value.hyperlink);
    return '';
  }
  if (value !== undefined && value !== null) {
    return String(value).trim();
  }
  try {
    return String(cell.text || '').trim();
  } catch (error) {
    return '';
  }
}

function editableValue(cell) {
  if (!cell) return '';
  if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  if (cell.value && typeof cell.value === 'object') {
    if (cell.value.result !== undefined && cell.value.result !== null) {
      return cell.value.result;
    }
    if (cell.value.text !== undefined && cell.value.text !== null) {
      return cell.value.text;
    }
  }
  return cell.value ?? '';
}

function detectHeader(worksheet) {
  let best = null;
  const maxRows = Math.min(worksheet.rowCount || 1, 80);
  const maxCols = Math.min(worksheet.columnCount || 1, 100);

  for (let rowNumber = 1; rowNumber <= maxRows; rowNumber++) {
    const columns = {};
    const labels = {};
    const matchedFields = new Set();
    for (let colNumber = 1; colNumber <= maxCols; colNumber++) {
      const label = cellText(worksheet.getCell(rowNumber, colNumber));
      const field = detectField(label);
      if (!field || matchedFields.has(field)) continue;
      columns[field] = colNumber;
      labels[field] = label;
      matchedFields.add(field);
    }
    const requiredMatches = [...matchedFields].filter(field => REQUIRED_HEADER_FIELDS.has(field)).length;
    const score = matchedFields.size * 10 + requiredMatches * 4;
    if (!best || score > best.score) {
      best = { rowNumber, columns, labels, score, matches: matchedFields.size };
    }
  }

  if (!best || best.matches < 4 || !best.columns.quantity) {
    throw new Error('没有识别到询价明细表头，请确认文件中包含产品、数量、价格等字段');
  }
  return best;
}

function findBestSheet(workbook) {
  let best = null;
  for (const worksheet of workbook.worksheets) {
    try {
      const header = detectHeader(worksheet);
      if (!best || header.score > best.header.score) best = { worksheet, header };
    } catch (error) {
      // 继续尝试其他工作表。
    }
  }
  if (!best) throw new Error('工作簿中没有找到可识别的询价明细');
  return best;
}

function readHeaderMetadata(worksheet, headerRow) {
  const metadata = {};
  const labelMap = {
    fecha: 'date',
    comercial: 'salesperson',
    cliente: 'customer',
    tipo: 'tradeType',
    'ofertavalidahasta': 'validUntil'
  };
  const maxCols = Math.min(worksheet.columnCount || 1, 80);
  for (let rowNumber = 1; rowNumber < headerRow; rowNumber++) {
    for (let colNumber = 1; colNumber <= maxCols; colNumber++) {
      const normalized = normalizeText(cellText(worksheet.getCell(rowNumber, colNumber)));
      const metadataKey = labelMap[normalized];
      if (!metadataKey) continue;
      for (let valueCol = colNumber + 1; valueCol <= Math.min(maxCols, colNumber + 5); valueCol++) {
        const value = editableValue(worksheet.getCell(rowNumber, valueCol));
        if (value !== '' && value !== null && value !== undefined) {
          metadata[metadataKey] = value;
          break;
        }
      }
    }
  }
  return metadata;
}

function parseItems(worksheet, header) {
  const items = [];
  let blankStreak = 0;
  const maxRow = Math.min(worksheet.rowCount || header.rowNumber, header.rowNumber + 2000);
  const fieldEntries = Object.entries(header.columns);
  const identityFields = ['itemNumber', 'reference', 'code', 'description'];
  const totalMarkers = [
    'preciototalantesdeiva',
    'preciototal',
    'subtotal',
    'totalbeforevat',
    '合计',
    '总计'
  ];

  for (let rowNumber = header.rowNumber + 1; rowNumber <= maxRow; rowNumber++) {
    const data = {};
    for (const [field, colNumber] of fieldEntries) {
      data[field] = editableValue(worksheet.getCell(rowNumber, colNumber));
    }
    const hasIdentity = identityFields.some(field => {
      const value = data[field];
      return value !== '' && value !== null && value !== undefined;
    });
    const looksLikeTotal = Object.values(data).some(value => {
      const normalized = normalizeText(value);
      return totalMarkers.some(marker => normalized.includes(normalizeText(marker)));
    });

    if (!hasIdentity || looksLikeTotal) {
      blankStreak++;
      if (items.length > 0 && blankStreak >= 8) break;
      continue;
    }
    blankStreak = 0;
    const lineNo = items.length + 1;
    const itemKey = String(data.reference || data.code || data.description || lineNo).trim();
    items.push({ lineNo, sourceRow: rowNumber, itemKey, data });
  }

  if (items.length === 0) {
    throw new Error('识别到了表头，但没有找到产品明细行');
  }
  return items;
}

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '')
    .replace(/[¥￥$,\s]/g, '')
    .replace(/[^\d.\-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quoteFieldValue(quote, fieldLabels, keys, aliases = []) {
  for (const key of keys) {
    const value = quote?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  const wanted = new Set(aliases.map(normalizeText));
  for (const [key, label] of Object.entries(fieldLabels || {})) {
    if (!wanted.has(normalizeText(label))) continue;
    const value = quote?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function calculateUsdUnitPrice(quote, fieldLabels, options = {}) {
  const direct = quoteFieldValue(
    quote,
    fieldLabels,
    ['usdCost', 'usdPrice', 'unitPriceUsd'],
    FIELD_ALIASES.unitPriceUsd
  );
  if (numericValue(direct)) return numericValue(direct);

  const rmb = quoteFieldValue(
    quote,
    fieldLabels,
    ['price', 'totalPrice', 'totalRmb'],
    FIELD_ALIASES.totalRmb
  );
  const rate = numericValue(options.exchangeRate) || 7.25;
  const invoiceDivisor = options.invoiceType === 'regular' ? 1 : 1.13;
  return numericValue(rmb) / rate / invoiceDivisor;
}

function columnLetter(columnNumber) {
  let value = Number(columnNumber);
  let result = '';
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function columnNumber(columnLetters) {
  return String(columnLetters || '').toUpperCase().split('').reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0
  );
}

function shiftColumnReferences(formula, startColumn, count) {
  if (typeof formula !== 'string' || !formula) return formula;
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?\d+)/g, (match, absolute, letters, row) => {
    const currentColumn = columnNumber(letters);
    if (currentColumn < startColumn) return match;
    return `${absolute}${columnLetter(currentColumn + count)}${row}`;
  });
}

function insertColumnsPreservingReferences(worksheet, startColumn, count) {
  if (!count) return;
  const validations = JSON.parse(JSON.stringify(worksheet.dataValidations.model || {}));
  worksheet.spliceColumns(startColumn, 0, ...Array.from({ length: count }, () => []));

  worksheet.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      if (!cell.value || typeof cell.value !== 'object' || !cell.value.formula) return;
      cell.value = {
        ...cell.value,
        formula: shiftColumnReferences(cell.value.formula, startColumn, count)
      };
    });
  });

  const shiftedValidations = {};
  for (const [address, validation] of Object.entries(validations)) {
    shiftedValidations[shiftColumnReferences(address, startColumn, count)] = {
      ...validation,
      formulae: (validation.formulae || []).map(formula =>
        shiftColumnReferences(formula, startColumn, count)
      )
    };
  }
  worksheet.dataValidations.model = shiftedValidations;
}

function findHiddenSupportStart(worksheet, afterColumn) {
  for (let column = afterColumn + 1; column <= worksheet.columnCount; column++) {
    if (worksheet.getColumn(column).hidden) return column;
  }
  return worksheet.columnCount + 1;
}

function columnIsBlank(worksheet, column, startRow, endRow) {
  for (let row = startRow; row <= endRow; row++) {
    if (cellText(worksheet.getCell(row, column)).trim()) return false;
  }
  return true;
}

function prepareOutputColumns(worksheet, items) {
  let header = detectHeader(worksheet);
  const customFields = new Set(['incoterm', 'totalRmb', 'notes']);
  const coreColumns = Object.entries(header.columns)
    .filter(([field]) => !customFields.has(field))
    .map(([, column]) => column);
  const coreLastColumn = Math.max(...coreColumns);
  let supportStart = findHiddenSupportStart(worksheet, coreLastColumn);

  // Older beta builds appended output fields after the hidden dropdown lists.
  // Remove those generated columns before placing them beside the visible table.
  const obsoleteColumns = [...new Set(
    [...customFields]
      .map(field => header.columns[field])
      .filter(column => Number.isFinite(column) && column >= supportStart)
  )].sort((a, b) => b - a);
  for (const column of obsoleteColumns) worksheet.spliceColumns(column, 1);

  header = detectHeader(worksheet);
  const refreshedCoreLast = Math.max(...Object.entries(header.columns)
    .filter(([field]) => !customFields.has(field))
    .map(([, column]) => column));
  supportStart = findHiddenSupportStart(worksheet, refreshedCoreLast);
  const lastItemRow = Math.max(header.rowNumber, ...items.map(item =>
    Number(item.source_row || item.sourceRow) || header.rowNumber
  ));

  let fobColumn = header.columns.incoterm;
  if (!fobColumn || fobColumn >= supportStart) {
    fobColumn = 0;
    for (let column = supportStart - 1; column > refreshedCoreLast; column--) {
      if (columnIsBlank(worksheet, column, header.rowNumber, lastItemRow)) {
        fobColumn = column;
        break;
      }
    }
  }

  if (!fobColumn) {
    insertColumnsPreservingReferences(worksheet, supportStart, 3);
    fobColumn = supportStart;
  } else {
    const requiredLastColumn = fobColumn + 2;
    if (requiredLastColumn >= supportStart) {
      insertColumnsPreservingReferences(
        worksheet,
        supportStart,
        requiredLastColumn - supportStart + 1
      );
    }
  }

  return {
    header: detectHeader(worksheet),
    fobColumn,
    totalRmbColumn: fobColumn + 1,
    notesColumn: fobColumn + 2
  };
}

function rowHasImage(worksheet, rowNumber) {
  return worksheet.getImages().some(image => {
    const nativeRow = image.range?.tl?.nativeRow;
    const modelRow = image.range?.tl?.row;
    const zeroBasedRow = Number.isInteger(nativeRow) ? nativeRow : modelRow;
    return Number.isFinite(zeroBasedRow) && Math.floor(zeroBasedRow) + 1 === rowNumber;
  });
}

function writeCell(worksheet, rowNumber, columnNumber, value) {
  if (!columnNumber || value === undefined || value === null || value === '') return;
  worksheet.getCell(rowNumber, columnNumber).value = value;
}

function isAttachmentValue(value) {
  return Boolean(
    value && typeof value === 'object' &&
    (value.kind === 'file' || value.kind === 'image') &&
    (value.path || value.relativePath)
  );
}

function findQuoteAttachment(quote) {
  if (quote && Object.prototype.hasOwnProperty.call(quote, '_rfqAttachment')) {
    return isAttachmentValue(quote._rfqAttachment) ? quote._rfqAttachment : null;
  }
  return Object.values(quote || {}).find(isAttachmentValue) || null;
}

function sanitizeAttachmentName(value) {
  return String(value || 'attachment')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'attachment';
}

function resolveAttachmentSource(attachment, quoteSet, outputPath) {
  if (attachment.path) return path.resolve(attachment.path);
  const workbookFolder = quoteSet.generatedFile
    ? path.dirname(quoteSet.generatedFile)
    : path.dirname(outputPath);
  return path.resolve(
    workbookFolder,
    String(attachment.relativePath || '').replace(/\//g, path.sep)
  );
}

function writeRfqNoteAttachment({
  workbook,
  worksheet,
  cell,
  attachment,
  quoteSet,
  outputPath,
  rowNumber,
  columnNumber,
  notesText
}) {
  const sourcePath = resolveAttachmentSource(attachment, quoteSet, outputPath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`备注附件不存在或已被移动：${attachment.name || sourcePath}`);
  }

  const baseName = path.basename(outputPath, path.extname(outputPath));
  const attachmentFolderName = `${baseName}_附件`;
  const attachmentFolder = path.join(path.dirname(outputPath), attachmentFolderName);
  fs.mkdirSync(attachmentFolder, { recursive: true });
  const targetName = `${String(rowNumber).padStart(4, '0')}_${sanitizeAttachmentName(
    attachment.name || path.basename(sourcePath)
  )}`;
  const targetPath = path.join(attachmentFolder, targetName);
  if (path.resolve(sourcePath).toLowerCase() !== path.resolve(targetPath).toLowerCase()) {
    fs.copyFileSync(sourcePath, targetPath);
  }
  const relativePath = `${attachmentFolderName}/${targetName}`;

  if (attachment.kind === 'image') {
    const extension = String(
      attachment.extension || path.extname(targetPath).slice(1)
    ).toLowerCase();
    const excelExtension = extension === 'jpg' ? 'jpeg' : extension;
    if (!['png', 'jpeg', 'gif'].includes(excelExtension)) {
      throw new Error(`Excel 不支持直接显示该图片格式：${attachment.name || targetName}`);
    }
    const imageId = workbook.addImage({ filename: targetPath, extension: excelExtension });
    worksheet.addImage(imageId, {
      tl: { col: columnNumber - 1 + 0.08, row: rowNumber - 1 + 0.08 },
      ext: { width: 106, height: 72 },
      editAs: 'oneCell'
    });
    cell.value = notesText || attachment.name || '图片';
    cell.alignment = { horizontal: 'left', vertical: 'bottom', wrapText: true };
    worksheet.getRow(rowNumber).height = Math.max(worksheet.getRow(rowNumber).height || 20, 62);
    return;
  }

  cell.value = {
    text: [notesText, `打开附件：${attachment.name || targetName}`].filter(Boolean).join('\n'),
    hyperlink: relativePath,
    tooltip: '点击打开备注附件'
  };
  cell.font = { ...cell.font, color: { argb: 'FF0563C1' }, underline: true };
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
}

function findLabelValueCell(worksheet, headerRow, labels) {
  const wanted = new Set(labels.map(normalizeText));
  const maxCols = Math.min(worksheet.columnCount || 1, 80);
  for (let rowNumber = 1; rowNumber < headerRow; rowNumber++) {
    for (let colNumber = 1; colNumber <= maxCols; colNumber++) {
      if (!wanted.has(normalizeText(cellText(worksheet.getCell(rowNumber, colNumber))))) continue;
      return worksheet.getCell(rowNumber, colNumber + 1);
    }
  }
  return null;
}

async function fillRfqWorkbook({
  sourceFile,
  sheetName,
  headerRow,
  metadata = {},
  items = [],
  selections = [],
  quoteSets = [],
  outputPath,
  options = {}
}) {
  const selectionMap = new Map(selections.map(selection => [
    selection.item_id || selection.itemId,
    selection
  ]));
  const quoteSetMap = new Map(quoteSets.map(quoteSet => [quoteSet.id, quoteSet]));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourceFile);
  const worksheet = workbook.getWorksheet(sheetName) || workbook.worksheets[0];

  // 检测表头行和现有列
  const outputColumns = prepareOutputColumns(worksheet, items);
  const header = outputColumns.header;
  const headerRowNum = header.rowNumber;

  // 找到表格最后一列（取表头行最右侧非空列和 columnCount 的较大值）
  const existingCols = Object.values(header.columns).filter(Number.isFinite);

  // 取表头行已有单元格的样式作为新列表头参考
  const refHeaderCell = existingCols.length > 0
    ? worksheet.getCell(headerRowNum, Math.min(...existingCols))
    : null;

  // 在表格末尾新增三列
  const fobCol = outputColumns.fobColumn;
  const totalRmbCol = outputColumns.totalRmbColumn;
  const notesCol = outputColumns.notesColumn;

  // 表头样式：优先复用原表头样式，否则用默认
  const headerFont = refHeaderCell?.font && Object.keys(refHeaderCell.font).length > 0
    ? { ...refHeaderCell.font }
    : { name: '微软雅黑', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  const headerFill = refHeaderCell?.fill && refHeaderCell.fill.type
    ? { ...refHeaderCell.fill }
    : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  const headerAlign = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const headerBorder = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' }
  };

  function applyHeaderStyle(cell, value) {
    cell.value = value;
    cell.font = headerFont;
    cell.fill = headerFill;
    cell.alignment = headerAlign;
    cell.border = headerBorder;
  }

  applyHeaderStyle(worksheet.getCell(headerRowNum, fobCol), 'FOB');
  applyHeaderStyle(worksheet.getCell(headerRowNum, totalRmbCol), '总价');
  applyHeaderStyle(worksheet.getCell(headerRowNum, notesCol), '备注');

  worksheet.getColumn(fobCol).width = 16;
  worksheet.getColumn(totalRmbCol).width = 18;
  worksheet.getColumn(notesCol).width = 22;
  worksheet.getColumn(fobCol).hidden = false;
  worksheet.getColumn(totalRmbCol).hidden = false;
  worksheet.getColumn(notesCol).hidden = false;
  worksheet.getRow(headerRowNum).height = Math.max(worksheet.getRow(headerRowNum).height || 20, 24);

  // 填充每行的数据
  const dataBorder = {
    top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
  };

  for (const item of items) {
    const selection = selectionMap.get(item.id);
    if (!selection) continue;

    const quoteEntryId = selection.quote_entry_id || selection.quoteEntryId;
    const quoteSet = quoteSetMap.get(quoteEntryId) || {};
    const quote = selection.selected_data || selection.selectedData || {};
    const labels = quoteSet.fieldLabels || {};
    const rowNumber = item.source_row || item.sourceRow;

    // 美金成本(FOB)：取 usdCost，否则用 price / 汇率 / 税率 换算
    const directUsd = quoteFieldValue(quote, labels, ['usdCost', 'usdPrice'], FIELD_ALIASES.unitPriceUsd);
    let fobValue = numericValue(directUsd);
    if (!fobValue) {
      const rmbPrice = quoteFieldValue(quote, labels, ['price'], FIELD_ALIASES.totalRmb);
      const rate = numericValue(options.exchangeRate || quoteSet.options?.exchangeRate) || 7.25;
      const taxDiv = (options.invoiceType || quoteSet.options?.invoiceType) === 'regular' ? 1 : 1.13;
      fobValue = numericValue(rmbPrice) / rate / taxDiv;
    }

    // Fill the customer's existing RFQ columns as the primary output.
    if (fobValue && header.columns.unitPriceUsd) {
      const unitPriceCell = worksheet.getCell(rowNumber, header.columns.unitPriceUsd);
      unitPriceCell.value = Number(fobValue.toFixed(2));
      unitPriceCell.numFmt = '$#,##0.00';
    }
    if (fobValue && header.columns.totalPriceUsd && header.columns.quantity) {
      const quantity = numericValue(worksheet.getCell(rowNumber, header.columns.quantity).value);
      const totalPriceCell = worksheet.getCell(rowNumber, header.columns.totalPriceUsd);
      totalPriceCell.value = {
        formula: `${columnLetter(header.columns.unitPriceUsd)}${rowNumber}*${columnLetter(header.columns.quantity)}${rowNumber}`,
        result: Number((fobValue * quantity).toFixed(2))
      };
      totalPriceCell.numFmt = '$#,##0.00';
    }

    writeCell(
      worksheet,
      rowNumber,
      header.columns.paymentTerms,
      quoteFieldValue(quote, labels, ['paymentTerms', 'paymentMethod'], FIELD_ALIASES.paymentTerms)
    );
    writeCell(
      worksheet,
      rowNumber,
      header.columns.country,
      quoteFieldValue(quote, labels, ['country'], FIELD_ALIASES.country)
    );
    writeCell(
      worksheet,
      rowNumber,
      header.columns.importType,
      quoteFieldValue(quote, labels, ['importType', 'shippingMethod'], FIELD_ALIASES.importType)
    );
    writeCell(
      worksheet,
      rowNumber,
      header.columns.deliveryTime,
      quoteFieldValue(quote, labels, ['deliveryTime', 'delivery', 'leadTime'], FIELD_ALIASES.deliveryTime)
    );

    if (fobValue) {
      const fobCell = worksheet.getCell(rowNumber, fobCol);
      fobCell.value = Number(fobValue.toFixed(2));
      fobCell.numFmt = '$#,##0.00';
      fobCell.alignment = { horizontal: 'right', vertical: 'middle' };
      fobCell.border = dataBorder;
    }

    // 含税运总价(¥)：取 RMB 单价
    const rmbValue = quoteFieldValue(quote, labels, ['price', 'totalPrice'], FIELD_ALIASES.totalRmb);
    if (numericValue(rmbValue)) {
      const rmbCell = worksheet.getCell(rowNumber, totalRmbCol);
      rmbCell.value = Number(numericValue(rmbValue).toFixed(2));
      rmbCell.numFmt = '¥#,##0.00';
      rmbCell.alignment = { horizontal: 'right', vertical: 'middle' };
      rmbCell.border = dataBorder;
    }

    // 备注
    const notesValue = quote._rfqNotes ?? quoteFieldValue(
      quote,
      labels,
      ['notes', 'afterSales'],
      FIELD_ALIASES.notes
    );
    const notesText = typeof notesValue === 'string' || typeof notesValue === 'number'
      ? String(notesValue).trim()
      : '';
    const notesAttachment = findQuoteAttachment(quote);
    if (notesText || notesAttachment) {
      const notesCell = worksheet.getCell(rowNumber, notesCol);
      notesCell.border = dataBorder;
      if (notesAttachment) {
        writeRfqNoteAttachment({
          workbook,
          worksheet,
          cell: notesCell,
          attachment: notesAttachment,
          quoteSet,
          outputPath,
          rowNumber,
          columnNumber: notesCol,
          notesText
        });
      } else {
        notesCell.value = notesText;
        notesCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      }
    }

    // 确保行高足够
    const currentHeight = worksheet.getRow(rowNumber).height || 18;
    worksheet.getRow(rowNumber).height = Math.max(currentHeight, 20);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
  return { workbook, worksheet, header, filePath: outputPath };
}

class RfqManager {
  constructor(databaseProvider, sourcesDir) {
    this.databaseProvider = databaseProvider;
    this.sourcesDir = sourcesDir;
    fs.mkdirSync(this.sourcesDir, { recursive: true });
  }

  async importProject(sourcePath) {
    if (!fs.existsSync(sourcePath)) throw new Error('文件不存在，请重新选择');
    if (path.extname(sourcePath).toLowerCase() !== '.xlsx') {
      throw new Error('内测版目前只支持 .xlsx 文件');
    }
    const stats = fs.statSync(sourcePath);
    if (stats.size <= 0 || stats.size > 50 * 1024 * 1024) {
      throw new Error('文件为空或超过 50MB');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(sourcePath);
    const { worksheet, header } = findBestSheet(workbook);
    const parsedItems = parseItems(worksheet, header);
    const projectId = uuidv4();
    const storedPath = path.join(this.sourcesDir, `${projectId}.xlsx`);
    fs.copyFileSync(sourcePath, storedPath);

    const metadata = {
      ...readHeaderMetadata(worksheet, header.rowNumber),
      detectedFields: header.labels,
      detectedColumns: header.columns
    };
    const now = new Date().toISOString();
    const defaultName = [
      metadata.customer,
      path.basename(sourcePath, path.extname(sourcePath))
    ].filter(Boolean).join(' - ');
    const db = this.databaseProvider();
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO rfq_projects (
          id, name, source_file, original_name, sheet_name, header_row,
          status, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
      `).run(
        projectId,
        defaultName || path.basename(sourcePath),
        storedPath,
        path.basename(sourcePath),
        worksheet.name,
        header.rowNumber,
        JSON.stringify(metadata),
        now,
        now
      );
      const insertItem = db.prepare(`
        INSERT INTO rfq_items (
          id, project_id, line_no, source_row, item_key, data, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of parsedItems) {
        insertItem.run(
          uuidv4(),
          projectId,
          item.lineNo,
          item.sourceRow,
          item.itemKey,
          JSON.stringify(item.data),
          now,
          now
        );
      }
    });
    try {
      transaction();
    } catch (error) {
      try { fs.unlinkSync(storedPath); } catch (cleanupError) { /* ignore */ }
      throw error;
    }
    return this.getProject(projectId);
  }

  listProjects() {
    return this.databaseProvider().prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM rfq_items i WHERE i.project_id = p.id) item_count,
        (SELECT COUNT(*) FROM rfq_selections s WHERE s.project_id = p.id) selected_count
      FROM rfq_projects p
      ORDER BY p.updated_at DESC
    `).all().map(row => ({
      ...row,
      metadata: this._parseJson(row.metadata, {})
    }));
  }

  getProject(projectId) {
    const db = this.databaseProvider();
    const project = db.prepare('SELECT * FROM rfq_projects WHERE id = ?').get(projectId);
    if (!project) throw new Error('询价项目不存在');
    const items = db.prepare(`
      SELECT * FROM rfq_items WHERE project_id = ? ORDER BY line_no
    `).all(projectId).map(row => ({ ...row, data: this._parseJson(row.data, {}) }));
    const selections = db.prepare(`
      SELECT * FROM rfq_selections WHERE project_id = ?
    `).all(projectId).map(row => ({
      ...row,
      selected_data: this._parseJson(row.selected_data, {})
    }));
    return {
      ...project,
      metadata: this._parseJson(project.metadata, {}),
      items,
      selections
    };
  }

  deleteProject(projectId) {
    const db = this.databaseProvider();
    const project = db.prepare('SELECT source_file FROM rfq_projects WHERE id = ?').get(projectId);
    if (!project) return false;
    db.prepare('DELETE FROM rfq_projects WHERE id = ?').run(projectId);
    if (project.source_file && fs.existsSync(project.source_file)) {
      fs.unlinkSync(project.source_file);
    }
    return true;
  }

  saveQuoteSet(payload = {}) {
    const db = this.databaseProvider();
    const id = payload.id || uuidv4();
    const now = new Date().toISOString();
    const data = {
      name: payload.name || `供应商询价 ${new Date().toLocaleDateString('zh-CN')}`,
      templateId: payload.templateId || null,
      templateName: payload.templateName || '',
      batches: Array.isArray(payload.batches) ? payload.batches : [],
      fieldLabels: payload.fieldLabels || {},
      options: payload.options || {},
      generatedFile: payload.generatedFile || '',
      savedAt: now
    };
    db.prepare(`
      INSERT OR REPLACE INTO data_entries (id, type, data, created_at, updated_at)
      VALUES (?, 'supplier_quote_set', ?,
        COALESCE((SELECT created_at FROM data_entries WHERE id = ?), ?), ?)
    `).run(id, JSON.stringify(data), id, now, now);
    return { id, ...data };
  }

  listQuoteSets() {
    return this.databaseProvider().prepare(`
      SELECT id, data, created_at, updated_at
      FROM data_entries
      WHERE type = 'supplier_quote_set'
      ORDER BY updated_at DESC
    `).all().map(row => ({
      id: row.id,
      ...this._parseJson(row.data, {}),
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  saveSelections(projectId, selections = []) {
    const project = this.getProject(projectId);
    const itemIds = new Set(project.items.map(item => item.id));
    const db = this.databaseProvider();
    const now = new Date().toISOString();
    const upsert = db.prepare(`
      INSERT INTO rfq_selections (
        id, project_id, item_id, quote_entry_id, quote_item_index,
        supplier_name, selected_data, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, item_id) DO UPDATE SET
        quote_entry_id = excluded.quote_entry_id,
        quote_item_index = excluded.quote_item_index,
        supplier_name = excluded.supplier_name,
        selected_data = excluded.selected_data,
        updated_at = excluded.updated_at
    `);
    const transaction = db.transaction(() => {
      for (const selection of selections) {
        if (!itemIds.has(selection.itemId)) throw new Error('中选记录与询价项目不匹配');
        upsert.run(
          uuidv4(),
          projectId,
          selection.itemId,
          selection.quoteEntryId,
          Number(selection.quoteItemIndex) || 0,
          selection.supplierName || '',
          JSON.stringify(selection.selectedData || {}),
          now,
          now
        );
      }
      db.prepare(`
        UPDATE rfq_projects SET status = ?, updated_at = ? WHERE id = ?
      `).run(selections.length >= project.items.length ? 'selected' : 'draft', now, projectId);
    });
    transaction();
    return this.getProject(projectId);
  }

  async generateFilled(projectId, selections, outputPath, options = {}) {
    if (!outputPath) throw new Error('请选择保存位置');
    const project = this.getProject(projectId);
    if (!fs.existsSync(project.source_file)) throw new Error('项目原始询价单文件已丢失');
    if (!Array.isArray(selections) || selections.length !== project.items.length) {
      throw new Error('每个询价产品都必须选择一家供应商');
    }
    await this.saveSelections(projectId, selections);
    const savedProject = this.getProject(projectId);
    await fillRfqWorkbook({
      sourceFile: project.source_file,
      sheetName: project.sheet_name,
      headerRow: project.header_row,
      metadata: project.metadata,
      items: savedProject.items,
      selections: savedProject.selections,
      quoteSets: this.listQuoteSets(),
      outputPath,
      options
    });
    const now = new Date().toISOString();
    this.databaseProvider().prepare(`
      UPDATE rfq_projects SET status = 'generated', updated_at = ? WHERE id = ?
    `).run(now, projectId);
    return { success: true, filePath: outputPath, project: this.getProject(projectId) };
  }

  _parseJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
}

module.exports = {
  RfqManager,
  FIELD_ALIASES,
  normalizeText,
  detectField,
  detectHeader,
  findBestSheet,
  parseItems,
  calculateUsdUnitPrice,
  fillRfqWorkbook
};
