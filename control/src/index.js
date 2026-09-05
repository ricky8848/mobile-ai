// mobile ai（移动AI）· 控制面 Worker 入口：路由 + D1 适配器。
// 业务逻辑全在 core.js；CF 调用走 cf.js（makeCf(env)）。
import { activate, heartbeat, rotate, issueCode, markOrderPaid, ensureUser, enqueueEmail, trialCodeEmail, claimEmail, claimableEmails, emailStaleMs, markEmail, apply, consumeMagicLink, createSession, sessionUser, mePayload,
  paymentInfoFromEnv, createAdminSession, adminSessionOk, deleteAdminSession, revokeBinding, adminBindings,
  adminStats, ONLINE_WINDOW_MS } from './core.js';
import { createStripeCheckout, handleStripeWebhook } from './stripe.js';
import { landingPage, loginErrorPage, mePage, adminLoginPage, adminDashboard } from './site.js';
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
    // 原子领取：条件 UPDATE，多 mailer/重复轮询并发时只有一个 changes>0
    claimEmail: async (id, staleBeforeTs) => { const r = await db.prepare("UPDATE emails SET status='sending', error=NULL, updated_at=? WHERE id=? AND (status IN ('queued','failed') OR (status='sending' AND updated_at<?))").bind(Date.now(), id, staleBeforeTs).run(); return r.changes > 0; },
    // 状态守卫：sent 为终态，迟到的失败回报不得把 sent 打回 failed
    markEmail: async (id, ok, error, ts) => { await db.prepare(ok
      ? "UPDATE emails SET status='sent', error=NULL, updated_at=? WHERE id=? AND status<>'sent'"
      : "UPDATE emails SET status='failed', error=?, updated_at=? WHERE id=? AND status<>'sent'").bind(...(ok ? [ts, id] : [error || null, ts, id])).run(); },
    claimableEmails: async (staleBeforeTs, limit) => { const q = db.prepare("SELECT * FROM emails WHERE status='queued' OR (status='sending' AND updated_at<?) ORDER BY created_at ASC LIMIT ?").bind(staleBeforeTs, limit); return (await q.all()).results; },
    session: (t) => db.prepare('SELECT * FROM sessions WHERE token=?').bind(t).first(),
    createSession: (r) => db.prepare('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(r.token, r.user_id, r.created_at, r.expires_at).run(),
    listBindings: async (status) => status
      ? (await db.prepare('SELECT * FROM bindings WHERE status=? ORDER BY created_at DESC LIMIT 200').bind(status).all()).results
      : (await db.prepare('SELECT * FROM bindings ORDER BY created_at DESC LIMIT 200').all()).results,
    binding: (id) => db.prepare('SELECT * FROM bindings WHERE id=?').bind(id).first(),
    adminSession: (t) => db.prepare('SELECT * FROM admin_sessions WHERE token=?').bind(t).first(),
    createAdminSession: (r) => db.prepare('INSERT INTO admin_sessions (token,created_at,expires_at) VALUES (?,?,?)')
      .bind(r.token, r.created_at, r.expires_at).run(),
    deleteAdminSession: (t) => db.prepare('DELETE FROM admin_sessions WHERE token=?').bind(t).run(),
    bindingsWithUser: async (limit, status) => {
      const q = status
        ? db.prepare('SELECT b.*, u.email FROM bindings b JOIN users u ON u.id=b.user_id WHERE b.status=? ORDER BY b.created_at DESC LIMIT ?').bind(status, limit)
        : db.prepare('SELECT b.*, u.email FROM bindings b JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC LIMIT ?').bind(limit);
      return (await q.all()).results;
    },
    // ---- P7：实时统计 + Stripe 事件审计 / 订单幂等 ----
    stats: async ({ onlineSince, dayStart }) => {
      const one = (sql, ...args) => db.prepare(sql).bind(...args).first(); // COUNT/SUM 聚合行
      const [onl, act, grace, totB] = await Promise.all([
        one('SELECT COUNT(*) AS n FROM bindings WHERE status IN (\'active\',\'grace\') AND last_heartbeat IS NOT NULL AND last_heartbeat >= ?', onlineSince),
        one('SELECT COUNT(*) AS n FROM bindings WHERE status=\'active\''),
        one('SELECT COUNT(*) AS n FROM bindings WHERE status=\'grace\''),
        one('SELECT COUNT(*) AS n FROM bindings'),
      ]);
      const [uTot, uAct, uPend, paidU] = await Promise.all([
        one('SELECT COUNT(*) AS n FROM users'),
        one('SELECT COUNT(*) AS n FROM users WHERE status=\'active\''),
        one('SELECT COUNT(*) AS n FROM users WHERE status=\'pending\''),
        one("SELECT COUNT(DISTINCT user_id) AS n FROM orders WHERE status='paid'"),
      ]);
      const [ordPaid, revTot, revDay, ordDay] = await Promise.all([
        one("SELECT COUNT(*) AS n FROM orders WHERE status='paid'"),
        one("SELECT COALESCE(SUM(amount_cents),0) AS n FROM orders WHERE status='paid'"),
        one("SELECT COALESCE(SUM(amount_cents),0) AS n FROM orders WHERE status='paid' AND created_at >= ?", dayStart),
        one("SELECT COUNT(*) AS n FROM orders WHERE status='paid' AND created_at >= ?", dayStart),
      ]);
      const [codes, queuedE, sessA] = await Promise.all([
        one("SELECT COUNT(*) AS n FROM auth_codes WHERE status='issued'"),
        one("SELECT COUNT(*) AS n FROM emails WHERE status='queued'"),
        one('SELECT COUNT(*) AS n FROM sessions WHERE expires_at >= ?', Date.now()),
      ]);
      return { online_tunnels: onl.n, active_bindings: act.n, grace_bindings: grace.n, total_bindings: totB.n,
        users_total: uTot.n, users_active: uAct.n, users_pending: uPend.n, paid_users: paidU.n,
        orders_paid: ordPaid.n, revenue_cents_total: revTot.n, revenue_today_cents: revDay.n, orders_today: ordDay.n,
        codes_unused: codes.n, emails_queued: queuedE.n, portal_sessions_active: sessA.n };
    },
    stripeEventExists: (id) => db.prepare('SELECT 1 AS x FROM stripe_events WHERE stripe_event_id=?').bind(id).first(),
    createStripeEvent: (r) => db.prepare(
      'INSERT INTO stripe_events (id,stripe_event_id,type,email,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(r.id, r.stripe_event_id, r.type, r.email || null, r.amount_cents ?? 0, r.status || 'processed', r.created_at).run(),
    recentStripeEvents: async (limit = 5) => { const q = db.prepare('SELECT * FROM stripe_events ORDER BY created_at DESC, id DESC LIMIT ?').bind(limit); return (await q.all()).results; },
    orderByRef: (ref) => db.prepare('SELECT * FROM orders WHERE ref=? ORDER BY created_at DESC').bind(ref).first(),
    unusedCodeForUser: (uid) => db.prepare("SELECT code FROM auth_codes WHERE user_id=? AND status='issued' LIMIT 1").bind(uid).first(),
  };
}
const ts0 = (r) => r.created_at || Date.now();

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    let body, rawBody; // P7：Stripe webhook 需原始 body（验签），不能先 JSON 解析
    if (req.method === 'POST' && url.pathname === '/api/webhooks/stripe') rawBody = await req.text().catch(() => '');
    else { try { body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}; } catch { body = {}; } }
    const db = dbAdapter(env.DB);
    const cf = makeCf(env);
    const ts = Date.now();

    // ---- 客户端 API（公开）----
    if (req.method === 'POST' && url.pathname === '/api/activate') return out(await activate(db, cf, body, env.DOMAIN, ts));
    if (req.method === 'POST' && url.pathname === '/api/heartbeat') return out(await heartbeat(db, body, env.DOMAIN, ts));
    if (req.method === 'POST' && url.pathname === '/api/rotate') return out(await rotate(db, cf, body, env.DOMAIN, ts));

    // ---- P7：Stripe webhook（验签即鉴权；非 2xx → Stripe 自动重试）----
    if (req.method === 'POST' && url.pathname === '/api/webhooks/stripe') {
      const r = await handleStripeWebhook(db, env, rawBody || '', req.headers.get('stripe-signature'), ts);
      const st = r && !r.error ? 200 : (r.error === 'webhook secret not configured' ? 503 : 400);
      return json(r, st);
    }

    // ---- 门户（P4：落地页 / magic link 登录 / 我的页面）----
    const portalBase = env.PORTAL_BASE || ('https://' + env.DOMAIN);
    if (req.method === 'GET' && url.pathname === '/') return html(landingPage());
    if (req.method === 'POST' && url.pathname === '/site/apply') return out(await apply(db, body, portalBase, ts));
    if (req.method === 'GET' && url.pathname === '/login') {
      const uid = await consumeMagicLink(db, url.searchParams.get('token'), ts);
      if (!uid) return html(loginErrorPage());
      const tok = await createSession(db, uid, ts);
      return new Response(null, { status: 302, headers: { location: '/me', 'set-cookie': `mai_session=${tok}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` } });
    }
    if (req.method === 'GET' && url.pathname === '/me') {
      const u = await sessionUser(db, (req.headers.get('cookie') || '').split('; ').find((c) => c.startsWith('mai_session='))?.slice(12));
      if (!u) return new Response(null, { status: 302, headers: { location: '/' } });
      return html(mePage(await mePayload(db, u), portalBase, env.DOMAIN, paymentInfoFromEnv(env),
        { justPaid: url.searchParams.get('paid') === '1' })); // P7：Stripe success_url 回跳
    }
    if (req.method === 'POST' && url.pathname === '/site/pay/checkout') { // P7：创建 Stripe Checkout（需门户会话）
      const u = await sessionUser(db, (req.headers.get('cookie') || '').split('; ').find((c) => c.startsWith('mai_session='))?.slice(12));
      if (!u || u.status !== 'pending') return new Response(null, { status: 302, headers: { location: '/me' } });
      if (await db.unusedCodeForUser(u.id)) return json({ error: '你已有未使用的认证码，无需重复付款' }, 409);
      const pay = paymentInfoFromEnv(env);
      try {
        const s = await createStripeCheckout(env, { email: u.email, amountCents: pay.amountCents, currency: pay.currency,
          productName: '移动AI — 一次性买断（隧道服务）', successUrl: portalBase + '/me?paid=1', cancelUrl: portalBase + '/me' });
        return json({ url: s.url, session_id: s.id });
      } catch (e) { return json({ error: '创建支付会话失败：' + String(e.message || e) }, 502); }
    }
    if (req.method === 'POST' && url.pathname === '/site/logout') {
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': 'mai_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' } });
    }

    // ---- 管理端（P6：/admin 控制台；Bearer ADMIN_TOKEN 或 mai_admin cookie）----
    const auth = req.headers.get('authorization') || '';
    const adminTok = (req.headers.get('cookie') || '').split('; ').find((c) => c.startsWith('mai_admin='))?.slice(10);
    const adminOk = !!(env.ADMIN_TOKEN && (auth === 'Bearer ' + env.ADMIN_TOKEN ||
      (adminTok && await adminSessionOk(db, adminTok))));

    if (req.method === 'GET' && url.pathname === '/admin') {
      return html(adminOk ? adminDashboard(portalBase) : adminLoginPage());
    }
    if (req.method === 'POST' && url.pathname === '/admin/login') {
      if (!env.ADMIN_TOKEN || String(body.token || '') !== env.ADMIN_TOKEN) return json({ error: '令牌不正确' }, 401);
      const tok = await createAdminSession(db, ts);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json; charset=utf-8',
        'set-cookie': `mai_admin=${tok}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` } });
    }
    if (req.method === 'POST' && url.pathname === '/admin/logout') {
      if (adminTok) await deleteAdminSession(db, adminTok);
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': 'mai_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' } });
    }

    if (url.pathname.startsWith('/admin/')) {
      if (!adminOk) return json({ error: 'unauthorized' }, 401);
      const db2 = db; // 便于阅读
      if (req.method === 'POST' && url.pathname === '/admin/user') { const u = await ensureUser(db2, body.email, ts); return json({ ok: true, email: u.email, status: u.status }); }
      if (req.method === 'POST' && url.pathname === '/admin/order-paid') return out(await markOrderPaid(db2, { ...body, amountCents: Number(env.PAYMENT_AMOUNT_CENTS) || 3900 }, ts));
      if (req.method === 'POST' && url.pathname === '/admin/issue-code') { // 试用码：签发 + 发邮件（测试阶段免费）
        const r = await issueCode(db2, { email: body.email }, ts);
        if (!r.error) await enqueueEmail(db2, { to_email: String(body.email), subject: '移动AI — 你的试用码', body_text: trialCodeEmail(String(body.email), r.code) }, ts);
        return out(r); }
      if (req.method === 'GET' && url.pathname === '/admin/users') return json(await db2.listUsers());
      if (req.method === 'GET' && url.pathname === '/admin/bindings') return json(await adminBindings(db2, { status: url.searchParams.get('status') }));
      if (req.method === 'GET' && url.pathname === '/admin/emails') return json({ queued: await db2.listEmails('queued', 10),
        recent: await db2.listEmails(null, Number(url.searchParams.get('limit')) || 20) });
      if (req.method === 'GET' && url.pathname === '/admin/stats') { // P7：实时总览（前端 10s 轮询）
        const onlineMs = Number(env.ONLINE_WINDOW_MS) > 0 ? Number(env.ONLINE_WINDOW_MS) : ONLINE_WINDOW_MS;
        const s = await adminStats(db2, ts, onlineMs);
        return json({ ...s, currency: paymentInfoFromEnv(env).currency, online_window_min: Math.round(onlineMs / 60e3),
          stripe_events_recent: await db2.recentStripeEvents(5) });
      }
      if (req.method === 'POST' && url.pathname === '/admin/revoke') return out(await revokeBinding(db2, body.id, ts));
      const staleMs = emailStaleMs(env); // P3b：claim 机制（防重复发送）
      if (req.method === 'POST' && url.pathname === '/admin/email-claim') { const claimed = await claimEmail(db2, body.id, ts, staleMs); return json({ ok: true, claimed }); }
      if (req.method === 'GET' && url.pathname === '/admin/email-queue') return json({ emails: await claimableEmails(db2, ts, 10, staleMs) });
      if (req.method === 'POST' && url.pathname === '/admin/email-result') { await markEmail(db2, body.id, { ok: !!body.ok && !body.error, error: body.error || null }, ts); return json({ ok: true }); }
      return json({ error: 'not found' }, 404);
    }

    if (url.pathname === '/' || url.pathname === '/healthz') return json({ ok: true, service: 'mobileai-control' });
    return json({ error: 'not found' }, 404);
  },
};
