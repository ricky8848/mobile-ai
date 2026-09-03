#!/usr/bin/env node
// mobile ai（移动AI）· server.mjs 冒烟测试 — Node+SQLite 桥接回归。
//   node smoke-server.mjs     # 独立起 server.mjs（:6421，临时目录），跑完即杀
// 覆盖：healthz / apply→magic link（邮件正文解析）/登录 302//me 待付款卡/坏链接
//       /admin 试用码→/me 已激活+码/activate 无 CF token 优雅报错/stats/admin 鉴权。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.SMOKE_PORT || 6421);
const BASE = 'http://127.0.0.1:' + PORT;
const ADMIN = { authorization: 'Bearer dev-admin-token' };

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.error('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mai-smoke-'));
const child = spawn('node', ['server.mjs'], { cwd: DIR,
  env: { ...process.env, PORT: String(PORT), MAI_HOME: home, MAI_DB: path.join(home, 'smoke.db'), ADMIN_TOKEN: 'dev-admin-token' },
  stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
const kill = () => { try { child.kill('SIGKILL'); } catch {} };

async function waitUp(ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

const get = (p, h) => fetch(BASE + p, { headers: h || {}, redirect: 'manual' });
const post = (p, body, h) => fetch(BASE + p, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body || {}), redirect: 'manual' });

try {
  if (!(await waitUp())) throw new Error('server.mjs 未起来：\n' + log);
  console.log(`— server.mjs smoke（:${PORT}，SQLite ${path.join(home, 'smoke.db')}）—`);

  let r = await get('/healthz');
  ok('healthz', (await r.json()).service === 'mobileai-control');

  // apply → magic link（从 /admin/emails 正文解析；同时验证「查看」弹窗数据源）
  r = await post('/site/apply', { email: 'smoke@test.local' });
  ok('apply → ok', r.status === 200 && (await r.json()).ok === true);
  await new Promise((res) => setTimeout(res, 300)); // mailer 不参与（无进程）；邮件已同步入队
  r = await get('/admin/emails', ADMIN);
  const mails = (await r.json());
  const allMails = [...(mails.recent || []), ...(mails.queued || [])];
  const withBody = allMails.find((e) => (e.body_text || '').length > 50);
  ok('邮件入队且正文非空（admin「查看」数据源）', !!withBody, JSON.stringify(allMails.map((e) => e.subject)));
  const m = (withBody?.body_text || '').match(/login\?token=([a-f0-9]{32})/);
  ok('magic link 在邮件正文', !!m, 'no token');

  // magic link 登录 → 302 /me + cookie
  const cookies = {};
  r = await get('/login?token=' + (m ? m[1] : 'x'));
  ok('magic link 登录 → 302 /me', r.status === 302 && (r.headers.get('location') || '') === '/me');
  for (const sc of String(r.headers.getSetCookie?.() || []).split(/,(?=[^ ;]+=)/)) {
    const [pair] = sc.split(';'); if (!pair) continue; const i = pair.indexOf('='); cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  const jar = Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; ');
  const me = () => get('/me', { cookie: jar });

  r = await me(); let page = await r.text();
  ok('/me → 200 + 待付款确认', r.status === 200 && page.includes('待付款确认'));
  ok('/me QR 备用卡（未配 Stripe：无在线支付按钮）', page.includes('扫码 / 银行转账') && !page.includes('pay-online'));

  r = await get('/login?token=deadbeef');
  ok('坏 magic link → 「链接不可用」页', r.status === 200 && (await r.text()).includes('链接不可用'));

  // admin：试用码 → /me 显示大字号认证码（试用不激活用户，仍「待付款确认」）
  r = await post('/admin/issue-code', { email: 'smoke@test.local' }, ADMIN);
  const code = (await r.json()).code || '';
  ok('试用码签发 MAI-XXXXXX', /^MAI-[A-Z2-9]{6}$/.test(code), code);
  r = await me(); page = await r.text();
  ok('/me → 显示认证码（试用态：仍待付款确认）', page.includes(code) && page.includes('待付款确认'));

  // admin：确认收款（第二用户）→ 激活 + 发码 + 认证码邮件入队
  r = await post('/admin/order-paid', { email: 'smoke2@test.local', method: 'alipay' }, ADMIN);
  const pay = await r.json();
  ok('确认收款 → 发码 + 无 error', /^MAI-[A-Z2-9]{6}$/.test(pay.code || ''), JSON.stringify(pay));

  // activate：无 CF token → 优雅报错（4xx + error 文案），不炸
  r = await post('/api/activate', { code, machineCode: 'MAI-SMOKE-TEST1', serviceAddr: '127.0.0.1:3080' });
  const act = await r.json().catch(() => ({}));
  ok('activate 无 CF token → 4xx + error', r.status >= 400 && !!act.error, JSON.stringify(act));

  // stats + admin 鉴权
  r = await get('/admin/stats', ADMIN); const st = await r.json();
  ok('stats：users_total=2 active=1 pending=1 codes_unused=2', st.users_total === 2 && st.users_active === 1
    && st.users_pending === 1 && st.codes_unused === 2, JSON.stringify(st));
  r = await get('/admin/stats');
  ok('stats 未鉴权 → unauthorized', (await r.json()).error === 'unauthorized');
  const adm = await get('/admin').then((x) => x.text());
  ok('未登录 /admin → 令牌登录页', adm.includes('管理令牌'));
  const dash = await get('/admin', ADMIN).then((x) => x.text());
  ok('dashboard：实时总览 + 邮件「查看」按钮', dash.includes('实时总览') && dash.includes('emailview'));

  console.log(`==== SMOKE RESULT: PASS=${pass} FAIL=${fail} ====`);
  process.exitCode = fail ? 1 : 0;
} catch (e) { console.error('SMOKE ERROR:', e.message); process.exitCode = 1; }
finally { kill(); fs.rmSync(home, { recursive: true, force: true }); }
