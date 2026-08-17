const { createApp } = require('./app');
const { loadConfig } = require('./lib/config');
const { ensureServerSchema } = require('./lib/db');
const os = require('os');

function getLanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal).map(item => item.address);
}

async function start() {
  const config = loadConfig();
  await ensureServerSchema();
  const app = createApp();
  app.listen(config.server.port, config.server.host, () => {
    console.log(`LATIC询价协作服务已启动：http://${config.server.host}:${config.server.port}`);
    const addresses = getLanAddresses();
    if (addresses.length) console.log(`局域网访问地址：${addresses.map(address => `http://${address}:${config.server.port}`).join('、')}`);
  });
}

start().catch(error => {
  console.error('服务器启动失败：', error.message);
  process.exitCode = 1;
});
