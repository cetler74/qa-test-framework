/**
 * Normalize ticket URL list from DB row (supports legacy single ticket_url).
 * @param {object} row - Sequelize plain object or similar
 * @returns {string[]}
 */
function normalizeTicketUrlsList(row) {
  if (!row || typeof row !== 'object') return [];
  const arr = row.ticket_urls;
  if (Array.isArray(arr) && arr.length > 0) {
    return arr.map((u) => String(u).trim()).filter(Boolean).slice(0, 30);
  }
  if (row.ticket_url && String(row.ticket_url).trim()) {
    return [String(row.ticket_url).trim()];
  }
  return [];
}

/**
 * Parse ticket_urls from API request body (array preferred; legacy ticket_url string).
 * @param {object} body
 * @returns {string[]}
 */
function persistTicketUrlsFromBody(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.ticket_urls)) {
    return body.ticket_urls.map((u) => String(u).trim()).filter(Boolean).slice(0, 30);
  }
  if (typeof body.ticket_url === 'string' && body.ticket_url.trim()) {
    return [body.ticket_url.trim()];
  }
  return [];
}

/**
 * Values to persist on ProjectTest model.
 * @param {string[]} urls
 * @returns {{ ticket_urls: string[]|null, ticket_url: string|null }}
 */
function ticketUrlsForDb(urls) {
  const list = Array.isArray(urls) ? urls : [];
  if (list.length === 0) {
    return { ticket_urls: [], ticket_url: null };
  }
  return { ticket_urls: list, ticket_url: list[0] };
}

/**
 * Parse CSV cell: multiple URLs separated by | or newlines.
 * @param {string} cell
 * @returns {string[]}
 */
function parseTicketUrlsFromCsvCell(cell) {
  if (cell == null || String(cell).trim() === '') return [];
  const s = String(cell).trim();
  if (s.includes('|')) {
    return s.split('|').map((x) => x.trim()).filter(Boolean).slice(0, 30);
  }
  return s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
}

/**
 * Join for CSV export (semicolon-separated file uses | inside cell for multiple URLs).
 * @param {string[]} urls
 * @returns {string}
 */
function ticketUrlsToCsvCell(urls) {
  if (!urls || !urls.length) return '';
  return urls.join('|');
}

module.exports = {
  normalizeTicketUrlsList,
  persistTicketUrlsFromBody,
  ticketUrlsForDb,
  parseTicketUrlsFromCsvCell,
  ticketUrlsToCsvCell
};
