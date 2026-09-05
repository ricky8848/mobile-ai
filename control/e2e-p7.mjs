// mobile ai（移动AI）· P7 E2E：Stripe mock 全流程 + webhook 验签/幂等 + /admin/stats。
//   node e2e-p7.mjs            # 起独立 mock（:6431，STRIPE_MOCK=1），跑完即杀
// 覆盖：apply→magic link→登录→/me 付款卡（在线支付按钮）→假 Stripe checkout→
//       带签名 webhook→自动发码+邮件→/me?paid=1 → /admin/stats（付款用户/收入）→
//       重复 webhook 幂等 → 坏签名拒绝 → 409/302 防重复付款 → activate+heartbeat→在线隧道=1。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));

const PORT = Number(process.env.E2E_PORT || 6431);
const BASE = 'http://127.0.0.1:' + PORT;
const ADMIN = { authorization: 'Bearer dev-admin-token' };

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.error('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const child = spawn('node', ['mock-server.mjs'], { cwd: DIR,
  env: { ...process.env, MOCK_PORT: String(PORT), STRIPE_MOCK: '1', PAYMENT_AMOUNT_CENTS: '3900' }, stdio: ['ignore', 'pipe', 'pipe'] });
let mockLog = ''; child.stdout.on('data', (d) => (mockLog += d)); child.stderr.on('data', (d) => (mockLog += d));
const kill = () => { try { child.kill('SIGKILL'); } catch {} };

