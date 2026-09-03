#!/usr/bin/env bash
# mobile ai — 本地生产部署（免费先）· deploy-local.sh
#
# 前置：cloudflared 已安装 + 终端跑过一次 `cloudflared tunnel login`（浏览器 OAuth）。
# 效果：
#   1) ~/.mobileai/control.env        — CF token + ADMIN_TOKEN（生成一次，chmod 600）
#   2) CF 命名隧道 mai-control        — ingress: mai.newapi.email → http://127.0.0.1:6420
#   3) DNS CNAME mai.newapi.email     → <tunnel>.cfargotunnel.com（只动这一条记录）
#   4) cloudflared + server.mjs       — nohup 启动（若未运行）
#   5) LaunchAgent ×3                 — control / mailer / cloudflared（重启自启）
#   6) https://mai.newapi.email/healthz 验证（DNS 传播最多 ~1min）
# 幂等：重跑安全（已存在的隧道/env 字段不覆盖）。newapi.email 根域 = 既有 New API 网关，绝不动。
set -uo pipefail

DOMAIN=newapi.email
PORTAL_HOST=mai.newapi.email
TUNNEL=mai-control
API_PORT=${MAI_API_PORT:-6420}
CTL_DIR="$(cd "$(dirname "$0")" && pwd)"

say()  { echo ""; echo "━━ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# JSON 取值（node，路径如 result[0].id）
jget() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=eval("(JSON.parse(d)"+process.argv[1]+")");console.log(v==null?"":v)}catch{}})' "$2"; }

say "0/6 前置检查"
command -v cloudflared >/dev/null || fail "cloudflared 未安装：brew install cloudflared"
command -v node >/dev/null || fail "node 未安装（需 ≥18）"
CF_JSON=$(ls "$HOME/.cloudflared/"*.json 2>/dev/null | head -1)
[ -n "${CF_JSON:-}" ] && [ -f "$CF_JSON" ] || fail "未找到 ~/.cloudflared/*.json — 请先在终端运行：cloudflared tunnel login"
CF_TOKEN=$(node -p "JSON.parse(require('fs').readFileSync('$CF_JSON','utf8')).api_token || ''")
[ -n "$CF_TOKEN" ] || fail "$CF_JSON 里没有 api_token（cloudflared tunnel login 未完成？）"
echo "✓ cloudflared + CF OAuth token（$CF_JSON）"

say "1/6 读取 Cloudflare 账号 id"
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

say "3/6 CF 命名隧道 $TUNNEL（幂等）"
TUNNEL_ID=$(cloudflared tunnel list --output json 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log((j||[]).find(t=>t.Name==="'$TUNNEL'")?.ID||"")}catch{console.log("")}})')
if [ -z "$TUNNEL_ID" ]; then
  TUNNEL_ID=$(cloudflared tunnel create "$TUNNEL" | awk '{print $NF}')
  [ -n "$TUNNEL_ID" ] || fail "创建隧道失败（cloudflared tunnel create 输出异常）"
  echo "✓ 新建隧道 $TUNNEL_ID"
else
  echo "✓ 复用已有隧道 $TUNNEL_ID"
fi

CFG="$HOME/.mobileai/cloudflared/$TUNNEL_ID.json"
mkdir -p "$(dirname "$CFG")"
cat > "$CFG" <<EOF
{ "ingress": [ { "hostname": "$PORTAL_HOST", "service": "http://127.0.0.1:$API_PORT" }, { "service": "http_status:404" } ] }
EOF
echo "✓ 隧道配置 $CFG（$PORTAL_HOST → 127.0.0.1:$API_PORT）"

say "4/6 DNS CNAME $PORTAL_HOST（只动这一条；根域 A 记录不碰）"
ZONE_ID=$(curl -s --max-time 15 "https://api.cloudflare.com/client/v4/zones?name=$DOMAIN" \
  -H "Authorization: Bearer $CF_TOKEN" | jget '' '.result[0].id')
