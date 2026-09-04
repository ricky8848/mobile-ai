#!/usr/bin/env node
/**
 * mobile ai — 移动AI · local client (single file, zero dependencies, Node >= 18)
 * MIT License — Copyright (c) 2026 ricky8848
 *
 * What this does (and nothing else):
 *   1. Downloads the official cloudflared binary (pinned version + SHA-256 verified)
 *   2. Serves a local console on 127.0.0.1 (setup / status / guide)
 *   3. Activates your tunnel against the mobile ai control plane (auth code + machine code)
 *   4. Runs cloudflared, registers auto-start (launchd / systemd user / schtasks)
 *   5. Heartbeats with machine-code verification (offline-tolerant, revoked => stop)
 *
 * It never touches your tunneled traffic. Audit me: https://github.com/ricky8848/mobile-ai
 */
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream'; // fetch 返回 Web stream，Node 侧写盘需 fromWeb
import path from 'node:path';

const VERSION = '0.1.0';
const HOME_DIR = path.join(os.homedir(), '.mobileai');
const BIN_DIR = path.join(HOME_DIR, 'bin');
const STATE_FILE = path.join(HOME_DIR, 'state.json');
const CF_LOG = path.join(HOME_DIR, 'cloudflared.log');
const PORT_BASE = 5380;

/* ---------------- pinned cloudflared (official GitHub release) ------------- */
const CLOUDFLARED = {
  version: '2026.8.2',
  base: 'https://github.com/cloudflare/cloudflared/releases/download/2026.8.2',
  files: {
    'darwin-arm64':   { file: 'cloudflared-darwin-arm64.tgz',  tarball: true,
      sha256: 'b61054d3d6326ea558cb49826eebf5676e0d0a36d51b546975096ca3e0e3c89d' },
    'darwin-amd64':   { file: 'cloudflared-darwin-amd64.tgz',  tarball: true,
      sha256: 'b0f770e1e0b281399a57219b840fd8eef1cc25387a404124248157ea2073727a' },
    'linux-amd64':    { file: 'cloudflared-linux-amd64',
      sha256: 'fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2' },
    'linux-arm64':    { file: 'cloudflared-linux-arm64',
      sha256: '7747d94570fb390cf47dcb4f9555c193c6355cda9793f0d878d9049e5d6a7790' },
    'win32-amd64':    { file: 'cloudflared-windows-amd64.exe',
      sha256: 'c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5' },
  },
};

function cfKey() { return process.platform + '-' + (os.arch() === 'x64' ? 'amd64' : os.arch()); }
function ensureDirs() { fs.mkdirSync(BIN_DIR, { recursive: true }); }
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function writeState(s) { s.updatedAt = Date.now(); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 }); }

/* ---------------- machine code (practical fingerprint) -------------------- */
function rawFingerprint() {
  try {
    if (process.platform === 'darwin')
      return execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
    if (process.platform === 'win32')
      return execFileSync('reg', ['query', 'HKLM\SOFTWARE\Microsoft\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return '';
  } catch { return ''; }
}
function getMachineCode() {
  let id = '', degraded = false;
  const raw = rawFingerprint();
  if (process.platform === 'darwin') {
    const m = raw.match(/"IOPlatformUUID"s*=s*"([0-9A-Fa-f-]{20,})"/);
    if (m) id = m[1];
  } else if (process.platform === 'win32') {
    const m = raw.match(/MachineGuids+REG_SZs+(S+)/i);
    if (m) id = m[1];
  } else {
    for (const f of ['/sys/class/dmi/id/product_uuid', '/etc/machine-id']) {
      try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) { id = v; break; } } catch {}
    }
  }
  if (!id) { id = os.hostname() + '|' + (os.userInfo().username || 'user'); degraded = true; }
  const h = crypto.createHash('sha256').update('mobileai|' + process.platform + '|' + id).digest('hex');
  return { code: 'MAI-' + h.slice(0, 5).toUpperCase() + '-' + h.slice(5, 10).toUpperCase(), degraded };
}

