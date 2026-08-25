// mobile ai（移动AI）· 门户页面（P4）。纯 HTML/CSS/JS 字符串，无构建。
// Worker（index.js）与本地 mock-server.mjs 共用；黑白 Apple 风，移动端优先。

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
:root{--bg:#fff;--fg:#1d1d1f;--muted:#86868b;--border:rgba(0,0,0,.1);--btn:#1d1d1f;--btn-fg:#fff;
  --ok:#34c759;--warn:#ff9f0a;--err:#ff3b30}
@media(prefers-color-scheme:dark){:root{--bg:#000;--fg:#f5f5f7;--muted:#86868b;
  --border:rgba(255,255,255,.14);--btn:#f5f5f7;--btn-fg:#000}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
  font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.5}
.wrap{max-width:620px;margin:0 auto;padding:48px 20px 80px}
.mark{font-size:13px;letter-spacing:.12em;font-weight:600;color:var(--muted);text-transform:uppercase}
h1{font-size:34px;line-height:1.15;letter-spacing:-.02em;margin:.4em 0 .3em}
.sub{color:var(--muted);font-size:15px;margin-bottom:28px}
.card{border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin:14px 0;background:transparent}
label{font-size:13px;color:var(--muted);display:block;margin-bottom:6px}
input[type=email]{width:100%;padding:12px 14px;font-size:16px;border:1px solid var(--border);
  border-radius:10px;background:transparent;color:var(--fg)}
button{appearance:none;border:0;padding:12px 18px;font-size:15px;border-radius:10px;
  background:var(--btn);color:var(--btn-fg);cursor:pointer;font-weight:500}
button.ghost{background:transparent;color:var(--fg);border:1px solid var(--border)}
.mono{font:"SF Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px}
.big-code{font:"SF Mono",ui-monospace,Menlo,monospace;font-size:26px;letter-spacing:.08em;margin:8px 0}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;
  border:1px solid var(--border);color:var(--muted)}
.badge.ok{color:#fff;background:var(--ok);border-color:transparent}
.badge.warn{color:#000;background:var(--warn);border-color:transparent}
.badge.err{color:#fff;background:var(--err);border-color:transparent}
.msg{font-size:14px;margin-top:10px;min-height:20px}
.msg.ok{color:var(--ok)}.msg.err{color:var(--err)}
.kv{display:flex;justify-content:space-between;font-size:14px;padding:6px 0;border-bottom:1px solid var(--border)}
.kv:last-child{border-bottom:0}
.kv span:first-child{color:var(--muted)}
pre.cmd{background:rgba(125,125,130,.08);border-radius:10px;padding:12px 14px;overflow-x:auto;font-size:13px}
.top{display:flex;justify-content:space-between;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--border);margin-bottom:20px}
footer{margin-top:48px;color:var(--muted);font-size:12px}
`;

function page(title, body) {
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' · 移动AI</title>' +
    '<style>' + CSS + '</style></head><body><div class="wrap">' + body + '</div></body></html>';
}

/* ---------------- 落地页：申请入口 ---------------- */
export function landingPage() {
  return page('移动AI — 零成本隧道即服务', `
<div class="mark">mobile ai</div>
<h1>人在路上任意飘，<br>家里电脑爆缸开工。</h1>
<p class="sub">零成本隧道即服务：一条命令 + 一个页面，把家中电脑的任意本地服务（默认 DSH 控制台）同步到手机。浏览器开 URL 即用，不装 App。</p>
<div class="card">
<label for="em">邮箱</label>
<input id="em" type="email" placeholder="you@example.com" autocomplete="email">
<div class="row" style="margin-top:10px"><button id="go">申请 →</button></div>
<div class="msg" id="m"></div>
<p style="font-size:12px;color:var(--muted);margin-top:8px">申请后收到确认链接；付款确认后自动发送专属认证码。数据面在你自己机器（cloudflared 出站隧道），我们不碰你的流量。</p>
</div>
<div class="card">
<label>三步上线</label>
<ol style="margin:8px 0 0;padding-left:18px;font-size:14px;color:var(--muted)">
<li>邮箱申请 → 确认链接（magic link）</li>
<li>扫码付款 → 认证码邮件自动送达「我的页面」+邮箱</li>
<li>家中电脑一条命令安装 → 填认证码 → 专属 URL 上线</li>
</ol>
</div>
<footer>移动AI · newapi.email · 流量不经第三方服务器</footer>` + `
<script>
document.getElementById('go').onclick = async () => {
  const em = document.getElementById('em'), m = document.getElementById('m');
  if (!/^[^@\\s]+@[^@\\s]+$/.test(em.value.trim())) { m.textContent = '请填写有效邮箱'; m.className = 'msg err'; return; }
  document.getElementById('go').disabled = true; m.textContent = '发送中…'; m.className = 'msg';
  try { const r = await fetch('/site/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: em.value.trim() }) });
    const d = await r.json(); m.textContent = (r.ok && d.ok) ? '确认链接已发送至邮箱，请查收。' : ('失败：' + (d.error || r.status));
    m.className = 'msg ' + ((r.ok && d.ok) ? 'ok' : 'err');
  } catch (e) { m.textContent = '网络错误'; m.className = 'msg err'; }
  document.getElementById('go').disabled = false;
};
</script>`);
}

/* ---------------- magic link 落地（无效/过期） ---------------- */
export function loginErrorPage(msg) {
  return page('登录 · 移动AI', `
<div class="mark">mobile ai</div>
<h1 style="font-size:24px;margin-top:16px">链接不可用</h1>
<p class="sub">${esc(msg || '确认链接无效或已过期（7 天有效，一次性）。')}</p>
<div class="card"><div class="row">
<button onclick="location.href='/'" style="flex:1">回到首页重新申请</button>
</div></div>`);
}

/* ---------------- 我的页面：认证码 + 绑定状态 ---------------- */
export function mePage(p, portalBase, domain = 'newapi.email') {
  const b = p.binding;
  const bindCard = b ? `
<div class="card">
<label>当前绑定</label>
<div class="kv"><span>专属 URL</span><span class="mono">${esc(b.subdomain)}.${esc(domain)}</span></div>
<div class="kv"><span>机器码</span><span class="mono">${esc(String(b.machine_code).slice(0, 12))}…</span></div>
<div class="kv"><span>状态</span><span>${b.status === 'active' ? '<span class="badge ok">在线</span>' : b.status === 'grace' ? '<span class="badge warn">宽限（心跳超时）</span>' : '<span class="badge err">' + esc(b.status) + '</span>'}</span></div>
<div class="kv"><span>最后心跳</span><span>${b.last_heartbeat ? new Date(b.last_heartbeat).toLocaleString('zh-CN') : '尚未上报'}</span></div>
</div>` : `
<div class="card">
<label>尚未绑定终端</label>
<p style="font-size:14px;color:var(--muted);margin:8px 0">在家中电脑上运行一条命令（自动下载 cloudflared + 打开本地控制台），然后填入下方认证码：</p>
<pre class="cmd">curl -fsSL ${esc(portalBase)}/i.sh | bash</pre>
<pre class="cmd" style="margin-top:8px"># Windows PowerShell：irm ${esc(portalBase)}/i.ps1 | iex</pre>
</div>`;
  return page('我的页面 · 移动AI', `
<div class="top"><span class="mark">mobile ai</span>
<button class="ghost" style="padding:6px 14px;font-size:13px" onclick="fetch('/site/logout',{method:'POST'}).then(()=>location.href='/')">退出</button></div>
<div class="card">
<label>账号</label>
<div class="kv"><span>邮箱</span><span>${esc(p.email)}</span></div>
<div class="kv"><span>状态</span><span>${p.status === 'active' ? '<span class="badge ok">已激活</span>' : p.status === 'suspended' ? '<span class="badge err">已停用</span>' : '<span class="badge warn">待付款确认</span>'}</span></div>
${p.status === 'pending' ? '<p style="font-size:13px;color:var(--muted);margin-top:8px">完成付款后认证码将自动发放（二维码见申请页说明 / 联系客服）。</p>' : ''}
</div>
${p.code ? `<div class="card">
<label>认证码（一次性，填入本地控制台）</label>
<div class="big-code mono">${esc(p.code.code)}</div>
<div class="row"><button onclick="copyCode(this)" style="font-size:13px;padding:8px 14px">复制</button>
<span class="badge ${p.code.status === 'redeemed' ? '' : 'ok'}">${p.code.status === 'redeemed' ? '已使用' : '未使用'}</span></div>
</div>` : '<p style="font-size:13px;color:var(--muted)">暂无认证码 — 付款确认后自动发放。</p>'}
${bindCard}
<footer>移动AI · newapi.email</footer>` + `
<script>function copyCode(el){navigator.clipboard.writeText('${p.code ? esc(p.code.code) : ''}').then(()=>{el.textContent='已复制 ✓';setTimeout(()=>el.textContent='复制',1500)})}</script>`);
}
