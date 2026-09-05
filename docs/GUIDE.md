# mobile ai 使用指引（详细版）

> 本文件是本地控制台「指引」页的内容源，也是客服第一版。
> 遇到问题先看 **第 6 节速查表**；仍无解 → ricky8848@outlook.com（务必附：订单号 + 机器码）。

---

## 0. 当前生产状态（2026-09-05 修订版，测试前必读）

### 公网地址总表（均已全球可解析，含国内网络）

| 地址 | 是什么 | 状态 |
|---|---|---|
| **https://newapi.email/** | New API 网关（x-new-api v1.0.0-rc.8，Docker :3000） | ✅ **主域名已恢复原状（5月配置），不再改动**；其管理界面在此域下 |
| **https://dsh.newapi.email/** | DSH Web GUI 直连（CF Access 邮箱验证登录墙） | ✅ 保持原样，行为不变 |
| **https://dsh.newapi.email/mai** | mobile ai 门户（申请 / magic link 登录 / 我的页面）+ 安装脚本 | ✅ 2026-09-05 新增（/mai 前缀，edge 反代分流） |
| **https://dsh.newapi.email/mai/admin** | **mobile ai 后台管理台**（用户发码 / 绑定吊销 / 邮件队列 / 实时总览） | ✅ 登录令牌 = `~/.mobileai/control.env` 的 ADMIN_TOKEN |
| https://dsh.newapi.email/mai/i.sh · /mobileai.mjs | 一键安装脚本与客户端源码 | ✅（此前公网 404，2026-09-05 修复） |
| https://mai.newapi.email/ | 更早的门户地址（已弃用） | ⚠️ DNS 不可用：CF 只为 Zero Trust 注册过的公共主机名注入 A 记录，mai 从未注册（CNAME→`*.cfargotunnel.com` 无 A）。修复=在 Zero Trust（org jutixinxi）把它注册为公共主机名，可选 |

**架构一句话**：`dsh.newapi.email → 本机 edge.mjs（:6430，launchd com.mobileai.edge）`
按路径分流——`/mai/* → 门户 :6420（剥前缀）`，其余全部 `→ DSH GUI :3080`；
cloudflared 隧道只认 hostname，所以本地必须有一个反代做路径分流。

