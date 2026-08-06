const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let db;
let dbPath;

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        file_path TEXT NOT NULL,
        thumbnail TEXT,
        is_builtin INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS field_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id TEXT NOT NULL,
        template_field TEXT NOT NULL,
        system_field TEXT NOT NULL,
        FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS data_entries (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS generation_history (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        template_name TEXT,
        data_summary TEXT,
        file_path TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS custom_system_fields (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL UNIQUE,
        category TEXT DEFAULT '自定义字段',
        data_type TEXT NOT NULL DEFAULT 'text',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `
  },
  {
    version: 2,
    name: 'drafts_and_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS data_entry_drafts (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 3,
    name: 'rfq_workflow',
    sql: `
      CREATE TABLE IF NOT EXISTS rfq_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_file TEXT NOT NULL,
        original_name TEXT NOT NULL,
        sheet_name TEXT NOT NULL,
        header_row INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rfq_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        source_row INTEGER NOT NULL,
        item_key TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES rfq_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rfq_selections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        quote_entry_id TEXT NOT NULL,
        quote_item_index INTEGER NOT NULL,
        supplier_name TEXT,
        selected_data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, item_id),
        FOREIGN KEY (project_id) REFERENCES rfq_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES rfq_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rfq_items_project
      ON rfq_items(project_id, line_no);

      CREATE INDEX IF NOT EXISTS idx_rfq_selections_project
      ON rfq_selections(project_id);
    `
  }
];

function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database.prepare('SELECT version FROM schema_migrations').all().map(row => row.version)
  );
  const applyMigration = database.transaction(migration => {
    database.exec(migration.sql);
    database.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `).run(migration.version, migration.name, new Date().toISOString());
    database.pragma(`user_version = ${migration.version}`);
  });

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) applyMigration(migration);
  }
}

function initDatabase() {
  dbPath = path.join(app.getPath('userData'), 'excel-generator.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // 尝试清理可能残留的 WAL 日志
  try { fs.unlinkSync(dbPath + '-wal'); } catch (_) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch (_) {}

  const existingDatabase = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;

  let needsRecovery = false;
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  } catch (e) {
    console.warn('数据库打开失败，将备份旧文件并重建:', e.message);
    if (db) { try { db.close(); } catch (_) {} db = null; }
    const backupName = `${dbPath}.corrupted-${Date.now()}`;
    try { fs.renameSync(dbPath, backupName); } catch (_) {
      try { fs.copyFileSync(dbPath, backupName); fs.unlinkSync(dbPath); } catch (__) {}
    }
    try { fs.unlinkSync(dbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch (_) {}
    needsRecovery = true;
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }

  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (!needsRecovery) {
    const currentVersion = db.pragma('user_version', { simple: true });
    const targetVersion = MIGRATIONS[MIGRATIONS.length - 1].version;
    if (existingDatabase && currentVersion < targetVersion) {
      try { db.pragma('wal_checkpoint(FULL)'); } catch (_) {}
      const backupsDir = path.join(path.dirname(dbPath), 'backups');
      fs.mkdirSync(backupsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(
        dbPath,
        path.join(backupsDir, `excel-generator-${timestamp}-before-migration-v${currentVersion}.db`)
      );
    }
  }
  runMigrations(db);
  return db;
}

function getDatabase() {
  return db;
}

function getDatabasePath() {
  return dbPath || path.join(app.getPath('userData'), 'excel-generator.db');
}

function closeDatabase() {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    // 数据库关闭前检查点失败时仍继续关闭，SQLite 会在下次启动恢复 WAL。
  }
  db.close();
  db = null;
}

module.exports = {
  MIGRATIONS,
  initDatabase,
  getDatabase,
  getDatabasePath,
  closeDatabase,
  runMigrations
};
