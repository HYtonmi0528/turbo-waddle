const { createApp } = require('./app');
const { loadConfig } = require('./lib/config');
const { ensureServerSchema } = require('./lib/db');

async function start() {
  const config = loadConfig();
  await ensureServerSchema();
  const app = createApp();
  app.listen(config.server.port, config.server.host, () => {
    console.log(`LATIC询价协作服务已启动：http://${config.server.host}:${config.server.port}`);
  });
}

start().catch(error => {
  console.error('服务器启动失败：', error.message);
  process.exitCode = 1;
});
