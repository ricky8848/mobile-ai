#!/usr/bin/env node
// mobile ai（移动AI）· edge.mjs — dsh.newapi.email 统一入口反向代理（2026-09-05 修订架构）。
//
// cloudflared ingress: dsh.newapi.email → http://127.0.0.1:6430（本服务，仅回环）
//   /mai、/mai/*  → mobile ai 门户/控制面 :6420（剥掉 /mai 前缀；
//                   magic link、i.sh/mobileai.mjs、/admin 管理台都从这里进）
//   其余所有路径   → DSH Web GUI :3080（根路径保持原样，CF Access 登录墙不变）
//
// 为什么需要它：一个 hostname 的 cloudflared ingress 只能指一个 service，
// 「主域名 newapi.email 还给 New API 网关 + dsh.newapi.email 承载全部服务」
// 只能在本地做路径分流。纯 node http，无依赖；SSE/流式响应直接 pipe（不缓冲），
// WebSocket upgrade 透传。
//
//   node edge.mjs          # http://127.0.0.1:6430
//   EDGE_PORT=xxxx node edge.mjs

import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.env.EDGE_PORT) || 6430;
const MAI_HOST = '127.0.0.1', MAI_PORT = Number(process.env.MAI_API_PORT) || 6420; // mobile ai 门户
const DSH_HOST = '127.0.0.1', DSH_PORT = Number(process.env.DSH_GUI_PORT) || 3080; // DSH Web GUI
const PREFIX = '/mai';

function target(reqUrl) {
  if (reqUrl.pathname === PREFIX || reqUrl.pathname.startsWith(PREFIX + '/')) {
    return { host: MAI_HOST, port: MAI_PORT, path: reqUrl.pathname.slice(PREFIX.length) || '/' + (reqUrl.search || '') };
  }
  return { host: DSH_HOST, port: DSH_PORT, path: reqUrl.pathname + (reqUrl.search || '') };
}

// 逐跳头（hop-by-hop）不透传；Node http 客户端已解 chunked，响应 pipe 时自动重编码
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade']);

function filterHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) if (!HOP.has(k.toLowerCase())) out[k] = v;
  return out;
}

function proxy(req, res) {
  let u; try { u = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); return res.end('bad request'); }
  const t = target(u);
  const headers = filterHeaders(req.headers);
  delete headers.host;
  headers.host = `${t.host}:${t.port}`;
  if (!headers['x-forwarded-for']) headers['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
  const up = http.request({ host: t.host, port: t.port, path: t.path, method: req.method, headers }, (pr) => {
    res.writeHead(pr.statusCode || 502, filterHeaders(pr.headers));
    pr.pipe(res); // SSE/流式：不缓冲，边收边发
  });
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `upstream ${t.host}:${t.port} 不可达`, detail: String(e.message || e) }));
  });
  req.pipe(up);
}

const server = http.createServer(proxy);

// WebSocket upgrade 透传（DSH GUI / 门户若用 WS 也能穿过来）
server.on('upgrade', (req, socket, head) => {
  let u; try { u = new URL(req.url, 'http://127.0.0.1'); } catch { socket.destroy(); return; }
  const t = target(u);
  const reqLines = [`${req.method} ${t.path} HTTP/${req.httpVersion}`,
    ...Object.entries(req.headers).filter(([k]) => !HOP.has(k.toLowerCase())).map(([k, v]) => `${k}: ${v}`), '', ''];
  const up = net.connect(t.port, t.host);
  up.on('connect', () => { up.write(reqLines.join('\r\n')); if (head && head.length) up.write(head); });
  const fail = () => { try { socket.destroy(); } catch {} };
  up.on('error', fail); socket.on('error', () => { try { up.destroy(); } catch {} });
  socket.pipe(up); up.pipe(socket); // 双向透传
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[edge] http://127.0.0.1:${PORT}  ${PREFIX}* → ${MAI_HOST}:${MAI_PORT}(mobile ai)   * → ${DSH_HOST}:${DSH_PORT}(DSH GUI)`);
});
