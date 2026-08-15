// Web-only behavior that is easier to maintain outside the generated API shim.
(function () {
  if (!window.electronAPI) return;
  const downloadBlob = (blob, name) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = String(name || 'generated.xlsx').split(/[\\/]/).pop();
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  window.electronAPI.excel.generate = function (payload) {
    return fetch('/api/excel/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(async response => {
      if (!response.ok) {
        let message = '生成失败';
        try { message = (await response.json()).message || message; } catch (_) {}
        throw new Error(message);
      }
      const blob = await response.blob();
      const name = payload?.fileName || payload?.savePath || 'generated.xlsx';
      downloadBlob(blob, name);
      return { success: true, filePath: String(name).split(/[\\/]/).pop() };
    }).catch(error => ({ success: false, message: error.message }));
  };

  window.electronAPI.exchangeRate.getToday = function (params) {
    return fetch('/api/exchange-rate' + (params?.force ? '?force=1' : ''), {
      credentials: 'same-origin'
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '汇率请求失败');
      return { success: data.success !== false, ...data };
    }).catch(() => ({
      success: true,
      rate: 7.25,
      referenceDate: new Date().toISOString().slice(0, 10),
      source: '默认值',
      stale: true,
      message: '汇率服务暂时不可用，已保留当前汇率'
    }));
  };
}());
