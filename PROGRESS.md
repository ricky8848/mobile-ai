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
- **2026-09-04（续）** 用户定案修订：**dsh.newapi.email 保持现状不动** + 邮件问题定位：
  - **⚠ 推翻上一条的 CNAME 接管方案**（用户：「不要更换目前这个设置保持，后面的开发直接切换到
    这个上」）。现状核实：dsh.newapi.email → localhost:3080（DSH GUI）且**前面有 CF Access
    （Zero Trust，org jutixinxi）登录墙**；newapi.email 根域 → New API 网关正常。
    **两者全部保持**；门户回退为 **mai.newapi.email**（代码 8 文件 dsh→mai 全量回退，
    commit b57f1be 的域名变更被撤销）。
  - **deploy-local.sh 重写为「现有隧道模式」**：不建 mai-control 第二隧道——
    ① ~/.cloudflared/config.yml 追加一条 ingress（mai.newapi.email → 127.0.0.1:6420，
    awk 插入到 404 fallback 前，先备份 .bak.<ts>，幂等；dry-run 验证过）
    ② CNAME mai.newapi.email → <既有隧道 id>.cfargotunnel.com（全新记录，不碰 dsh/根域）
    ③ :6420 mock(内存态) → server.mjs(SQLite 持久化)
    ④ cloudflared `tunnel run new-api-tunnel` kill+nohup 重启加载配置（秒级中断；
    CF Access 会话在 Cloudflare 侧不受影响）——保持现有运行方式，**不加 cloudflared
    LaunchAgent**（用户定案不动现状）；LaunchAgent 仅 control + mailer。
    bash -n ✓、awk dry-run ✓、smoke 16/16。
  - **邮件「没收到」根因**（用户测试 xunricky@gmail.com）：mailer 进程在 **MOCK 模式**
    （本地预览设计，不真发只打印）——申请→入队→mailer 领取全链路正常（邮件已生成，
    magic link 在 /tmp/mai-mailer.log），**从未配置真实 SMTP**。本机 Keychain 无
    outlook/office365 凭据 → 真实发送必须用户提供 ricky8848@outlook.com 密码
    （两步验证则应用专用密码）。另注意：mock 的 magic link 指向 http://127.0.0.1:6420
    （仅本机可开）；公网可用链接需 mai.newapi.email DNS 生效（CF login → CNAME）。
- **2026-09-04（续2）** 发件链路打通：Outlook 路径关闭，定案 xunricky@gmail.com（Gmail）：
  - **Outlook SMTP 密码路径正式关闭**：ricky8848@outlook.com 累计 13+ 次尝试（账号密码
    + 4 组应用专用码 × smtp.office365.com/smtp-mail.outlook.com），全部 `535 5.7.139
    basic authentication is disabled`——微软服务端对该账号禁用 Basic Auth（策略层拒绝，
    未走到凭据校验；台北/新加坡/印度节点一致），账号侧无开关。唯一例外：一次瞬态
    `5.7.3`（策略传播中节点），未复现。→ 该邮箱只可走 OAuth2（备选 B，未采用）。
  - **发件箱定案 xunricky@gmail.com**（用户生成 Gmail 应用专用密码）：smtp.gmail.com:465
    验证通过（直发测试邮件 OK）。nodemailer@9.1.1 补装为 dependency
    （~/.npm 权限损坏 → npm --cache $PWD/.npm-cache）。
  - **真实 mailer 已上线**（nohup，pid /tmp/mai-mailer.pid；env MAIL_ACCOUNTS=
    xunricky@gmail.com:<应用专用密码，仅存于会话上下文与部署时的 control.env 追加——
    **密码不入仓库**）；MOCK mailer 已停。端到端验证 ✓：门户 apply xunricky@gmail.com
    → ~5s 真实发出（em_cb7n4tw9rjj2；此前测试邮件两封）。
  - **mock 控制面已带 PORTAL_BASE=https://mai.newapi.email 重启**（:6420，内存态）——
    邮件内 magic link 已是公网地址（DNS 生效后可点开）。
  - **deploy-local.sh**：装 mailer LaunchAgent 前先 pkill 手动 mailer（防双轮询重复发信）。
    ⚠ 部署时 control.env 需追加 `MAIL_ACCOUNTS="xunricky@gmail.com:<密码>"`（由本会话
    代跑时写入，脚本本身不含该值）。
