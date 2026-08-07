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

  try {
    await getPool().query(`CREATE TABLE IF NOT EXISTS quote_sets (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, name VARCHAR(200) NOT NULL,
      project_id CHAR(36), options_json JSON, field_labels_json JSON,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      INDEX idx_quotes_user (user_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } catch (_) {}
  try {
    await getPool().query(`CREATE TABLE IF NOT EXISTS quote_items (
      id CHAR(36) PRIMARY KEY, quote_set_id CHAR(36) NOT NULL, item_index INT NOT NULL,
      supplier_name VARCHAR(255), model VARCHAR(200), reference VARCHAR(200),
      description TEXT, price DECIMAL(18,4), total_price DECIMAL(18,4), total_rmb DECIMAL(18,4),
      notes TEXT, after_sales TEXT, data_json JSON,
      created_at DATETIME(3) NOT NULL,
      INDEX idx_qitems_set (quote_set_id, item_index)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } catch (_) {}

  try {
    await getPool().query(`CREATE TABLE IF NOT EXISTS task_comments (
      id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
      content TEXT NOT NULL, created_at DATETIME(3) NOT NULL,
      INDEX idx_comments_task (task_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } catch (_) {}
}

module.exports = { getPool, withTransaction, ensureServerSchema };
