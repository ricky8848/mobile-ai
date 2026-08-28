// mobile ai（移动AI）· 本地 mock 控制面：无 CF / 无 D1，内存态。
// 与 src/index.js 暴露完全相同的 API（含 /admin/*），供 P2b 本机 E2E：
//   node mock-server.mjs            # http://127.0.0.1:6420
//   MOCK_PORT=xxxx node mock-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import { activate, heartbeat, rotate, issueCode, markOrderPaid, ensureUser, markEmail, apply, consumeMagicLink, createSession, sessionUser, mePayload,
  paymentInfoFromEnv, createAdminSession, adminSessionOk, deleteAdminSession, revokeBinding, adminBindings } from './src/core.js';
import { landingPage, loginErrorPage, mePage, adminLoginPage, adminDashboard } from './src/site.js';

const PORT = Number(process.env.MOCK_PORT || 6420);
export const DOMAIN = 'newapi.email';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';

/* ---------------- 内存 db（与 index.js 的 D1 适配器同接口） ---------------- */
const users = new Map(), codes = new Map(), bindings = new Map(); // key: 主键
const orders = [];
const magicLinks = new Map(), sessionsMap = new Map(); const emailsArr = []; // P3/P4 内存态
const adminSessionsMap = new Map(); // P6 管理端会话（cookie mai_admin）

export const db = {
  code: (c) => codes.get(c),
  user: (id) => users.get(id),
  userByEmail: async (e) => { for (const u of users.values()) if (u.email === e) return u; return null; },
  bindingByMachine: async (mc) => { let r = null; for (const b of bindings.values()) if (b.machine_code === mc && (!r || b.created_at > r.created_at)) r = b; return r; },
  bindingBySubdomain: async (sub) => { for (const b of bindings.values()) if (b.subdomain === sub) return b; return null; },
  async bindingsForUser(uid, statuses) { const r = []; for (const b of bindings.values()) if (b.user_id === uid && statuses.includes(b.status)) r.push(b); return r.sort((a, b) => b.created_at - a.created_at); },
  redeemCode: async (c, ts) => { const k = codes.get(c); if (k && k.status === 'issued') { k.status = 'redeemed'; k.updated_at = ts; } },
  createBinding: async (r) => { bindings.set(r.id, { created_at: r.created_at || Date.now(), updated_at: r.updated_at || Date.now(), ...r }); },
  updateBinding: async (id, fields, ts) => { const b = bindings.get(id); if (!b) return; Object.assign(b, fields, { updated_at: ts }); },
  createUser: async (r) => { users.set(r.id, { ...r }); },
  updateUser: async (id, fields, ts) => { const u = users.get(id); if (!u) return; Object.assign(u, fields, { updated_at: ts }); },
  createCode: async (r) => { codes.set(r.code, { ...r }); },
  createOrder: async (r) => { orders.push({ ...r }); },
  listUsers: async () => [...users.values()].map(({ id, email, status }) => ({ id, email, status })),
  latestCodes: async (uid) => [...codes.values()].filter((c) => c.user_id === uid).sort((a, b) => b.created_at - a.created_at).slice(0, 1),
  magicLink: (t) => magicLinks.get(t),
  createMagicLink: async (r) => { magicLinks.set(r.token, { ...r }); },
  useMagicLink: async (t, ts) => { const m = magicLinks.get(t); if (m && !m.used_at) m.used_at = ts; },
  createEmail: async (r) => { emailsArr.push({ ...r }); },
  updateEmail: async (id, fields, ts) => { const e = emailsArr.find((x) => x.id === id); if (e) Object.assign(e, fields, { updated_at: ts }); },
  listEmails: async (status, limit) => emailsArr.filter((e) => !status || e.status === status).sort((a, b) => (status ? a.created_at - b.created_at : b.created_at - a.created_at)).slice(0, limit),
  session: (t) => sessionsMap.get(t),
  createSession: async (r) => { sessionsMap.set(r.token, { ...r }); },
  listBindings: async (status) => [...bindings.values()].filter((b) => !status || b.status === status),
  binding: (id) => bindings.get(String(id)),
  adminSession: (t) => adminSessionsMap.get(String(t || '')),
  createAdminSession: async (r) => { adminSessionsMap.set(r.token, { ...r }); },
  deleteAdminSession: async (t) => { adminSessionsMap.delete(String(t || '')); },
  bindingsWithUser: async (limit, status) => [...bindings.values()].filter((b) => !status || b.status === status)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, limit || 200)
    .map((b) => ({ ...b, email: users.get(b.user_id)?.email || null })),
};

