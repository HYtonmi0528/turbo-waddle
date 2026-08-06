const fs = require('fs');
const { createApp } = require('./app');
const { configPath, loadConfig } = require('./lib/config');
const { ensureServerSchema } = require('./lib/db');

let server;

async function startEmbeddedServerIfConfigured() {
  if (server || !fs.existsSync(configPath)) return server;
  const config = loadConfig();
  await ensureServerSchema();
  const app = createApp();
  await new Promise((resolve, reject) => {
    server = app.listen(config.server.port, config.server.host, resolve);
    server.once('error', reject);
  });
  console.log(`内置协作服务已启动：http://${config.server.host}:${config.server.port}`);
  return server;
}

module.exports = { startEmbeddedServerIfConfigured };
