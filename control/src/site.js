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
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--border);vertical-align:middle}
th{color:var(--muted);font-weight:600;font-size:12px;white-space:nowrap}
td .mono{font-size:12px}
button.mini{padding:5px 10px;font-size:12px;border-radius:8px}
select,input[type=text],input[type=password]{padding:9px 12px;font-size:14px;border:1px solid var(--border);
  border-radius:10px;background:transparent;color:var(--fg)}
.qr{display:flex;flex-direction:column;gap:6px}
.qr img{width:150px;height:auto;border-radius:10px}
.qr-ph{width:150px;min-height:120px;border:1.5px dashed var(--border);border-radius:12px;display:flex;
  align-items:center;justify-content:center;text-align:center;color:var(--muted);font-size:12px;padding:8px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:6px}
.tile{border:1px solid var(--border);border-radius:12px;padding:10px 12px;min-width:0}
.tile .l{font-size:11px;color:var(--muted);white-space:nowrap}
.tile .n{font-size:24px;font-weight:700;letter-spacing:-.01em;margin-top:2px;white-space:nowrap}
.tile .s{font-size:11px;color:var(--muted);margin-top:2px;white-space:nowrap}
#live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-left:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
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
export function mePage(p, portalBase, domain = 'newapi.email', pay, flags = {}) {
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
${flags.justPaid ? '<div class="card" style="border-color:rgba(52,199,89,.45)"><b style="color:var(--ok)">支付成功 ✓</b><p style="font-size:13px;color:var(--muted);margin:6px 0 0">认证码已发放（见下方）并同步至邮箱。若尚未显示，请 10 秒后刷新。</p></div>' : ''}
<div class="card">
<label>账号</label>
<div class="kv"><span>邮箱</span><span>${esc(p.email)}</span></div>
<div class="kv"><span>状态</span><span>${p.status === 'active' ? '<span class="badge ok">已激活</span>' : p.status === 'suspended' ? '<span class="badge err">已停用</span>' : '<span class="badge warn">待付款确认</span>'}</span></div>
${p.status === 'pending' ? paymentCard(pay) : ''}
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

/* ---------------- P6/P7：付款卡片（/me 待付款状态） ---------------- */
// P7：在线收款优先（Stripe Checkout，全球卡/Apple Pay → webhook 自动发码）；
//     未配 Stripe 时：PAYMENT_ONLINE_URL 外链兜底（如 PayPal.me）→ 仍需人工确认。
//     二维码/银行转账保留为备用渠道（半自动：管理端确认后发码）。
function fmtMoney(cents, cur) {
  const c = Number(cents) || 0;
  const u = String(cur || 'usd').toLowerCase();
  const sym = { usd: '$', cny: '¥', eur: '€', gbp: '£' }[u] || (String(cur || 'USD').toUpperCase() + ' ');
  return sym + (c / 100).toFixed(2);
}

export function paymentCard(pay) {
  const p = pay || {};
  const methods = (p.methods && p.methods.length ? p.methods : [ { name: '支付宝' }, { name: '微信支付' } ]);
  const qrs = methods.map((m) => `
 <div class="qr"><label>${esc(m.name)}</label>
 ${m.qrUrl ? `<img src="${esc(m.qrUrl)}" alt="${esc(m.name)}收款码">`
   : `<div class="qr-ph mono">${esc(m.name)}二维码<br>未配置</div>`}</div>`).join('');
  const online = p.stripeConfigured ? `
<div class="card" style="border-color:rgba(52,199,89,.4)">
<label>在线支付（推荐 · 全球可用）</label>
<button id="pay-online" style="width:100%">Pay ${fmtMoney(p.amountCents, p.currency)} · 全球信用卡 / Apple Pay</button>
<p style="font-size:12px;color:var(--muted);margin-top:8px">经 Stripe 安全支付；付款成功后<b>认证码自动发放</b>，无需等待人工确认。</p>
<div class="msg" id="pay-m"></div>
</div>` : p.onlineUrl ? `
<div class="card">
<label>在线支付（全球可用）</label>
<a href="${esc(p.onlineUrl)}" target="_blank" rel="noopener"><button style="width:100%">在线支付 →</button></a>
<p style="font-size:12px;color:var(--muted);margin-top:8px">付款完成后等待确认（通常数小时内），认证码将自动发放。</p>
</div>` : '';
  return `${online}
<div class="card">
<label>扫码 / 银行转账（备用渠道）</label>
<div class="kv"><span>金额</span><b>${esc(p.amountLabel || '¥39')}</b></div>
<p style="font-size:12px;color:var(--muted);margin:6px 0 14px">${esc(p.note || '一次性付费 · 专属 URL + 开机自启自动重连，无订阅')}</p>
<div class="row" style="gap:20px">${qrs}</div>
<p style="font-size:12px;color:var(--muted);margin-top:14px">
① 扫码完成付款；银行转账请在备注填写<b>本邮箱</b>。
② 付款完成后等待确认（通常数小时内），认证码将<b>自动发放</b>到本页面并同步至邮箱。</p>
<p style="font-size:12px;color:var(--muted)">已付款？无需额外操作——确认后本页自动显示认证码。</p>
</div>` + (p.stripeConfigured ? `
<script>document.getElementById('pay-online').onclick = async () => {
  const m = document.getElementById('pay-m'), b = document.getElementById('pay-online');
  b.disabled = true; m.textContent = '正在创建安全支付链接…'; m.className = 'msg';
  try { const r = await fetch('/site/pay/checkout', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.url) { location.href = d.url; return; }
    m.textContent = '创建支付失败：' + (d.error || r.status); m.className = 'msg err'; b.disabled = false;
  } catch (e) { m.textContent = '网络错误，请重试'; m.className = 'msg err'; b.disabled = false; }
};</script>` : '');
}

/* ---------------- P6：管理端（/admin）—— token 登录 + 控制台 ---------------- */
export function adminLoginPage() {
  return page('管理端 · 移动AI', `
<div class="mark">mobile ai · admin</div>
<h1 style="font-size:24px;margin-top:16px">管理控制台</h1>
<p class="sub">输入 ADMIN_TOKEN 登录（与 API Bearer 同一凭据）。</p>
<div class="card">
<label for="tok">管理令牌</label>
<input id="tok" type="password" placeholder="ADMIN_TOKEN" autocomplete="off">
<div class="row" style="margin-top:10px"><button id="go">登录</button></div>
<div class="msg" id="m"></div>
</div>` + `
<script>
async function login(){const m=document.getElementById('m');document.getElementById('go').disabled=true;
 try{const r=await fetch('/admin/login',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({token:document.getElementById('tok').value.trim()})});
 if(r.ok){location.href='/admin';return}
 const d=await r.json().catch(()=>({}));m.textContent=d.error||('登录失败（'+r.status+'）');m.className='msg err';}
 catch(e){m.textContent='网络错误';m.className='msg err'}
 document.getElementById('go').disabled=false}
document.getElementById('go').onclick=login;
document.getElementById('tok').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
</script>`);
}

export function adminDashboard(portalBase) {
  return page('管理控制台 · 移动AI', `
<div class="top"><span class="mark">mobile ai · admin</span>
<button class="ghost" style="padding:6px 14px;font-size:13px" onclick="fetch('/admin/logout',{method:'POST'}).then(()=>location.href='/')">退出</button></div>
<div class="card">
<label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">实时总览<span id="live-dot"></span>
<span id="stats-updated" style="font-weight:400;font-size:12px;color:var(--muted)"></span>
<button class="mini ghost" id="stats-toggle">暂停刷新</button></label>
<div class="tiles" id="stat-tiles"><div style="color:var(--muted);font-size:13px">加载中…</div></div>
<div id="stripe-evs"></div>
<p style="font-size:12px;color:var(--muted);margin-top:8px">在线 = 心跳在窗口内（默认 45min，客户端每 30min 一次）；收入按 Stripe/手动确认落库金额累计。</p>
</div>
<div class="card">
<label>用户与发码 <span style="font-weight:400;font-size:12px">（确认收款 → 自动发码 + 邮件；试用码直接签发）</span></label>
<table><thead><tr><th>邮箱</th><th>状态</th><th>创建时间</th><th style="width:170px">操作</th></tr></thead>
<tbody id="u-body"><tr><td colspan=4 style="color:var(--muted)">加载中…</td></tr></tbody></table>
</div>
<div class="card">
<label>终端绑定 <span style="font-weight:400;font-size:12px">（吊销 = 隧道立即失效）</span></label>
<table><thead><tr><th>子域</th><th>用户</th><th>机器码</th><th>服务地址</th><th>状态</th><th>最后心跳</th><th style="width:70px">操作</th></tr></thead>
<tbody id="b-body"><tr><td colspan=7 style="color:var(--muted)">加载中…</td></tr></tbody></table>
</div>
<div class="card">
<label>邮件队列 <span id="e-count" style="font-weight:400;font-size:12px"></span></label>
<table><thead><tr><th>收件人</th><th>主题</th><th>状态</th><th>创建时间</th></tr></thead>
<tbody id="e-body"><tr><td colspan=4 style="color:var(--muted)">加载中…</td></tr></tbody></table>
<p style="font-size:12px;color:var(--muted);margin-top:8px">队列由 mailer.mjs（家中机器常驻）轮询发出；MOCK 模式打印到 /tmp/mai-mailer.log。</p>
</div>
<footer>移动AI 管理端 · ${esc(portalBase || '')}</footer>` + `
<script>
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function badge(st){const m={active:['ok','在线'],grace:['warn','宽限'],revoked:['err','已吊销'],suspended:['err','停用'],
 pending:['warn','待付款确认'],queued:['warn','排队中'],sent:['ok','已发送'],failed:['err','失败']};
 const k=m[st]||['',String(st??'')];return '<span class="badge '+k[0]+'">'+esc(k[1])+'</span>'}
function tsFmt(t){return t?new Date(Number(t)).toLocaleString('zh-CN'):'—'}
async function j(p,b){const r=await fetch(p,{method:b?'POST':'GET',headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined});
 return{ok:r.ok,d:await r.json().catch(()=>({}))}}
/* ---- P7：实时总览（/admin/stats，10s 轮询）---- */
function money(c,cur){const u=String(cur||'usd').toLowerCase();const s={usd:'$',cny:'¥',eur:'€',gbp:'£'}[u]||(String(cur||'USD').toUpperCase()+' ');
 return s+((Number(c)||0)/100).toFixed(2)}
function tile(n,l,s){return '<div class="tile"><div class="l">'+esc(l)+'</div><div class="n">'+n+'</div>'+(s?'<div class="s">'+esc(s)+'</div>':'')+'</div>'}
async function loadStats(){const{ok,d}=await j('/admin/stats');if(!ok||!d)return;
 document.getElementById('stat-tiles').innerHTML=
  tile('<span style="color:var(--ok)">●</span> '+(d.online_tunnels??0),'在线隧道','心跳 <'+(d.online_window_min||45)+'min')+
  tile(d.paid_users??0,'付款用户','累计订单 '+(d.orders_paid??0))+
  tile(money(d.revenue_today_cents,d.currency),'今日收入','UTC 今日')+
  tile(money(d.revenue_cents_total,d.currency),'累计收入')+
  tile(d.users_total??0,'用户总数','待付款 '+(d.users_pending??0))+
  tile(d.active_bindings??0,'活跃绑定','宽限 '+(d.grace_bindings??0))+
  tile(d.codes_unused??0,'未使用码')+
  tile(d.emails_queued??0,'邮件排队');
 const evs=(d.stripe_events_recent||[]);
 document.getElementById('stripe-evs').innerHTML=evs.length?('<div style="font-size:12px;color:var(--muted);margin-top:4px">最近在线收款（Stripe webhook）</div>'
  +'<table><tbody>'+evs.map(e=>'<tr><td class="mono">'+tsFmt(e.created_at)+'</td><td class="mono">'+esc(e.email||'—')+'</td>'
  +'<td>'+money(e.amount_cents,d.currency)+'</td><td class="mono" style="font-size:12px">'+esc(e.type||'')+'</td></tr>').join('')+'</tbody></table>'):'';
 document.getElementById('stats-updated').textContent='更新 '+new Date().toLocaleTimeString('zh-CN')}
let statsTimer=null,statsOn=true;
function startStats(){stopStats();if(statsOn)statsTimer=setInterval(loadStats,10e3)}
function stopStats(){if(statsTimer){clearInterval(statsTimer);statsTimer=null}}
document.getElementById('stats-toggle').onclick=function(){statsOn=!statsOn;this.textContent=statsOn?'暂停刷新':'恢复刷新';
 if(statsOn){loadStats();startStats()}else stopStats()};
async function loadUsers(){const{ok,d}=await j('/admin/users');if(!ok){document.getElementById('u-body').innerHTML='<tr><td colspan=4 class="msg err">加载失败</td></tr>';return}
 document.getElementById('u-body').innerHTML=(d||[]).map(u=>'<tr><td class="mono">'+esc(u.email)+'</td>'
 +'<td>'+badge(u.status)+'</td><td>'+tsFmt(u.created_at)+'</td>'
 +'<td class="row" style="gap:6px"><button class="mini ghost" data-act="pay" data-em="'+esc(u.email)+'">确认收款</button>'
 +'<button class="mini ghost" data-act="trial" data-em="'+esc(u.email)+'">试用码</button></td></tr>').join('')
 ||'<tr><td colspan=4 style="color:var(--muted)">暂无用户</td></tr>'}
async function loadBindings(){const{ok,d}=await j('/admin/bindings');if(!ok){document.getElementById('b-body').innerHTML='<tr><td colspan=7 class="msg err">加载失败</td></tr>';return}
 document.getElementById('b-body').innerHTML=(d||[]).map(b=>'<tr><td class="mono">'+esc(b.subdomain)+'</td>'
 +'<td class="mono">'+esc(b.email||'—')+'</td><td class="mono">'+esc(b.machine_code)+'</td>'
 +'<td class="mono">'+esc(b.service_addr||'—')+'</td><td>'+badge(b.status)+'</td><td>'+tsFmt(b.last_heartbeat)+'</td>'
 +'<td>'+(b.status==='active'||b.status==='grace'?'<button class="mini ghost" data-act="revoke" data-id="'+esc(b.id)+'">吊销</button>':'')+'</td></tr>').join('')
 ||'<tr><td colspan=7 style="color:var(--muted)">暂无绑定</td></tr>'}
async function loadEmails(){const{ok,d}=await j('/admin/emails?limit=20');if(!ok)return;
 document.getElementById('e-count').textContent='（排队中 '+(d.queued||[]).length+' 封）';
 document.getElementById('e-body').innerHTML=((d.recent)||[]).map(e=>'<tr><td class="mono">'+esc(e.to_email)+'</td>'
 +'<td>'+esc(e.subject||'')+'</td><td>'+badge(e.status)+'</td><td>'+tsFmt(e.created_at)+'</td></tr>').join('')
 ||'<tr><td colspan=4 style="color:var(--muted)">暂无邮件</td></tr>'}
document.body.addEventListener('click',async ev=>{const b=ev.target.closest('button[data-act]');if(!b)return;
 const act=b.dataset.act,em=b.dataset.em,id=b.dataset.id;
 if(act==='pay'){const method=prompt('收款渠道：alipay / wechat / bank','alipay');if(!method)return;
  const ref=prompt('收款备注/转账单号（可留空）','')||'';
  const{ok,d}=await j('/admin/order-paid',{email:em,method,ref});
  if(ok&&!d.error){alert('收款已确认 ✓ 认证码已签发并发邮件：\\n\\n'+d.code);loadUsers();loadStats()}
  else alert('失败：'+(d.error||ok));}
 if(act==='trial'){const{ok,d}=await j('/admin/issue-code',{email:em});
  if(ok&&!d.error){alert('试用码已签发（含邮件）：\\n\\n'+d.code);loadStats()}else alert('失败：'+(d.error||ok));}
 if(act==='revoke'){if(!confirm('吊销该绑定？对应隧道将立即失效。'))return;
  const{ok,d}=await j('/admin/revoke',{id});if(ok){loadBindings();loadStats()}else alert('失败：'+(d.error||ok));}});
Promise.all([loadStats(),startStats(),loadUsers(),loadBindings(),loadEmails()]);
</script>`);
}
