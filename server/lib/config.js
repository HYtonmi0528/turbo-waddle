const fs = require('fs');
const path = require('path');

const configuredDataDir = process.env.LATIC_RFQ_DATA_DIR;
const isPackagedElectron = Boolean(process.versions.electron && process.type === 'browser' && !process.defaultApp);
const electronDataDir = isPackagedElectron
  ? path.join(process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd(), 'LATIC-RFQ-Collaboration', 'server-data')
  : null;
const sharedDataDir = process.env.ProgramData
  ? path.join(process.env.ProgramData, 'LATIC-RFQ-Collaboration', 'server-data')
  : null;
const dataDirCandidates = [
  configuredDataDir,
  electronDataDir,
  path.join(process.cwd(), 'server-data'),
  sharedDataDir
].filter(Boolean).map(candidate => path.resolve(candidate));
const explicitConfigPath = process.env.LATIC_RFQ_SERVER_CONFIG;
const detectedDataDir = explicitConfigPath
  ? path.dirname(path.resolve(explicitConfigPath))
  : dataDirCandidates.find(candidate => fs.existsSync(path.join(candidate, 'config.json')));
const dataDir = detectedDataDir || dataDirCandidates[0];
const configPath = path.resolve(explicitConfigPath || path.join(dataDir, 'config.json'));

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`尚未配置服务器，请先运行 npm run server:init。配置文件：${configPath}`);
  }
  const rawConfig = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  const config = JSON.parse(rawConfig);
  config.server = config.server || {};
  config.mysql = config.mysql || {};
  config.server.host = config.server.host || '0.0.0.0';
  config.server.port = Number(config.server.port || 3210);
  config.mysql.port = Number(config.mysql.port || 3306);
  config.externalApiKey = String(config.externalApiKey || '').trim();
  if (config.externalApiKey.length < 24) {
    const crypto = require('crypto');
    config.externalApiKey = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }
  const configuredStorageDir = String(config.storageDir || '').trim();
  config.storageDir = isPackagedElectron && !path.isAbsolute(configuredStorageDir)
    ? path.join(dataDir, 'files')
    : path.resolve(configuredStorageDir || path.join(dataDir, 'files'));
  if (!config.sessionSecret || config.sessionSecret.length < 16) {
    const crypto = require('crypto');
    config.sessionSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
  }
  fs.mkdirSync(config.storageDir, { recursive: true });
  return config;
}

module.exports = { dataDir, configPath, loadConfig };
