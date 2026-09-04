#!/usr/bin/env bash
# mobile ai — 本地生产部署（免费先）· deploy-local.sh 【现有隧道模式】
#
# 设计定案（2026-09-04）：**不动既有 new-api-tunnel 的任何现有条目**——
#   · dsh.newapi.email → DSH Web GUI(:3080，CF Access 保护)   ← 保持
#   · newapi.email     → New API 网关(192.168.0.131:3000)     ← 保持
# 移动AI门户挂 **mai.newapi.email**，复用同一隧道：只新增一条 ingress + 一条全新 CNAME。
# 不建第二隧道、不接管任何既有主机名；cloudflared 保持现有运行方式（nohup，非 launchd）。
#
# 前置：cloudflared 已安装 + `cloudflared tunnel login`（浏览器 OAuth，仅 CNAME 创建用）。
# 效果：
#   1) ~/.mobileai/control.env        — CF token + ADMIN_TOKEN（生成一次，chmod 600）
#   2) ~/.cloudflared/config.yml      — 追加 ingress: mai.newapi.email → http://127.0.0.1:6420（先备份，幂等）
#   3) DNS CNAME mai.newapi.email     → <既有隧道 id>.cfargotunnel.com（只新增这一条记录）
#   4) cloudflared 重启加载配置 + :6420 mock → server.mjs（持久化 SQLite）
#   5) LaunchAgent ×2                 — control / mailer（重启自启）
#   6) https://mai.newapi.email/healthz 验证（DNS 传播最多 ~1min）
# 幂等：重跑安全。newapi.email 根域与 dsh.newapi.email（含 CF Access）绝不动。
set -uo pipefail

DOMAIN=newapi.email
PORTAL_HOST=mai.newapi.email
TUNNEL_NAME=new-api-tunnel          # 既有隧道名（保持其运行方式，仅重启加载新配置）
API_PORT=${MAI_API_PORT:-6420}
CTL_DIR="$(cd "$(dirname "$0")" && pwd)"

say()  { echo ""; echo "━━ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# JSON 取值（node，路径如 .result[0].id）
jget() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=eval("(JSON.parse(d)"+process.argv[1]+")");console.log(v==null?"":v)}catch{}})' "$2"; }

say "0/6 前置检查"
command -v cloudflared >/dev/null || fail "cloudflared 未安装：brew install cloudflared"
command -v node >/dev/null || fail "node 未安装（需 ≥18）"
NODE_BIN=$(command -v node)      # launchd 的 PATH 不含 /opt/homebrew/bin，plist 必须绝对路径
CF_BIN=$(command -v cloudflared)
[ -f "$HOME/.cloudflared/config.yml" ] || fail "未找到 ~/.cloudflared/config.yml（既有 new-api-tunnel 配置）"
CF_JSON=$(ls "$HOME/.cloudflared/"*.json 2>/dev/null | head -1)
[ -n "${CF_JSON:-}" ] && [ -f "$CF_JSON" ] || fail "未找到 ~/.cloudflared/*.json 凭据文件"
CF_TOKEN=$(node -p "JSON.parse(require('fs').readFileSync('$CF_JSON','utf8')).api_token || ''")
[ -n "$CF_TOKEN" ] || fail "$CF_JSON 里没有 api_token — 请先在终端运行：cloudflared tunnel login"
TUNNEL_ID=$(node -p "JSON.parse(require('fs').readFileSync('$CF_JSON','utf8')).TunnelID || ''")
[ -n "$TUNNEL_ID" ] || fail "凭据文件读不到 TunnelID：$CF_JSON"
echo "✓ cloudflared + CF OAuth token（$CF_JSON）· 既有隧道 $TUNNEL_ID"

say "1/6 读取 Cloudflare 账号 id（用户隧道创建用，写入 control.env）"
ACCT=$(curl -s --max-time 15 "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CF_TOKEN" | jget '' '.result[0].id')
[ -n "$ACCT" ] || fail "取不到 CF account id（token 权限不足？重新 cloudflared tunnel login）"
echo "✓ account=$ACCT"

say "2/6 写入 ~/.mobileai/control.env（缺什么补什么，不覆盖已有）"
mkdir -p "$HOME/.mobileai"
ENVF="$HOME/.mobileai/control.env"
if [ ! -f "$ENVF" ]; then
  ADMIN_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  { echo "# mobile ai 控制面 env（deploy-local.sh 生成；chmod 600）"
    echo "PORT=$API_PORT"
    echo "DOMAIN=$DOMAIN"
    echo "PORTAL_BASE=https://$PORTAL_HOST"
    echo "ADMIN_TOKEN=$ADMIN_TOKEN"
    echo "# 真实收款二维码（P6，拿到后取消注释）："
    # echo "PAYMENT_QR_ALIPAY=https://.../alipay-qr.png"
    # echo "PAYMENT_QR_WECHAT=https://.../wechat-qr.png"
    # echo "PAYMENT_AMOUNT=¥39"
  } > "$ENVF"; chmod 600 "$ENVF"
  echo "✓ 已生成 $ENVF（ADMIN_TOKEN=$ADMIN_TOKEN — 仅显示这一次，也保存在文件里）"
