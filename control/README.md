# control · 控制面（CF Workers + D1）

零成本：Workers 免费档（10 万请求/天）+ D1 免费档。数据面在用户机器（cloudflared
出站隧道），本站只发 token / 管 DNS，不碰用户流量。

## 文件

| 文件 | 说明 |
|---|---|
| `schema.sql` | D1 schema（users / orders / auth_codes / bindings），已用本地 sqlite3 验证 |
| `wrangler.jsonc` | Worker 配置（D1 binding、DOMAIN=newapi.email） |
| `src/core.js` | 纯业务逻辑（无 CF/DB 依赖，Worker 与本地 mock 共用） |
| `src/cf.js` | Cloudflare REST：命名隧道创建/ingress 更新/CNAME/token 签发 |
| `src/index.js` | Worker 入口：路由 + D1 适配层 |
| `mock-server.mjs` | 本地 mock 控制面（无 CF，P2b 本机 E2E 用） |

## API（客户端契约，与 client/src/mobileai.mjs 对齐）

| 端点 | 请求体 | 响应 |
|---|---|---|
| `POST /api/activate` | `{code, machineCode, serviceAddr}` | `{tunnelToken, url}` 或错误 |
| `POST /api/heartbeat` | `{machineCode, url}` | `{ok:true}` 或 `{revoked:true, reason}` |
| `POST /api/rotate` | `{machineCode, url}` | `{url}`（新子域，token 不变） |

管理端（`Authorization: Bearer <ADMIN_TOKEN>`）：
- `POST /admin/user {email}` → 建用户（pending→active 由收款确认驱动）
- `POST /admin/order-paid {email, method?, ref?}` → 记收款 + 签发认证码，返回 `code`
- `POST /admin/issue-code {email}` → 直接签发认证码（试用）
- `GET /admin/users` · `GET /admin/bindings?status=`

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