/* ---------------- cloudflared lifecycle ------------------------------------ */
function cfBinaryPath() {
  return path.join(BIN_DIR, 'cloudflared-' + CLOUDFLARED.version, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}
function cfReady() { return fs.existsSync(cfBinaryPath()) && readState().cfVersion === CLOUDFLARED.version; }
async function downloadCloudflared() {
  const key = cfKey();
  const spec = CLOUDFLARED.files[key];
  if (!spec) throw new Error('unsupported platform: ' + key);
  const dir = path.join(BIN_DIR, 'cloudflared-' + CLOUDFLARED.version);
  fs.mkdirSync(dir, { recursive: true });
  const url = CLOUDFLARED.base + '/' + spec.file;
  console.log('[mobile ai] downloading cloudflared ' + CLOUDFLARED.version + ' (' + key + ') ...');
  const dest = path.join(dir, spec.file);
  await new Promise((res, rej) => {
    const out = fs.createWriteStream(dest);
    fetch(url).then(r => { if (!r.ok) rej(new Error('download failed HTTP ' + r.status)); else Readable.fromWeb(r.body).pipe(out); }).catch(rej);
    out.on('finish', () => res()); out.on('error', rej);
  });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  if (sha !== spec.sha256) { fs.rmSync(dest, { force: true }); throw new Error('SHA-256 mismatch — download aborted (possible tampering)'); }
  console.log('[mobile ai] cloudflared SHA-256 verified ✓');
  const bin = path.join(dir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (spec.tarball) { execFileSync('tar', ['xzf', dest, '-C', dir]); fs.rmSync(dest, { force: true }); }
  else if (path.basename(dest) !== path.basename(bin)) fs.renameSync(dest, bin);
  fs.chmodSync(bin, 0o755);
  const s = readState(); s.cfVersion = CLOUDFLARED.version; writeState(s);
}
function spawnCloudflared() {
  const s = readState(); if (!s.tunnelToken) return;
  const logFd = fs.openSync(CF_LOG, 'a');
  const child = spawn(cfBinaryPath(), ['tunnel', '--token', s.tunnelToken, 'run'],
    { detached: true, stdio: ['ignore', logFd, logFd], cwd: HOME_DIR });
  child.unref();
  const st = readState(); st.cfPid = child.pid; writeState(st);
}
function cfAlive() { const s = readState(); if (!s.cfPid) return false; try { process.kill(s.cfPid, 0); return true; } catch { return false; } }
function stopCloudflared() { try { process.kill(readState().cfPid, 'SIGTERM'); } catch {} const s = readState(); delete s.cfPid; writeState(s); }

/* ---------------- control plane client ------------------------------------- */
function apiBase() { return process.env.MOBILEAI_API || readState().apiBase || 'https://dsh.newapi.email'; }
async function apiCall(ep, body) {
  const r = await fetch(apiBase() + ep, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let d = {}; try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d.error || d.message || ('control plane error HTTP ' + r.status));
  return d;
}

/* ---------------- auto-start (launchd / systemd user / schtasks) ------------ */
function registerAutoStart() {
  const me = path.resolve(process.argv[1]);
  const nodeBin = process.execPath;
  if (process.platform === 'darwin') {
    const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    fs.mkdirSync(plistDir, { recursive: true });
    const plist = path.join(plistDir, 'com.mobileai.tunnel.plist');
    fs.writeFileSync(plist, [
      '<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      '  <key>Label</key><string>com.mobileai.tunnel</string>',
      '  <key>ProgramArguments</key><array><string>' + nodeBin + '</string><string>' + me + '</string><string>--daemon</string></array>',
      '  <key>RunAtLoad</key><true/>', '<key>KeepAlive</key><true/>',
      '  <key>StandardOutPath</key><string>' + path.join(HOME_DIR, 'daemon.out.log') + '</string>',
      '  <key>StandardErrorPath</key><string>' + path.join(HOME_DIR, 'daemon.err.log') + '</string>',
      '</dict></plist>'].join('\n'));
    try { execFileSync('launchctl', ['bootout', 'gui/' + process.getuid(), plist], { stdio: 'ignore' }); } catch {}
    try { execFileSync('launchctl', ['bootstrap', 'gui/' + process.getuid(), plist], { stdio: 'ignore' }); } catch {}
  } else if (process.platform === 'linux') {
    const udir = path.join(os.homedir(), '.config', 'systemd', 'user');
    fs.mkdirSync(udir, { recursive: true });
    const unit = path.join(udir, 'mobile-ai.service');
    fs.writeFileSync(unit, [
      '[Unit]', 'Description=mobile ai tunnel (移动AI)', 'After=default.target', '',
      '[Service]', 'ExecStart=' + nodeBin + ' "' + me + '" --daemon', 'Restart=always', 'RestartSec=5', '',
      '[Install]', 'WantedBy=default.target'].join('\n'));
    try { execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' }); } catch {}
    try { execFileSync('systemctl', ['--user', 'enable', '--now', 'mobile-ai.service'], { stdio: 'ignore' }); } catch {}
  } else if (process.platform === 'win32') {
    const cmd = '"' + nodeBin + '" "' + me + '" --daemon';
    try { execFileSync('schtasks', ['/create', '/f', '/tn', 'mobile ai tunnel', '/tr', cmd, '/sc', 'onlogon'], { stdio: 'ignore' }); } catch {}
  }
}

/* ---------------- local console server -------------------------------------- */
function findFreePort(start) {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); });
    srv.on('error', rej);
  });
}
function statusPayload() {
  const s = readState(); const mc = getMachineCode();
  return { version: VERSION, platform: process.platform + '-' + os.arch(),
    activated: !!s.url && !s.revoked, revoked: !!s.revoked, url: s.url || null,
    machineCode: mc.code, serviceAddr: s.serviceAddr || '127.0.0.1:3080',
    tunnelUp: cfAlive(), lastHeartbeat: s.lastHeartbeat || null, apiBase: apiBase() };
}
function json(res, code, obj) { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'content-type': 'application/json' }); res.end(b); }
async function handleApi(req, res, url) {
  const s = readState();
  if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, statusPayload());
  if (req.method === 'POST' && url.pathname === '/api/start') {
    let body = ''; req.on('data', c => (body += c)); await new Promise(r2 => req.on('end', r2));
    let form = {}; try { form = JSON.parse(body || '{}'); } catch {}
    const serviceAddr = String(form.serviceAddr || '127.0.0.1:3080').trim();
    const code = String(form.code || '').trim().toUpperCase();
    if (!code) return json(res, 400, { error: '请填写认证码' });
    if (!/^[0-9A-Za-z.:]+$/.test(serviceAddr)) return json(res, 400, { error: '本机服务地址格式不正确（host:port）' });
    if (!cfReady()) await downloadCloudflared();
    const d = await apiCall('/api/activate', { code, machineCode: getMachineCode().code, serviceAddr });
    const st = readState();
    st.tunnelToken = d.tunnelToken; st.url = d.url; st.serviceAddr = serviceAddr;
    delete st.revoked; writeState(st);
    if (!process.env.MOBILEAI_NO_SPAWN) spawnCloudflared();
    let autoStart = 'ok'; try { registerAutoStart(); } catch (e) { autoStart = String(e.message || e); }
    return json(res, 200, { ok: true, url: d.url, autoStart });
  }
  if (req.method === 'POST' && url.pathname === '/api/stop') { stopCloudflared(); return json(res, 200, { ok: true }); }
  if (req.method === 'POST' && url.pathname === '/api/restart') { stopCloudflared(); if (!process.env.MOBILEAI_NO_SPAWN) spawnCloudflared(); return json(res, 200, { ok: true }); }
  if (req.method === 'POST' && url.pathname === '/api/rotate') {
    const d = await apiCall('/api/rotate', { machineCode: getMachineCode().code, url: s.url });
    const st = readState(); st.url = d.url; writeState(st); stopCloudflared(); if (!process.env.MOBILEAI_NO_SPAWN) spawnCloudflared();
    return json(res, 200, { ok: true, url: d.url });
  }
  return json(res, 404, { error: 'not found' });
}