else
  grep -q '^CF_API_TOKEN='   "$ENVF" || echo "CF_API_TOKEN=$CF_TOKEN" >> "$ENVF"
  grep -q '^CF_ACCOUNT_ID='  "$ENVF" || echo "CF_ACCOUNT_ID=$ACCT" >> "$ENVF"
  grep -q '^ADMIN_TOKEN='    "$ENVF" || echo "ADMIN_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")" >> "$ENVF"
  grep -q '^PORTAL_BASE='    "$ENVF" || echo "PORTAL_BASE=https://$PORTAL_HOST" >> "$ENVF"
  chmod 600 "$ENVF"; echo "✓ $ENVF 已存在，补齐缺失字段"
fi

say "3/6 既有隧道配置追加门户 ingress（先备份；幂等）"
CFG="$HOME/.cloudflared/config.yml"
if grep -q "hostname: $PORTAL_HOST\$" "$CFG"; then
  echo "✓ ingress 已存在（$PORTAL_HOST → :$API_PORT），跳过"
else
  cp "$CFG" "$CFG.bak.$(date +%s)"
  awk -v h="$PORTAL_HOST" -v s="http://127.0.0.1:$API_PORT" '
    !done && /^ *- service: http_status:/ { print "  - hostname: " h; print "    service: " s; done=1 }
    { print }' "$CFG" > "$CFG.new"
  grep -q "hostname: $PORTAL_HOST\$" "$CFG.new" \
    || printf '  - hostname: %s\n    service: http://127.0.0.1:%s\n' "$PORTAL_HOST" "$API_PORT" >> "$CFG.new"
  mv "$CFG.new" "$CFG"
  echo "✓ 已追加 $PORTAL_HOST → 127.0.0.1:$API_PORT（备份：$CFG.bak.*；dsh/根域条目未动）"
fi

say "4/6 DNS CNAME $PORTAL_HOST（只新增这一条；根域与 dsh 记录不碰）"
ZONE_ID=$(curl -s --max-time 15 "https://api.cloudflare.com/client/v4/zones?name=$DOMAIN" \
  -H "Authorization: Bearer $CF_TOKEN" | jget '' '.result[0].id')
[ -n "$ZONE_ID" ] || fail "zone $DOMAIN 不在该 CF 账号下（NS 未切到 Cloudflare？）"
# 先删同名的旧记录（可能不存在），再建新的 → <既有隧道 id>.cfargotunnel.com
curl -s --max-time 15 "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=CNAME&name=$PORTAL_HOST" \
  -H "Authorization: Bearer $CF_TOKEN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const j=JSON.parse(d);for(const r of (j.result||[])){await fetch("https://api.cloudflare.com/client/v4/zones/dns_records/"+r.id,{method:"DELETE",headers:{Authorization:"Bearer "+process.argv[1]}});console.log("  - 删除旧记录 "+r.id)}}catch{}}' "$CF_TOKEN"
curl -s --max-time 15 "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -X POST -d "{\"type\":\"CNAME\",\"name\":\"$PORTAL_HOST\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"ttl\":120}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.success?"  ✓ CNAME 已建":"  ✗ "+(j.errors||[])[0].message)}catch{console.log("  ? 响应异常")}})'

say "5/6 :6420 mock → server.mjs（持久化 SQLite）+ 重启 cloudflared 加载配置"
HZ=$(curl -s --max-time 3 "http://127.0.0.1:$API_PORT/healthz" 2>/dev/null || true)
case "$HZ" in *mock*) echo "· :$API_PORT 是 mock（内存态）→ 停掉，换持久化 server.mjs"; pkill -f "node .*mock-server\.mjs" || true; sleep 1;; esac
SRV_PID=""
if ! curl -sf --max-time 3 "http://127.0.0.1:$API_PORT/healthz" 2>/dev/null | grep -q '"ok":true'; then
  nohup "$NODE_BIN" "$CTL_DIR/server.mjs" >> /tmp/mai-control.log 2>&1 &
  SRV_PID=$!; echo $SRV_PID > /tmp/mai-mock.pid   # 兼容旧 pid 文件位置
  sleep 1; curl -sf --max-time 3 "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1 \
    && echo "✓ server.mjs :$API_PORT (pid $SRV_PID)" || fail "server.mjs 启动失败，看 /tmp/mai-control.log"
else
  echo "✓ server.mjs :$API_PORT 已在运行（若为旧实例请手动 pkill -f server.mjs）"
