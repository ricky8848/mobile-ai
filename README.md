# DSH-MobileAI（移动AI）

> **人在路上任意飘，家里电脑爆缸开工。**

零安装的隧道即服务：一条终端命令 + 一个浏览器页面，把**家中电脑的任意本地工具/服务**同步到你的手机和任何设备。
无需端口转发、无需公网 IP，手机上不装任何 App——浏览器打开一个 URL 即可。

内置默认用例是 **DeepSeek Harness（DSH）Web GUI**：一个专属 URL，手机上直接操作家里电脑的
全部工具（DeepSeek Harness / Codex / OpenClaw 等）。但 DSH-MobileAI 不关心你跑的是什么——
localhost 上的任何服务都可以。

---

## 📍 当前生产地址（2026-09）

| 地址 | 是什么 |
|---|---|
| **https://dsh.newapi.email/mai** | 客户门户：申请 / magic link 登录 / 我的页面（含「我的工具」管理） |
| **https://dsh.newapi.email/mai/admin** | 运营后台：用户发码 / 绑定吊销 / 邮件队列 / 实时总览 |
| **https://dsh.newapi.email/** | DSH Web GUI（运营方机器示例，CF Access 邮箱验证墙） |
| https://dsh.newapi.email/mai/i.sh · /i.ps1 · /mobileai.mjs | 客户端安装脚本与源码（手机/任意设备可下载） |
| **https://\<你的随机子域\>.newapi.email** | 你激活后获得的专属 URL（= 你家机器的钥匙） |

> **CF Access 说明**：dsh.newapi.email 整个域名在 Cloudflare Zero Trust 邮箱验证墙后。
> 首次访问任意页面会先过一次邮箱验证（同一浏览器会话内只需一次），之后门户/后台畅通。
> 你激活后的**专属子域 URL 不受此墙限制**，手机随时可开。

---

## 📱 客户使用方式（完整流程）

### 前提

- 一台**保持开机**的家中电脑：macOS / Linux / Windows（需 Node.js ≥ 18；i.sh 会自动补齐组件）
- 一部能收邮件的手机（邮箱用于 magic link 登录，Gmail/QQ/163/Outlook 均可）

### 第 1 步 · 申请账号（手机，约 30 秒）

1. 打开 **https://dsh.newapi.email/mai**
2. 输入你的邮箱 → 「申请」
3. **≤5 秒**收到确认邮件，点里面的链接（7 天有效、一次性）→ 自动登录「我的页面」

### 第 2 步 · 获取认证码（/me 页）

- **测试阶段（当前）**：联系运营签发试用码 → /me 页与邮箱都会显示 `MAI-XXXXXX`
- **正式阶段**：/me 页付款（支付宝 / 微信二维码，或 Stripe 全球卡/Apple Pay）→
  webhook 自动发码（Stripe 路径零人工），或运营后台确认后发码

### 第 3 步 · 安装客户端（家中电脑，一条命令）

```sh
# macOS / Linux
curl -fsSL https://dsh.newapi.email/mai/i.sh | bash

# Windows PowerShell
irm https://dsh.newapi.email/mai/i.ps1 | iex
```

脚本自动下载 cloudflared（SHA-256 校验）并**弹出本地控制台浏览器页面**。全程只需两项：

| 字段 | 说明 |
|---|---|
| 本机服务地址 | 默认 `127.0.0.1:3080`（DSH）；可改成任意 `host:port` |
| 认证码 | /me 页或邮箱里的 `MAI-XXXXXX`（一次性，核销即绑定本机） |

点「启动隧道」→ 页面显示你的**专属 URL**。开机自启（launchd / systemd user / Windows
计划任务）与断线重连已自动配置，之后无需任何操作。

### 第 4 步 · 手机使用（打开专属 URL）

浏览器打开 `https://<你的随机子域>.newapi.email`：

- **默认（DSH）**= 家中电脑的完整 DSH Web GUI —— DeepSeek Harness / Codex / OpenClaw
  等**全部工具都在里面**，会话、文件、审批与在电脑前操作完全一致；
- **自定义服务**：第 3 步把「本机服务地址」改成任意 `host:port`，专属 URL 就是你的那个服务。

### 「我的工具」管理（/me 页）

登录后 /me 的「**我的工具**」卡片列出你账号的全部绑定服务，每项可管理：

- **专属 URL**（直接点开即用）
- **服务地址 / 状态（在线·宽限）/ 最后心跳**
- **「URL 轮换」按钮**：一键换新链接——旧 URL **立即失效**，新 URL 数秒内生效
  （机器码不变、客户端无需重跑）。怀疑链接泄露时第一时间点它。