/* ---------------- UI (embedded; black & white design system) --------------- */
const UI_CSS = `
/* mobile ai — design system (black & white) */
:root {
  --bg:#ffffff; --fg:#1d1d1f; --muted:#86868b; --card-bg:#ffffff;
  --border:rgba(0,0,0,.1); --btn-bg:#1d1d1f; --btn-fg:#ffffff;
  --ok:#34c759; --warn:#ff9f0a; --err:#ff3b30;
  --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;
  --mono:"SF Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#000; --fg:#f5f5f7; --muted:#86868b; --card-bg:#161617;
    --border:rgba(255,255,255,.14); --btn-bg:#f5f5f7; --btn-fg:#000; }
}
* { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--bg); color:var(--fg); font-family:var(--font); -webkit-font-smoothing:antialiased; line-height:1.5; }
.wrap { max-width:680px; margin:0 auto; padding:48px 24px 96px; }
header { display:flex; align-items:center; justify-content:space-between; margin-bottom:56px; }
.wordmark { font-size:21px; font-weight:600; letter-spacing:-.02em; }
.wordmark span { color:var(--muted); font-weight:400; }
h1 { font-size:32px; font-weight:700; letter-spacing:-.02em; margin-bottom:8px; }
.sub { color:var(--muted); font-size:17px; margin-bottom:32px; }
.card { background:var(--card-bg); border:1px solid var(--border); border-radius:18px; padding:28px; margin-bottom:20px; }
.status-row { display:flex; align-items:center; gap:12px; }
.dot { width:10px; height:10px; border-radius:50%; background:var(--muted); flex:none; }
.dot.ok { background:var(--ok); } .dot.warn { background:var(--warn); animation:pulse 1.2s ease-in-out infinite; } .dot.err { background:var(--err); }
@keyframes pulse { 50% { opacity:.35; } }
.url-box { font-family:var(--mono); font-size:14px; word-break:break-all; margin-top:16px; }
.tabs { display:flex; gap:4px; border-bottom:1px solid var(--border); margin-bottom:28px; }
.tab { padding:10px 16px; font-size:15px; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tab.active { color:var(--fg); border-bottom-color:var(--fg); font-weight:600; }
label { display:block; font-size:14px; color:var(--muted); margin-bottom:6px; }
input[type=text] { width:100%; padding:13px 16px; font-size:17px; font-family:var(--mono); border:1px solid var(--border); border-radius:12px; background:transparent; color:var(--fg); }
input[type=text]:focus { outline:2px solid var(--fg); border-color:transparent; }
.field { margin-bottom:20px; }
.btn { display:inline-block; padding:13px 28px; border-radius:980px; background:var(--btn-bg); color:var(--btn-fg); font-size:17px; font-weight:500; border:none; cursor:pointer; transition:opacity .2s ease, transform .05s ease; }
.btn:hover { opacity:.85; } .btn:active { transform:scale(.98); }
.btn.ghost { background:transparent; color:var(--fg); border:1px solid var(--border); }
.btn.small { padding:8px 16px; font-size:14px; }
.btn:disabled { opacity:.5; cursor:default; }
.form-msg { margin-top:14px; font-size:15px; min-height:20px; }
.kv { display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--border); font-size:15px; }
.kv:last-child { border-bottom:none; } .kv .k { color:var(--muted); } .kv .v { font-family:var(--mono); font-size:14px; word-break:break-all; text-align:right; }
footer { margin-top:64px; text-align:center; color:var(--muted); font-size:13px; }
.guide h2 { font-size:20px; margin:36px 0 12px; } .guide h2:first-child { margin-top:0; }
.guide p, .guide li { font-size:16px; } .guide ul { padding-left:20px; margin:8px 0; }
.guide code { font-family:var(--mono); font-size:14px; background:rgba(128,128,128,.12); padding:2px 6px; border-radius:6px; }
.guide pre { background:rgba(128,128,128,.08); border-radius:12px; padding:14px 16px; overflow-x:auto; margin:10px 0; }
.guide pre code { background:none; padding:0; font-size:13px; }
.guide table { width:100%; border-collapse:collapse; font-size:14px; margin:12px 0; display:block; overflow-x:auto; }
.guide th, .guide td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); }
.guide hr { border:none; border-top:1px solid var(--border); margin:32px 0; }
`;