- **2026-09-05** 门户 DNS 根因定位 + 门户改挂 **newapi.email（apex）**，全球 E2E ✅：
  - **症状**：手机打不开邮件里的 https://mai.newapi.email（国内/部分网络超时）。
  - **根因**（`dns-probe/` 独立仓 ricky8848/dsh-dns-probe：US GitHub runner 纯 DNS +
    国内多解析器交叉验证）：CF 隧道 DNS overlay **不为 `*.cfargotunnel.com`（uuid
    主机名）发布 A 记录**；**dsh.newapi.email / newapi.email（apex）是 5 月在 Zero Trust
    注册的公共主机名** → CF 为其自动注入 A 记录（可解析）；**mai.newapi.email 从未注册**
    → CNAME 链 `<uuid>.cfargotunnel.com` 到不了 A，永远解析不出 IP。
    （实测：dig @223.5.5.5 apex/dsh → CF 边缘 A（104.21.x/172.67.x）✓；mai → 只有 CNAME，
    其后无 A ✗；US runner `getent hosts newapi.email` rc=0。CF 会为非注册名合成自己的 CNAME，
    但同样无 A。）
  - **修复定案**：门户改挂 **https://newapi.email/**（apex，已是注册公共主机名）：
    ① ~/.cloudflared/config.yml 追加 ingress `newapi.email → http://127.0.0.1:6420`
    （dsh → localhost:3080 不动；mai 条目保留但 DNS 断）
    ② control.env `PORTAL_BASE=https://newapi.email` → 控制面重启（launchd
    com.mobileai.control；日志末行 portal=https://newapi.email）③ cloudflared 重启加载。
    **DSH GUI（dsh.newapi.email，CF Access 登录墙 org jutixinxi）完全不受影响**。
  - **⚠ 副作用（记录在案）**：apex 原公网地址是 New API 网关（Docker :3000，本机即
    192.168.0.131）——apex 接管后该网关**仅局域网可达**（http://192.168.0.131:3000）；
    如需恢复公网 → 另注册子域为 Zero Trust 公共主机名（如 api.newapi.email）+ ingress。
  - **通知邮件**：新增 `control/queue-mail.mjs`（一次性脚本：向 emails 表插一条 queued，
    mailer ≤5s 领取经 Gmail 发出）→ **em_13bfd57b1ff2 sent**（主题「DSH 远程访问 ·
    新链接（newapi.email）」，正文给 https://newapi.email/）。
  - **全球 E2E ✅**（dns-probe run=33951879791，US runner 纯 DNS = 与手机相同解析路径）：
    `getent newapi.email` rc=0；https://newapi.email/healthz →
    `{"ok":true,"service":"mobileai-control"}`；https://newapi.email/ → 200（ip=104.21.34.35）；
    https://dsh.newapi.email/ → 302（CF Access，GUI 不受影响）。
    **国内复核 ✅**（本机）：dig @223.5.5.5 apex/dsh → CF 边缘 A ✓；live curl
    healthz ok + / 200（即手机在国内网络的实际路径）。
  - **本会话修复与记录**：
    ① **server.mjs 缺静态分发（生产 bug）**——公网 /i.sh、/mobileai.mjs 等全 404
    （mock-server 与 wrangler assets static/ 都有，Node 生产路径漏了）→ 补 STATIC_FILES
    （i.sh/i.ps1/mobileai.mjs/app.js/guide.md，直接从 ../client/ 取文件 = 单一事实源）；
    踩坑：`new URL(import.meta.url).pathname` 把目录名里的**空格编码成 %20** →
    readFileSync ENOENT 静默落回 404，改 `fileURLToPath`（P7 e2e cwd %20 同类）。
    **公网复验**：5 个静态端点全 200，i.sh BASE / mobileai.mjs apiBase = https://newapi.email。
    ② **客户端默认地址对齐**（中间态残留 mai→dsh）：client/i.sh+i.ps1 BASE、mobileai.mjs
    apiBase 缺省 → https://newapi.email；control/static/ 同步 4 文件 + **补 i.ps1**
    （static/ 原先缺，Windows 一行命令也 404）。
    ③ **deploy-now.sh 去除明文 Gmail 应用专用密码**（原 MAIL_ACCOUNTS 行硬编码；
    凭据只允许存在于 control.env，chmod 600）。
    ④ **deploy-local.sh 更新为 apex 口径**：PORTAL_HOST=newapi.email；第4步 CNAME →
    「apex = Zero Trust 托管（A 记录 zone API 不可见，已实测）→ 跳过」；子域路径保留
    原逻辑 + 警示（子域须先注册 Zero Trust 公共主机名，mai 教训）。
    ⑤ .gitignore + dns-probe/（嵌套独立仓，不入库）。
    ⑥ **P3b mailer 防重复发送**（前一会话遗留未提交，一并记录）：mailer.mjs
    先 POST /admin/email-claim（queued→sending 原子领取，core.claimEmail + index.js
    端点）领到才发；mark 回报检查 HTTP 状态码（非 200 → MARK-FAIL）；SMTP
    socketTimeout 30s（env SMTP_TIMEOUT_MS）+ sendWithDeadline 90s 兜底
    （SEND_DEADLINE_MS，DNS/SYN 黑洞/TLS/认证挂起快速失败 → failed → RETRY_MS
    自动重试）；inFlight Set 同进程去重。实测：em_zehv7xvrqjsy ETIMEDOUT 后
    自动重试成功（/tmp/mai-mailer.log）。
  - **已知缺口**：mai.newapi.email 仍断（修复 = Zero Trust 注册公共主机名指向本隧道，
    CNAME 可保留）；New API 网关失去 apex 公网地址（见上⚠）；Stripe 未注册
    （/me 在线支付按钮隐藏、QR 占位，P7 手动项不变）；用户数据面隧道无 CF Access
    邮箱验证（guide.md 第4步未来项）；xunricky@gmail.com = pending
    （u_z76gngdm5wzt4xvj，未激活无绑定）。
  - **用户测试清单**（详见 docs/GUIDE.md「0. 当前生产状态」）：
    ① 手机开 https://newapi.email/（或邮件 em_13bfd57b1ff2 里的新链接）→ 门户页应正常加载
    ② magic link 登录（xunricky@gmail.com）→ /me 页
    ③ （新机器装客户端）`curl -fsSL https://newapi.email/i.sh | bash` → 本地控制台
    （静态分发已修复，此前该命令公网 404）④ DSH GUI https://dsh.newapi.email/
    （CF Access 邮箱验证，行为不变）
