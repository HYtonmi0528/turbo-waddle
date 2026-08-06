const { getPool } = require('../lib/db');

const CACHE_KEY = 'exchange-rate-cache';

async function getToday(force = false) {
  if (!force) {
    const [[row]] = await getPool().execute(
      'SELECT setting_value FROM app_settings WHERE user_id = ? AND setting_key = ?', ['system', CACHE_KEY]
    );
    if (row) {
      try {
        const cached = JSON.parse(row.setting_value);
        if (cached.date === new Date().toISOString().slice(0, 10)) {
          return cached;
        }
      } catch (_) {}
    }
  }

  try {
    const resp = await fetch('https://api.frankfurter.dev/latest?from=USD&to=CNY', {
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) throw new Error('API unavailable');
    const data = await resp.json();
    const result = { rate: data.rates.CNY, date: data.date, source: 'frankfurter.dev' };
    await getPool().execute(
      `INSERT INTO app_settings (user_id, setting_key, setting_value, updated_at)
       VALUES ('system', ?, ?, NOW()) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
      [CACHE_KEY, JSON.stringify(result)]
    );
    return result;
  } catch (_) {
    return { rate: 7.25, date: new Date().toISOString().slice(0, 10), source: '默认' };
  }
}

module.exports = { getToday };