[ -n "$ZONE_ID" ] || fail "zone $DOMAIN 不在该 CF 账号下（NS 未切到 Cloudflare？）"
# 先删旧 CNAME（可能不存在），再经 cloudflared CLI 建新的
curl -s --max-time 15 "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=CNAME&name=$PORTAL_HOST" \
  -H "Authorization: Bearer $CF_TOKEN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const j=JSON.parse(d);for(const r of (j.result||[])){await fetch("https://api.cloudflare.com/client/v4/zones/dns_records/"+r.id,{method:"DELETE",headers:{Authorization:"Bearer "+process.argv[1]}});console.log("  - 删除旧记录 "+r.id)}}catch{}}' "$CF_TOKEN"
cloudflared tunnel route dns "$TUNNEL_ID" "$PORTAL_HOST" >/dev/null 2>&1 && echo "✓ CNAME $PORTAL_HOST → $TUNNEL_ID.cfargotunnel.com" \
  || echo "⚠ CNAME 命令返回非零（若记录已是目标值可忽略；稍后 healthz 验证会给出结论）"

say "5/6 启动服务（server.mjs + cloudflared；已在跑则跳过）"
SRV_PID=""
if ! curl -sf --max-time 3 "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1; then
  nohup node "$CTL_DIR/server.mjs" >> /tmp/mai-control.log 2>&1 &
  SRV_PID=$!; echo $SRV_PID > /tmp/mai-mock.pid   # 兼容旧 pid 文件位置
  sleep 1; curl -sf --max-time 3 "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1 \
    && echo "✓ server.mjs :$API_PORT (pid $SRV_PID)" || fail "server.mjs 启动失败，看 /tmp/mai-control.log"
else
  echo "✓ server.mjs :$API_PORT 已在运行（launchd 接管时不会杀它，若端口冲突请手动 pkill -f server.mjs）"
fi
CF_PID=""
if ! pgrep -f "cloudflared.*run $TUNNEL_ID" >/dev/null 2>&1; then
  nohup cloudflared tunnel --no-autoupdate run "$TUNNEL_ID" >> /tmp/mai-cloudflared.log 2>&1 &
  CF_PID=$!; echo $CF_PID > /tmp/mai-cf.pid
  echo "✓ cloudflared（$TUNNEL_ID）已启动 (pid $CF_PID) → /tmp/mai-cloudflared.log"
else
  echo "✓ cloudflared（$TUNNEL_ID）已在运行（launchd 接管时若端口冲突请手动 pkill -f cloudflared）"
fi

say "6/6 安装 LaunchAgent（重启自启；bootstrap 成功后接管 nohup 实例）"
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
if mk_agent com.mobileai.control node "$CTL_DIR/server.mjs"; then
  echo "✓ com.mobileai.control（重启自启）"
  [ -n "$SRV_PID" ] && kill "$SRV_PID" >/dev/null 2>&1 && echo "  · nohup 实例已交还给 launchd"
fi
if grep -qs '^MAIL_ACCOUNTS=' "$HOME/.mobileai/control.env" 2>/dev/null; then
  # mailer 需要 control.env 里的 MAIL_ACCOUNTS/ADMIN_TOKEN → 包装脚本 source 后 exec
  cat > "$HOME/.mobileai/run-mailer.sh" <<EOF2
#!/bin/bash
set -a; . "\$HOME/.mobileai/control.env" 2>/dev/null || true
exec node "$CTL_DIR/mailer.mjs"
EOF2
  chmod +x "$HOME/.mobileai/run-mailer.sh"
  if mk_agent com.mobileai.mailer /bin/bash "$HOME/.mobileai/run-mailer.sh"; then echo "✓ com.mobileai.mailer（重启自启）"; fi
else
  echo "· mailer LaunchAgent 跳过（未配置 MAIL_ACCOUNTS；配好后重跑本脚本即可）"
fi
if mk_agent com.mobileai.cloudflared cloudflared tunnel --no-autoupdate run "$TUNNEL_ID"; then
  echo "✓ com.mobileai.cloudflared（重启自启）"
  [ -n "$CF_PID" ] && kill "$CF_PID" >/dev/null 2>&1 && echo "  · nohup 实例已交还给 launchd"
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
echo "日志            : /tmp/mai-control.log · /tmp/mai-cloudflared.log"
echo "下一步          : 配置真实发信 → 在 $ENVF 加 MAIL_ACCOUNTS=\"邮箱:授权码\"，然后重跑本脚本装 mailer"
echo "                  （QQ/163 用「授权码」不是登录密码；Gmail 用应用专用密码）"