const UI_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mobile ai · 本地控制台</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="wrap">
  <header>
    <div class="wordmark">mobile ai <span>· 本地控制台</span></div>
    <div class="dot" id="status-dot"></div>
  </header>

  <section class="card">
    <div class="status-row"><span id="status-text" style="font-size:17px;font-weight:600">连接中…</span></div>
    <div class="url-box" id="tunnel-url">———</div>
    <p style="margin-top:14px"><button class="btn small ghost" id="copy-url">复制 URL</button>
    <button class="btn small ghost" id="rotate-url">轮换 URL（泄露时用）</button></p>
  </section>

  <nav class="tabs">
    <div class="tab active" data-tab="setup">设置</div>
    <div class="tab" data-tab="status">状态</div>
    <div class="tab" data-tab="guide">使用指引</div>
  </nav>

  <section id="tab-setup">
    <h1>连接你的电脑</h1>
    <p class="sub">填写两项，启动隧道。手机打开你的专属 URL 即可使用。</p>
    <div class="card">
      <div class="field"><label for="svc-addr">本机服务地址</label>
        <input type="text" id="svc-addr" value="127.0.0.1:3080"></div>
      <div class="field"><label for="auth-code">认证码</label>
        <input type="text" id="auth-code" placeholder="购买后在邮件 / 门户获取"></div>
      <button class="btn" id="start-btn">启动隧道</button>
      <div class="form-msg" id="form-msg"></div>
    </div>
  </section>

  <section id="tab-status" hidden>
    <h1>设备与隧道</h1>
    <p class="sub">机器码是客服凭证，请妥善保管。</p>
    <div class="card">
      <div class="kv"><span class="k">机器码</span><span class="v" id="machine-code">———</span></div>
      <div class="kv"><span class="k">隧道状态</span><span class="v" id="tunnel-state">———</span></div>
      <div class="kv"><span class="k">最近心跳</span><span class="v" id="last-heartbeat">———</span></div>
      <div class="kv"><span class="k">本机服务</span><span class="v" id="svc-addr-ro">127.0.0.1:3080</span></div>
    </div>
  </section>

  <section id="tab-guide" class="guide" hidden><h2>指引加载中…</h2></section>

  <footer>mobile ai v0.1 · 移动AI · MIT © ricky8848</footer>
