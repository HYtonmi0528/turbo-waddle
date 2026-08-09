import React, { useEffect, useState, useCallback } from 'react';

function formatCell(value) {
  if (value === null || value === undefined) return <span className="db-cell-null">NULL</span>;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text.length > 200) return text.slice(0, 200) + '…';
  return text;
}

export default function DatabaseBrowser() {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(0);
  const [customSql, setCustomSql] = useState('');
  const [error, setError] = useState('');
  const pageSize = 100;

  const loadTables = useCallback(async () => {
    try {
      const result = await window.electronAPI.database.getTables();
      setTables(result || []);
    } catch (_) { setTables([]); setError('无法加载数据库表，请确认服务已启动'); }
  }, []);

  useEffect(() => { loadTables(); }, [loadTables]);

  const loadTable = useCallback(async (tableName, pageNum = 0) => {
    setError('');
    try {
      const result = await window.electronAPI.database.getTableData(tableName, pageNum, pageSize);
      setColumns(result.columns || []);
      setRows(result.rows || []);
      setTotalRows(result.total || 0);
      setPage(pageNum);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, []);

  const selectTable = (tableName) => {
    setSelectedTable(tableName);
    setCustomSql('');
    loadTable(tableName, 0);
  };

  const runCustomSql = async () => {
    setError('');
    try {
      const result = await window.electronAPI.database.runQuery(customSql.trim());
      setColumns(result.columns || []);
      setRows(result.rows || []);
      setTotalRows(result.rows?.length || 0);
      setPage(0);
      setSelectedTable('');
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const totalPages = Math.ceil(totalRows / pageSize);

  return (
    <div className="db-browser">
      <div className="db-sidebar">
        <h3 className="db-sidebar-title">协作 MySQL 表</h3>
        <p className="text-sm text-muted" style={{ lineHeight: 1.5, marginBottom: 12 }}>
          每张表对应一个业务对象；详细字段和关联关系见项目 docs/database-dictionary.md。
        </p>
        {tables.map(t => (
          <button
            key={t.name}
            className={`db-table-btn ${selectedTable === t.name ? 'active' : ''}`}
            onClick={() => selectTable(t.name)}
          >
            <span>{t.name}</span>
            <span className="db-row-count">{t.rowCount}</span>
          </button>
        ))}
        <div className="db-custom-section">
          <h4>自定义查询</h4>
          <textarea
            className="db-sql-input"
            value={customSql}
            onChange={e => setCustomSql(e.target.value)}
            placeholder="SELECT * FROM templates LIMIT 10"
            rows={4}
          />
          <button className="btn btn-primary btn-sm" onClick={runCustomSql}>执行查询</button>
        </div>
      </div>
      <div className="db-main">
        <div className="db-main-header">
          <h2>{selectedTable || 'SQL 查询结果'}</h2>
          {totalRows > 0 && <span className="db-info">{totalRows} 行 · {columns.length} 列</span>}
        </div>
        {error && <div className="collab-form-error">{error}</div>}
        {columns.length > 0 && (
          <>
            <div className="table-container db-table-wrap">
              <table className="data-table db-data-table">
                <thead>
                  <tr>{columns.map(col => <th key={col}>{col}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map(col => <td key={col}>{formatCell(row[col])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="db-pagination">
                <button className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => loadTable(selectedTable, page - 1)}>上一页</button>
                <span>{page + 1} / {totalPages}</span>
                <button className="btn btn-outline btn-sm" disabled={page >= totalPages - 1} onClick={() => loadTable(selectedTable, page + 1)}>下一页</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
