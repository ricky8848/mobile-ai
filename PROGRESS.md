# mobile ai（移动AI）· 工程进度检查点

> **本文件是断点续跑的唯一依据。** 每完成一步立即追加记录。
> 若会话/模型中断，新对话里说「按 new dsh/PROGRESS.md 继续」即可精确接续。

## 最终目标（已确认，2026-08-25）

零成本隧道即服务（mini-ngrok），域名 newapi.email：一条命令 + 一个浏览器页面，
把家中电脑任意本地服务（默认 DSH 127.0.0.1:3080）同步到手机。
控制面 = CF Workers + D1（零成本）；数据面 = 用户机器 cloudflared 出站隧道。
安全：机器码单终端绑定 + URL 轮换 + Cloudflare Access。付款先半自动（二维码+确认后自动发码）。

## 目录约定（结构固定，只新增不改动已有布局）

```
new dsh/
├── README.md / LICENSE / SECURITY.md      已有，不动
├── docs/GUIDE.md                          已有，客服第一版内容源
├── client/                                i.sh / i.ps1（新增）+ src/mobileai.mjs（已有）
│   └── src/ui/index.html + styles.css     已有，不动
├── control/                               P2/P3：Workers + D1 schema + nodemailer（新增）
└── site/                                  P4：官网门户页面（新增）
```

## 阶段计划与状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1a | OMLX 健康预检 + PROGRESS.md | ✅ 2026-08-25 |
| P1b | 读透 mobileai.mjs，确定缺失文件清单 | ✅ 2026-08-25 |
| P1c | 补齐 guide.md / app.js（控制台引用缺失） | ✅ 2026-08-25 |
| P1d | 写 i.sh / i.ps1 一键安装脚本 | ✅ 2026-08-25（node --check / bash -n 全过） |
| P2a | control/ 控制面代码（activate/heartbeat/rotate + D1 schema） | ✅ 2026-08-25（core/cf/index/mock 全部 node --check 通过） |
| P2b | 本地 mock 控制面 + 本机端到端跑通（mock） | ✅ 2026-08-25 API E2E 10/10 + 客户端集成（真实隧道待 CF 部署） |
| P3 | 自动发信 worker（nodemailer 多邮箱） | ✅ 2026-08-25 D1 队列 + mailer.mjs，MOCK E2E 闭环 |
| P4 | site/ 官网门户 + 自动客服 | ✅ 2026-08-25 src/site.js（落地/登录/我的页面），全旅程 E2E 通过 |
| P5 | GitHub 发布 + 其他平台列表（需用户确认账号/仓库名） | ✅ 2026-08-25 已推私有仓 ricky8848/mobile-ai（可一键转公开） |
| P6 | 收费功能完善（二维码+确认后自动发码，按计划半自动） + /admin 管理控制台 | ✅ 2026-08-28 mock E2E 全过（生产 CF 部署待凭据） |
| P7 | Stripe 全球在线收款（Checkout+webhook 自动发码，二维码保留为备用） + /admin 实时总览（在线/付款用户等 10s 轮询） | ✅ 2026-08-28 E2E 31/31（Stripe mock）；上线待用户注册 Stripe + CF 部署 |

## 检查点日志

- **2026-08-25** 目标 9 项核对一致，用户确认开工。OMLX 预检通过（127.0.0.1:8000 正常）。
- **2026-08-25** P1b：通读 mobileai.mjs（424 行，语法 OK）。已知契约：
  - 控制面 API：`POST /api/activate {code, machineCode, serviceAddr}` → URL；
    `POST /api/rotate {machineCode, url}` → 新 URL；`POST /api/heartbeat {machineCode, url}`
  - apiBase = env `MOBILEAI_API` > state.apiBase > https://newapi.email
  - 本地控制台 HTTP（端口从 5380 起找空位）：`GET /api/status`；UI 引用 SELF_DIR 下 `guide.md`、`app.js`（**缺失，待补**）
  - cloudflared：下载到 ~/.mobileai/bin/（版本表在 CLOUDFLARED），token 模式运行，state.json 存 cfPid/url/machineCode
  - 自启注册：launchd / systemd user / Windows schtasks（registerAutoStart）
