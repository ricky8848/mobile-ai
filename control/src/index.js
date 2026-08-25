// mobile ai（移动AI）· 控制面 Worker 入口：路由 + D1 适配器。
// 业务逻辑全在 core.js；CF 调用走 cf.js（makeCf(env)）。
import { activate, heartbeat, rotate, issueCode, markOrderPaid, ensureUser, markEmail, apply, consumeMagicLink, createSession, sessionUser, mePayload } from './core.js';
import { landingPage, loginErrorPage, mePage } from './site.js';
import { makeCf } from './cf.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// 业务结果 → HTTP：{error} 一律 400（客户端 apiCall 会展示 error 文案）
const out = (r) => json(r, r && r.error ? 400 : 200);
const html = (s) => new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } });

function dbAdapter(db) {
  return {
    code: (c) => db.prepare('SELECT * FROM auth_codes WHERE code=?').bind(c).first(),
    user: (id) => db.prepare('SELECT * FROM users WHERE id=?').bind(id).first(),
    userByEmail: (e) => db.prepare('SELECT * FROM users WHERE email=?').bind(e).first(),
    bindingByMachine: (mc) => db.prepare('SELECT * FROM bindings WHERE machine_code=? ORDER BY created_at DESC').bind(mc).first(),
    bindingBySubdomain: (sub) => db.prepare('SELECT * FROM bindings WHERE subdomain=?').bind(sub).first(),
    async bindingsForUser(uid, statuses) {
      const ph = statuses.map(() => '?').join(',');
      return (await db.prepare(`SELECT * FROM bindings WHERE user_id=? AND status IN (${ph}) ORDER BY created_at DESC`)
        .bind(uid, ...statuses).all()).results;
    },
    redeemCode: (c, ts) => db.prepare('UPDATE auth_codes SET status=?, updated_at=? WHERE code=? AND status=?')
      .bind('redeemed', ts, c, 'issued').run(),
    createBinding: (r) => db.prepare(
      `INSERT INTO bindings (id,user_id,machine_code,subdomain,tunnel_id,tunnel_token,service_addr,status,last_heartbeat,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(r.id, r.user_id, r.machine_code, r.subdomain, r.tunnel_id || null, r.tunnel_token,
        r.service_addr, r.status, r.last_heartbeat ?? null, r.created_at, ts0(r)).run(),
    updateBinding: (id, fields, ts) => {
      const sets = Object.keys(fields).map((k) => `${k}=?`).join(', ');
      return db.prepare(`UPDATE bindings SET ${sets}, updated_at=? WHERE id=?`)
        .bind(...Object.values(fields), ts, id).run();
    },
    createUser: (r) => db.prepare('INSERT INTO users (id,email,status,created_at,updated_at) VALUES (?,?,?,?,?)')
      .bind(r.id, r.email, r.status, r.created_at, r.updated_at).run(),
    updateUser: (id, fields, ts) => {
      const sets = Object.keys(fields).map((k) => `${k}=?`).join(', ');
      return db.prepare(`UPDATE users SET ${sets}, updated_at=? WHERE id=?`).bind(...Object.values(fields), ts, id).run();
    },
    createCode: (r) => db.prepare('INSERT INTO auth_codes (code,user_id,order_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .bind(r.code, r.user_id, r.order_id || null, r.status, r.created_at, r.updated_at).run(),
    createOrder: (r) => db.prepare(
      'INSERT INTO orders (id,user_id,amount_cents,method,ref,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(r.id, r.user_id, r.amount_cents ?? 0, r.method || null, r.ref || null, r.status, r.created_at, r.updated_at).run(),
    listUsers: async () => (await db.prepare('SELECT email,status,created_at FROM users ORDER BY created_at DESC LIMIT 200').all()).results,
    latestCodes: async (uid) => { const q = db.prepare('SELECT code,status,created_at FROM auth_codes WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(uid); return (await q.all()).results; },
    magicLink: (t) => db.prepare('SELECT * FROM magic_links WHERE token=?').bind(t).first(),
    createMagicLink: (r) => db.prepare('INSERT INTO magic_links (token,user_id,kind,created_at,used_at) VALUES (?,?,?,?,?)')
      .bind(r.token, r.user_id, r.kind || 'login', r.created_at, null).run(),
    useMagicLink: (t, ts) => db.prepare('UPDATE magic_links SET used_at=? WHERE token=? AND used_at IS NULL').bind(ts, t).run(),
    createEmail: (r) => db.prepare('INSERT INTO emails (id,to_email,subject,body_text,status,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(r.id, r.to_email, r.subject, r.body_text, r.status || 'queued', null, r.created_at, r.updated_at).run(),
    updateEmail: (id, fields, ts) => { const sets = Object.keys(fields).map((k) => `${k}=?`).join(', '); return db.prepare(`UPDATE emails SET ${sets}, updated_at=? WHERE id=?`).bind(...Object.values(fields), ts, id).run(); },
    listEmails: async (status, limit) => { const q = status ? db.prepare('SELECT * FROM emails WHERE status=? ORDER BY created_at ASC LIMIT ?').bind(status, limit) : db.prepare('SELECT * FROM emails ORDER BY created_at DESC LIMIT ?').bind(limit); return (await q.all()).results; },
    session: (t) => db.prepare('SELECT * FROM sessions WHERE token=?').bind(t).first(),
    createSession: (r) => db.prepare('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(r.token, r.user_id, r.created_at, r.expires_at).run(),
    listBindings: async (status) => status
      ? (await db.prepare('SELECT * FROM bindings WHERE status=? ORDER BY created_at DESC LIMIT 200').bind(status).all()).results
      : (await db.prepare('SELECT * FROM bindings ORDER BY created_at DESC LIMIT 200').all()).results,
  };
}
const ts0 = (r) => r.created_at || Date.now();

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    let body;
    try { body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}; } catch { body = {}; }
    const db = dbAdapter(env.DB);
    const cf = makeCf(env);
    const ts = Date.now();

    // ---- 客户端 API（公开）----
    if (req.method === 'POST' && url.pathname === '/api/activate') return out(activate(db, cf, body, env.DOMAIN, ts));
    if (req.method === 'POST' && url.pathname === '/api/heartbeat') return out(heartbeat(db, body, env.DOMAIN, ts));
    if (req.method === 'POST' && url.pathname === '/api/rotate') return out(rotate(db, cf, body, env.DOMAIN, ts));

    // ---- 门户（P4：落地页 / magic link 登录 / 我的页面）----
    const portalBase = env.PORTAL_BASE || ('https://' + env.DOMAIN);
    if (req.method === 'GET' && url.pathname === '/') return html(landingPage());
    if (req.method === 'POST' && url.pathname === '/site/apply') return out(apply(db, body, portalBase, ts));
    if (req.method === 'GET' && url.pathname === '/login') {
      const uid = await consumeMagicLink(db, url.searchParams.get('token'), ts);
      if (!uid) return html(loginErrorPage());
      const tok = await createSession(db, uid, ts);
      return new Response(null, { status: 302, headers: { location: '/me', 'set-cookie': `mai_session=${tok}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` } });
    }
    if (req.method === 'GET' && url.pathname === '/me') {
      const u = await sessionUser(db, (req.headers.get('cookie') || '').split('; ').find((c) => c.startsWith('mai_session='))?.slice(12));
      if (!u) return new Response(null, { status: 302, headers: { location: '/' } });
      return html(mePage(await mePayload(db, u), portalBase));
    }
    if (req.method === 'POST' && url.pathname === '/site/logout') {
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': 'mai_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' } });
    }

    // ---- 管理端（Bearer ADMIN_TOKEN；v0.3 半自动收款/发码）----
    const auth = req.headers.get('authorization') || '';
    if (url.pathname.startsWith('/admin/')) {
      if (!env.ADMIN_TOKEN || auth !== 'Bearer ' + env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
      const db2 = db; // 便于阅读
      if (req.method === 'POST' && url.pathname === '/admin/user') { const u = await ensureUser(db2, body.email, ts); return json({ ok: true, email: u.email, status: u.status }); }
      if (req.method === 'POST' && url.pathname === '/admin/order-paid') return out(markOrderPaid(db2, body, ts));
      if (req.method === 'POST' && url.pathname === '/admin/issue-code') return out(issueCode(db2, { email: body.email }, ts));
      if (req.method === 'GET' && url.pathname === '/admin/users') return json(await db2.listUsers());
      if (req.method === 'GET' && url.pathname === '/admin/bindings') return json(await db2.listBindings(url.searchParams.get('status')));
      if (req.method === 'GET' && url.pathname === '/admin/email-queue') return json({ emails: await db2.listEmails('queued', 10) });
      if (req.method === 'POST' && url.pathname === '/admin/email-result') { await markEmail(db2, body.id, { ok: !!body.ok && !body.error, error: body.error || null }, ts); return json({ ok: true }); }
      return json({ error: 'not found' }, 404);
    }

    if (url.pathname === '/' || url.pathname === '/healthz') return json({ ok: true, service: 'mobileai-control' });
    return json({ error: 'not found' }, 404);
  },
};
