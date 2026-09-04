#!/usr/bin/env node
// mobile ai（移动AI）· 生产本地控制面 server.mjs — P8「免费先」部署形态。
//
// 与 CF Workers（src/index.js）跑**同一份 Worker 代码**：Node 24 + 内置 SQLite
// （node:sqlite，D1 兼容垫片），零路由重复。数据持久化到 SQLite（schema.sql）。
// cloudflared 命名隧道把 mai.newapi.email → http://127.0.0.1:6420 暴露到公网。
//
//   node server.mjs        # http://127.0.0.1:6420
//   MAI_DB=/path/db PORT=xxxx node server.mjs
//
// env 优先级：process.env > ~/.mobileai/control.env（KEY=VALUE / export KEY=V；# 注释）。
//   PORT            监听端口（缺省 6420）
//   MAI_HOME        数据目录（env 文件位置；缺省 ~/.mobileai）
//   MAI_DB          SQLite 文件路径（缺省 ~/.mobileai/control.db）
//   DOMAIN          newapi.email（用户隧道子域根；勿改，除非换域名）
//   PORTAL_BASE     门户公网地址（缺省 https://mai.newapi.email；magic link / Stripe 回跳用）
//   ADMIN_TOKEN     管理端令牌（缺省 dev-admin-token → 启动时告警，生产必须替换）
//   CF_API_TOKEN / CF_ACCOUNT_ID   用户隧道创建用（cf.js；未配时 activate 会报错）
//   PAYMENT_* / STRIPE_*           见 wrangler.jsonc vars/secrets 注释
//   PORTAL_BASE 未配 Stripe 前，/me 只显示二维码备用渠道（设计行为）。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/* ---------------- env file（~/.mobileai/control.env）---------------- */
// MAI_HOME 可覆盖数据目录（测试/沙箱用；缺省 ~/.mobileai）
const HOME_DIR = process.env.MAI_HOME || path.join(os.homedir(), '.mobileai');
fs.mkdirSync(HOME_DIR, { recursive: true });

function parseEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v; // 空值也算配置（显式清空）
  }
  return out;
}

const ENV_FILE = process.env.MAI_ENV_FILE || path.join(HOME_DIR, 'control.env');
const fileEnv = parseEnvFile(ENV_FILE);
// process.env 优先（12-factor）；文件是基线。DB/PORTAL_BASE/DOMAIN 给缺省值。
const env = { ...fileEnv, ...process.env };
env.DB_PATH = process.env.MAI_DB || fileEnv.MAI_DB || path.join(HOME_DIR, 'control.db');
env.DOMAIN = process.env.DOMAIN || fileEnv.DOMAIN || 'newapi.email';
env.PORTAL_BASE = process.env.PORTAL_BASE || fileEnv.PORTAL_BASE || 'https://mai.newapi.email';
const PORT = Number(process.env.PORT || fileEnv.PORT) || 6420;

/* ---------------- SQLite（D1 兼容垫片：prepare().bind() → first/all/run）---------------- */
fs.mkdirSync(path.dirname(env.DB_PATH), { recursive: true });
const sqlite = new DatabaseSync(env.DB_PATH);
sqlite.exec('PRAGMA journal_mode=WAL;');
const schemaPath = new URL('./schema.sql', import.meta.url);
sqlite.exec(fs.readFileSync(schemaPath, 'utf8')); // CREATE TABLE IF NOT EXISTS，幂等

function d1Shim() {
  return {
    prepare(sql) {
      const st = sqlite.prepare(sql);
      let args = [];
      const q = {
        bind(...a) { args = a; return q; },
        async first() { const r = st.get(...args); return r ?? null; }, // D1: row | null
        async all() { return { results: st.all(...args) }; },           // D1: {results}
        async run() { const r = st.run(...args); return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }; },
      };
      return q;
    },
  };
}

/* ---------------- Worker 桥接：HTTP ↔ Request/Response（Node ≥18 Web API）---------------- */
const worker = (await import('./src/index.js')).default;

function envForWorker() {
  return { ...env, DB: d1Shim() }; // env.DB 每次请求新建垫片（prepare 无状态，可复用）
}

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks); // Stripe webhook 需原始 body（验签）
    const url = new URL(req.url, 'http://127.0.0.1');
    const init = { method: req.method, headers: req.headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = raw;
    const resp = await worker.fetch(new Request(url.toString(), init), envForWorker());

    // 响应头：set-cookie 可能多条，用 getSetCookie()；其余合并
    const h = {};
    resp.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
    const sc = resp.headers.getSetCookie();
    if (sc.length) h['set-cookie'] = sc;
    res.writeHead(resp.status, h);
    const buf = Buffer.from(await resp.arrayBuffer());
    res.end(buf.length ? buf : undefined);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mobile ai control plane] http://127.0.0.1:${PORT}  db=${env.DB_PATH}`);
  console.log(`[mobile ai control plane] portal=${env.PORTAL_BASE} domain=${env.DOMAIN}`);
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) console.warn('[mobile ai control plane] ⚠ CF_API_TOKEN/CF_ACCOUNT_ID 未配置 — /api/activate（用户隧道）会失败，其余功能正常');
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN === 'dev-admin-token') console.warn('[mobile ai control plane] ⚠ ADMIN_TOKEN 使用默认 dev-admin-token — 公网部署前必须替换（control.env）');
});

const shutdown = (sig) => { console.log(`[mobile ai control plane] ${sig} — shutting down`);
  server.close(() => { try { sqlite.close(); } catch {} process.exit(0); });
  setTimeout(() => process.exit(1), 3000).unref(); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