**⚠ CF Access 说明（测试前必看）**：dsh.newapi.email 整个域名在 Zero Trust
邮箱验证墙后（org jutixinxi，5月为 DSH GUI 所设）——**/mai/* 也在墙内**。
首次访问 /mai 任意页面会先过一次邮箱验证（与打开 DSH GUI 是同一个验证，
同一浏览器会话内只需过一次），之后门户/管理台畅通。若日后要让门户对公众
自助开放：Zero Trust dashboard → Access → Applications → dsh.newapi.email →
Policies 加 URI **Exclude** `/mai/*`（2 分钟，API token 无该 org 权限需手动）。

### 手机端测试清单（按序）

1. **DSH GUI**：打开 `https://dsh.newapi.email/` → CF Access 邮箱验证（与以前完全一致）
   → 家里 Mac 的完整 DSH。（顺便完成一次验证，后面第 2/3 步同会话免再验）
2. **门户**：打开 `https://dsh.newapi.email/mai` → 黑白极简门户页。
   首页填 xunricky@gmail.com「申请」→ Gmail ≤5s 收到 magic link →
   点开自动登录 → `/me` 页（当前状态：待付款确认）。
3. **后台管理台**：打开 `https://dsh.newapi.email/mai/admin` →
   输入 ADMIN_TOKEN（~/.mobileai/control.env）→ 实时总览/用户发码/绑定/邮件队列。
4. **主域名恢复确认**：打开 `https://newapi.email/` → 应看到 New API 网关页面
   （不是 mobile ai）。
5. **安装客户端（可选，在新机器上）**：
   ```sh
   curl -fsSL https://dsh.newapi.email/mai/i.sh | bash    # macOS / Linux
   irm https://dsh.newapi.email/mai/i.ps1 | iex           # Windows PowerShell
   ```
   → 自动下载组件 + 弹本地控制台。「认证码」在 /me 页获取（先确认收款/试用码）。
6. **健康检查（任何设备终端）**：`curl -s https://dsh.newapi.email/mai/healthz`
   → `{"ok":true,"service":"mobileai-control"}`（未过 CF Access 时返回 302 属正常）。

### 本机（家里 Mac）运维速查

```sh
launchctl print gui/$(id -u)/com.mobileai.edge    | head   # 路径分流反代（:6430）
launchctl print gui/$(id -u)/com.mobileai.control | head   # 门户/控制面（server.mjs :6420）
launchctl print gui/$(id -u)/com.mobileai.mailer  | head   # 邮件轮询（Gmail，5s/次）
tail -20 /tmp/mai-edge.log                           # 反代日志（启动行含路由表）
tail -20 /tmp/mai-control.log                        # 门户日志（末行含 portal=…/mai）
tail -20 /tmp/mai-mailer.log                         # 发信日志（sent em_xxx）
curl -s http://127.0.0.1:6430/mai/healthz            # 本机健康检查（绕 CF Access）
```

- 数据：`~/.mobileai/control.db`（SQLite）· env/令牌：`~/.mobileai/control.env`
  （chmod 600，**含 Gmail 应用专用密码与 ADMIN_TOKEN——勿外传、勿提交仓库**）
- 隧道：cloudflared `new-api-tunnel`（nohup；ingress：**apex→192.168.0.131:3000
  New API 网关（5月原值）**、dsh.newapi.email→127.0.0.1:6430 edge、
  mai.newapi.email→:6420（DNS 断，占位）；配置备份 ~/.cloudflared/config.yml.bak.*）
- **全球验证工具**：`new dsh/dns-probe/`（独立仓 ricky8848/dsh-dns-probe）——
  push/手动触发即在美国 runner 上跑纯 DNS + curl E2E（与手机相同解析路径）
- **已知**：Stripe 未注册 → /me「在线支付」按钮隐藏（QR 占位）；/mai/* CF Access
  排除待手动（可选，见上⚠）；deploy-local.sh 已加废弃守卫勿直接跑

---

## 1. 这是什么 / 不是什么

```
手机浏览器 ──HTTPS──▶ https://<你的随机子域>.newapi.email  (Cloudflare 边缘 + 鉴权)
                              │
                    ┌─────────▼────────┐
                    │ 你的电脑（常驻）    │ ← cloudflared 出站连接，无需公网 IP
                    ├──────────────────┤
                    │ 任意本地服务        │   默认: DSH @ 127.0.0.1:3080
                    └──────────────────┘
```

- **是**：一条命令 + 一个浏览器页面，把家中电脑的任意本地服务同步到手机/任何设备。
- **不是**：远程桌面（转发的是具体 HTTP 服务，不是屏幕画面）；也不是 SaaS 托管——所有数据与算力都在你自己机器上。
- **DSH 默认用例**：暴露 `127.0.0.1:3080` 后，你在手机上操作的就是家里那台电脑的完整 DSH（会话、历史全部保留）。

**安全红线（三条）**
1. 你的专属 URL = 访问凭证，泄露给谁谁就能操作你的服务；疑似泄露立即一键轮换。
2. 暴露什么服务由你负责（建议 DSH 这类带审批/沙箱的工具）。
3. mobile ai 不经手、不留存你的流量内容（仅 Cloudflare 边缘 TLS 中转）。

## 2. 前置检查（每条附可直接复制的命令）

| # | 检查项 | macOS / Linux | Windows PowerShell | 预期结果 |
|---|--------|---------------|--------------------|----------|
| 1 | Node ≥ 18 | `node -v` | `node -v` | v18.x 及以上。缺失：macOS `brew install node`；Windows `winget install OpenJS.NodeJS.LTS` |
| 2 | 服务在监听 | `lsof -iTCP:3080` | `netstat -ano | findstr 3080` | 有 LISTEN 记录（DSH web） |
| 3 | 服务本机可开 | 浏览器打开 `http://127.0.0.1:3080` | 同左 | 能正常打开 DSH 界面 |
| 4 | 出站网络正常 | `curl -sS https://api.cloudflare.com | head -c 100` | `curl.exe -sS https://api.cloudflare.com | Select-Object -First 1` | 返回 JSON（403/报错都算通） |

## 3. 首次设置（逐步图文位）

**第 1 步 · 运行命令**
```sh
curl -fsSL https://newapi.email/i.sh | bash        # macOS / Linux
irm https://newapi.email/i.ps1 | iex               # Windows PowerShell
```
- 你应看到：终端输出"下载组件 → 启动本地控制台"。
- 没看到？→ 第 6 节「命令报错」。

**第 2 步 · 浏览器自动弹出**
- 你应看到：本地控制台页面（黑白界面，顶部 mobile ai）。
- 没弹出？→ 终端里会打印本地 URL（形如 `http://127.0.0.1:538xx`），手动复制到浏览器打开。

**第 3 步 · 填写两项 → 启动隧道**
- 「本机服务地址」：预填 `127.0.0.1:3080`，不用动（想暴露别的服务才改）。
- 「认证码」：购买后在邮件/门户获取，一次性核销并绑定本机。
- 你应看到：成功页——你的专属 URL + **机器码**（抄下来，客服凭证）。

**第 4 步 · 手机验证**
- 手机浏览器打开你的专属 URL。
- 首次会经 Cloudflare Access **邮箱验证**（收验证码/链接，注意垃圾箱）。
- 你应看到：家里的 DSH 界面。打不开？→ 第 6 节「手机打不开」。

## 4. 日常使用

- **开机自启**：已自动配置（macOS launchd / Linux systemd user / Windows 计划任务），重启后无需任何操作。
- **睡眠/断网**：隧道离线；唤醒或网络恢复后 10–30 秒自动重连，手机端刷新页面即可。
- **本地控制台**：随时重新运行一次命令（幂等）或打开终端打印的本地 URL——可看状态、复制/轮换 URL、重启隧道。
- **URL 泄露**：本地控制台「状态」页 → 「轮换 URL」→ 旧地址立即失效，新地址重新发手机。

## 5. 换机 / 重绑（单终端绑定规则）

- 认证码**只绑定首次激活的机器**（以机器码为准）。
- **换新电脑**：新机器上运行命令并填同一认证码 → 会被拒绝（提示已绑定其他设备）→ 到门户支付「换机费」→ 旧机器自动失效、新机器激活。
- **特例（硬件变更/重装系统）**：换硬盘、主板或重做系统可能导致机器码变化 → 联系 ricky8848@outlook.com，提供购买记录 + 新旧机器码，人工重绑（唯一需要人工的例外之一）。

## 6. 故障排查速查表

| 症状 | 可能原因 | 处理 |
|------|----------|------|
| 命令报错 node 未找到/版本低 | Node 缺失或 <18 | 按第 2 节一行命令安装后重跑 |
| 浏览器没弹出（无界面/服务器） | headless 环境或弹窗被拦 | 用终端打印的本地 URL 手动打开；手机直接访问该地址（需同一局域网） |
| 「端口被占用」提示 | 3080 已被其他进程占 | `lsof -iTCP:3080` 定位；停掉占用方，或给 DSH/隧道换同一新端口 |
| 手机打不开 URL（连接超时） | 家里电脑睡眠/关机；隧道未起 | 唤醒电脑等 10–30s；本地控制台看状态点是否绿 |
| 手机打不开（一直转圈/403） | URL 复制不完整；鉴权未过 | 完整复制含 `https://`；首次需 Access 邮箱验证（查垃圾箱） |
| 能打开但页面空白/反复刷新 | 家里服务本身没跑 | 先在电脑上开 `http://127.0.0.1:3080` 确认服务活着 |
| 重启后隧道没起来 | 常驻项被系统清理/改名 | macOS：`launchctl print gui/$(id -u)/com.mobileai.tunnel`；Linux：`systemctl --user status mobile-ai` |
| 机器码变了（换硬件后） | 指纹依赖的部件更换 | 第 5 节特例：人工重绑 |
| URL 失效但没轮换过 | 被吊销（心跳校验未通过）/ 套餐到期 | 查门户订单与设备状态；异常联系支持 |

## 7. FAQ

**Q: 能暴露 DSH 以外的服务吗？**
A: 可以。任何 `host:port`（如本地 Web 应用 `127.0.0.1:8080`）。建议只暴露你信任的服务。

**Q: 我的数据会经过你们的服务器吗？**
A: 不会。业务流量仅经 Cloudflare 边缘 TLS 中转；mobile ai 控制面只管理订单/认证码/隧道状态，不接触你的服务流量。

**Q: URL 泄露了怎么办？**
A: 一键轮换（本地控制台或门户），旧地址秒失效。建议保持 Access 邮箱验证开启作为第二层。

**Q: "单终端绑定"锁的是哪一头？**
A: 锁的是**你的电脑**（一台授权机器）。手机、平板同时打开同一个 URL 完全没问题——那是客户端数量，不受限。

**Q: 退款政策？**
A: 以 ToS 为准（发布时上线）：已激活为数字服务，不激活可于 7 天内申请退款。

**Q: 家里电脑必须一直开着吗？**
A: 是的——服务在你机器上，机器睡眠/关机时隧道离线。唤醒后自动恢复。
