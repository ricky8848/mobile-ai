# Security Policy

## Reporting a Vulnerability

Please report security issues privately to **ricky8848@outlook.com** (subject: "[mobile ai] security").
Do **not** open a public issue for vulnerabilities.

Response target: acknowledgement within 48h, patch plan within 7 days (best effort).

## Threat Model Summary

- **Control plane** (newapi.email): orders, auth codes, device bindings. Protected by Cloudflare edge + scoped API tokens (server-side only).
- **Data plane**: user device <-> Cloudflare edge. mobile ai control plane never sees business traffic.
- **Client** (client/): open source by design - audit it before running. It only talks to newapi.email APIs and runs cloudflared (official binary, pinned version + SHA-256 verified).

## Known Boundaries (by design)

- The access URL is the credential. Treat it like a password; rotate immediately if leaked (one-click in local console / portal).
- What you expose is your responsibility. We provide the channel and identity management, not content moderation of tunneled services.
- Machine-code binding is practical-grade (deterrent + heartbeat revocation), not DRM. Hardware changes may require a manual rebind via support.
