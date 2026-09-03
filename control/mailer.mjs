#!/usr/bin/env node
// mobile ai（移动AI）· mailer.mjs — 邮件队列轮询发送器（P3）。
// 与 cloudflared 一起常驻家中机器：轮询控制面 /admin/email-queue，
// nodemailer 多邮箱轮转发出（确认链接/认证码/订单邮件），回报 /admin/email-result。
//
// env：
//   MOBILEAI_API    控制面地址（默认 http://127.0.0.1:6420；生产 https://newapi.email）
//   ADMIN_TOKEN     管理端 Bearer（默认 dev-admin-token）
//   MAIL_ACCOUNTS   "user1:pass1,user2:pass2"（多邮箱轮转；QQ/网易需授权码）
//   MAIL_FROM_NAME  发件人显示名（默认「移动AI」）
//   POLL_MS         轮询间隔 ms（默认 5000）
//   MAIL_MOCK=1     MOCK：不真发，打印到 stdout（本地 E2E / 调试）
//   MAIL_RETRY_MS   failed 邮件重试间隔 ms（默认 300000 = 5min；修好 SMTP 后自动重发，无需手动）

let nodemailer = null;
try { ({ default: nodemailer } = await import('nodemailer')); } catch {}

const API = process.env.MOBILEAI_API || 'http://127.0.0.1:6420';
const TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';
const MOCK = !!process.env.MAIL_MOCK;
const INTERVAL_MS = Number(process.env.POLL_MS || 5000);
const RETRY_MS = Number(process.env.MAIL_RETRY_MS || 300 * 1000);

function smtpFor(user) {
  const d = (user.split('@')[1] || '').toLowerCase();
  if (d === 'gmail.com') return { host: 'smtp.gmail.com', port: 465, secure: true };
  if (d === 'qq.com') return { host: 'smtp.qq.com', port: 465, secure: true };
  if (d === '163.com') return { host: 'smtp.163.com', port: 465, secure: true };
  if (['outlook.com', 'hotmail.com', 'live.com'].includes(d)) return { host: 'smtp.office365.com', port: 587, secure: false };
  throw new Error('无法推断 SMTP：' + d);
}

const accounts = (process.env.MAIL_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  .map((pair) => { const i = pair.indexOf(':'); return { user: pair.slice(0, i).trim(), pass: (pair.slice(i + 1) || '').trim() }; });
const transports = accounts.map((a) => (nodemailer ? nodemailer.createTransport({ ...smtpFor(a.user), auth: { user: a.user, pass: a.pass } }) : null));
let rr = 0;

const j = async (p, b) => { const r = await fetch(API + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: b && JSON.stringify(b) }); return { s: r.status, d: await r.json().catch(() => ({})) }; };

async function sendOne(email) {
  if (MOCK || !transports.length) { console.log(`[mailer MOCK] to=${email.to_email} subject="${email.subject}"\n${email.body_text}`); return; }
  const i = rr % transports.length; rr++;
  await transports[i].sendMail({ from: `"${process.env.MAIL_FROM_NAME || '移动AI'}" <${accounts[i].user}>`, to: email.to_email, subject: email.subject, text: email.body_text });
}

async function tick() {
  try {
    const q = await j('/admin/email-queue');
    // failed 邮件自动重试（修好 SMTP/授权码后无需手动；间隔 MAIL_RETRY_MS，MOCK 模式跳过）
    let retryList = [];
    if (!MOCK) { try { const f = await j('/admin/emails?limit=50'); retryList = (f.d.recent || []).filter((e) => e.status === 'failed' && Date.now() - Number(e.updated_at || 0) >= RETRY_MS); } catch {} }
    for (const e of [...(q.d.emails || []), ...retryList]) {
      try { await sendOne(e); await j('/admin/email-result', { id: e.id, ok: true }); console.log('[mailer] sent ' + e.id); }
      catch (err) { try { await j('/admin/email-result', { id: e.id, ok: false, error: String(err.message || err) }); } catch {} console.error('[mailer] failed ' + e.id + ':', String(err.message || err)); }
    }
  } catch (e) { console.error('[mailer] poll failed:', String(e.message || e)); }
}

console.log('[mailer] ' + (MOCK ? 'MOCK 模式' : accounts.length + ' 个邮箱') + ' · 轮询 ' + INTERVAL_MS + 'ms · api=' + API);
if (!MOCK && !transports.length) console.warn('[mailer] 未安装 nodemailer 或未设 MAIL_ACCOUNTS — 邮件将积压在队列');
tick(); setInterval(tick, INTERVAL_MS);