### 多个工具都支持吗？（常见疑问）

| 场景 | 是否支持 | 说明 |
|---|---|---|
| **DSH 里的所有工具**（Harness / Codex / OpenClaw …） | ✅ 一条隧道全包含 | DSH GUI 是统一入口，激活一次全部可用（推荐方式） |
| **同一台机器的多个独立服务**（如 DSH :3080 + 另一个 :5173） | ✅ 每个服务一次激活 | 每换一个「本机服务地址」= 新的一次激活（各需一个认证码，运营后台签发） |
| **多台机器** | ✅ 每台一条隧道 | 同样每机一次激活；单终端绑定指「同一服务地址」只授权一台机器，错机心跳自动吊销 |

> 安全模型：随机子域 = 凭证（不可猜测）+ 机器码单终端绑定 + 心跳校验
> （离线宽限 6h / 停用 7d，错机即杀）+ URL 一键轮换 +（可选）Cloudflare Access。

---

## ⚠️ 安全须知（使用前必读）

1. **你的专属 URL = 访问凭证。** 它等价于那台机器的钥匙：泄露给谁，谁就能操作你的本地服务。
2. **暴露什么服务由你负责。** DSH-MobileAI 提供通道与身份管理，不审查、不经手、不留存你的流量内容。
3. **建议只暴露你信任的服务**（如 DSH 这类带审批/沙箱机制的工具），并善用「我的工具」里的 URL 轮换。
4. 本服务要求目标机器保持开机且网络可达；睡眠/关机期间隧道离线，唤醒后自动重连。

## 工作原理

```
手机浏览器 ──HTTPS──▶ https://<你的随机子域>.newapi.email   (Cloudflare 边缘)
                               │
                     ┌─────────▼────────┐
                     │ 你的电脑（常驻）    │ ← cloudflared 出站连接，无需公网 IP/端口转发
                     ├──────────────────┤
                     │ 任意本地服务        │   默认: DSH @ 127.0.0.1:3080
                     └──────────────────┘
```

- 数据只经过 Cloudflare 边缘加密中转，控制面**不接触你的业务流量**。
- 控制面：Cloudflare Workers + D1（零成本）；数据面：你机器上的 cloudflared 出站隧道。

## 特性

- **一条命令 + 一个浏览器页面**：无安装包（不产生 .pkg/.exe），无签名/白名单摩擦
- **任意服务、任意端口**：DSH 只是默认值，任何 localhost 服务皆可
- **机器码 + 单终端绑定**：心跳校验（离线宽限、错机即杀）
- **随机子域 = 凭证**：不可猜测 + 客户自助一键轮换，旧 URL 秒失效
- **常自动重连**：launchd / systemd user / Windows 计划任务，三平台一套逻辑
- **邮件自动化**：magic link 登录 / 认证码发放，队列 + 失败自动重试（≤5min）
- **统一黑白设计**：门户、本地控制台同一套极简视觉系统

## 运营 / 开发（维护者）

- **后台**：https://dsh.newapi.email/mai/admin —— 用户与发码（确认收款/试用码）、
  终端绑定（吊销）、邮件队列（分页 + 正文查看）、实时总览（在线隧道/收入，10s 轮询）
- **控制面**：`control/`（Workers 代码 + `server.mjs` Node24+SQLite 本地生产形态
  + `edge.mjs` /mai 路径分流反代）；部署见 `control/README.md`
- **客户端**：`client/i.sh · i.ps1 · src/mobileai.mjs`（本地控制台 + cloudflared 托管）
- **回归**：`node control/smoke-server.mjs`（16 项全旅程）· `node control/e2e-p7.mjs`
  （37 项：Stripe mock/webhook/门户工具轮换）；进度检查点见 `PROGRESS.md`
- **详细客服指引**：[docs/GUIDE.md](docs/GUIDE.md)（内置于本地控制台「指引」页）

## 路线图

| 版本 | 内容 |
|---|---|
| v0.1 pilot ✅ | 单用户隧道 + Cloudflare Access 鉴权，手动开通 |
| v0.2 ✅ | i.sh / i.ps1 一键客户端（浏览器控制台 + 机器码 + 心跳） |
| v0.3 ✅（当前） | 自助门户：magic link / 认证码 / URL 轮换 + 自动发信 + Stripe（代码就绪） |
| v1.0 | 付费全自动上线（Stripe live key + webhook）+ 换机重绑自助化 + 自动客服 |

## License

MIT © ricky8848 · [SECURITY.md](SECURITY.md) · 漏洞与反馈：ricky8848@outlook.com
