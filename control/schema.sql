-- mobile ai（移动AI）· 控制面 D1 schema（SQLite，wrangler d1 push 使用）
-- 时间戳统一 unix ms（INTEGER）。

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,            -- worker 侧 crypto.randomUUID()
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | active | suspended
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,           -- 'ord_' + 随机串（v0.3 半自动：管理端确认收款后落库）
  user_id      TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL DEFAULT 0, -- v0.3 手动二维码，金额仅记录
  method       TEXT,                       -- alipay | wechat
  ref          TEXT,                       -- 收款备注/订单号（管理端填写，可空）
  status       TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid | refunded
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
  code       TEXT PRIMARY KEY,             -- MAI-XXXXXX（6 位大写字母数字，去易混字符）
  user_id    TEXT NOT NULL REFERENCES users(id),
  order_id   TEXT,                         -- 可空：免费试用/管理端直接签发
  status     TEXT NOT NULL DEFAULT 'issued', -- issued | redeemed | revoked
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bindings (
  id             TEXT PRIMARY KEY,         -- uuid，每次激活一条记录（轮换不换行，只改 subdomain）
  user_id        TEXT NOT NULL REFERENCES users(id),
  machine_code   TEXT NOT NULL,            -- 客户端机器码指纹（sha256 hex）
  subdomain      TEXT NOT NULL UNIQUE,     -- newapi.email 下的随机子域（轮换时替换）
  tunnel_id      TEXT,                     -- CF named-tunnel id；mock 模式为 null
  tunnel_token   TEXT NOT NULL,            -- cloudflared token（同机重新激活时原样返回）
  service_addr   TEXT NOT NULL,            -- 本机服务地址，如 127.0.0.1:3080
  status         TEXT NOT NULL DEFAULT 'active', -- active | grace | revoked | suspended
  last_heartbeat INTEGER,                  -- unix ms；null = 尚未收到心跳
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user      ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_codes_user       ON auth_codes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bindings_machine ON bindings(machine_code);

-- ---- P3/P4：邮件队列（mailer 轮询）+ magic link + 门户会话 ----

CREATE TABLE IF NOT EXISTS emails (
  id         TEXT PRIMARY KEY,           -- 'em_' + 随机串；mailer.mjs 轮询领取
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body_text  TEXT NOT NULL,              -- v0.3 纯文本（含 magic link / 认证码）
  status     TEXT NOT NULL DEFAULT 'queued', -- queued | sent | failed
  error      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token      TEXT PRIMARY KEY,           -- 32 hex；邮件中的确认链接 /login?token=
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL DEFAULT 'login', -- login（magic link）| code（认证码邮件，可选验证用）
  created_at INTEGER NOT NULL,
  used_at    INTEGER                      -- null = 未使用（一次性）
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,           -- 32 hex；cookie mai_session（HttpOnly）
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL            -- unix ms（默认 +7d）
);

CREATE INDEX IF NOT EXISTS idx_emails_status  ON emails(status, created_at);

-- ---- P6：管理端会话（cookie mai_admin，与门户 mai_session 分离）----

CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,           -- 32 hex；cookie mai_admin（HttpOnly）
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL            -- unix ms（默认 +7d）
);

-- ---- P7：Stripe 在线收款（全球卡/Apple Pay）事件审计表 ----
CREATE TABLE IF NOT EXISTS stripe_events (
  id              TEXT PRIMARY KEY,          -- 'se_' + 随机串（worker 侧生成）
  stripe_event_id TEXT NOT NULL UNIQUE,      -- evt_...（Stripe 事件 id，幂等去重）
  type            TEXT NOT NULL,             -- checkout.session.completed | ...
  email           TEXT,                      -- 归属用户（session.metadata.email）
  amount_cents    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'processed', -- processed | error
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type, created_at);
