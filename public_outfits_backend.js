// Roblox Profile outfits backend (V2, cursor pagination, no account allowlist).
// Node.js 18+; no dependencies.
const http = require('node:http');
const PORT = Number(process.env.PORT || 3000);
const PAGE_SIZE = 50;
const MAX_PAGE = 200;
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

async function getRobloxPage(userId, cursor) {
  const url = new URL(`https://avatar.roblox.com/v2/avatar/users/${userId}/outfits`);
  url.searchParams.set('itemsPerPage', String(PAGE_SIZE));
  url.searchParams.set('isEditable', 'true');
  if (cursor) url.searchParams.set('paginationToken', cursor);
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Roblox API HTTP ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.data)) throw new Error('Unexpected Roblox API response');
  return {
    outfits: data.data.filter(x => Number.isSafeInteger(x.id) && x.id > 0 && typeof x.name === 'string' && x.isEditable !== false)
      .map(x => ({ id: x.id, name: x.name.slice(0, 80) })),
    next: typeof data.paginationToken === 'string' ? data.paginationToken : '',
  };
}

async function getPage(userId, page) {
  let entry = cache.get(userId);
  if (!entry || Date.now() - entry.created > CACHE_MS) {
    entry = { created: Date.now(), cursors: [''], pages: new Map(), finished: false };
    cache.set(userId, entry);
  }
  if (entry.pages.has(page)) return entry.pages.get(page);
  for (let p = 1; p <= page; p++) {
    if (entry.pages.has(p)) continue;
    if (entry.finished || entry.cursors[p - 1] === undefined) {
      return { ok: true, outfits: [], hasMore: false, page: p, source: 'roblox-v2' };
    }
    const result = await getRobloxPage(userId, entry.cursors[p - 1]);
    const hasMore = result.next.length > 0;
    const item = { ok: true, outfits: result.outfits, hasMore, page: p, source: 'roblox-v2' };
    entry.pages.set(p, item);
    if (hasMore) entry.cursors[p] = result.next;
    else entry.finished = true;
  }
  return entry.pages.get(page);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/outfits') {
    res.writeHead(404); return res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  }
  const userId = url.searchParams.get('userId');
  const page = Number(url.searchParams.get('page') || 1);
  if (!/^\d{1,16}$/.test(userId || '') || !Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
    res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Invalid userId or page' }));
  }
  try {
    const result = await getPage(userId, page);
    return res.end(JSON.stringify(result));
  } catch (e) {
    cache.delete(userId);
    res.writeHead(502);
    return res.end(JSON.stringify({ ok: false, error: e.message || 'Roblox API unavailable' }));
  }
});
server.listen(PORT, '0.0.0.0');
