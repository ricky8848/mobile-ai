// mobile ai（移动AI）· 本地 mock 控制面：无 CF / 无 D1，内存态。
// 与 src/index.js 暴露完全相同的 API（含 /admin/*），供 P2b 本机 E2E：
//   node mock-server.mjs            # http://127.0.0.1:6420
//   MOCK_PORT=xxxx node mock-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import { activate, heartbeat, rotate, issueCode, markOrderPaid, ensureUser, enqueueEmail, trialCodeEmail, claimEmail, claimableEmails, emailStaleMs, markEmail, apply, consumeMagicLink, createSession, sessionUser, mePayload,
  paymentInfoFromEnv, createAdminSession, adminSessionOk, deleteAdminSession, revokeBinding, adminBindings,
  adminStats, ONLINE_WINDOW_MS } from './src/core.js';
import { createStripeCheckout, handleStripeWebhook, signStripePayload, MOCK_WEBHOOK_SECRET } from './src/stripe.js';
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
  binding: async (id) => bindings.get(id) || null,
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
  // P3b：claim 机制（与 D1 适配器同语义；单进程内存态，读-改-写在事件循环内原子）
  claimEmail: async (id, staleBeforeTs) => { const e = emailsArr.find((x) => x.id === String(id)); if (!e) return false;
    const win = e.status === 'queued' || e.status === 'failed' || (e.status === 'sending' && Number(e.updated_at) < staleBeforeTs);
    if (win) { e.status = 'sending'; e.error = null; e.updated_at = Date.now(); return true; }
    return false; },
  markEmail: async (id, ok, error, ts) => { const e = emailsArr.find((x) => x.id === String(id)); if (!e || e.status === 'sent') return;
    Object.assign(e, { status: ok ? 'sent' : 'failed', error: ok ? null : (error || null), updated_at: ts }); },
  claimableEmails: async (staleBeforeTs, limit) => emailsArr.filter((e) => e.status === 'queued' || (e.status === 'sending' && Number(e.updated_at) < staleBeforeTs))
    .sort((a, b) => a.created_at - b.created_at).slice(0, limit),
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
  // ---- P7：实时统计 + Stripe 事件审计 / 订单幂等（与 D1 适配器同口径）----
  stats: async ({ onlineSince, dayStart }) => {
    const bs = [...bindings.values()];
    return { online_tunnels: bs.filter((b) => ['active', 'grace'].includes(b.status) && b.last_heartbeat >= onlineSince).length,
      active_bindings: bs.filter((b) => b.status === 'active').length,
      grace_bindings: bs.filter((b) => b.status === 'grace').length, total_bindings: bs.length,
      users_total: users.size, users_active: [...users.values()].filter((u) => u.status === 'active').length,
      users_pending: [...users.values()].filter((u) => u.status === 'pending').length,
      paid_users: new Set(orders.filter((o) => o.status === 'paid').map((o) => o.user_id)).size,
      orders_paid: orders.filter((o) => o.status === 'paid').length,
      revenue_cents_total: orders.filter((o) => o.status === 'paid').reduce((s, o) => s + (Number(o.amount_cents) || 0), 0),
      revenue_today_cents: orders.filter((o) => o.status === 'paid' && o.created_at >= dayStart).reduce((s, o) => s + (Number(o.amount_cents) || 0), 0),
      orders_today: orders.filter((o) => o.status === 'paid' && o.created_at >= dayStart).length,
      codes_unused: [...codes.values()].filter((c) => c.status === 'issued').length,
      emails_queued: emailsArr.filter((e) => e.status === 'queued').length,
      portal_sessions_active: [...sessionsMap.values()].filter((s) => s.expires_at >= Date.now()).length };
  },
  stripeEventExists: async (id) => stripeEvents.some((e) => e.stripe_event_id === String(id)),
  createStripeEvent: async (r) => { stripeEvents.push({ ...r }); },
  recentStripeEvents: async (limit = 5) => [...stripeEvents].sort((a, b) => b.created_at - a.created_at).slice(0, limit),
  orderByRef: async (ref) => [...orders].reverse().find((o) => o.ref === String(ref)) || null,
  unusedCodeForUser: async (uid) => [...codes.values()].find((c) => c.user_id === uid && c.status === 'issued') || null,
};

