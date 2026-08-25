// mobile ai（移动AI）· Cloudflare REST 适配器（命名隧道 + DNS CNAME）。
// 仅 Worker 侧使用；本地 mock（mock-server.mjs）用假实现替代，不碰 CF。
// 需要 env：CF_API_TOKEN（cfd_tunnel + DNS 权限）、CF_ACCOUNT_ID、DOMAIN。

const BASE = 'https://api.cloudflare.com/client/v4';

export function makeCf(env) {
  let zoneId = null; // newapi.email 的 zone id，首次调用时解析并缓存

  async function api(method, path, body) {
    const r = await fetch(BASE + path, {
      method,
      headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.success) throw new Error((j.errors || [])[0]?.message || 'CF API error: HTTP ' + r.status);
    return j;
  }

  async function getZoneId() {
    if (!zoneId) zoneId = (await api('GET', '/zones?name=' + encodeURIComponent(env.DOMAIN))).result[0].id;
    return zoneId;
  }

  const ingress = (hostname, service) => [{ hostname, service }, { service: 'http_status:404' }];

  return {
    // 建命名隧道并写入首条 ingress（hostname → http://serviceAddr）
    async createTunnel({ name, hostname, service }) {
      const j = await api('POST', `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel`,
        { name, config: { ingress: ingress(hostname, service) } });
      return { tunnelId: j.result.id };
    },

    // 为该隧道签发 cloudflared token（客户端 `tunnel --token <t> run`）
    async issueToken(tunnelId) {
      const j = await api('POST', `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel/${tunnelId}/tokens`);
      return j.result.token;
    },

    // 轮换：ingress 指向新子域（service 保持不变）
    async updateIngress(tunnelId, hostname) {
      const cur = await api('GET', `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel/${tunnelId}`);
      const service = cur.result.config.ingress[0].service;
      await api('PUT', `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel/${tunnelId}`,
        { config: { ingress: ingress(hostname, service) } });
    },

    // 子域 CNAME → <tunnel-id>.cfargotunnel.com
    async createCname({ sub, tunnelId }) {
      const z = await getZoneId();
      await api('POST', `/zones/${z}/dns_records`, {
        type: 'CNAME', name: sub + '.' + env.DOMAIN, content: tunnelId + '.cfargotunnel.com', ttl: 120,
      });
    },

    async deleteCname(sub) {
      const z = await getZoneId();
      const j = await api('GET', `/zones/${z}/dns_records?type=CNAME&name=${encodeURIComponent(sub + '.' + env.DOMAIN)}`);
      for (const rec of j.result || []) await api('DELETE', `/zones/${z}/dns_records/${rec.id}`);
    },
  };
}
