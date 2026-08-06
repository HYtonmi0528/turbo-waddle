const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { normalizeReleaseNotes } = require('./releaseNotes');
const { cleanupPendingUpdateCache } = require('./updateCleanup');
const { createDatabaseBackup } = require('./databaseMaintenance');

let mainWindow = null;
let checkIsManual = false;
let initialized = false;
let cleanupScheduled = false;
let automaticInstallTimer = null;
let status = {
  state: 'idle',
  currentVersion: '',
  availableVersion: null,
  percent: 0,
  message: '',
  releaseNotes: ''
};

function cleanError(error) {
  const message = error && error.message ? error.message : String(error || '未知错误');
  const cleaned = message
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/No published versions on GitHub/i.test(cleaned)) {
    return 'GitHub 仓库还没有已发布版本，请先创建并正式发布 Release';
  }
  return cleaned;
}

function getPendingNotesPath() {
  return path.join(app.getPath('userData'), 'pending-release-notes.json');
}

function savePendingReleaseNotes(info) {
  const notes = normalizeReleaseNotes(info?.releaseNotes) || status.releaseNotes;
  if (!info?.version || !notes) return;
  try {
    fs.writeFileSync(getPendingNotesPath(), JSON.stringify({
      version: info.version,
      notes,
      savedAt: new Date().toISOString()
    }), 'utf8');
  } catch (error) {
    // 更新文件已下载时，更新说明保存失败不应阻止安装。
  }
}

function getInstalledReleaseNotes() {
  try {
    const filePath = getPendingNotesPath();
    if (!fs.existsSync(filePath)) return null;
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (String(record.version) !== String(app.getVersion())) return null;
    return record;
  } catch (error) {
    return null;
  }
}

function acknowledgeInstalledReleaseNotes(version) {
  const record = getInstalledReleaseNotes();
  if (!record || String(record.version) !== String(version)) return false;
  try {
    fs.unlinkSync(getPendingNotesPath());
    cleanupPendingUpdateCache().catch(() => {});
    return true;
  } catch (error) {
    return false;
  }
}

function scheduleInstalledUpdateCleanup(delayMs = 15000) {
  if (cleanupScheduled || !getInstalledReleaseNotes()) return;
  cleanupScheduled = true;
  const timer = setTimeout(() => {
    cleanupPendingUpdateCache().catch(() => {});
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
}

function publish(next) {
  status = {
    ...status,
    ...next,
    currentVersion: app.getVersion()
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status);
  }
  return status;
}

function installDownloadedUpdate() {
  if (automaticInstallTimer) {
    clearTimeout(automaticInstallTimer);
    automaticInstallTimer = null;
  }
  if (!['downloaded', 'installing'].includes(status.state)) return false;
  publish({
    state: 'installing',
    percent: 100,
    message: '正在关闭程序并自动安装更新，安装完成后会重新打开…',
    silent: false
  });
  try {
    createDatabaseBackup('before-update');
  } catch (error) {
    // 更新前备份失败不阻止安装；用户数据仍保存在独立的 userData 目录。
  }
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

function scheduleAutomaticInstall(delayMs = 8000) {
  if (automaticInstallTimer) clearTimeout(automaticInstallTimer);
  automaticInstallTimer = setTimeout(() => installDownloadedUpdate(), delayMs);
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    return publish({
      state: 'unavailable',
      message: '开发模式不检查更新，请安装正式版后测试',
      silent: !manual
    });
  }

  if (['checking', 'downloading'].includes(status.state)) return status;

  checkIsManual = Boolean(manual);
  publish({ state: 'checking', percent: 0, message: '正在检查更新…', silent: !checkIsManual });

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    // electron-updater 同时会触发 error 事件；此处只防止未处理的 Promise 拒绝。
    if (status.state === 'checking') {
      publish({
        state: 'error',
        message: `更新检查失败：${cleanError(error)}`,
        silent: !checkIsManual
      });
    }
  }
  return status;
}

function initializeUpdateManager(window) {
  mainWindow = window;
  status.currentVersion = app.getVersion();
  scheduleInstalledUpdateCleanup();
  if (initialized) return;
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    publish({ state: 'checking', message: '正在检查更新…', silent: !checkIsManual });
  });

  autoUpdater.on('update-available', info => {
    publish({
      state: 'downloading',
      availableVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      percent: 0,
      message: `发现新版本 v${info.version}，正在后台下载…`,
      silent: false
    });
  });

  autoUpdater.on('update-not-available', () => {
    publish({
      state: 'not-available',
      availableVersion: null,
      releaseNotes: '',
      percent: 0,
      message: '当前已经是最新版本',
      silent: !checkIsManual
    });
    checkIsManual = false;
  });

  autoUpdater.on('download-progress', progress => {
    publish({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      message: '正在下载更新…',
      silent: false
    });
  });

  autoUpdater.on('update-downloaded', info => {
    savePendingReleaseNotes(info);
    publish({
      state: 'downloaded',
      availableVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes) || status.releaseNotes,
      percent: 100,
      message: `新版本 v${info.version} 已下载，程序将在 8 秒后自动安装并重新打开`,
      silent: false
    });
    scheduleAutomaticInstall();
    checkIsManual = false;
  });

  autoUpdater.on('error', error => {
    publish({
      state: 'error',
      message: `更新检查失败：${cleanError(error)}`,
      silent: !checkIsManual
    });
    checkIsManual = false;
  });
}

function registerUpdateIpcHandlers() {
  ipcMain.handle('update:getStatus', () => publish({}));
  ipcMain.handle('update:getInstalledReleaseNotes', () => getInstalledReleaseNotes());
  ipcMain.handle('update:acknowledgeReleaseNotes', (event, version) => acknowledgeInstalledReleaseNotes(version));
  ipcMain.handle('update:check', () => checkForUpdates(true));
  ipcMain.handle('update:restartAndInstall', () => {
    return installDownloadedUpdate();
  });
}

function scheduleAutomaticUpdateCheck(delayMs = 8000) {
  const timer = setTimeout(() => checkForUpdates(false), delayMs);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
  initializeUpdateManager,
  registerUpdateIpcHandlers,
  scheduleAutomaticUpdateCheck,
  checkForUpdates,
  cleanError,
  installDownloadedUpdate,
  scheduleAutomaticInstall
};
