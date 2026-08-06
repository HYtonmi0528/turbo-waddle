const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-template-generator-db-smoke-'));
app.setPath('userData', userDataPath);

app.whenReady().then(() => {
  const { initDatabase, getDatabase, closeDatabase } = require('../src/main/database');
  const {
    createDatabaseBackup,
    validateDatabaseBackup
  } = require('../src/main/databaseMaintenance');

  try {
    const db = initDatabase();
    const tables = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map(row => row.name));
    for (const required of [
      'schema_migrations',
      'data_entry_drafts',
      'app_settings',
      'rfq_projects',
      'rfq_items',
      'rfq_selections'
    ]) {
      if (!tables.has(required)) throw new Error(`missing table: ${required}`);
    }

    getDatabase().prepare(`
      INSERT INTO data_entry_drafts (id, template_id, payload, created_at, updated_at)
      VALUES ('smoke', 'template', '{"ok":true}', ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());

    const backup = createDatabaseBackup(userDataPath, 'smoke');
    validateDatabaseBackup(backup.path);
    process.stdout.write(JSON.stringify({
      migrations: db.prepare('SELECT COUNT(*) count FROM schema_migrations').get().count,
      backupExists: fs.existsSync(backup.path),
      backupSize: backup.size
    }));
    closeDatabase();
    fs.rmSync(userDataPath, { recursive: true, force: true });
    app.quit();
  } catch (error) {
    try { closeDatabase(); } catch (closeError) {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
    process.stderr.write(error.stack || error.message);
    app.exit(1);
  }
});
