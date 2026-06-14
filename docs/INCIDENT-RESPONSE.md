# Incident Response Plan — Techniline Operations (Amazon SP-API integration)

_Owner: Vihan (primary contact). Last reviewed: 2026-06-14. Review cadence: every 6 months._

## Scope
Covers any suspected or actual security incident affecting the Techniline
Operations app or the data it accesses via Amazon's Selling Partner API
(non-PII vendor finance / returns / purchase-order data), including credential
exposure (LWA client secret, refresh token), unauthorised access, or data loss.

## Roles
- **Incident Lead — Vihan (primary contact):** declares an incident, coordinates
  response, decides on credential rotation, and notifies Amazon.
- **Technical responder:** the developer maintaining the app; performs rotation,
  access review and remediation.
- **Backup:** a designated manager covers the Incident Lead when unavailable.

## Detection
- Application and platform (Vercel / Supabase) error and access logs are
  monitored; access tokens are never logged.
- Any report of suspected exposure (e.g. a leaked secret, unexpected API usage)
  is treated as an incident until ruled out.

## Response steps
1. **Contain** — immediately rotate the affected credential: regenerate the LWA
   client secret and/or the SP-API refresh token, and update the Vercel
   environment variables. Revoke the app authorisation if compromise is suspected.
2. **Assess** — review logs to determine what data/period was affected and
   whether any data left our systems.
3. **Eradicate & recover** — remove the cause (e.g. fix the leak, tighten
   access), confirm the integration is operating on new credentials.
4. **Notify** — report qualifying security incidents to **security@amazon.com
   within 24 hours** of discovery, with scope and remediation taken.
5. **Record** — log the incident, timeline, impact and actions in an internal
   record.

## Post-incident
- Conduct a review, capture lessons learned, and update controls/this plan.
- The plan is reviewed at least every **6 months** and after any incident.

## Controls (standing)
- Credentials stored only as encrypted server-side environment variables.
- Role-based, least-privilege access; database row-level security.
- TLS/HTTPS in transit; data encrypted at rest (managed PostgreSQL).
- No PII roles requested; only non-PII vendor data processed.
