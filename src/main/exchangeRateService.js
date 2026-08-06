const fs = require('fs');
const path = require('path');
const https = require('https');

const RATE_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY';

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseRatePayload(payload) {
  const rate = Number(payload?.rates?.CNY);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 20) {
    throw new Error('汇率服务返回了无效的 USD/CNY 数据');
  }
  return {
    rate,
    referenceDate: String(payload.date || localDateKey())
  };
}

function requestJson(url = RATE_URL) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'ExcelTemplateGenerator/1.0' },
      timeout: 8000
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`汇率服务响应异常（${response.statusCode}）`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 100 * 1024) {
          request.destroy(new Error('汇率服务响应过大'));
        }
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error('无法解析汇率服务响应'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('获取今日汇率超时')));
    request.on('error', reject);
  });
}

class ExchangeRateService {
  constructor(cacheDir, fetchPayload = requestJson) {
    this.cachePath = path.join(cacheDir, 'exchange-rate-cache.json');
    this.fetchPayload = fetchPayload;
  }

  readCache() {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      const cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      return Number.isFinite(Number(cache.rate)) ? cache : null;
    } catch (error) {
      return null;
    }
  }

  writeCache(cache) {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify(cache), 'utf8');
    } catch (error) {
      // 缓存失败不应影响本次汇率结果。
    }
  }

  async getToday(force = false) {
    const checkedDate = localDateKey();
    const cached = this.readCache();
    if (!force && cached?.checkedDate === checkedDate) {
      return { success: true, ...cached, cached: true };
    }

    try {
      const parsed = parseRatePayload(await this.fetchPayload(RATE_URL));
      const result = {
        rate: parsed.rate,
        referenceDate: parsed.referenceDate,
        checkedDate,
        fetchedAt: new Date().toISOString(),
        source: 'Frankfurter / 央行参考汇率'
      };
      this.writeCache(result);
      return { success: true, ...result, cached: false };
    } catch (error) {
      return {
        success: false,
        message: error.message || '无法获取今日汇率',
        stale: cached || null
      };
    }
  }
}

module.exports = {
  RATE_URL,
  ExchangeRateService,
  localDateKey,
  parseRatePayload,
  requestJson
};
