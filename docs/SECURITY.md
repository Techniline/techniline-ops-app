# Security controls — Techniline Operations

Reference for the SP-API Solution Provider security questionnaire and our own
hygiene. Describes the *actual* controls; update it as practices change.

## Architecture
- Next.js app on **Vercel** (serverless); data in **Supabase** (managed
  PostgreSQL on AWS). No self-managed servers.
- Secrets (SP-API client id/secret/refresh tokens, Supabase service key) live
  only as **server-side Vercel environment variables** — never in source, never
  shipped to the browser.

## Data protection
- **In transit:** TLS/HTTPS everywhere (enforced by Vercel + Supabase).
- **At rest:** Supabase encrypts at rest (AES-256) with provider-managed keys.
- **PII minimisation:** order/return records are stored without buyer name,
  address, phone, or payment data.
- **Access control:** Supabase Auth + row-level security + role/capability
  gating; access is least-privilege / need-to-know.

## Network
- Network protection (firewalls, DDoS, isolation) is provided by the managed
  platforms (Vercel / Supabase / AWS). Databases are not publicly exposed;
  access is via authenticated API only.

## Change management & testing
- See [CHANGE-MANAGEMENT.md](CHANGE-MANAGEMENT.md). Changes are built on a branch,
  scanned in CI, deployed to a **Vercel preview** for verification, then promoted
  to production. Production deploys are deliberate (`vercel deploy --prod`).

## Vulnerability management
- **Dependencies:** Dependabot + `npm audit` in CI on every push (`.github/`).
- **Code:** CodeQL static analysis in CI on every push/PR.
- **Remediation SLA:** critical within 7 days, high within 30 days.
- **Penetration testing:** _not yet performed_ — to be commissioned if/when a
  restricted-PII role (e.g. Direct to Consumer Shipping) is pursued.

## Logging, monitoring & audit
- Application actions on sensitive records are recorded in an append-only audit
  trail (`amazon_action_log`); Vercel and Supabase provide platform request/auth
  logs. Logs are reviewed on a defined cadence (see below).
- **Review cadence:** access/audit logs reviewed at least bi-weekly by the owner.

## Credentials
- No credentials in public repos, no hard-coding, no sharing. Rotated if exposure
  is suspected. (See repo `.gitignore` for excluded credential artefacts.)

## Incident response
- See [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md): defined owner/roles, reviews,
  and notification of Amazon (security@amazon.com) within 24 hours of a confirmed
  incident affecting Amazon Information.

## Known gaps (be honest on attestations)
- No enforced password **expiration/rotation** policy (Supabase Auth has no native
  expiry); MFA + min-length/complexity are the enforced controls.
- No formal annual **penetration test** yet.
- Audit-log **review cadence** is a manual commitment, not automated.
