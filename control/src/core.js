// mobile ai（移动AI）· 控制面核心业务逻辑。
// 纯函数：不依赖 CF / D1 / Node API。Worker（index.js）与本地 mock
// （mock-server.mjs）各自实现 db / cf 适配器后共用本文件。
// 约定：所有时间戳为 unix ms，由调用方以 ts 参数显式传入（便于测试宽限策略）。

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去 I L O 0 1
export const SUB_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';  // URL 小写，同去易混
export const GRACE_MS = 6 * 3600e3;        // 心跳缺失宽限：超过 → grace（隧道保留）
export const SUSPEND_MS = 7 * 24 * 3600e3; // 宽限耗尽 → suspended（付费重绑）

export function randFrom(alphabet, n, rng = Math.random) {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[(rng() * alphabet.length) | 0];
  return s;
}

export const genCode = (rng) => 'MAI-' + randFrom(CODE_ALPHABET, 6, rng);
export const genSubdomain = (rng) => randFrom(SUB_ALPHABET, 12, rng);

function err(msg) { return { error: msg }; }
export function subFromUrl(url, domain) {
  let h = String(url || '').replace(/^https?:\/\//i, '').split('/')[0];
  if (h.endsWith('.' + domain)) return h.slice(0, -(domain.length + 1));
  return null; // 不属于本域 → 视为未知 URL（心跳不杀）
}

/* ---------------- activate：认证码核销 + 建隧道绑定 ---------------- */
// db: code(c) user(id) bindingByMachine(mc) bindingsForUser(uid, statusIn[])
//     redeemCode(c, ts) createBinding(row) updateBinding(id, fields, ts)
// cf: createTunnel({name, hostname, service}) -> {tunnelId}
//     issueToken(tunnelId) -> token ; createCname({sub, tunnelId})
export async function activate(db, cf, { code, machineCode, serviceAddr }, domain, ts) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^MAI-[A-Z2-9]{6}$/.test(c)) return err('认证码格式不正确');
  const row = await db.code(c);
  if (!row || row.status !== 'issued') return err('认证码无效或已使用');
  const user = await db.user(row.user_id);
  if (!user) return err('账号不存在');
  if (user.status === 'suspended') return err('账号已停用，请联系客服');

  // 同机重新激活：不消耗新码，原样返回既有隧道凭据
  const same = await db.bindingByMachine(machineCode);
  if (same && (same.status === 'active' || same.status === 'grace')) {
    await db.redeemCode(c, ts); // 码同样核销（防再次分发）
    return { tunnelToken: same.tunnel_token, url: 'https://' + same.subdomain + '.' + domain };
  }

  // 单终端绑定：该账号已有其他机器在线 → 拒绝（换机付费重绑）
  const other = await db.bindingsForUser(user.id, ['active', 'grace']);
  if (other.length && other[0].machine_code !== machineCode) {
    return err('该账号已绑定其他终端；换机重绑请联系客服');
  }

  const sub = genSubdomain();
  const hostname = sub + '.' + domain;
  let tunnelId, token;
  try {
    const t = await cf.createTunnel({ name: 'mai-' + user.id.slice(0, 8), hostname, service: 'http://' + serviceAddr });
    tunnelId = t.tunnelId; token = await cf.issueToken(tunnelId);
    await cf.createCname({ sub, tunnelId });
  } catch (e) { return err('隧道创建失败：' + String(e.message || e)); }

  await db.redeemCode(c, ts);
  const b = same || { id: 'b_' + randFrom(SUB_ALPHABET, 16) };
  await db.createBinding({ ...b, user_id: user.id, machine_code: machineCode, subdomain: sub,
    tunnel_id: tunnelId, tunnel_token: token, service_addr: serviceAddr, status: 'active',
    last_heartbeat: ts });
  return { tunnelToken: token, url: 'https://' + hostname };
}

/* ---------------- heartbeat：宽限 / 错机即杀 ---------------- */
export async function heartbeat(db, { machineCode, url }, domain, ts) {
  const sub = subFromUrl(url, domain);
  if (!sub) return { ok: true }; // 非本域 URL，不处理
  const b = await db.bindingBySubdomain(sub);
  if (!b) return { ok: true };

  if (['revoked', 'suspended'].includes(b.status)) return { revoked: true, reason: b.status };
  if (b.machine_code !== machineCode) {           // 错机即杀
    await db.updateBinding(b.id, { status: 'revoked' }, ts);
    return { revoked: true, reason: 'machine mismatch' };
  }
  let status = b.status;
  if (b.last_heartbeat && ts - b.last_heartbeat > SUSPEND_MS) {
    status = 'suspended';
  } else if (b.last_heartbeat && ts - b.last_heartbeat > GRACE_MS) {
    status = 'grace';
  } else if (status === 'grace') {
    status = 'active';                            // 宽限期内恢复在线
  }
  await db.updateBinding(b.id, { status, last_heartbeat: ts }, ts);
  if (status === 'suspended') return { revoked: true, reason: 'offline beyond grace' };
  return { ok: true, status };
}

