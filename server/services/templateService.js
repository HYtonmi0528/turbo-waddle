const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { getPool } = require('../lib/db');
const { loadConfig } = require('../lib/config');
const {
  DEFAULT_TEMPLATE_FIELDS,
  inferSystemFieldKey,
  normalizeFieldName,
  normalizePersistedMapping
} = require('../../src/shared/templateMappings');

function numberValue(val) {
  const n = Number(String(val || '').replace(/[¥￥$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function getTemplatesDir() {
  const config = loadConfig();
  const dir = path.join(config.storageDir, 'templates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildGeneratedTemplateStructure(fields) {
  const normalizedFields = [...new Set((Array.isArray(fields) && fields.length ? fields : DEFAULT_TEMPLATE_FIELDS)
    .map(field => String(field || '').replace(/\{\{|\}\}/g, '').trim())
    .filter(Boolean))];
  const columns = normalizedFields.map((field, index) => ({
    index: index + 1,
    colNumber: index + 1,
    sourceColNumber: index + 1,
    header: field,
    name: field,
    field,
    type: 'text',
    width: 120
  }));
  return {
    structure: { headerRow: 1, columns, sheetName: 'Sheet1' },
    fields: normalizedFields,
    mappings: normalizedFields.map(field => ({
      templateField: field,
      systemField: inferSystemFieldKey(field, [], { allowUnknown: true })
    }))
  };
}

async function createGeneratedTemplateFile(templateId, fields) {
  const { structure, fields: normalizedFields, mappings } = buildGeneratedTemplateStructure(fields);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(structure.sheetName);
  normalizedFields.forEach((field, index) => {
    const cell = sheet.getCell(1, index + 1);
    cell.value = `{{${field}}}`;
    cell.font = { name: '微软雅黑', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sheet.getColumn(index + 1).width = Math.max(12, Math.min(32, field.length + 6));
  });
  sheet.getRow(1).height = 24;
  const storagePath = path.join(getTemplatesDir(), `${templateId}.xlsx`);
  await workbook.xlsx.writeFile(storagePath);
  return { storagePath, structure, mappings };
}

async function listTemplates(userId) {
  const [rows] = await getPool().execute(
    `SELECT id, name, type, description, original_name AS originalName,
     structure_json AS structure, mappings_json AS mappings, is_shared AS isShared,
     storage_path AS storagePath, created_at AS createdAt, updated_at AS updatedAt
     FROM user_templates WHERE owner_id = ? OR is_shared = 1 ORDER BY updated_at DESC`,
    [userId]
  );
  return rows.map(row => ({
    ...row,
    name: decodeUploadedName(row.name) || '未命名模板',
    originalName: decodeUploadedName(row.originalName),
    structure: parseJson(row.structure),
    mappings: parseJson(row.mappings)
  }));
}

async function deleteTemplate(userId, templateId) {
  const [[row]] = await getPool().execute(
    'SELECT storage_path FROM user_templates WHERE id = ? AND owner_id = ?',
    [templateId, userId]
  );
  if (!row) throw new Error('模板不存在或无权操作');
  if (row.storage_path) try { fs.unlinkSync(row.storage_path); } catch (_) {}
  await getPool().execute('DELETE FROM user_templates WHERE id = ?', [templateId]);
}

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (_) { return null; }
}

function decodeUploadedName(value) {
  if (value == null) return value;
  const text = String(value).replace(/^\uFEFF/, '').trim();
  if (/[ÃÂèéêëåæç鍏妯璇�]/.test(text)) {
    try {
      const repaired = Buffer.from(text, 'latin1').toString('utf8');
      if (repaired && !repaired.includes('�')) return repaired;
    } catch (_) {}
  }
  return text;
}

async function generateExcel(templateId, batches, options = {}) {
  const [[row]] = await getPool().execute(
    `SELECT id, name, type, storage_path, structure_json, mappings_json
     FROM user_templates WHERE id = ?`, [templateId]
  );
  if (!row || !row.storage_path || !fs.existsSync(row.storage_path)) {
    throw new Error('模板不存在或文件已丢失');
  }
  const structure = parseJson(row.structure_json);
  const mappings = parseJson(row.mappings_json) || [];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(row.storage_path);
  const sheet = workbook.getWorksheet(1);
  if (!sheet) throw new Error('模板中没有找到工作表');

  const headerRow = structure ? structure.headerRow : detectHeaderRow(sheet);
  const colMap = buildColumnMap(sheet, headerRow, mappings, structure);

  const outputPath = path.join(loadConfig().storageDir, 'generated', `${Date.now()}-${templateId}.xlsx`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let outRow = headerRow + 1;
  const batchList = Array.isArray(batches) ? batches : (batches ? [batches] : []);

  for (const batch of batchList) {
    if (batch.category) {
      const cell = sheet.getCell(outRow, 1);
      cell.value = batch.category;
      cell.font = { bold: true, size: 13 };
      outRow++;
    }
    for (const item of (batch.items || [batch])) {
      for (const col of colMap) {
        const cell = sheet.getCell(outRow, col.colIndex);
        let val = item[col.field] !== undefined ? item[col.field] : '';
        if (col.isNumber && val !== '') val = numberValue(val);
        if (val !== null && val !== undefined && val !== '') cell.value = val;
      }
      outRow++;
    }
  }

  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

function detectHeaderRow(sheet) {
  for (let r = 1; r <= Math.min(40, sheet.rowCount); r++) {
    let hits = 0;
    const row = sheet.getRow(r);
    row.eachCell({ includeEmpty: false }, cell => {
      const v = String(cell.value || '').trim();
      if (v.length > 0 && v.length < 50) hits++;
    });
    if (hits >= 3) return r;
  }
  return 1;
}

function buildColumnMap(sheet, headerRow, mappings, structure) {
  const map = [];
  const fields = getFieldNames(sheet, headerRow);
  const normalizedMappings = (mappings || [])
    .map(mapping => normalizePersistedMapping(mapping))
    .filter(mapping => mapping.templateField && mapping.systemField);
  fields.forEach((fieldName, idx) => {
    const colIndex = idx + 1;
    const mapping = normalizedMappings.find(m =>
      normalizeFieldName(m.templateField) === normalizeFieldName(fieldName)
    );
    if (mapping) {
      map.push({ colIndex, field: mapping.systemField, isNumber: false });
    }
  });
  if (map.length === 0 && structure && structure.columns) {
    structure.columns.forEach(col => {
      map.push({ colIndex: col.colIndex || col.index, field: col.field, isNumber: col.type === 'number' });
    });
  }
  return map;
}

function getFieldNames(sheet, headerRow) {
  const fields = [];
  const row = sheet.getRow(headerRow);
  row.eachCell({ includeEmpty: true }, (cell, colNum) => {
    let value = cell.value;
    if (value && typeof value === 'object' && Array.isArray(value.richText)) value = value.richText.map(part => part.text || '').join('');
    fields[colNum - 1] = String(value || '').replace(/^\uFEFF/, '').replace(/\{\{|\}\}/g, '').trim();
  });
  return fields;
}

async function parseTemplateStructure(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(1);
  if (!sheet) throw new Error('模板中没有找到工作表');

  const headerRow = detectHeaderRow(sheet);
  const fields = getFieldNames(sheet, headerRow);
  const columns = fields.map((name, idx) => ({
    index: idx + 1,
    colNumber: idx + 1,
    sourceColNumber: idx + 1,
    header: name || `列${idx + 1}`,
    name: name || `列${idx + 1}`,
    field: name || `col_${idx + 1}`,
    type: 'text',
    width: 120
  }));

  const structure = { headerRow, columns, sheetName: sheet.name };
  return { structure, fields };
}

module.exports = {
  listTemplates,
  deleteTemplate,
  generateExcel,
  getTemplatesDir,
  parseTemplateStructure,
  decodeUploadedName,
  buildGeneratedTemplateStructure,
  createGeneratedTemplateFile
};
