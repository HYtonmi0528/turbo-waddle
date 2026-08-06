const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { importRfqWorkbook } = require('./rfqImporter');

const EXPORT_FIELDS = {
  fobUsd: { label: 'FOB', aliases: ['fob', 'precio fob', 'fob (usd)'] },
  totalRmb: { label: '总价', aliases: ['总价', '人民币总价', '含税含运', '含税运人民币'] },
  remarks: { label: '备注', aliases: ['备注', 'observación', 'observacion', 'remarks'] }
};

function cellScalar(cell) {
  const value = cell?.value;
  if (value == null) return '';
  if (typeof value !== 'object') return value;
  if (value.text != null) return value.text;
  if (value.result != null) return value.result;
  if (value.hyperlink != null) return value.text || value.hyperlink;
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  return '';
}

function normalize(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[：:]$/, '')
    .replace(/\s+/g, ' ');
}

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function lastMeaningfulColumn(sheet) {
  let maxColumn = 1;
  for (let rowNo = 1; rowNo <= sheet.rowCount; rowNo += 1) {
    for (let colNo = 1; colNo <= sheet.columnCount; colNo += 1) {
      if (normalize(cellScalar(sheet.getRow(rowNo).getCell(colNo)))) {
        maxColumn = Math.max(maxColumn, colNo);
      }
    }
  }
  return maxColumn;
}

function lastPopulatedColumn(row, maximum) {
  for (let colNo = maximum; colNo >= 1; colNo -= 1) {
    if (normalize(cellScalar(row.getCell(colNo)))) return colNo;
  }
  return 1;
}

function lastStyledColumn(row, maximum) {
  for (let colNo = maximum; colNo >= 1; colNo -= 1) {
    if (row.getCell(colNo).hasStyle) return colNo;
  }
  return Math.max(1, maximum);
}

function findHeaderColumn(sheet, headerRow, aliases) {
  const row = sheet.getRow(headerRow);
  for (let colNo = 1; colNo <= sheet.columnCount; colNo += 1) {
    const header = normalize(cellScalar(row.getCell(colNo)));
    if (aliases.some(alias => header === normalize(alias))) return colNo;
  }
  return null;
}

function ensureExportColumns(sheet, headerRow) {
  const columns = {};
  const meaningfulColumn = lastMeaningfulColumn(sheet);
  let nextColumn = meaningfulColumn + 1;
  const header = sheet.getRow(headerRow);
  const headerStyleColumn = lastStyledColumn(header, lastPopulatedColumn(header, meaningfulColumn));
  const headerStyleSource = header.getCell(headerStyleColumn);

  for (const [field, definition] of Object.entries(EXPORT_FIELDS)) {
    let colNo = findHeaderColumn(sheet, headerRow, definition.aliases);
    if (!colNo) {
      colNo = nextColumn;
      nextColumn += 1;
      const cell = header.getCell(colNo);
      cell.value = definition.label;
      cell.style = cloneStyle(headerStyleSource.style);
      cell.alignment = { ...(cell.alignment || {}), horizontal: 'center', vertical: 'middle', wrapText: true };
      sheet.getColumn(colNo).width = field === 'remarks' ? 28 : 14;
    }
    columns[field] = colNo;
  }
  return columns;
}

async function exportCompletedRfq(sourcePath, outputPath, completedItems) {
  const imported = await importRfqWorkbook(sourcePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const sheet = workbook.getWorksheet(imported.sheetName);
  if (!sheet) throw new Error('原始询价单工作表不存在');
  const columns = ensureExportColumns(sheet, imported.headerRow);

  for (const completed of completedItems) {
    const importedItem = imported.items.find(item => Number(item.lineNo) === Number(completed.lineNo));
    if (!importedItem) continue;
    const row = sheet.getRow(importedItem.sourceRow);
    const styleColumn = lastStyledColumn(row, columns.fobUsd - 1);
    const styleSource = row.getCell(styleColumn);
    for (const colNo of Object.values(columns)) {
      if (!row.getCell(colNo).hasStyle) row.getCell(colNo).style = cloneStyle(styleSource.style);
    }
    row.getCell(columns.fobUsd).value = completed.fobUsd == null ? null : Number(completed.fobUsd);
    row.getCell(columns.totalRmb).value = completed.totalRmb == null ? null : Number(completed.totalRmb);
    row.getCell(columns.remarks).value = completed.remarks || null;
    row.getCell(columns.fobUsd).numFmt = '$#,##0.00';
    row.getCell(columns.totalRmb).numFmt = '¥#,##0.00';
    row.getCell(columns.remarks).alignment = { ...(row.getCell(columns.remarks).alignment || {}), wrapText: true, vertical: 'top' };

    const attachments = Array.isArray(completed.attachments) ? completed.attachments : [];
    const available = attachments.filter(file => file.storagePath && fs.existsSync(file.storagePath));
    if (available.length) {
      const attachmentDirName = `${path.basename(outputPath, path.extname(outputPath))}_附件`;
      const attachmentDir = path.join(path.dirname(outputPath), attachmentDirName);
      fs.mkdirSync(attachmentDir, { recursive: true });
      const copied = available.map((file, index) => {
        const safeName = `${index + 1}_${path.basename(file.name || file.storagePath).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}`;
        fs.copyFileSync(file.storagePath, path.join(attachmentDir, safeName));
        return { ...file, safeName, relativePath: `${attachmentDirName}/${safeName}` };
      });
      const remarksCell = row.getCell(columns.remarks);
      const note = String(completed.remarks || '').trim();
      const firstFile = copied.find(file => file.kind !== 'image') || copied[0];
      remarksCell.value = {
        text: [note, `附件：${copied.map(file => file.name).join('、')}`].filter(Boolean).join('\n'),
        hyperlink: firstFile.relativePath,
        tooltip: '点击打开附件'
      };
      const image = copied.find(file => file.kind === 'image');
      if (image) {
        const extension = path.extname(image.safeName).slice(1).toLowerCase();
        if (['png', 'jpeg', 'jpg', 'gif'].includes(extension)) {
          const imageId = workbook.addImage({ filename: path.join(attachmentDir, image.safeName), extension: extension === 'jpg' ? 'jpeg' : extension });
          workbook.getWorksheet(sheet.name).addImage(imageId, {
            tl: { col: columns.remarks - 1, row: importedItem.sourceRow - 1 },
            ext: { width: 90, height: 64 },
            editAs: 'oneCell'
          });
          row.height = Math.max(row.height || 18, 52);
        }
      }
    }
  }

  await workbook.xlsx.writeFile(outputPath);
  return { sheetName: sheet.name, headerRow: imported.headerRow, columns };
}

module.exports = { exportCompletedRfq, EXPORT_FIELDS };
