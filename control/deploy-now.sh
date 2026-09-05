#!/usr/bin/env bash
# mobile ai — 上线（跳过 CF API 步骤：隧道 ingress + DNS 已就位且在跑；
# /api/activate（用户自建隧道）待 `cloudflared tunnel login` 后补 CF_API_TOKEN/CF_ACCOUNT_ID）。
# 与 deploy-local.sh 同口径：control.env + server.mjs(SQLite) + LaunchAgent×2（重启自启）。
# 2026-09-05：门户定案 newapi.email（apex，Zero Trust 公共主机名）；本脚本已按该口径更新。
# ⚠ MAIL_ACCOUNTS（含 Gmail 应用专用密码）只允许存在于 control.env，禁止写入本脚本/仓库。
set -uo pipefail

CTL_DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN=newapi.email
PORTAL_HOST=$DOMAIN   # 门户 = apex（2026-09-05 定案；dsh.newapi.email = DSH GUI，不动）
API_PORT=6420
NODE_BIN=$(command -v node)

say()  { echo ""; echo "━━ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

say "1/4 control.env（缺什么补什么，不覆盖已有）"
ENVF="$HOME/.mobileai/control.env"
mkdir -p "$HOME/.mobileai"; chmod 700 "$HOME/.mobileai"
[ -f "$ENVF" ] || echo "# mobile ai 控制面 env（生成；chmod 600）" > "$ENVF"
add() { grep -q "^$1=" "$ENVF" || echo "$2" >> "$ENVF"; }
add PORT "PORT=$API_PORT"
add DOMAIN "DOMAIN=$DOMAIN"
add PORTAL_BASE "PORTAL_BASE=https://$PORTAL_HOST"
add ADMIN_TOKEN "ADMIN_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
grep -q '^MAIL_ACCOUNTS=' "$ENVF" || echo "⚠ MAIL_ACCOUNTS 未配置（mailer 不发信）：在 $ENVF 加 MAIL_ACCOUNTS=\"邮箱:应用专用密码\"（勿写入本脚本）"
chmod 600 "$ENVF"

say "2/4 :$API_PORT mock → server.mjs（持久化 SQLite）"
HZ=$(curl -s --max-time 3 "http://127.0.0.1:$API_PORT/healthz" 2>/dev/null || true)
case "$HZ" in *mock*) pkill -f "node .*mock-server\.mjs" || true; sleep 1;; esac
pkill -f "node .*mailer\.mjs" 2>/dev/null || true; sleep 1

say "3/4 LaunchAgent ×2（control + mailer；重启自启）"
LA="$HOME/Library/LaunchAgents"; mkdir -p "$LA"
mk_agent() { # $1=label 其余为 argv；返回 0 = bootstrap 成功（与 deploy-local.sh 同实现）
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
    "</dict></plist>"].join("\n");fs.writeFileSync(process.argv[3],s)' "$label" "$json" "$LA/$label.plist"
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1
  launchctl bootstrap "gui/$(id -u)" "$LA/$label.plist" && return 0 || { echo "⚠ $label bootstrap 失败（手动：launchctl load $LA/$1.plist）"; return 1; }
}

cat > "$HOME/.mobileai/run-mailer.sh" <<EOF2
#!/bin/bash
set -a; . "\$HOME/.mobileai/control.env" 2>/dev/null || true
exec "$NODE_BIN" "$CTL_DIR/mailer.mjs"
EOF2
chmod +x "$HOME/.mobileai/run-mailer.sh"

mk_agent com.mobileai.control "$NODE_BIN" "$CTL_DIR/server.mjs" && echo "✓ com.mobileai.control（重启自启）"
mk_agent com.mobileai.mailer /bin/bash "$HOME/.mobileai/run-mailer.sh" && echo "✓ com.mobileai.mailer（重启自启）"

say "4/4 验证 :$API_PORT"
sleep 2
if curl -sf --max-time 3 "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1; then
  echo "✓ server.mjs :$API_PORT (db=$HOME/.mobileai/control.db)"
else
  fail "server.mjs 未起，看 /tmp/mai-control.log"; fi

echo ""
echo "════ 上线完成 ════"
echo "门户: https://$PORTAL_HOST/   管理台: /admin（令牌见 $ENVF）"
echo "日志: /tmp/mai-control.log · /tmp/mai-mailer.log"
