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
    await getPool().query(`CREATE TABLE IF NOT EXISTS app_settings (
      user_id CHAR(36) NOT NULL, setting_key VARCHAR(120) NOT NULL, setting_value TEXT,
      updated_at DATETIME(3) NOT NULL, PRIMARY KEY (user_id, setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
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

  try {
    await getPool().query("ALTER TABLE documents MODIFY category VARCHAR(80) NOT NULL DEFAULT 'other'");
  } catch (_) {}
  try {
    const [documentColumns] = await getPool().query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents'`);
    const existingDocumentColumns = new Set(documentColumns.map(row => row.COLUMN_NAME));
    for (const [column, definition] of [
      ['archive_category', 'VARCHAR(80) NULL AFTER entity_id'],
      ['archive_date', 'DATE NULL AFTER archive_category'],
      ['archive_folder', 'VARCHAR(255) NULL AFTER archive_date'],
      ['archive_name', 'VARCHAR(255) NULL AFTER archive_folder']
    ]) {
      if (!existingDocumentColumns.has(column)) await getPool().query(`ALTER TABLE documents ADD COLUMN \`${column}\` ${definition}`);
    }
    await getPool().query('CREATE INDEX idx_documents_archive ON documents (archive_category, archive_date, archive_folder)');
  } catch (_) {}
  try {
    await getPool().query(`CREATE TABLE IF NOT EXISTS documents (
      id CHAR(36) PRIMARY KEY, original_name VARCHAR(255) NOT NULL, storage_path VARCHAR(600) NOT NULL,
      mime_type VARCHAR(160), file_size BIGINT UNSIGNED NOT NULL DEFAULT 0, file_ext VARCHAR(20),
      category VARCHAR(80) NOT NULL DEFAULT 'other',
      entity_type VARCHAR(60), entity_id CHAR(36), visibility ENUM('all','department','private','admin') NOT NULL DEFAULT 'all',
      archive_category VARCHAR(80), archive_date DATE, archive_folder VARCHAR(255), archive_name VARCHAR(255),
      version_no INT NOT NULL DEFAULT 1, checksum CHAR(64), status ENUM('active','deleted') NOT NULL DEFAULT 'active',
      created_by CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, deleted_at DATETIME(3),
      INDEX idx_documents_search (status, category, created_at), INDEX idx_documents_entity (entity_type, entity_id, version_no),
      INDEX idx_documents_archive (archive_category, archive_date, archive_folder),
      INDEX idx_documents_name (original_name), INDEX idx_documents_creator (created_by, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } catch (_) {}

  try {
    await getPool().query(`CREATE TABLE IF NOT EXISTS external_rfq_submissions (
      id CHAR(36) PRIMARY KEY, external_request_id VARCHAR(120), title VARCHAR(255) NOT NULL,
      requester VARCHAR(120), country VARCHAR(120), client_name VARCHAR(180), request_date DATE,
      deadline DATETIME(3), original_name VARCHAR(255) NOT NULL, storage_path VARCHAR(600) NOT NULL,
      metadata_json JSON, parsed_items_json JSON,
      status ENUM('received','accepted','rejected') NOT NULL DEFAULT 'received', received_at DATETIME(3) NOT NULL,
      reviewed_at DATETIME(3), reviewed_by CHAR(36), rejection_reason TEXT, task_id CHAR(36),
      UNIQUE KEY uq_external_request_id (external_request_id), INDEX idx_external_status_received (status, received_at),
      INDEX idx_external_task (task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } catch (_) {}
}

module.exports = { getPool, withTransaction, ensureServerSchema };