/* ---------------- P7：假 Stripe（STRIPE_MOCK=1）---------------- */
// 内存态 checkout session；/mock-stripe/pay 用 signStripePayload 伪造带签名的
// checkout.session.completed webhook → 走与生产完全相同的 handleStripeWebhook。
const mockStripeSessions = new Map(); // session_id → {email, amountCents, currency}
const stripeEvents = [];

function mockStripePage(sessionId, portalBase) {
  const s = mockStripeSessions.get(String(sessionId)) || {};
  const u = String(s.currency || 'usd').toLowerCase();
  const sym = { usd: '$', cny: '¥', eur: '€', gbp: '£' }[u] || (String(s.currency || 'USD').toUpperCase() + ' ');
  const money = sym + ((Number(s.amountCents) || 3900) / 100).toFixed(2);
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout · Stripe Test Mode</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#f6f8fa;margin:0;padding:40px 16px">
<div style="max-width:380px;margin:0 auto;border:1px solid #d0d7de;border-radius:12px;background:#fff;padding:24px">
<div style="font-size:12px;font-weight:700;color:#6e56cf;letter-spacing:.08em">STRIPE · TEST MODE（本地 mock）</div>
<h1 style="font-size:20px;margin:14px 0 6px">移动AI — 一次性买断（隧道服务）</h1>
<p style="font-size:26px;font-weight:700;margin:8px 0">${money}</p>
<p style="font-size:13px;color:#57606a;margin:4px 0 20px">收款邮箱：${String(s.email || '')}</p>
<button id="pay" style="width:100%;padding:12px;border:0;border-radius:8px;background:#635bff;color:#fff;font-size:15px;cursor:pointer">Pay ${money}</button>
<a href="${String(portalBase).replace(/"/g, '&quot;')}/me" style="display:block;text-align:center;font-size:13px;color:#57606a;margin-top:12px">取消</a>
<p id="m" style="font-size:13px;margin-top:12px;min-height:18px"></p>
</div><script>
document.getElementById('pay').onclick = async () => {
  const m = document.getElementById('m'); document.getElementById('pay').disabled = true; m.textContent = '支付处理中…';
  const r = await fetch('/mock-stripe/pay', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: '${String(sessionId).replace(/'/g, '')}' }) });
  const d = await r.json().catch(() => ({}));
  if (r.ok && (d.received || d.duplicate)) { m.textContent = '✓ 支付成功，正在返回…'; setTimeout(() => location.href = '${String(portalBase).replace(/'/g, '')}/me?paid=1', 600); }
  else { m.textContent = '支付失败：' + (d.error || r.status); document.getElementById('pay').disabled = false; }
};</script></body></html>`;
}

// 伪造 Stripe checkout.session.completed（签名与生产 webhook 校验同路径）
async function mockStripeComplete(sessionId, ts) {
  const s = mockStripeSessions.get(String(sessionId));
  if (!s) return { error: 'unknown session' };
  const event = { id: 'evt_mock_' + Math.random().toString(36).slice(2, 14),
    type: 'checkout.session.completed', created: Math.floor(ts / 1000),
    data: { object: { id: String(sessionId), metadata: { email: s.email },
      customer_details: { email: s.email }, amount_total: Number(s.amountCents) || 0, currency: (s.currency || 'usd').toLowerCase() } } };
  const raw = JSON.stringify(event);
  const sig = await signStripePayload(raw, process.env.STRIPE_WEBHOOK_SECRET || MOCK_WEBHOOK_SECRET);
  return handleStripeWebhook(db, process.env, raw, sig, ts); // ← 与生产同一处理函数
}

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
  let body, rawBody; // P7：Stripe webhook 需原始 body（验签），不能先 JSON.parse
  if (req.method === 'POST' && url.pathname === '/api/webhooks/stripe') rawBody = await drain(req);
  else { try { body = req.method === 'POST' ? JSON.parse((await drain(req)) || '{}') : {}; } catch { body = {}; } }
  const ts = Date.now();
  const portalBase = process.env.PORTAL_BASE || 'http://127.0.0.1:' + PORT;
  try {
    if (req.method === 'POST' && url.pathname === '/api/activate') return out(res, await activate(db, cf, body, DOMAIN, ts));
    if (req.method === 'POST' && url.pathname === '/api/heartbeat') return out(res, await heartbeat(db, body, DOMAIN, ts));
    if (req.method === 'POST' && url.pathname === '/api/rotate') return out(res, await rotate(db, cf, body, DOMAIN, ts));
    // ---- P7：Stripe webhook（与 Worker 同路径；验签即鉴权）----
    if (req.method === 'POST' && url.pathname === '/api/webhooks/stripe') {
      const r = await handleStripeWebhook(db, process.env, rawBody || '', req.headers['stripe-signature'] || '', ts);
      const st = r && !r.error ? 200 : (r.error === 'webhook secret not configured' ? 503 : 400);
      return json(res, r, st);
    }
    // ---- P7：假 Stripe 收银台（STRIPE_MOCK=1；/mock-stripe/pay → 带签名 webhook）----
    if (req.method === 'GET' && url.pathname === '/mock-stripe/checkout') {
      return html(res, mockStripePage(url.searchParams.get('session_id'), portalBase));
    }
    if (req.method === 'POST' && url.pathname === '/mock-stripe/pay') {
      const r = await mockStripeComplete(body.session_id, ts);
      return json(res, { received: !!(r && (r.ok || r.duplicate)), ...r }, r && r.error ? 400 : 200);
    }
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
      console.log('[dbg] ' + req.method + ' ' + url.pathname); // 全请求留痕（含 401，便于定位 mark/claim 去向）
      if (!adminOk) return json(res, { error: 'unauthorized' }, 401);
      if (req.method === 'POST' && url.pathname === '/admin/user') { const u = await ensureUser(db, body.email, ts); return json(res, { ok: true, email: u.email, status: u.status }); }
      if (req.method === 'POST' && url.pathname === '/admin/order-paid') return out(res, await markOrderPaid(db, { ...body, amountCents: Number(process.env.PAYMENT_AMOUNT_CENTS) || 3900 }, ts));
      if (req.method === 'POST' && url.pathname === '/admin/issue-code') { // 试用码：签发 + 发邮件（与 Worker 同语义）
        const r = await issueCode(db, { email: body.email }, ts);
        if (!r.error) await enqueueEmail(db, { to_email: String(body.email), subject: '移动AI — 你的试用码', body_text: trialCodeEmail(String(body.email), r.code) }, ts);
        return out(res, r); }
      if (req.method === 'GET' && url.pathname === '/admin/users') return json(res, await db.listUsers());
      if (req.method === 'GET' && url.pathname === '/admin/bindings') return json(res, await adminBindings(db, { status: url.searchParams.get('status') }));
      if (req.method === 'GET' && url.pathname === '/admin/emails') return json(res, { queued: await db.listEmails('queued', 10),
        recent: await db.listEmails(null, Number(url.searchParams.get('limit')) || 20) });
      if (req.method === 'GET' && url.pathname === '/admin/stats') { // P7：实时总览（前端 10s 轮询）
        const onlineMs = Number(process.env.ONLINE_WINDOW_MS) > 0 ? Number(process.env.ONLINE_WINDOW_MS) : ONLINE_WINDOW_MS;
        const s = await adminStats(db, ts, onlineMs);
        return json(res, { ...s, currency: paymentInfoFromEnv(process.env).currency, online_window_min: Math.round(onlineMs / 60e3),
          stripe_events_recent: await db.recentStripeEvents(5) });
      }
      if (req.method === 'POST' && url.pathname === '/admin/revoke') return out(res, await revokeBinding(db, body.id, ts));
      const _staleMs = emailStaleMs(process.env); // P3b：claim 机制（防重复发送）
      if (req.method === 'POST' && url.pathname === '/admin/email-claim') { const _c = await claimEmail(db, body.id, ts, _staleMs); console.log('[dbg] email-claim id=' + body.id + ' claimed=' + _c); return json(res, { ok: true, claimed: _c }); }
      if (req.method === 'GET' && url.pathname === '/admin/email-queue') { const _l = await claimableEmails(db, ts, 10, _staleMs); console.log('[dbg] email-queue → ' + (_l.map((e) => e.id).join(',') || '(empty)')); return json(res, { emails: _l }); }
      if (req.method === 'POST' && url.pathname === '/admin/email-result') { const _f = emailsArr.find((x) => x.id === body.id); console.log('[dbg] email-result id=' + body.id + ' found=' + !!_f + ' before=' + (_f ? _f.status : '?') + ' ok=' + (!!body.ok && !body.error)); await markEmail(db, body.id, { ok: !!body.ok && !body.error, error: body.error || null }, ts); return json(res, { ok: true }); }
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
      return html(res, mePage(await mePayload(db, u), portalBase, DOMAIN, paymentInfoFromEnv(process.env),
        { justPaid: url.searchParams.get('paid') === '1' })); // P7：Stripe success_url 回跳
    }
    if (req.method === 'POST' && url.pathname === '/site/tools/rotate') { // 我的工具：客户侧 URL 轮换（与 src/index.js 同规则）
      const u = await sessionUser(db, (req.headers['cookie'] || '').split('; ').find((c) => c.startsWith('mai_session='))?.slice(12));
      if (!u) return json(res, { error: 'unauthorized' }, 401);
      const b = await db.binding(String(body.id || ''));
      if (!b || b.user_id !== u.id) return json(res, { error: '绑定不存在' }, 404);
      if (!['active', 'grace'].includes(b.status)) return json(res, { error: '绑定不可用（已吊销/停用）' }, 409);
      return out(res, await rotate(db, cf, { machineCode: b.machine_code, url: 'https://' + b.subdomain + '.' + DOMAIN }, DOMAIN, ts));
    }
    if (req.method === 'POST' && url.pathname === '/site/pay/checkout') { // P7：Stripe Checkout（mock 或真实）
      const u = await sessionUser(db, (req.headers['cookie'] || '').split('; ').find((c) => c.startsWith('mai_session='))?.slice(12));
      if (!u || u.status !== 'pending') { res.writeHead(302, { location: '/me' }); return res.end(); }
      if (await db.unusedCodeForUser(u.id)) return json(res, { error: '你已有未使用的认证码，无需重复付款' }, 409);
      const pay = paymentInfoFromEnv(process.env);
      if (process.env.STRIPE_MOCK) { // 假 Stripe：内存 session → /mock-stripe/checkout
        const id = 'cs_mock_' + Math.random().toString(36).slice(2, 14);
        mockStripeSessions.set(id, { email: u.email, amountCents: pay.amountCents, currency: pay.currency });
        return json(res, { url: portalBase + '/mock-stripe/checkout?session_id=' + id, session_id: id });
      }
      try {
        const s = await createStripeCheckout(process.env, { email: u.email, amountCents: pay.amountCents, currency: pay.currency,
          productName: '移动AI — 一次性买断（隧道服务）', successUrl: portalBase + '/me?paid=1', cancelUrl: portalBase + '/me' });
        return json(res, { url: s.url, session_id: s.id });
      } catch (e) { return json(res, { error: '创建支付会话失败：' + String(e.message || e) }, 502); }
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