- **2026-08-25** P1c/P1d 完成并复核（换会话接管）：app.js(7.7KB)/i.sh/i.ps1/guide.md 均在盘，
  `node --check` app.js、mobileai.mjs 与 `bash -n i.sh` 全部通过；cloudflared 钉版 2026.8.2 已验证存在。
  **P1 ✅**。关键契约补充：cloudflared 以 `tunnel --token <tunnelToken> run`（命名隧道）运行，
  故 `/api/activate` 响应必须含 `{tunnelToken, url}`；heartbeat 返回 `d.revoked=true` 时客户端自停隧道。
- **2026-08-25** 接管说明：本地 OMLX 长回合易断，本会话继续执行。纪律不变——短回合、逐步落盘本文件；
  P2b 本机 E2E 用 `MOBILEAI_NO_SPAWN=1`（不真跑 cloudflared），真实隧道验证待 CF 凭据部署后。
- **2026-08-25** P2a 进行中：`control/` 新增 schema.sql（4 表+索引，sqlite3 :memory: 验证通过）、
  wrangler.jsonc、package.json(type=module)、README.md（部署步骤+API/心跳策略）、src/core.js
  （纯业务逻辑：activate 核销码+建隧道、heartbeat 宽限6h/停7d/错机即杀、rotate 换子域 token 不变、
  admin 半自动收款发码）。bindings 表含 tunnel_token（同机重激活复用）。
- **2026-08-25** P2a ✅ + API E2E 10/10：mock-server.mjs（内存 db+假 CF，:6420）全过——
  发码/激活/心跳/轮换/错机即杀/付费重绑/同机幂等/码复用拒绝/admin 鉴权。
  **客户端 bug 修复**（E2E 发现）：mobileai.mjs downloadCloudflared 用 `r.body.pipe`（Web stream 无 .pipe）
  → 改 `Readable.fromWeb(r.body).pipe(out)`（1MB 单测通过；本机 GitHub asset 可达但 ~62KB/s，环境因素）。
- **2026-08-25** P2b ✅（无 CF 凭据可达范围）：真实客户端 daemon（fake HOME + launchctl stub，:5380）
  → mock 控制面：/api/start {ok:true,url} → status activated:true，state.json 存 token+url；
  UI 静态资源 /、/app.js、/guide.md 均 200。真实 cloudflared 隧道 + CF DNS 待 P2 部署（wrangler token）。
  mock 复跑：`cd control && node mock-server.mjs`（admin token: dev-admin-token）。
- **2026-08-25** P3 ✅：schema 增 emails/magic_links/sessions（sqlite3 验证）；core.js 加
  createMagicLink/consumeMagicLink/enqueueEmail/markEmail/apply/createSession/sessionUser/mePayload + 纯文本邮件模板；
  index.js+mock-server 加 /admin/email-queue、/admin/email-result（Bearer ADMIN_TOKEN）。
  `control/mailer.mjs`：nodemailer 多邮箱轮转（gmail/qq/163/outlook SMTP 推断）、POLL_MS 轮询、MAIL_MOCK=1 调试模式。
  **E2E ✅**：order-paid → 认证码邮件入队（正文含 MAI-DWKVP3）→ mailer 1s 内发出 → sent，队列清空。
  （修复：mailer.mjs 一处模板字符串反引号未闭合——node --check 抓到。）真实 SMTP 发送待家中机器配 MAIL_ACCOUNTS。