/* ---------------- rotate：一键 URL 轮换（token 不变） ---------------- */
export async function rotate(db, cf, { machineCode, url }, domain, ts) {
  const b = await db.bindingByMachine(machineCode);
  if (!b || ['revoked', 'suspended'].includes(b.status)) return err('无有效绑定');
  if (subFromUrl(url, domain) !== b.subdomain) return err('URL 与该机器绑定不一致');
  const sub = genSubdomain();
  try {
    await cf.updateIngress(b.tunnel_id, sub + '.' + domain);   // ingress 指向新子域
    await cf.createCname({ sub, tunnelId: b.tunnel_id });      // 新 CNAME
    await cf.deleteCname(b.subdomain);                         // 旧子域下线
  } catch (e) { return err('轮换失败：' + String(e.message || e)); }
  await db.updateBinding(b.id, { subdomain: sub, status: 'active', last_heartbeat: ts }, ts);
  return { url: 'https://' + sub + '.' + domain };
}

/* ---------------- admin：用户 / 收款确认 / 发码（v0.3 半自动） ---------------- */
export async function ensureUser(db, email, ts) {
  let u = await db.userByEmail(String(email).trim().toLowerCase());
  if (u) return u;
  const id = 'u_' + randFrom(SUB_ALPHABET, 16);
  await db.createUser({ id, email: String(email).trim().toLowerCase(), status: 'pending', created_at: ts, updated_at: ts });
  return await db.userByEmail(String(email).trim().toLowerCase());
}

export async function issueCode(db, { email, orderId }, ts) {
  const u = await ensureUser(db, email, ts);
  if (u.status === 'suspended') return err('账号已停用');
  let c; do { c = genCode(); } while (await db.code(c)); // 极小概率碰撞重试
  await db.createCode({ code: c, user_id: u.id, order_id: orderId || null, status: 'issued', created_at: ts, updated_at: ts });
  return { code: c };
}

export async function markOrderPaid(db, { email, method, ref, amountCents }, ts) {
  const u = await ensureUser(db, email, ts);
  const oid = 'ord_' + randFrom(SUB_ALPHABET, 12);
  await db.createOrder({ id: oid, user_id: u.id, amount_cents: Number(amountCents) || 0, method: method || null,
    ref: ref || null, status: 'paid', created_at: ts, updated_at: ts });
  await db.updateUser(u.id, { status: 'active' }, ts); // pending → active
  const r = await issueCode(db, { email, orderId: oid }, ts);   // 收款确认 → 自动发码
  if (!r.error) await enqueueEmail(db, { to_email: u.email, subject: '移动AI — 你的认证码', body_text: codeEmail(u.email, r.code) }, ts);
  return r; // 收款确认 → 自动发码 + 认证码邮件入队（mailer.mjs 轮询发出）
}

/* ---------------- P3/P4：magic link + 邮件队列（mailer.mjs 轮询） ---------------- */
export const HEX = '0123456789abcdef';
export const genToken = (rng) => randFrom(HEX, 32, rng);

export async function createMagicLink(db, userId, kind, ts) {
  let t; do { t = genToken(); } while (await db.magicLink(t));
  await db.createMagicLink({ token: t, user_id: userId, kind: kind || 'login', created_at: ts, used_at: null });
  return t;
}

// magic link 一次性消费：返回用户 id（未用过且 <7d），否则 null
export async function consumeMagicLink(db, token, ts) {
  const m = await db.magicLink(String(token || ''));
  if (!m || m.used_at) return null;
  if (ts - m.created_at > 7 * 24 * 3600e3) return null;
  await db.useMagicLink(m.token, ts);
  return m.user_id;
}

export async function enqueueEmail(db, { to_email, subject, body_text }, ts) {
  const id = 'em_' + randFrom(SUB_ALPHABET, 12);
  await db.createEmail({ id, to_email: String(to_email), subject, body_text, status: 'queued', error: null, created_at: ts, updated_at: ts });
  return id;
}

export async function markEmail(db, id, { ok, error }, ts) {
  await db.updateEmail(id, { status: ok ? 'sent' : 'failed', error: error || null }, ts);
}

