function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeReleaseNotes(releaseNotes) {
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map(item => {
        if (typeof item === 'string') return stripHtml(item);
        const version = item?.version ? `v${String(item.version).replace(/^v/i, '')}` : '';
        const note = stripHtml(item?.note || item?.notes || '');
        return [version, note].filter(Boolean).join('\n');
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  return stripHtml(releaseNotes);
}

module.exports = { normalizeReleaseNotes, stripHtml };