- **2026-08-25** P4 ✅：src/site.js（落地页/magic link/我的页面，黑白 Apple 风，Worker+mock 共用）；
  index.js + mock-server 挂路由：GET /（申请）、POST /site/apply、GET /login?token=（一次性→302+HttpOnly cookie）、
  GET /me、POST /site/logout；静态分发 i.sh/mobileai.mjs/app.js/guide.md（wrangler assets: control/static/）。
  **全旅程 E2E ✅**：apply → magic link（从邮件正文解析）→ 登录 302 → /me 待付款确认
  → order-paid MAI-DFXWES → /me 已激活+码展示；无会话 302→/。
- **2026-08-25** P5 进行中：gh 已登录 ricky8848 → 推 GitHub（私有仓库 mobile-ai，确认后可一键转公开）。
- **2026-08-25** P5 ✅：git init + 27 文件提交（commit 52540cd）→ https://github.com/ricky8848/mobile-ai（私有）。转公开：`gh repo edit mobile-ai --visibility public`。
  **本地预览已启动**：mock :6420 + mailer MOCK（日志 /tmp/mai-mailer.log，pid 见 /tmp/mai-mock.pid、/tmp/mai-mailer.pid）；demo@example.com 已激活。
  **剩余手动项（需用户）**：CF 部署控制面 wrangler token（control/README.md）；家中机器设 MAIL_ACCOUNTS 跑 mailer.mjs（真实 SMTP）。
- **2026-08-28** 预览恢复 + E2E 复核（oMLX KV 事故后环境稳定）：旧 mock/mailer 进程已失 → nohup 常驻重启
  （pid 见 /tmp/mai-mock.pid、/tmp/mai-mailer.pid；mock 日志 /tmp/mai-mock.log）。Mock 为内存态 → 旧会话丢失，
  重播种 demo@example.com（order-paid）→ 新码 MAI-2QTQ7B。全旅程 E2E ✅：mailer 发认证码邮件（MOCK）→
  apply → magic link 登录 302→/me → /me 显示已激活+码。
  用户访问：magic link 登录（MOCK 模式链接在 /tmp/mai-mailer.log）→ 打开 http://127.0.0.1:6420/me。
  部署准备：control/ 已装 wrangler@4.127.0（npm EPERM→`--cache /tmp/mai-npm-cache` 绕过；wrangler 写
  ~/.wrangler 的权限问题在部署时处理）。剩余手动项不变：CF 凭据 + MAIL_ACCOUNTS。
- **2026-08-28** P6 ✅ 收费功能完善 + /admin 管理控制台（按既定计划「付款先半自动：二维码+确认后自动发码」）：
  - core.js：paymentInfoFromEnv（env PAYMENT_AMOUNT/PAYMENT_NOTE/PAYMENT_QR_ALIPAY/PAYMENT_QR_WECHAT 覆盖，
    缺省 ¥39 占位）；admin 会话（cookie mai_admin，7d：createAdminSession/adminSessionOk/deleteAdminSession）；
    revokeBinding（吊销即隧道失效）；adminBindings（JOIN users 带邮箱 + machine_code 截断展示）；
    markOrderPaid 记录 amount_cents（env PAYMENT_AMOUNT_CENTS，缺省 3900）。
  - site.js：/me 待付款状态 → 付款卡片（金额 + 支付宝/微信二维码；未配置显示虚线占位）+「已付款无需操作」提示；
    新增 /admin 控制台（token 登录页 + 三表：用户与发码[确认收款/试用码]、终端绑定[吊销]、邮件队列）。
  - index.js + mock-server.mjs：GET /admin、POST /admin/login|logout（mai_admin HttpOnly cookie）；
    admin JSON API 双鉴权（Bearer ADMIN_TOKEN **或** mai_admin cookie，mailer/脚本兼容不变）；
    新增 GET /admin/emails（queued+recent）、POST /admin/revoke。schema.sql + admin_sessions 表（sqlite3 :memory: 验证）。
  - E2E ✅：登录页/错 token 401/dashboard 三表渲染/cookie（无 Bearer）确认收款→发码+mailer 邮件送达→
    activate 后绑定列表带邮箱显示→吊销 ok→heartbeat 返回 revoked:true；/me 待付款用户见付款卡片（¥39+占位码）；
    Bearer 路径（mailer /admin/email-queue）不受影响。修复：/admin/bindings 误用 listBindings（无 email JOIN）、
    mock createBinding 缺 created_at/updated_at、mock portalBase TDZ。
  - **用户待给**：真实收款二维码 URL + 金额（wrangler vars / env，见 control/wrangler.jsonc 注释）；
    生产 ADMIN_TOKEN（mock 用 dev-admin-token）。本地管理台：http://127.0.0.1:6420/admin
