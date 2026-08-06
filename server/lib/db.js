const mysql = require('mysql2/promise');
const { loadConfig } = require('./config');

let pool;

function getPool() {
  if (!pool) {
    const config = loadConfig();
    pool = mysql.createPool({
      ...config.mysql,
      waitForConnections: true,
      connectionLimit: 12,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'Z',
      decimalNumbers: true
    });
  }
  return pool;
}

async function withTransaction(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function ensureServerSchema() {
  const required = [
    ['total_rmb', 'DECIMAL(18,4) NULL AFTER total_usd'],
    ['exchange_rate', 'DECIMAL(18,6) NULL AFTER total_rmb'],
    ['invoice_type', 'VARCHAR(30) NULL AFTER exchange_rate'],
    ['selected_supplier', 'VARCHAR(255) NULL AFTER invoice_type'],
    ['selected_quote_json', 'JSON NULL AFTER selected_supplier']
  ];
  const [rows] = await getPool().query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rfq_items'`
  );
  const existing = new Set(rows.map(row => row.COLUMN_NAME));
  for (const [column, definition] of required) {
    if (!existing.has(column)) {
      await getPool().query(`ALTER TABLE rfq_items ADD COLUMN \`${column}\` ${definition}`);
    }
  }

  try {
    const [[colInfo]] = await getPool().query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
    );
    if (colInfo && !colInfo.COLUMN_TYPE.includes('manager')) {
      await getPool().query("ALTER TABLE users MODIFY role ENUM('admin','manager','purchaser','viewer') NOT NULL DEFAULT 'viewer'");
    }
  } catch (_) {}
}

module.exports = { getPool, withTransaction, ensureServerSchema };
