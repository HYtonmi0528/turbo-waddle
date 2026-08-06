const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

let logDir;
try {
  const { loadConfig } = require('./config');
  logDir = path.join(loadConfig().storageDir, 'logs');
} catch (_) {
  logDir = path.join(__dirname, '..', '..', 'server-data', 'logs');
}

fs.mkdirSync(logDir, { recursive: true });

const rotate = new winston.transports.DailyRotateFile({
  dirname: logDir,
  filename: 'server-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d',
  maxSize: '50m',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, stack }) =>
      `${timestamp} [${level.toUpperCase()}] ${stack || message}`
    )
  )
});

const logger = winston.createLogger({
  level: 'info',
  transports: [
    rotate,
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

module.exports = { logger };