- **2026-08-28** P7 ✅ Stripe 全球在线收款 + /admin 实时总览（用户两项新需求）：
  - **①全球在线收款 = Stripe Checkout**（`src/stripe.js`）：/me 待付款用户见「在线支付」按钮
    （Pay $39.00 · 全球信用卡/Apple Pay，金额=PAYMENT_CURRENCY+PAYMENT_AMOUNT_CENTS）→
    POST /site/pay/checkout 建一次性 Checkout session（动态 price_data，无需预建 Product）→
    Stripe 托管收银台 → webhook POST /api/webhooks/stripe（HMAC-SHA256 验签 ±5min 防重放、
    raw body）→ `checkout.session.completed` → markOrderPaid(method=stripe, ref=session id)
    **自动发码+邮件，无需人工确认**。幂等双保险：stripe_events.stripe_event_id UNIQUE +
    orders.ref；非 2xx Stripe 自动重试。防重复付款：已有未用码 →409 / 已激活 →302。
    二维码/银行转账保留为备用渠道（半自动不变）；未配 Stripe 时可挂 PAYMENT_ONLINE_URL
    外链兜底（如 PayPal.me）。schema + stripe_events 审计表（sqlite3 :memory: 验证）。
    **mock E2E**：STRIPE_MOCK=1 → /mock-stripe/checkout 假收银台 + signStripePayload
    伪造带签名 webhook，走与生产**同一** handleStripeWebhook 代码路径。
  - **②/admin 实时总览**：GET /admin/stats（Bearer/cookie 双鉴权）→ 前端 10s 轮询 +
    「暂停/恢复刷新」+ 更新时刻。指标：在线隧道（心跳<45min，env ONLINE_WINDOW_MS 可覆盖；
    客户端心跳 30min）、活跃/宽限绑定、用户总数（待付款 x）、**付款用户数**、今日收入
    （UTC 日界）/累计收入（amount_cents）、未使用码、邮件排队 + 最近 Stripe webhook 事件列表。
    D1/内存双实现同口径（core.adminStats 纯函数 + db.stats）。
  - **E2E ✅ 31/31**（`control/e2e-p7.mjs`，独立 mock :6431）：apply→magic link（邮件队列解析）
    →登录→/me 付款卡（在线支付+QR 备用）→checkout→假收银台→带签名 webhook→自动发码
    →/me?paid=1 成功横幅+码→stats（付款用户=1/revenue=$39/stripe_events）→重复 webhook
    duplicate 且金额不变→坏签名/无签名头拒绝（400）→已付费再 checkout 302、有未用码 409
    →activate+heartbeat→online_tunnels=1、bindings 带邮箱 JOIN、坏码 4xx→dashboard
    「实时总览」渲染+stats 未鉴权 401。修复：fmtMoney usd→"$"（与收银台一致）、
    e2e spawn cwd 用 fileURLToPath（空格路径 %20）。
  - **预览已重启**：mock :6420（STRIPE_MOCK=1）+ mailer MOCK；demo@example.com 重播种
    →新码 MAI-WTY9FB（收款确认 $39 alipay）；preview-p7@example.com 验证 /me 新付款卡。
    pid：/tmp/mai-mock.pid、/tmp/mai-mailer.pid；日志 /tmp/mai-mock.log、/tmp/mai-mailer.log。
  - **用户手动项（Stripe 注册，步骤详见 control/README.md「P7」）**：
    1) dashboard.stripe.com 注册（个人/个体户；地区不支持则 Lemon Squeezy/Paddle）
    2) Test mode → Developers → API keys → sk_test_... `wrangler secret put STRIPE_SECRET_KEY`
    3) 部署后建 webhook：https://newapi.email/api/webhooks/stripe，只勾 checkout.session.completed
       → whsec_... `wrangler secret put STRIPE_WEBHOOK_SECRET`
    4) Test mode 卡号 4242... 全流程自测 → Live mode 换 sk_live_ + live webhook。
