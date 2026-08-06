const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline/promises');
const mysql = require('mysql2/promise');
const { stdin, stdout } = require('process');
const { dataDir, configPath } = require('../lib/config');

function getArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find(arg => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const host = getArg('host') || await rl.question('MySQL地址 [127.0.0.1]：') || '127.0.0.1';
    const port = Number(getArg('port') || await rl.question('MySQL端口 [3306]：') || 3306);
    const rootUser = getArg('root-user') || await rl.question('MySQL管理员账号 [root]：') || 'root';
    const rootPassword = getArg('root-password') ?? await rl.question('MySQL管理员密码：');
    const appPassword = crypto.randomBytes(24).toString('base64url');

    const root = await mysql.createConnection({ host, port, user: rootUser, password: rootPassword });
    await root.query('CREATE DATABASE IF NOT EXISTS `latic_rfq` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
    await root.query("CREATE USER IF NOT EXISTS 'latic_rfq_app'@'localhost' IDENTIFIED BY ?", [appPassword]);
    await root.query("ALTER USER 'latic_rfq_app'@'localhost' IDENTIFIED BY ?", [appPassword]);
    await root.query("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON `latic_rfq`.* TO 'latic_rfq_app'@'localhost'");
    await root.end();

    fs.mkdirSync(dataDir, { recursive: true });
    const storageDir = path.join(dataDir, 'files');
    fs.mkdirSync(storageDir, { recursive: true });
    const config = {
      server: { host: '0.0.0.0', port: 3210 },
      mysql: {
        host,
        port,
        user: 'latic_rfq_app',
        password: appPassword,
        database: 'latic_rfq'
      },
      storageDir
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    const appConnection = await mysql.createConnection({ ...config.mysql, multipleStatements: true });
    await appConnection.query(schema);
    await appConnection.end();

    console.log(`\n数据库初始化完成。`);
    console.log(`配置文件：${configPath}`);
    console.log('下一步运行：npm run server');
  } finally {
    rl.close();
  }
}

main().catch(error => {
  console.error(`初始化失败：${error.message}`);
  process.exitCode = 1;
});
