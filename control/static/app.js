/* mobile ai — 本地控制台前端（app.js）· 零依赖 vanilla JS · MIT © ricky8848 */
'use strict';

const $ = (id) => document.getElementById(id);

/* ---------------- markdown-lite 渲染器（仅覆盖 GUIDE.md 用到的语法） -------- */
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '', i = 0, inCode = false, codeBuf = [], listType = null;
  const closeList = () => { if (listType) { html += '</' + listType + '>'; listType = null; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {                      // 代码围栏开关
      closeList();
      if (!inCode) { inCode = true; codeBuf = []; }
      else { html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'; inCode = false; }
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {   // 标题
      closeList(); const lvl = m[1].length;
      html += '<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>'; i++; continue;
    }
    if (/^\s*---+\s*$/.test(line)) { closeList(); html += '<hr>'; i++; continue; }
    if (/^\s*>/.test(line)) {                     // 引用（GUIDE 开头的说明行）
      closeList(); html += '<p style="color:var(--muted);font-size:14px">' + inline(line.replace(/^\s*>\s?/, '')) + '</p>'; i++; continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeList();                                 // 表格：表头行 + |---| 分隔行
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      html += '<table><tr>' + cells(line).map((c) => '<th>' + c + '</th>').join('') + '</tr>';
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        html += '<tr>' + cells(lines[i]).map((c) => '<td>' + c + '</td>').join('') + '</tr>'; i++;
      }
      html += '</table>'; continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {    // 无序列表
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += '<li>' + inline(m[1]) + '</li>'; i++; continue;
    }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {   // 有序列表
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += '<li>' + inline(m[1]) + '</li>'; i++; continue;
    }
    if (line.trim() === '') { closeList(); i++; continue; }
    closeList(); html += '<p>' + inline(line) + '</p>'; i++;   // 普通段落
  }
  if (inCode) html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
  closeList();
  return html;
}

/* ---------------- 状态轮询与展示 ------------------------------------------- */
let lastStatus = null;

function fmtTime(ts) { return ts ? new Date(ts).toLocaleString() : '———'; }

function paint(s) {
  const dot = $('status-dot'), text = $('status-text');
  dot.className = 'dot';
  if (s.revoked) {
    text.textContent = '已吊销 · 隧道已停止（换机/管理操作）'; dot.classList.add('err');
  } else if (s.activated && s.tunnelUp) {
    text.textContent = '在线'; dot.classList.add('ok');
  } else if (s.activated) {
    text.textContent = '隧道离线 · 自动重连中'; dot.classList.add('warn');
  } else {
    text.textContent = '未激活 · 请在「设置」填写认证码'; dot.classList.add('warn');
  }
  $('tunnel-url').textContent = s.url || 'https://———.newapi.email';
  $('machine-code').textContent = s.machineCode || '———';
  $('tunnel-state').textContent = !s.activated ? '未启动' : (s.tunnelUp ? '运行中' : '已停止');
  $('last-heartbeat').textContent = fmtTime(s.lastHeartbeat);
  $('svc-addr-ro').textContent = s.serviceAddr || '127.0.0.1:3080';
  const btn = $('start-btn');
  if (s.activated && !s.revoked) { btn.disabled = true; btn.textContent = '已激活'; }
  else if (s.revoked) { btn.disabled = true; btn.textContent = '已吊销 · 联系支持'; }
}

async function refresh() {
  try {
    const r = await fetch('/api/status');
    lastStatus = await r.json();
    paint(lastStatus);
  } catch {
    $('status-dot').className = 'dot err';
    $('status-text').textContent = '控制台未连接（daemon 异常？）';
  }
}

/* ---------------- tab 切换 --------------------------------------------------- */
let guideLoaded = false;
async function loadGuide() {
  if (guideLoaded) return; guideLoaded = true;
  const box = $('tab-guide');
  try {
    const r = await fetch('/guide.md');
    box.innerHTML = renderMarkdown(await r.text());
  } catch {
    box.innerHTML = '<p>指引加载失败：guide.md 缺失（安装包不完整，请重新运行安装命令）。</p>';
  }
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    for (const id of ['setup', 'status', 'guide']) {
      const sec = $('tab-' + id);
      if (id === t.dataset.tab) { sec.hidden = false; } else { sec.hidden = true; }
    }
    if (t.dataset.tab === 'guide') loadGuide();
  });
});

/* ---------------- 启动表单 ---------------------------------------------------- */
function formMsg(text, ok) {
  const el = $('form-msg');
  el.textContent = text;
  el.style.color = ok ? 'var(--ok)' : 'var(--err)';
}

$('start-btn').addEventListener('click', async () => {
  const btn = $('start-btn');
  const serviceAddr = $('svc-addr').value.trim();
  const code = $('auth-code').value.trim();
  formMsg('');
  if (!code) { formMsg('请填写认证码', false); return; }
  btn.disabled = true; btn.textContent = '启动中…（首次需下载 cloudflared，约 1–3 分钟）';
  try {
    const r = await fetch('/api/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceAddr, code }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
    formMsg('隧道已启动：' + d.url + (d.autoStart && d.autoStart !== 'ok' ? '\n开机自启：' + d.autoStart : ''), true);
    $('auth-code').value = '';
  } catch (e) {
    formMsg('启动失败：' + (e.message || e), false);
  } finally {
    btn.disabled = false; btn.textContent = '启动隧道';
    refresh();
  }
});

/* ---------------- URL 复制 / 轮换 -------------------------------------------- */
$('copy-url').addEventListener('click', async () => {
  const url = lastStatus && lastStatus.url;
  if (!url) return;
  try { await navigator.clipboard.writeText(url); formMsg('已复制', true); setTimeout(() => formMsg(''), 2000); }
  catch { window.prompt('手动复制：', url); }
});

$('rotate-url').addEventListener('click', async () => {
  if (!(lastStatus && lastStatus.url)) return;
  if (!confirm('轮换后旧 URL 立即失效，手机需重新打开新地址。确定继续？')) return;
  try {
    const r = await fetch('/api/rotate', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
    formMsg('已轮换：' + d.url, true);
  } catch (e) { formMsg('轮换失败：' + (e.message || e), false); }
  refresh();
});

/* ---------------- boot -------------------------------------------------------- */
refresh();
setInterval(refresh, 5000);
