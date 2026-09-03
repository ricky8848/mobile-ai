# control · 控制面（CF Workers + D1）

零成本：Workers 免费档（10 万请求/天）+ D1 免费档。数据面在用户机器（cloudflared
出站隧道），本站只发 token / 管 DNS，不碰用户流量。

## 文件

| 文件 | 说明 |
|---|---|
| `schema.sql` | D1 schema（users / orders / auth_codes / bindings / emails / magic_links / sessions / admin_sessions / stripe_events），已用本地 sqlite3 验证 |
| `wrangler.jsonc` | Worker 配置（D1 binding、DOMAIN=newapi.email） |
| `src/core.js` | 纯业务逻辑（无 CF/DB 依赖，Worker 与本地 mock 共用） |
| `src/cf.js` | Cloudflare REST：命名隧道创建/ingress 更新/CNAME/token 签发 |
| `src/stripe.js` | P7 Stripe：Checkout session + webhook 验签/处理（HMAC-SHA256） |
| `src/index.js` | Worker 入口：路由 + D1 适配层 |
| `mock-server.mjs` | 本地 mock 控制面（无 CF，P2b 本机 E2E 用；`STRIPE_MOCK=1` 含假 Stripe） |
| `e2e-p7.mjs` | P7 E2E 脚本（Stripe mock 全流程 + webhook 验签/幂等 + /admin/stats） |

## API（客户端契约，与 client/src/mobileai.mjs 对齐）

| 端点 | 请求体 | 响应 |
|---|---|---|
| `POST /api/activate` | `{code, machineCode, serviceAddr}` | `{tunnelToken, url}` 或错误 |
| `POST /api/heartbeat` | `{machineCode, url}` | `{ok:true}` 或 `{revoked:true, reason}` |
| `POST /api/rotate` | `{machineCode, url}` | `{url}`（新子域，token 不变） |

管理端（`Authorization: Bearer <ADMIN_TOKEN>` 或 mai_admin cookie）：
- `POST /admin/user {email}` → 建用户（pending→active 由收款确认驱动）
- `POST /admin/order-paid {email, method?, ref?}` → 记收款 + 签发认证码，返回 `code`
- `POST /admin/issue-code {email}` → 直接签发认证码（试用）
- `GET /admin/users` · `GET /admin/bindings?status=` · `POST /admin/revoke {id}`
- `GET /admin/stats` → P7 实时总览（在线隧道/付款用户/今日+累计收入等，前端 10s 轮询）

门户（P7 在线收款）：
- `POST /site/pay/checkout` → Stripe Checkout session，返回 `{url}`（需门户会话；跳转支付）
- `POST /api/webhooks/stripe` → Stripe webhook（HMAC-SHA256 验签；`checkout.session.completed`
  → `markOrderPaid(method=stripe)` 自动发码；事件审计入 stripe_events，幂等去重）

## P7 Stripe 在线收款（全球卡 / Apple Pay；需用户注册，步骤如下）

代码已就绪并 E2E 验证（`STRIPE_MOCK=1`）。上线只需以下**手动注册/配置**：

1. **注册 Stripe 账号**：<https://dashboard.stripe.com/register>（个人/个体户即可；
   选「我要卖产品或服务」。地区不支持 Stripe 的备选：Lemon Squeezy / Paddle，
   或先用 `PAYMENT_ONLINE_URL` 挂 PayPal.me 外链兜底）。
2. **拿 Secret Key（先测试模式）**：Dashboard 右上角切到 *Test mode* →
   Developers → API keys → Secret key（`sk_test_...`）。
3. **部署 Worker 后配 secrets**：
   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY      # sk_test_...（上线换 sk_live_）
   ```
4. **建 Webhook**：Dashboard → Developers → Webhooks → Add endpoint：
   - URL：`https://newapi.email/api/webhooks/stripe`（先部署再建，或临时用 ngrok）
   - 事件只勾 `checkout.session.completed`
   - 复制 Signing secret（`whsec_...`）→ `npx wrangler secret put STRIPE_WEBHOOK_SECRET`
5. **（可选）vars**：`PAYMENT_CURRENCY=usd`、`PAYMENT_AMOUNT_CENTS=<分>`（与展示金额配套）。
6. **测试**：Test mode 下 /me「在线支付」用卡 `4242 4242 4242 4242`（任意未来日期/CVC）
   → webhook 自动确认收款 + 发码邮件；/admin「实时总览」可见付款用户与收入。
7. **上线**：切 Live mode，换 `sk_live_...` + 新建 live webhook（whsec）替换 secrets。

无需预建 Product/Price：Checkout session 用动态 `price_data`（金额取
`PAYMENT_AMOUNT_CENTS`）。二维码/银行转账保留为备用渠道（半自动确认不变）。

## 部署（需 CF 凭据，v0.3）

```sh
cd control
npm i -D wrangler        # 或全局 npx
npx wrangler d1 create mobileai-db   # database_id 回填到 wrangler.jsonc
npx wrangler d1 execute mobileai-db --local=false --file schema.sql  # 或 push
npx wrangler secret put CF_API_TOKEN    # Account API token（cfd_tunnel + DNS 权限）
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put ADMIN_TOKEN     # 自定长随机串，仅自己持有
npx wrangler deploy
```

前置：Cloudflare 账号已托管 newapi.email；DNS 上为 `*.newapi.email`
预留泛解析冲突检查（子域 CNAME → `<tunnel-id>.cfargotunnel.com` 由 cf.js 自动创建）。

## 心跳策略（core.js）

- 客户端每 30 min 一次；`last_heartbeat` 超 **6 h** → `grace`（宽限，隧道保留）；
- 超 **7 d** → `suspended`（停用，换机/重新激活走付费重绑）；
- 同一 URL 收到**不同 machineCode** 的心跳 → `revoked`（错机即杀）。