</div>
<script src="/app.js" defer></script>
</body>
</html>`;

/* ---------------- console server + daemon ---------------------------------- */
import { fileURLToPath } from 'node:url';
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const GUIDE_PATH = path.join(SELF_DIR, 'guide.md');
const APP_JS_PATH = path.join(SELF_DIR, 'app.js');
const sleep = ms => new Promise(r2 => setTimeout(r2, ms));

async function pickPort() {
  for (let p = PORT_BASE; p < PORT_BASE + 20; p++) {
    const free = await new Promise(res => {
      const t = createServer();
      let done = false;
      const finish = v => { if (!done) { done = true; try { t.close(); } catch {} res(v); } };
      t.once('error', () => finish(false));
      t.listen(p, '127.0.0.1', () => finish(true));
      setTimeout(() => finish(false), 500);
    });
    if (free) return p;
  }
  throw new Error('no free port in ' + PORT_BASE + '-' + (PORT_BASE + 19));
}

async function startConsole() {
  const port = await pickPort();
  const srv = createServer(async (req, res) => {
    let url; try { url = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); return res.end('bad request'); }
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      if (url.pathname === '/' ) { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return res.end(UI_HTML); }
      if (url.pathname === '/styles.css') { res.writeHead(200, {'content-type':'text/css; charset=utf-8'}); return res.end(UI_CSS); }
      if (url.pathname === '/app.js') { try { res.writeHead(200, {'content-type':'application/javascript; charset=utf-8'}); return res.end(fs.readFileSync(APP_JS_PATH)); } catch { res.writeHead(500, {'content-type':'text/plain'}); return res.end('app.js missing from package dir'); } }
      if (url.pathname === '/guide.md') { try { res.writeHead(200, {'content-type':'text/markdown; charset=utf-8'}); return res.end(fs.readFileSync(GUIDE_PATH)); } catch { res.writeHead(404, {'content-type':'text/plain'}); return res.end('guide.md missing from package dir'); } }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); return res.end('not found');
    } catch (e) { try { json(res, 500, { error: String(e.message || e) }); } catch {} console.error('[mobile ai] api error:', e); }
  });
  await new Promise(r3 => srv.listen(port, '127.0.0.1', r3));
  const s = readState(); s.port = port; writeState(s);
  console.log('[mobile ai] local console: http://127.0.0.1:' + port + '/');
}

async function heartbeatLoop() {
  for (;;) {
    await sleep(30 * 60 * 1000);
    try {
      const s = readState(); if (!s.url) continue;
      const d = await apiCall('/api/heartbeat', { machineCode: getMachineCode().code, url: s.url });
      const st = readState();
      if (d.revoked) { stopCloudflared(); st.revoked = true; writeState(st); console.error('[mobile ai] tunnel revoked by control plane — stopped.'); }
      else { st.lastHeartbeat = Date.now(); writeState(st); if (!cfAlive() && !process.env.MOBILEAI_NO_SPAWN) spawnCloudflared(); }
    } catch (e) { console.error('[mobile ai] heartbeat failed:', e.message || e); }
  }
}

async function runDaemon() {
  ensureDirs();
  const s = readState();
  if (s.url && !cfAlive() && !process.env.MOBILEAI_NO_SPAWN) {
    if (!cfReady()) await downloadCloudflared().catch(e => console.error('[mobile ai] cloudflared prepare failed:', e.message || e));
    if (cfReady()) spawnCloudflared();
  }
  await startConsole();
  heartbeatLoop(); // never resolves (daemon lifetime)
}

function openBrowser(u) {
  try {
    if (process.platform === 'darwin') spawn('open', [u], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', u], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [u], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

async function serverAlive(port) {
  try { const c = new AbortController(); setTimeout(() => c.abort(), 1500); await fetch('http://127.0.0.1:' + port + '/api/status', { signal: c.signal }); return true; }
  catch { return false; }
}

async function main() {
  ensureDirs();
  if (process.argv.includes('--daemon')) { await runDaemon(); return; } // never exits
  const s = readState();
  if (s.port && await serverAlive(s.port)) {
    console.log('[mobile ai] local console already running: http://127.0.0.1:' + s.port + '/');
    openBrowser('http://127.0.0.1:' + s.port + '/'); return;
  }
  const me = path.resolve(process.argv[1]);
  const logFd = fs.openSync(path.join(HOME_DIR, 'daemon.out.log'), 'a');
  const d = spawn(process.execPath, [me, '--daemon'], { detached: true, stdio: ['ignore', logFd, logFd] });
  d.unref();
  let port = null;
  for (let i = 0; i < 40 && !port; i++) { await sleep(500); const st = readState(); if (st.port && await serverAlive(st.port)) port = st.port; }
  if (!port) { console.error('[mobile ai] local console failed to start — see ' + path.join(HOME_DIR, 'daemon.out.log')); process.exit(1); }
  console.log('[mobile ai] local console: http://127.0.0.1:' + port + '/ (browser opened)');
  openBrowser('http://127.0.0.1:' + port + '/');
}

main().catch(e => { console.error('[mobile ai] fatal:', e); process.exit(1); });