fi
echo "· 重启 cloudflared（$TUNNEL_NAME，秒级中断；CF Access 会话在 Cloudflare 侧不受影响）"
pkill -f "cloudflared tunnel run $TUNNEL_NAME" 2>/dev/null || true
sleep 2
nohup "$CF_BIN" tunnel run "$TUNNEL_NAME" >> /tmp/mai-cloudflared.log 2>&1 &
echo "✓ cloudflared（$TUNNEL_NAME）已重启 (pid $!) → /tmp/mai-cloudflared.log"

say "6/6 安装 LaunchAgent（control + mailer；cloudflared 保持现有运行方式）"
LA="$HOME/Library/LaunchAgents"; mkdir -p "$LA"
mk_agent() { # $1=label 其余为 argv（元素内不可含双引号）；返回 0 = bootstrap 成功
  local label="$1"; shift
  local json='[' first=1 a
  for a in "$@"; do [ "$first" = "1" ] || json+=','; first=0; json+="\"$a\"" ; done
  json+=']'
  node -e 'const fs=require("fs");const a=JSON.parse(process.argv[2]);
    const s=["<?xml version=\"1.0\"?>","<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\"><dict>",`<key>Label</key><string>${process.argv[1]}</string>`,
    "<key>ProgramArguments</key><array>"+a.map(x=>`<string>${x}</string>`).join("")+"</array>",
    "<key>RunAtLoad</key><true/>","<key>KeepAlive</key><true/>",
    `<key>StandardOutPath</key><string>/tmp/mai-${process.argv[1].split(".").pop()}.log</string>`,
    `<key>StandardErrorPath</key><string>/tmp/mai-${process.argv[1].split(".").pop()}.log</string>`,
    "</dict></plist>"].join("\n");fs.writeFileSync(process.argv[3],s)' "$label" "$json" "$LA/$1.plist"
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1
  launchctl bootstrap "gui/$(id -u)" "$LA/$label.plist" && return 0 || { echo "⚠ $label bootstrap 失败（手动：launchctl load $LA/$1.plist）"; return 1; }
}
if mk_agent com.mobileai.control "$NODE_BIN" "$CTL_DIR/server.mjs"; then
  echo "✓ com.mobileai.control（重启自启）"
  [ -n "$SRV_PID" ] && kill "$SRV_PID" >/dev/null 2>&1 && echo "  · nohup 实例已交还给 launchd"
fi
# 先清掉手动启动的 mailer（nohup/前台），避免与 launchd 实例双轮询同一队列 → 重复发信
pkill -f "node .*mailer\.mjs" 2>/dev/null || true; sleep 1
if grep -qs '^MAIL_ACCOUNTS=' "$HOME/.mobileai/control.env" 2>/dev/null; then
  # mailer 需要 control.env 里的 MAIL_ACCOUNTS/ADMIN_TOKEN → 包装脚本 source 后 exec
  cat > "$HOME/.mobileai/run-mailer.sh" <<EOF2
#!/bin/bash
set -a; . "\$HOME/.mobileai/control.env" 2>/dev/null || true
exec "$NODE_BIN" "$CTL_DIR/mailer.mjs"
EOF2
  chmod +x "$HOME/.mobileai/run-mailer.sh"
  if mk_agent com.mobileai.mailer /bin/bash "$HOME/.mobileai/run-mailer.sh"; then echo "✓ com.mobileai.mailer（重启自启）"; fi
else
  echo "· mailer LaunchAgent 跳过（未配置 MAIL_ACCOUNTS；配好后重跑本脚本即可）"
fi

say "验证 https://$PORTAL_HOST（DNS 传播最多 ~1min）"
for i in $(seq 1 30); do
  if HZ=$(curl -sf --max-time 5 "https://$PORTAL_HOST/healthz" 2>/dev/null) && echo "$HZ" | grep -q ok; then
    echo "✓ 公网可达：$HZ"; break
  fi; [ "$i" = "30" ] && echo "⚠ 60s 内未通 — DNS/隧道传播中，稍后手动 curl https://$PORTAL_HOST/healthz 复查"
  sleep 2
done

echo ""
echo "════ 部署完成 ════"
echo "门户（手机可开）: https://$PORTAL_HOST/"
echo "管理台          : https://$PORTAL_HOST/admin   （令牌见 $ENVF 的 ADMIN_TOKEN）"
echo "DSH GUI         : https://dsh.newapi.email/（保持原样，CF Access 保护）"
echo "日志            : /tmp/mai-control.log · /tmp/mai-cloudflared.log"
echo "下一步          : 配置真实发信 → 在 $ENVF 加 MAIL_ACCOUNTS=\"邮箱:密码\"，然后重跑本脚本装 mailer"
echo "                  （Outlook/Hotmail 用账号密码，开两步验证则用应用专用密码；QQ/163 用「授权码」不是登录密码）"