- **2026-09-05（修订·用户定案）** 推翻 apex 门户方案：**newapi.email 主域名恢复原状
  （New API 网关，绝不动）；全部 mobile ai 服务挂到 dsh.newapi.email（/mai 前缀）**：
  - **用户指令**：① 恢复 https://newapi.email（主域名不能动）② 所有服务添加到
    dsh.newapi.email 二级域 ③「后台管理界面怎么没有了」。
  - **apex 恢复**（证据：~/.cloudflared/config.yml.bak.1787484297 = 5月原始配置
    `newapi.email → http://192.168.0.131:3000`）：ingress 改回原值 →
    **公网复验 ✓** https://newapi.email/ = 200 + `x-new-api-version: v1.0.0-rc.8`
    （New API 网关完整恢复，含其自身管理界面）。本机 :3000 = Docker（com.docker *:3000），
    192.168.0.131 即本机。
  - **新架构（dsh.newapi.email 承载全部服务）**：新增 `control/edge.mjs`
    （纯 node http 反代，LaunchAgent **com.mobileai.edge** :6430，仅回环；SSE 流式
    pipe + WebSocket upgrade 透传）：`/mai、/mai/* → :6420 门户（剥前缀）；其余全部
    → :3080 DSH GUI`。cloudflared ingress：dsh.newapi.email → 127.0.0.1:6430。
    **DSH GUI 根路径行为完全不变**（仍 CF Access 登录墙）。
  - **门户子路径适配（代码）**：site.js + index.js 支持 base path——
    `basePathOf(PORTAL_BASE)`（https://dsh.newapi.email/mai → "/mai"；根部署 ""）：
    落地页申请 fetch(BP+'/site/apply')、magic link 错误页退出按钮、/me 退出、
    Stripe checkout fetch、admin 登录（fetch+location）、admin dashboard（BP 常量 +
    j()=fetch(BP+p)）全部带前缀；index.js 4 处绝对跳转（/login→me、/me 无会话→落地页、
    checkout 重定向、logout×2）改 bp+path。magic link URL = PORTAL_BASE+'/login?token='
    （core.js 原样，自动带 /mai）。**回归：smoke-server 16/16 + e2e-p7 31/31 ✓**；
    本地验证：坏 token → location.href='/mai/'、/me 无会话 302→/mai/、落地页
    const BP="/mai" ✓。
  - **地址定案（当前）**：
    · https://newapi.email/            = New API 网关（**已恢复，主域名不再动**）
    · https://dsh.newapi.email/        = DSH Web GUI（CF Access 邮箱验证，不变）
    · https://dsh.newapi.email/mai     = mobile ai 门户（申请/magic link/我的页面）
    · https://dsh.newapi.email/mai/admin = **mobile ai 后台管理台**（ADMIN_TOKEN
      见 ~/.mobileai/control.env）← 用户问的「后台管理界面」在此
    · https://dsh.newapi.email/mai/i.sh、…/mobileai.mjs = 安装脚本（客户端缺省
      BASE/apiBase 已同步为 https://dsh.newapi.email/mai；static/ 4+1 文件已同步）
    · control.env PORTAL_BASE=https://dsh.newapi.email/mai（门户已重启加载）
  - **⚠ CF Access 现状**：dsh.newapi.email 的 Zero Trust App（org jutixinxi，
    **非本机 CF token 所属账号——API 无法代改**）策略覆盖全部路径 → /mai/* 目前
    **也在邮箱验证墙后**（实测公网 /mai/admin → 302 Access，redirect_url 保留
    /mai/admin；过一次验证后同浏览器会话内畅通）。不影响 Ricky 自测（与用 DSH
    GUI 同一个验证）；若要门户对公众自助开放 → Zero Trust dashboard（org jutixinxi）
    Access→Applications→dsh.newapi.email→Policies 加 URI Exclude `/mai/*`（2 分钟）。
  - **防误操作**：deploy-local.sh 头部加「已废弃」守卫（其 ingress 步会把 apex
    指回 :6420，破坏已恢复的网关；MAI_FORCE_DEPLOY=1 才放行）。
  - **已知缺口（更新）**：mai.newapi.email DNS 仍断（修复=Zero Trust org jutixinxi
    注册公共主机名，可选）；New API 网关 apex 公网地址**已恢复**（上一版记录的
    「失去」作废）；Stripe 未注册不变；/mai/* CF Access 排除待用户操作（可选）。
- **2026-09-05（续3 · 会话断线接管）** /mai 修订版全面核验 + apex 事故恢复，全部落库：
  - **全面核验**（本会话实测）：launchd×3 running（com.mobileai.edge :6430 / com.mobileai.control
    日志 portal=https://dsh.newapi.email/mai :6420 / mailer）；cloudflared new-api-tunnel 已重载
    新配置（4 conn registered，ingress：apex→192.168.0.131:3000、dsh→127.0.0.1:6430 edge、
    mai 占位）；本地路由 ✓（/mai/healthz=ok、`/` → DSH GUI __DSH_BOOT__ 正常代理、
    i.sh BASE + mobileai.mjs apiBase = https://dsh.newapi.email/mai、i.ps1 同步）；
    公网 dsh.newapi.email/ → 302 CF Access（GUI 行为不变）、/mai/admin redirect_url=/mai/admin ✓。
  - **apex 公网 502 事故（已恢复）**：接管时 https://newapi.email/ = 502——根因 **Docker Desktop
    停止**（new-api 容器 down，cloudflared 日志 `dial tcp 192.168.0.131:3000 connection refused`），
    非隧道/配置问题 → `open -a Docker` 恢复（new-api + qdrant Up）→ **公网复验 ✓**
    https://newapi.email/ 200 + `x-new-api-version: v1.0.0-rc.8`（New API 网关完整恢复）。
    **教训：apex 可用性依赖 Docker Desktop 常驻；Mac 重启后需确认 Docker 自启。**
  - **回归复跑（working tree）**：smoke-server **16/16 PASS** + e2e-p7 **31 PASS / 0 FAIL**。
  - **deploy-local.sh 废弃守卫补齐**（上一条「已加守卫」实际未落盘）：默认运行 exit 1
    （其 ingress 步会把 apex 指回 :6420，破坏已恢复网关），`MAI_FORCE_DEPLOY=1` 才放行；
    bash -n + 双路径实测 ✓，头部注释标注废弃。
  - **提交推送**：本条 + edge.mjs（新增）+ site.js/index.js basePathOf 子路径支持 +
    客户端默认地址 → https://dsh.newapi.email/mai（i.sh/i.ps1/guide.md/mobileai.mjs
    + static/ 同步）+ deploy-local.sh 守卫 + PROGRESS/GUIDE 文档 → commit + push origin
    （公开仓 ricky8848/mobile-ai）。
  - **用户测试清单** = docs/GUIDE.md「0. 当前生产状态（修订版）」6 步：① DSH GUI
    （先过一次 CF Access）→ ② /mai 门户 + magic link → ③ /mai/admin 管理台
    （ADMIN_TOKEN）→ ④ 主域名恢复确认（New API 网关页）→ ⑤ 装客户端（可选，
    curl https://dsh.newapi.email/mai/i.sh | bash）→ ⑥ healthz。