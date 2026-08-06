const MAX_TEMPLATE_COLUMNS = 256;
const MAX_SCAN_ROWS = 1000;

function isMergedSlave(cell) {
  return Boolean(cell?.isMerged && cell.master && cell.master.address !== cell.address);
}

function hasCellContent(cell) {
  if (!cell || isMergedSlave(cell)) return false;
  if (cell.value !== null && cell.value !== undefined && cell.value !== '') return true;
  return Boolean(cell.text && cell.text.trim());
}

function getEffectiveColumnCount(worksheet) {
  const columnLimit = Math.min(Math.max(worksheet.columnCount || 1, 1), MAX_TEMPLATE_COLUMNS);
  const rowLimit = Math.min(worksheet.rowCount || 1, MAX_SCAN_ROWS);
  let maxColumn = 1;

  for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    for (let columnNumber = 1; columnNumber <= columnLimit; columnNumber++) {
      if (hasCellContent(row.getCell(columnNumber))) maxColumn = Math.max(maxColumn, columnNumber);
    }
  }

  return maxColumn;
}

function forEachEffectiveCell(row, columnCount, callback) {
  const limit = Math.min(Math.max(columnCount || 1, 1), MAX_TEMPLATE_COLUMNS);
  for (let columnNumber = 1; columnNumber <= limit; columnNumber++) {
    const cell = row.getCell(columnNumber);
    if (hasCellContent(cell)) callback(cell, columnNumber);
  }
}

module.exports = {
  MAX_TEMPLATE_COLUMNS,
  MAX_SCAN_ROWS,
  getEffectiveColumnCount,
  forEachEffectiveCell
};
