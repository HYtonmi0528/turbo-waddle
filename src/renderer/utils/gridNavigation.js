const GRID_ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function getGridNavigationTarget({
  key,
  rowIndex,
  columnIndex,
  rowCount,
  navigableColumns
}) {
  if (!GRID_ARROW_KEYS.has(key) || rowCount <= 0 || !Array.isArray(navigableColumns)) {
    return null;
  }

  const currentColumnPosition = navigableColumns.indexOf(columnIndex);
  if (currentColumnPosition < 0) return null;

  if (key === 'ArrowUp') {
    if (rowIndex <= 0) return null;
    return { rowIndex: rowIndex - 1, columnIndex, appendRow: false };
  }

  if (key === 'ArrowDown') {
    const appendRow = rowIndex >= rowCount - 1;
    return {
      rowIndex: appendRow ? rowCount : rowIndex + 1,
      columnIndex,
      appendRow
    };
  }

  const columnOffset = key === 'ArrowLeft' ? -1 : 1;
  const targetColumnPosition = currentColumnPosition + columnOffset;
  if (targetColumnPosition < 0 || targetColumnPosition >= navigableColumns.length) return null;

  return {
    rowIndex,
    columnIndex: navigableColumns[targetColumnPosition],
    appendRow: false
  };
}

function parseClipboardGrid(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n');
  while (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  return rows.map(row => row.split('\t'));
}

function applyGridPaste({
  items,
  fields,
  navigableColumns,
  startRow,
  startColumn,
  grid,
  createItem = () => ({})
}) {
  const startColumnPosition = navigableColumns.indexOf(startColumn);
  if (startColumnPosition < 0 || !Array.isArray(grid) || grid.length === 0) return null;

  const availableColumns = navigableColumns.slice(startColumnPosition);
  const updatedItems = (items || []).map(item => ({ ...item }));
  let pastedCells = 0;
  let lastRow = startRow;
  let lastColumn = startColumn;

  grid.forEach((rowValues, rowOffset) => {
    const targetRow = startRow + rowOffset;
    while (updatedItems.length <= targetRow) updatedItems.push({ ...createItem() });
    rowValues.slice(0, availableColumns.length).forEach((value, valueIndex) => {
      const targetColumn = availableColumns[valueIndex];
      const field = fields[targetColumn];
      if (!field) return;
      updatedItems[targetRow][field.key] = value;
      pastedCells++;
      lastRow = targetRow;
      lastColumn = targetColumn;
    });
  });

  return {
    items: updatedItems,
    pastedCells,
    pastedRows: grid.length,
    pastedColumns: Math.min(
      availableColumns.length,
      Math.max(0, ...grid.map(row => row.length))
    ),
    lastRow,
    lastColumn
  };
}

module.exports = {
  GRID_ARROW_KEYS,
  getGridNavigationTarget,
  parseClipboardGrid,
  applyGridPaste
};
