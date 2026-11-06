// Roblox saved outfits: V2 primary, V1 editable-only fallback.
// Node.js 18+, no dependencies. Never treats catalog items as saved outfits.
const http = require('node:http');
const PORT = Number(process.env.PORT || 3000);
const PAGE_SIZE = 50;
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map();

async function jsonFrom(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Roblox HTTP ${r.status}`);
  const body = await r.json();
  if (!body || !Array.isArray(body.data)) throw new Error('Unexpected Roblox response');
  return body;
}
function clean(rows) {
  const seen = new Set();
  return rows.filter(x => x && Number.isSafeInteger(x.id) && x.id > 0 && typeof x.name === 'string' && x.isEditable !== false)
    .filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; })
    .map(x => ({ id: x.id, name: x.name.slice(0, 80) }));
}
async function v2(userId, cursor) {
  const u = new URL(`https://avatar.roblox.com/v2/avatar/users/${userId}/outfits`);
  u.searchParams.set('itemsPerPage', String(PAGE_SIZE));
  u.searchParams.set('isEditable', 'true');
  if (cursor) u.searchParams.set('paginationToken', cursor);
  const body = await jsonFrom(u);
  return { outfits: clean(body.data), next: typeof body.paginationToken === 'string' ? body.paginationToken : '' };
}
async function v1(userId, page) {
  const u = new URL(`https://avatar.roblox.com/v1/users/${userId}/outfits`);
  u.searchParams.set('page', String(page));
  u.searchParams.set('itemsPerPage', String(PAGE_SIZE));
  u.searchParams.set('isEditable', 'true');
  const body = await jsonFrom(u);
  const total = Number(body.total);
  const hasMore = Number.isFinite(total) ? page * PAGE_SIZE < total : body.data.length === PAGE_SIZE;
  return { outfits: clean(body.data), hasMore };
}
async function getPage(userId, page) {
  let state = cache.get(userId);
  if (!state || Date.now() - state.created > CACHE_MS) {
    state = { created: Date.now(), mode: null, cursors: [''], pages: new Map(), finished: false };
    cache.set(userId, state);
  }
  if (state.pages.has(page)) return state.pages.get(page);
  for (let p = 1; p <= page; p++) {
    if (state.pages.has(p)) continue;
    if (state.finished) return { ok: true, outfits: [], hasMore: false, page, source: state.mode, availability: 'end' };
    let rows, hasMore, source;
    if (state.mode === 'v1') {
      const result = await v1(userId, p);
      rows = result.outfits; hasMore = result.hasMore; source = 'roblox-v1-fallback';
    } else {
      let result;
      try { result = await v2(userId, state.cursors[p - 1] || ''); }
      catch (err) {
        if (p !== 1 || state.mode === 'v2') throw err;
        result = null;
      }
      if (p === 1 && (!result || (result.outfits.length === 0 && !result.next))) {
        // The editable-only V1 API sometimes returns saved outfits missing from V2.
        // Do not use isEditable=false: it may return catalog/inventory assets.
        const old = await v1(userId, 1);
        if (old.outfits.length > 0 || !result) {
          state.mode = 'v1'; rows = old.outfits; hasMore = old.hasMore; source = 'roblox-v1-fallback';
        } else {
          state.mode = 'v2'; rows = result.outfits; hasMore = false; source = 'roblox-v2';
        }
      } else {
        state.mode = 'v2'; rows = result.outfits; hasMore = !!result.next; source = 'roblox-v2';
        if (hasMore) state.cursors[p] = result.next;
      }
    }
    const item = { ok: true, outfits: rows, hasMore, page: p, source,
      availability: rows.length === 0 && !hasMore ? 'not_publicly_available' : 'available' };
    state.pages.set(p, item);
    if (!hasMore) state.finished = true;
  }
  return state.pages.get(page);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/outfits') { res.writeHead(404); return res.end(JSON.stringify({ ok: false, error: 'Not found' })); }
  const userId = url.searchParams.get('userId');
  const page = Number(url.searchParams.get('page') || 1);
  if (!/^\d{1,16}$/.test(userId || '') || !Number.isSafeInteger(page) || page < 1 || page > 200) {
    res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Invalid userId or page' }));
  }
  try { return res.end(JSON.stringify(await getPage(userId, page))); }
  catch (e) { cache.delete(userId); res.writeHead(502); return res.end(JSON.stringify({ ok: false, error: String(e.message || 'Roblox API unavailable') })); }
});
server.listen(PORT, '0.0.0.0');
