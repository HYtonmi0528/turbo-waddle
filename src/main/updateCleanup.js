const fs = require('fs');
const os = require('os');
const path = require('path');

const UPDATER_CACHE_DIR_NAME = 'excel-template-generator-updater';

function getBaseCachePath(env = process.env) {
  if (process.platform === 'win32') {
    return env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches');
  return env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
}

function getUpdaterCachePaths(baseCachePath = getBaseCachePath()) {
  const cacheDir = path.resolve(baseCachePath, UPDATER_CACHE_DIR_NAME);
  const pendingDir = path.resolve(cacheDir, 'pending');
  if (path.basename(cacheDir) !== UPDATER_CACHE_DIR_NAME || path.dirname(pendingDir) !== cacheDir) {
    throw new Error('更新缓存路径校验失败');
  }
  return { cacheDir, pendingDir };
}

async function cleanupPendingUpdateCache(baseCachePath = getBaseCachePath()) {
  const { pendingDir } = getUpdaterCachePaths(baseCachePath);
  if (!fs.existsSync(pendingDir)) return { removed: 0, bytes: 0 };

  const entries = await fs.promises.readdir(pendingDir, { withFileTypes: true });
  let removed = 0;
  let bytes = 0;
  for (const entry of entries) {
    const target = path.resolve(pendingDir, entry.name);
    if (path.dirname(target) !== pendingDir) continue;
    try {
      if (entry.isFile()) bytes += (await fs.promises.stat(target)).size;
      await fs.promises.rm(target, { recursive: true, force: true });
      removed++;
    } catch (error) {
      // 安装程序句柄尚未释放时保留下次启动再清理。
    }
  }
  return { removed, bytes };
}

module.exports = {
  UPDATER_CACHE_DIR_NAME,
  getUpdaterCachePaths,
  cleanupPendingUpdateCache
};
