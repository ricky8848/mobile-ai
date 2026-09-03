// mobile ai（移动AI）· P7 Stripe 在线收款层。
// I/O：Stripe REST API（fetch，Workers / Node18+ 通用）；业务落库走 core.markOrderPaid。
// 签名：Stripe-Signature = t=<unix秒>,v1=<hmac-sha256 hex>，payload 为 `t.原始body`。
// mock：STRIPE_MOCK=1 时 mock-server.mjs 用 signStripePayload 伪造带签名的 webhook，
//       走与生产完全相同的 verify → handleStripeWebhook 代码路径（E2E 可验证）。

import { markOrderPaid, randFrom, SUB_ALPHABET } from './core.js';

const STRIPE_API = 'https://api.stripe.com/v1/';
export const MOCK_WEBHOOK_SECRET = 'whsec_mock_dev_000000'; // 仅 mock E2E；生产必须 wrangler secret put STRIPE_WEBHOOK_SECRET
const SIG_TOLERANCE_S = 300; // ±5min（防重放）

function hmacHex(secret, payload) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((key) => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
    .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''));
}

function safeEq(a, b) { // 恒定时间比较（长度不同直接 false）
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 校验 Stripe-Signature 头（rawBody = 未解析的原始请求体） */
export async function verifyStripeSignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const parts = {};
  for (const kv of String(header).split(',')) {
    const i = kv.indexOf('='); if (i < 0) continue;
    parts[kv.slice(0, i).trim()] = kv.slice(i + 1).replace(/^"|"$/g, '');
  }
  const t = Number(parts.t); if (!Number.isFinite(t)) return false;
  if (Math.abs(Date.now() / 1000 - t) > SIG_TOLERANCE_S) return false; // 重放保护
  const expected = await hmacHex(secret, t + '.' + rawBody);
  return String(parts.v1 || '').split(',').some((v) => safeEq(v.trim(), expected));
}

/** 生成 Stripe-Signature（mock「假 Stripe」用；生产由 Stripe 自己签） */
export async function signStripePayload(rawBody, secret) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=` + await hmacHex(secret, t + '.' + rawBody);
}

/** 创建一次性 Checkout Session（动态 price_data，无需预建 Product/Price）→ {id,url} */
export async function createStripeCheckout(env, { email, amountCents, currency, productName, successUrl, cancelUrl }) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY 未配置');
  const params = {
    mode: 'payment',
    customer_email: email,
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': String(currency || 'usd').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(Number(amountCents) || 3900),
    'line_items[0][price_data][product_data][name]': productName || '移动AI — 一次性买断（隧道服务）',
    'metadata[email]': String(email).toLowerCase(), // webhook 回传时定位用户
  };
  const r = await fetch(STRIPE_API + 'checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String((d.error && d.error.message) || ('stripe ' + r.status)));
  return { id: d.id, url: d.url };
}

/**
 * webhook 处理（POST /api/webhooks/stripe）。rawBody = req.text()。
 * 成功 → markOrderPaid（method=stripe, ref=session id）→ 自动发码 + 邮件。
 * 幂等：stripe_event_id UNIQUE + orders.ref 双去重；Stripe 重试不会重复发码。
 */
export async function handleStripeWebhook(db, env, rawBody, sigHeader, ts) {
  const secret = env.STRIPE_WEBHOOK_SECRET || (env.STRIPE_MOCK ? MOCK_WEBHOOK_SECRET : null);
  if (!secret) return { error: 'webhook secret not configured' };
  if (!(await verifyStripeSignature(rawBody, sigHeader || '', secret))) return { error: 'invalid signature' };
  let event; try { event = JSON.parse(rawBody); } catch { return { error: 'bad json' }; }
  const eventId = String(event.id || ''); if (!eventId) return { error: 'no event id' };
  const type = String(event.type || '');

  if (await db.stripeEventExists(eventId)) return { duplicate: true, id: eventId }; // Stripe 重试 → 直接确认
  if (type !== 'checkout.session.completed') {
    await db.createStripeEvent({ id: 'se_' + randFrom(SUB_ALPHABET, 12), stripe_event_id: eventId,
      type, email: null, amount_cents: 0, status: 'processed', created_at: ts });
    return { ok: true, ignored: type }; // 其他事件仅审计留痕
  }

  const s = (event.data && event.data.object) || {};
  const email = String((s.metadata && s.metadata.email) || (s.customer_details && s.customer_details.email) || '').toLowerCase();
  if (!email) return { error: 'no email in session' }; // 不写审计 → Stripe 重试（配置修复后可恢复）
  if (s.id && await db.orderByRef(s.id)) return { duplicate: true, id: eventId }; // 双保险

  const r = await markOrderPaid(db, { email, method: 'stripe', ref: s.id || null,
    amountCents: Number(s.amount_total) || 0 }, ts);
  await db.createStripeEvent({ id: 'se_' + randFrom(SUB_ALPHABET, 12), stripe_event_id: eventId,
    type, email, amount_cents: Number(s.amount_total) || 0, status: r.error ? 'error' : 'processed', created_at: ts });
  if (r.error) return r; // 400/5xx → Stripe 自动重试
  return { ok: true, code: r.code }; // 2xx → Stripe 停止重试
}