/* ---------------- 假 CF（token/子域可验证流转，不碰网络） ---------------- */
const cf = {
  async createTunnel({ name }) { return { tunnelId: 'mock-tun-' + Math.random().toString(36).slice(2, 10) }; },
  async issueToken(tunnelId) { return 'mock-token-' + tunnelId; },
  async updateIngress(tunnelId, hostname) { console.log('[mock-cf] ingress', tunnelId, '→', hostname); },
  async createCname({ sub, tunnelId }) { console.log('[mock-cf] CNAME', sub + '.' + DOMAIN, '→', tunnelId + '.cfargotunnel.com'); },
  async deleteCname(sub) { console.log('[mock-cf] CNAME -', sub + '.' + DOMAIN); },
};

/* ---------------- HTTP（路由与 Worker 一致） ---------------- */
const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const out = (res, r) => json(res, r, r && r.error ? 400 : 200);
const html = (res, s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(s); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body; try { body = req.method === 'POST' ? JSON.parse((await drain(req)) || '{}') : {}; } catch { body = {}; }
  const ts = Date.now();
  const portalBase = process.env.PORTAL_BASE || 'http://127.0.0.1:' + PORT;
  try {
    if (req.method === 'POST' && url.pathname === '/api/activate') return out(res, await activate(db, cf, body, DOMAIN, ts));
    if (req.method === 'POST' && url.pathname === '/api/heartbeat') return out(res, await heartbeat(db, body, DOMAIN, ts));
    if (req.method === 'POST' && url.pathname === '/api/rotate') return out(res, await rotate(db, cf, body, DOMAIN, ts));
    // ---- 管理端（P6：/admin 控制台；Bearer ADMIN_TOKEN 或 mai_admin cookie）----
    const auth = req.headers['authorization'] || ''; // Node http：headers 是普通对象（Workers 侧用 .get）
    const adminTok = (req.headers['cookie'] || '').split('; ').find((c) => c.startsWith('mai_admin='))?.slice(10);
    const adminOk = !!(ADMIN_TOKEN && (auth === 'Bearer ' + ADMIN_TOKEN ||
      (adminTok && await adminSessionOk(db, adminTok))));

    if (req.method === 'GET' && url.pathname === '/admin') {
      return html(res, adminOk ? adminDashboard(portalBase) : adminLoginPage());
    }
    if (req.method === 'POST' && url.pathname === '/admin/login') {
      if (!ADMIN_TOKEN || String(body.token || '') !== ADMIN_TOKEN) return json(res, { error: '令牌不正确' }, 401);
      const tok = await createAdminSession(db, ts);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8',
        'set-cookie': `mai_admin=${tok}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === 'POST' && url.pathname === '/admin/logout') {
      if (adminTok) await deleteAdminSession(db, adminTok);
      res.writeHead(302, { location: '/', 'set-cookie': 'mai_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' }); return res.end();
    }

    if (url.pathname.startsWith('/admin/')) {
      if (!adminOk) return json(res, { error: 'unauthorized' }, 401);
      if (req.method === 'POST' && url.pathname === '/admin/user') { const u = await ensureUser(db, body.email, ts); return json(res, { ok: true, email: u.email, status: u.status }); }
      if (req.method === 'POST' && url.pathname === '/admin/order-paid') return out(res, await markOrderPaid(db, { ...body, amountCents: Number(process.env.PAYMENT_AMOUNT_CENTS) || 3900 }, ts));
      if (req.method === 'POST' && url.pathname === '/admin/issue-code') return out(res, await issueCode(db, { email: body.email }, ts));
      if (req.method === 'GET' && url.pathname === '/admin/users') return json(res, await db.listUsers());
      if (req.method === 'GET' && url.pathname === '/admin/bindings') return json(res, await adminBindings(db, { status: url.searchParams.get('status') }));
      if (req.method === 'GET' && url.pathname === '/admin/emails') return json(res, { queued: await db.listEmails('queued', 10),
        recent: await db.listEmails(null, Number(url.searchParams.get('limit')) || 20) });
      if (req.method === 'POST' && url.pathname === '/admin/revoke') return out(res, await revokeBinding(db, body.id, ts));
      if (req.method === 'GET' && url.pathname === '/admin/email-queue') return json(res, { emails: await db.listEmails('queued', 10) });
      if (req.method === 'POST' && url.pathname === '/admin/email-result') { await markEmail(db, body.id, { ok: !!body.ok && !body.error, error: body.error || null }, ts); return json(res, { ok: true }); }
      return json(res, { error: 'not found' }, 404);
    }
    // ---- 门户（P4，与 Worker 一致）----
    if (req.method === 'GET' && url.pathname === '/') return html(res, landingPage());
    if (req.method === 'POST' && url.pathname === '/site/apply') return out(res, await apply(db, body, portalBase, ts));
    if (req.method === 'GET' && url.pathname === '/login') {
      const uid = await consumeMagicLink(db, url.searchParams.get('token'), ts);
      if (!uid) return html(res, loginErrorPage());
      const tok = await createSession(db, uid, ts);
      res.writeHead(302, { location: '/me', 'set-cookie': `mai_session=${tok}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/me') {
      const u = await sessionUser(db, (req.headers['cookie'] || '').split('; ').find((c) => c.startsWith('mai_session='))?.slice(12));
      if (!u) { res.writeHead(302, { location: '/' }); return res.end(); }
      return html(res, mePage(await mePayload(db, u), portalBase, DOMAIN, paymentInfoFromEnv(process.env)));
    }
    if (req.method === 'POST' && url.pathname === '/site/logout') { res.writeHead(302, { location: '/', 'set-cookie': 'mai_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' }); return res.end(); }
    // 安装脚本静态分发（与 wrangler assets static/ 同集合）
    const STATIC = { '/i.sh': ['../client/i.sh', 'text/x-shellscript; charset=utf-8'], '/mobileai.mjs': ['../client/src/mobileai.mjs', 'text/javascript; charset=utf-8'], '/app.js': ['../client/src/app.js', 'application/javascript; charset=utf-8'], '/guide.md': ['../client/src/guide.md', 'text/markdown; charset=utf-8'] };
    const st = STATIC[url.pathname];
    if (st) { try { res.writeHead(200, { 'content-type': st[1], 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(new URL(st[0], import.meta.url))); } catch { /* fallthrough 404 */ } }
    if (url.pathname === '/healthz') return json(res, { ok: true, service: 'mobileai-control-mock' });
    return json(res, { error: 'not found' }, 404);
  } catch (e) { console.error('[mock]', e); return json(res, { error: String(e.message || e) }, 500); }
});

function drain(req) { return new Promise((r2, rej) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r2(d)); req.on('error', rej); }); }

server.listen(PORT, '127.0.0.1', () => console.log(`[mobile ai mock control plane] http://127.0.0.1:${PORT}  (admin token: ${ADMIN_TOKEN === 'dev-admin-token' ? '<default dev>' : process.env.ADMIN_TOKEN})`));