// v0.3 纯文本邮件模板（黑白、无 HTML）
export function magicLinkEmail(email, link) {
  return ['移动AI（mobile ai）— 邮箱确认', '', `你好，${email}：`,
    '你已申请移动AI。点击下方链接确认邮箱并登录「我的页面」（7 天内有效，一次性）：', '',
    link, '', '如非本人操作请忽略本邮件。', ''].join('\n');
}

export function codeEmail(email, code) {
  return ['移动AI（mobile ai）— 你的认证码', '', `你好，${email}：`,
    '付款已确认。你的专属认证码（一次性）：', '', `      ${code}`, '',
    '在本地控制台页面填入「本机地址 + 认证码」即可上线隧道。',
    '完整指引见控制台内「使用指引」。', ''].join('\n');
}

// 门户申请（P4）：建/取用户 + magic link + 确认邮件入队
export async function apply(db, { email }, portalBase, ts) {
  const u = await ensureUser(db, email, ts);
  if (u.status === 'suspended') return err('账号已停用');
  const t = await createMagicLink(db, u.id, 'login', ts);
  await enqueueEmail(db, { to_email: u.email, subject: '移动AI — 邮箱确认',
    body_text: magicLinkEmail(u.email, portalBase + '/login?token=' + t) }, ts);
  return { ok: true, email: u.email };
}

/* ---------------- P4：门户会话（cookie mai_session） ---------------- */
export async function createSession(db, userId, ts) {
  let t; do { t = genToken(); } while (await db.session(t));
  await db.createSession({ token: t, user_id: userId, created_at: ts, expires_at: ts + 7 * 24 * 3600e3 });
  return t;
}

export async function sessionUser(db, token) {
  const s = await db.session(String(token || ''));
  if (!s || Date.now() > s.expires_at) return null;
  const u = await db.user(s.user_id);
  if (!u || u.status === 'suspended') return null;
  return u;
}

// 「我的页面」数据：账号 + 最新认证码 + 绑定状态
export async function mePayload(db, user) {
  const codes = await db.latestCodes(user.id);
  const bindings = await db.bindingsForUser(user.id, ['active', 'grace']);
  return { email: user.email, status: user.status, code: codes[0] || null, binding: bindings[0] || null };
}

/* ---------------- P6：收费信息（v0.3 半自动：二维码 + 确认后自动发码） ---------------- */
// env 覆盖（Worker vars / mock process.env），缺省为占位值——真实二维码 URL 与金额由运营配置。
export const PAYMENT_DEFAULT = {
  amountLabel: '¥39',
  note: '一次性付费 · 专属 URL + 开机自启自动重连，无订阅',
  methods: [ { name: '支付宝', envKey: 'PAYMENT_QR_ALIPAY' }, { name: '微信支付', envKey: 'PAYMENT_QR_WECHAT' } ],
};

export function paymentInfoFromEnv(env = {}) {
  const p = JSON.parse(JSON.stringify(PAYMENT_DEFAULT)); // 深拷贝，避免污染缺省
  if (env.PAYMENT_AMOUNT) p.amountLabel = String(env.PAYMENT_AMOUNT);
  if (env.PAYMENT_NOTE) p.note = String(env.PAYMENT_NOTE);
  for (const m of p.methods) if (env[m.envKey]) m.qrUrl = String(env[m.envKey]);
  return p;
}

/* ---------------- P6：管理端会话（cookie mai_admin，与门户 mai_session 分离） ---------------- */
export async function createAdminSession(db, ts) {
  let t; do { t = genToken(); } while (await db.adminSession(t));
  await db.createAdminSession({ token: t, created_at: ts, expires_at: ts + 7 * 24 * 3600e3 });
  return t;
}

export async function adminSessionOk(db, token) {
  const s = await db.adminSession(String(token || ''));
  return !!s && Date.now() <= s.expires_at;
}

export async function deleteAdminSession(db, token) {
  await db.deleteAdminSession(String(token || ''));
}

/* ---------------- P6：管理端操作（吊销绑定） ---------------- */
export async function revokeBinding(db, id, ts) {
  const b = await db.binding(String(id || ''));
  if (!b) return err('绑定不存在');
  await db.updateBinding(id, { status: 'revoked' }, ts);
  return { ok: true, id };
}

// 管理端绑定列表（带用户邮箱，JOIN users；machine_code 截断展示）
export async function adminBindings(db, { limit = 200, status } = {}) {
  const rows = await db.bindingsWithUser(limit, status);
  return (rows || []).map((b) => ({ ...b, machine_code: b.machine_code ? String(b.machine_code).slice(0, 12) + '…' : '' }));
}
