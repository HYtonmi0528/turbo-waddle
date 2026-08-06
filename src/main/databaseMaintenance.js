const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  getDatabase,
  getDatabasePath,
  closeDatabase,
  initDatabase
} = require('./database');

const BACKUP_RETENTION = 10;
const REQUIRED_TABLES = ['templates', 'field_mappings', 'data_entries', 'generation_history'];

function getBackupsDir() {
  return path.join(path.dirname(getDatabasePath()), 'backups');
}

function formatBackupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function listDatabaseBackups() {
  const backupsDir = getBackupsDir();
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^excel-generator-.*\.db$/i.test(entry.name))
    .map(entry => {
      const filePath = path.join(backupsDir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        name: entry.name,
        path: filePath,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function pruneDatabaseBackups(retention = BACKUP_RETENTION) {
  const backups = listDatabaseBackups();
  const expired = backups.slice(Math.max(0, retention));
  for (const backup of expired) {
    fs.rmSync(backup.path, { force: true });
  }
  return expired.length;
}

function createDatabaseBackup(reason = 'manual') {
  const database = getDatabase();
  const sourcePath = getDatabasePath();
  const backupsDir = getBackupsDir();
  fs.mkdirSync(backupsDir, { recursive: true });
  database.pragma('wal_checkpoint(FULL)');

  const safeReason = String(reason || 'manual').replace(/[^a-z0-9_-]/gi, '-');
  const backupPath = path.join(
    backupsDir,
    `excel-generator-${formatBackupTimestamp()}-${safeReason}.db`
  );
  fs.copyFileSync(sourcePath, backupPath);
  pruneDatabaseBackups();
  return {
    success: true,
    path: backupPath,
    size: fs.statSync(backupPath).size
  };
}

function createAutomaticBackupIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  const database = getDatabase();
  const lastBackup = database.prepare(
    "SELECT value FROM app_settings WHERE key = 'last_automatic_backup'"
  ).get();
  if (lastBackup?.value === today) return null;

  const result = createDatabaseBackup('automatic');
  database.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('last_automatic_backup', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(today, new Date().toISOString());
  return result;
}

function validateDatabaseBackup(candidatePath) {
  const resolved = path.resolve(candidatePath);
  if (!fs.existsSync(resolved) || path.extname(resolved).toLowerCase() !== '.db') {
    throw new Error('请选择有效的 .db 数据库备份文件');
  }

  const candidate = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`数据库完整性检查失败：${integrity}`);
    const tables = new Set(candidate.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map(row => row.name));
    const missing = REQUIRED_TABLES.filter(name => !tables.has(name));
    if (missing.length > 0) throw new Error(`备份缺少必要数据表：${missing.join('、')}`);
  } finally {
    candidate.close();
  }
  return resolved;
}

function restoreDatabaseBackup(candidatePath) {
  const sourcePath = validateDatabaseBackup(candidatePath);
  const safetyBackup = createDatabaseBackup('before-restore');
  const targetPath = getDatabasePath();
  const temporaryPath = `${targetPath}.restore.tmp`;
  closeDatabase();

  try {
    fs.copyFileSync(sourcePath, temporaryPath);
    fs.rmSync(targetPath, { force: true });
    fs.renameSync(temporaryPath, targetPath);
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${targetPath}${suffix}`, { force: true });
    }
    initDatabase();
    return { success: true, path: targetPath };
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    if (!fs.existsSync(targetPath) && fs.existsSync(safetyBackup.path)) {
      fs.copyFileSync(safetyBackup.path, targetPath);
    }
    initDatabase();
    throw error;
  }
}

module.exports = {
  BACKUP_RETENTION,
  REQUIRED_TABLES,
  getBackupsDir,
  formatBackupTimestamp,
  listDatabaseBackups,
  pruneDatabaseBackups,
  createDatabaseBackup,
  createAutomaticBackupIfNeeded,
  validateDatabaseBackup,
  restoreDatabaseBackup
};