async function waitUp(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

async function main() {
  if (!(await waitUp())) throw new Error('mock 未起来：\n' + mockLog);
  const emailA = `e2ep7a+${Date.now()}@example.com`, emailB = `e2ep7b+${Date.now()}@example.com`;
  const magicLinkOf = (em) => { // 从邮件队列正文解析 magic link（不依赖 mailer 进程）
    const r = /http:\/\/127\.0\.0\.1:\d+\/login\?token=([a-f0-9]{32})/;
    for (const e of emails.queued) if ((e.to_email || '') === em && /token=/.test(e.body_text || '')) { const m = (e.body_text).match(r); if (m) return m[1]; }
    for (const e of emails.recent) if ((e.to_email || '') === em && /token=/.test(e.body_text || '')) { const m = (e.body_text).match(r); if (m) return m[1]; }
    return null;
  };
  let emails = { queued: [], recent: [] };
  const pollEmails = async (em, tries = 25) => { for (let i = 0; i < tries && !magicLinkOf(em); i++) {
    const r = await fetch(BASE + '/admin/email-queue', { headers: ADMIN }); emails = { queued: (await r.json().catch(() => ({emails: []}))).emails || [], recent: emails.recent };
    if (!magicLinkOf(em)) await new Promise((r) => setTimeout(r, 200)); } return magicLinkOf(em); };
  const cookies = {}; // name → value（手动管理）
  const jarOf = (c) => Object.entries(cookies).filter(([k]) => c.includes(k)).map(([k, v]) => k + '=' + v).join('; ');
  const setJar = (res, scope) => { for (const sc of String(res.headers.get('set-cookie') || '').split(/,(?=[^ ;]+=)/)) {
    const [pair] = sc.split(';'); if (!pair) continue; const i = pair.indexOf('='); cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); } };
  const get = (p, { headers: h = {}, redirect = 'manual' } = {}) => fetch(BASE + p, { headers: { ...h }, redirect });
  const post = (p, body, h = {}) => fetch(BASE + p, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body || {}), redirect: 'manual' });

  console.log('— P7 E2E（mock :%d，STRIPE_MOCK=1）—', PORT);
  let r = await get('/healthz'); ok('healthz', r.status === 200);

  // 1) apply + magic link（用户 A）
  r = await post('/site/apply', { email: emailA });
  ok('apply A → 200', r.status === 200);
  const tokA = await pollEmails(emailA);
  ok('magic link A（邮件队列解析）', !!tokA, '未找到确认链接');
  r = await get('/login?token=' + tokA);
  ok('登录 A → 302 /me', r.status === 302 && (r.headers.get('location') || '') === '/me');
  setJar(r);

  // 2) /me：付款卡（在线支付按钮 + QR 备用）
  r = await get('/me', { headers: { cookie: jarOf('mai_session') } });
  let me = await r.text();
  ok('/me → 200', r.status === 200);
  ok('付款卡含「在线支付（推荐」', me.includes('在线支付（推荐'));
  ok('付款卡含 Pay $39.00', me.includes('Pay $39.00'));
  ok('付款卡保留 QR 备用渠道（¥39）', me.includes('扫码 / 银行转账') && me.includes('¥39'));

  // 3) checkout → 假 Stripe 收银台
  r = await post('/site/pay/checkout', {}, { cookie: jarOf('mai_session') });
  const co = await r.json().catch(() => ({}));
  ok('checkout → {url,session_id}', r.status === 200 && String(co.url || '').includes('/mock-stripe/checkout') && /^cs_mock_/.test(co.session_id || ''), JSON.stringify(co));
  r = await get('/mock-stripe/checkout?session_id=' + co.session_id);
  const page = await r.text();
  ok('假 Stripe 收银台渲染', r.status === 200 && page.includes('STRIPE · TEST MODE') && page.includes('$39.00'));

  // 4) 支付 → 带签名 webhook（与生产同路径）→ 自动发码
  r = await post('/mock-stripe/pay', { session_id: co.session_id });
  const pay = await r.json().catch(() => ({}));
  ok('支付 → received + code', pay.received === true && /^MAI-[A-Z2-9]{6}$/.test(pay.code || ''), JSON.stringify(pay));
  const codeA = pay.code;

  // 5) /me?paid=1：成功横幅 + 认证码
  r = await get('/me?paid=1', { headers: { cookie: jarOf('mai_session') } });
  me = await r.text();
  ok('/me?paid=1 → 支付成功横幅 + 码', me.includes('支付成功') && me.includes(codeA));

  // 6) /admin/stats：付款用户/收入
  r = await get('/admin/stats', { headers: ADMIN });
  let s = await r.json().catch(() => ({}));
  ok('stats：paid_users=1 & revenue=3900', s.paid_users === 1 && s.revenue_cents_total === 3900, JSON.stringify(s));
  ok('stats：orders_paid=1 & users_total=1', s.orders_paid === 1 && s.users_total === 1);
  ok('stats：stripe_events_recent≥1', Array.isArray(s.stripe_events_recent) && s.stripe_events_recent.length >= 1
    && (s.stripe_events_recent[0].type || '') === 'checkout.session.completed');
  ok('stats：currency/online_window_min', s.currency === 'usd' && (s.online_window_min || 0) >= 1);

  // 7) 幂等：重复 webhook（Stripe 重试）→ duplicate，不重复发码
  r = await post('/mock-stripe/pay', { session_id: co.session_id });
  const dup = await r.json().catch(() => ({}));
  ok('重复 webhook → duplicate', dup.duplicate === true, JSON.stringify(dup));
  r = await get('/admin/stats', { headers: ADMIN }); s = await r.json();
  ok('幂等后 revenue/orders 不变', s.revenue_cents_total === 3900 && s.orders_paid === 1);

  // 8) 坏签名 → 400 invalid signature
  const evil = JSON.stringify({ id: 'evt_evil_1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_evil', metadata: { email: emailA }, amount_total: 3900 } } });
  r = await fetch(BASE + '/api/webhooks/stripe', { method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` }, body: evil });
  const bad = await r.json().catch(() => ({}));
  ok('坏签名 → 400 invalid signature', r.status === 400 && bad.error === 'invalid signature');
  // 无签名头 → 同样拒绝（防止未配置 secret 时被裸调）
  r = await fetch(BASE + '/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: evil });
  ok('无签名头 → 4xx', r.status >= 400 && r.status < 500);

  // 9) 防重复付款：已激活用户 → 302；pending+有未用码 → 409
  r = await post('/site/pay/checkout', {}, { cookie: jarOf('mai_session') });
  ok('已付费用户再 checkout → 302', r.status === 302);
  await post('/site/apply', { email: emailB });
  const tokB = await pollEmails(emailB);
  r = await get('/login?token=' + tokB); setJar(r); // cookie 覆盖为 B
  r = await post('/admin/issue-code', { email: emailB }, ADMIN); // B：pending 但已有未用码
  ok('试用码签发（B）', r.status === 200 && /^MAI-[A-Z2-9]{6}$/.test((await r.json()).code || ''));
  r = await post('/site/pay/checkout', {}, { cookie: jarOf('mai_session') });
  ok('有未用码再 checkout → 409', r.status === 409);

  // 10) activate + heartbeat → stats.online_tunnels=1（用 A 的付款码 codeA，固定 machineCode）
  const MC = 'e2ep7fixed' + Math.random().toString(36).slice(2, 8);
  r = await post('/api/activate', { code: codeA, machineCode: MC, serviceAddr: '127.0.0.1:3080' });
  const act = await r.json().catch(() => ({}));
  ok('activate → tunnelToken+url', !!act.tunnelToken && /^https:\/\/[a-z0-9]{12}\.newapi\.email$/.test(act.url || ''), JSON.stringify(act));
  r = await post('/api/heartbeat', { machineCode: MC, url: act.url });
  const hbd = await r.json().catch(() => ({}));
  ok('heartbeat → ok', hbd.ok === true, JSON.stringify(hbd));

  r = await get('/admin/stats', { headers: ADMIN }); s = await r.json();
  ok('stats：online_tunnels=1 & active_bindings=1', s.online_tunnels === 1 && s.active_bindings === 1, JSON.stringify(s));
  ok('stats：codes_unused（B 试用码未用）', s.codes_unused >= 1);

  r = await get('/admin/bindings', { headers: ADMIN });
  const bs0 = (await r.json().catch(() => []))[0] || {};
  ok('admin bindings 带邮箱 JOIN', (bs0.email || '') === emailA, JSON.stringify(bs0));
  r = await post('/api/activate', { code: 'MAI-XXXXXX', machineCode: MC, serviceAddr: '127.0.0.1:3080' });
  ok('activate 坏码 → 4xx', r.status >= 400 && r.status < 500);

  // 10b) 我的工具（客户侧管理）：重新登录 A → /me 显示工具列表 + 门户 URL 轮换
  r = await post('/site/apply', { email: emailA }); // 重新申请（旧 magic link 已消费）→ 新确认邮件
  let tokA2 = null;
  for (let i = 0; i < 25 && !tokA2; i++) {
    const q = await fetch(BASE + '/admin/emails?limit=50', { headers: ADMIN });
    const list = (await q.json().catch(() => ({ recent: [] }))).recent || [];
    for (const e of list) if ((e.to_email || '') === emailA && /token=/.test(e.body_text || '')) {
      const m = (e.body_text).match(/token=([a-f0-9]{32})/);
      if (m && m[1] !== tokA) { tokA2 = m[1]; break; }
    }
    if (!tokA2) await new Promise((r2) => setTimeout(r2, 200));
  }
  ok('重新申请 A → 新 magic link', !!tokA2);
  r = await get('/login?token=' + tokA2); setJar(r); // jar → A
  ok('重新登录 A', r.status === 302 && (r.headers.get('location') || '') === '/me');
  r = await get('/me', { headers: { cookie: jarOf('mai_session') } });
  const meHtml = await r.text();
  ok('/me → 我的工具 + 专属 URL', r.status === 200 && meHtml.includes('我的工具') && (meHtml.match(act.url) || []).length >= 1, 'tools card missing');
  const bId = bs0.id; // A 的绑定（当前唯一）
  r = await post('/site/tools/rotate', { id: bId }, { cookie: jarOf('mai_session') });
  const rot = await r.json().catch(() => ({}));
  ok('门户轮换 → 新 URL', r.status === 200 && rot.url && rot.url !== act.url, JSON.stringify(rot));
  r = await post('/api/heartbeat', { machineCode: MC, url: rot.url });
  ok('新 URL heartbeat → ok', (await r.json().catch(() => ({ ok: false }))).ok === true);
  r = await post('/site/tools/rotate', { id: bId }); // 无会话
  ok('轮换未登录 → 401', r.status === 401);

  // 11) admin dashboard HTML（cookie 登录）含实时总览
  r = await post('/admin/login', { token: 'dev-admin-token' }); setJar(r);
  r = await get('/admin', { headers: { cookie: jarOf('mai_admin') } });
  const ad = await r.text();
  ok('/admin dashboard → 实时总览 + stat-tiles', r.status === 200 && ad.includes('实时总览') && ad.includes('stat-tiles'));
  r = await get('/admin/stats'); // 无鉴权
  ok('stats 未鉴权 → 401', r.status === 401);

  console.log(`\n结果：${pass} PASS / ${fail} FAIL` + (mockLog ? '\n[mock 日志尾部]\n' + mockLog.slice(-400) : ''));
}

main().then(() => { kill(); process.exit(fail ? 1 : 0); })
  .catch((e) => { console.error('E2E 异常：', e); kill(); process.exit(1); });