- **2026-09-03** P8 本地生产部署（免费先）+ 邮件完善 + GitHub 转公开：
  - **域名现状**（dig 核实）：newapi.email 已在 Cloudflare（NS=cloudflare），但**根域 A 记录跑着既有
    New API 网关（x-new-api-version v1.0.0-rc.8）——绝不动**。移动AI 门户改挂 **mai.newapi.email**
    （CNAME → 控制面命名隧道）；用户数据面隧道仍 `<随机子域>.newapi.email`（精确记录优先于根域，无冲突）。
  - **部署形态**：新增 `control/server.mjs` — Node24 + 内置 SQLite（node:sqlite，D1 兼容垫片
    prepare/bind/first/all/run），**直接跑 src/index.js 同一份 Worker 代码**（HTTP↔Request/Response
    桥接），零路由重复；数据持久化 `~/.mobileai/control.db`（schema.sql 幂等初始化）；
    env：process.env > `~/.mobileai/control.env`（MAI_HOME 可覆盖数据目录，测试/沙箱用）。
    cloudflared（本机已装 2026.5.0）命名隧道 mai-control：mai.newapi.email → 127.0.0.1:6420。
    `control/deploy-local.sh` 一键部署（前置：用户跑一次 `cloudflared tunnel login`）：
    CF token 读取/账号 id/control.env(ADMIN_TOKEN 生成,600)/隧道幂等创建/CNAME upsert/
    nohup 启动/LaunchAgent×3（control/mailer/cloudflared，bootstrap 成功即接管 nohup）/公网 healthz 验证。
    mailer LaunchAgent 走 `~/.mobileai/run-mailer.sh`（source control.env 拿 MAIL_ACCOUNTS/ADMIN_TOKEN）。
  - **生产 bug 修复（smoke test 抓到）**：src/index.js **7 路由漏 await**
    （/api/activate|heartbeat|rotate、/site/apply、/admin/order-paid|issue-code|revoke）——
    副作用执行但响应变 `200 {}`（mock-server.mjs 全有 await，故历次 E2E 未暴露；真实 Worker 上
    激活/付款确认/申请会全部静默失效）。已补 await。
  - **邮件功能完善**：① /admin 邮件表「查看」按钮 → 正文弹窗（magic link/认证码；排查 +
    MOCK 模式下直接取链接，site.js）② mailer.mjs **failed 邮件自动重试**（MAIL_RETRY_MS
    缺省 5min，MOCK 跳过；修好 SMTP/授权码后无需手动重发）。真实发送仍需 MAIL_ACCOUNTS
    （gmail/qq/163/outlook SMTP 推断已支持；QQ/163=授权码，Gmail=应用专用密码）。
  - **客户端域名切换**：mobileai.mjs apiBase 缺省、i.sh/i.ps1 BASE 缺省、guide.md →
    https://mai.newapi.email（control/static/ 已同步；本地测试 MOBILEAI_BASE=http://127.0.0.1:6420，
    mock 根路径分发无 /client）。
  - **回归**：新增 `control/smoke-server.mjs`（server.mjs 全旅程，:6421 临时 SQLite）
    **16/16 PASS**（healthz/apply→邮件正文解析 magic link/登录 302//me 待付款卡+QR 备用（无 Stripe
    按钮）/坏链接页/试用码→/me 显示码（试用不激活，仍待付款确认）/order-paid→发码+无 error/
    activate 无 CF token→4xx「隧道创建失败」优雅报错/stats 口径/未鉴权 401/dashboard+邮件查看按钮）；
    e2e-p7.mjs 复跑 **31/31**（site.js 共享改动不破坏 mock 路径）。
  - **GitHub 转公开**：ricky8848/mobile-ai private → public（对外可见；移动端功能 = 手机开
    https://mai.newapi.email，门户本身移动优先）。
  - **用户手动项（部署收尾）**：① 终端跑 `cloudflared tunnel login`（浏览器 OAuth，token 存
    ~/.cloudflared/*.json；权限较宽，日后可在 CF dashboard → My Profile → API Tokens 撤销）
    ② `bash "new dsh/control/deploy-local.sh"`（或让我代跑）→ 验证 https://mai.newapi.email
    ③ control.env 加 `MAIL_ACCOUNTS="邮箱:授权码"` + 重跑 deploy-local.sh → mailer 真发信
    （验证：/admin「邮件队列」状态=已发送 + 真实收件箱收到 magic link）。
  - **已知缺口**：用户隧道无 CF Access 邮箱验证（guide.md 第4步为未来项；现安全 = URL 保密 +
    机器码单终端绑定 + 轮换/吊销）；Stripe 未注册（在线支付按钮隐藏，QR 备用渠道占位待真实收款码）；
    控制面与数据面同机 = 家中 Mac（免费先，机器需常驻）。
    （二维码真实 URL/金额、CF 凭据等旧手动项不变。）
- **2026-09-04** 域名定案 dsh.newapi.email + 发件箱 ricky8848@outlook.com（部署待用户两键）：
  - **域名切换**（用户定案「最终上线使用 dsh.newapi.email」，测试=生产同域避免二次切换）：
    全量 mai.newapi.email → dsh.newapi.email（server.mjs PORTAL_BASE 缺省、deploy-local.sh
    PORTAL_HOST、client/i.sh+guide.md+mobileai.mjs apiBase 缺省，control/static/ 同步；
    PROGRESS.md 历史记录保留原样）。smoke/e2e 不受影响（走 127.0.0.1，域名仅缺省值）。
  - **⚠ dsh.newapi.email 接管**：该 CNAME 现指向既有 new-api-tunnel（93101028-…，
    ingress dsh.newapi.email → localhost:3080 = DSH Web GUI 手机入口）。deploy-local.sh
    第4步会删除该 CNAME 改指 mai-control → **切换后 DSH GUI 公网地址失效**；手机访问
    DSH 改用 Tailscale / Termius SSH 端口转发（dsh-mobile-access）。根域 New API 网关
    （192.168.0.131:3000）与 new-api-tunnel 本体仍不动。
  - **发件箱**：ricky8848@outlook.com（用户改定，替代 xunricky@gmail.com；mailer smtpFor
    已支持 outlook → office365:587）。「申请→立即发送」无需改码：/site/apply 入队 queued，
    mailer.mjs 5s 轮询 /admin/email-queue 发出（≤5s）。
  - **支付**：用户明确「目前只是测试版，还需完善支付功能」——P7 Stripe 代码已就绪
    （Checkout+webhook），待注册/配 key（见 P7 手动项）；本轮不展开。
  - **待用户两键**：① `cloudflared tunnel login`（cert.pem 已移走 → ~/cert.pem.mobileai-backup，
    旧式凭据 JSON 保留供 new-api-tunnel 重启；新 OAuth token 存 ~/.cloudflared/*.json）
    ② ricky8848@outlook.com 密码（两步验证则应用专用密码）。
  - **部署序列**（两键齐后我代跑）：pkill mock(:6420)+mailer MOCK → deploy-local.sh
    （建 mai-control 隧道 + CNAME 接管 + nohup server.mjs → LaunchAgent×3）→
    control.env 追加 MAIL_ACCOUNTS="ricky8848@outlook.com:密码" → 重跑脚本装 mailer agent
    → https://dsh.newapi.email/healthz 验证 + /admin 发测试邮件验真实收件。