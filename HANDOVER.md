# Techniline Ops v2 — Project Handover

_Last updated 2026-06-08. Repo: `Techniline/techniline-ops-app` · Stack: Next.js 16.2.7 (App Router, Turbopack) + Supabase + Vercel (Hobby)._

> **How to use this in a new chat:** open a Claude Code session in this repo and say
> _"Read HANDOVER.md and continue."_ Start at §12 (Outstanding / Next Steps).

---

## 1. Current Production Status

| Item | State |
|---|---|
| Live URL | https://techniline-ops-app.vercel.app — serving |
| Production commit | **`a2f3cc2`** ("Add KPI dashboard") — current with `origin/main`; deployed via Vercel CLI. |
| `origin/main` | **`a2f3cc2`** — in sync. |
| Live routes | `/login` · `/dashboard` (+ KPI strip) · `/checklist` · `/cocoblu` (+ PDF capture) · `/amazon-actions` · `/api/amazon-email-ingest` · `/api/amazon-ingest-poll` (401 w/o secret) · `/api/cocoblu/parse` (401 w/o auth) |
| Amazon ingestion | **LIVE & writing.** Daily Vercel cron `0 9 * * *` (48h lookback). 14-day 2026 backfill complete (237 Amazon emails, 0 errors). |
| Cocoblu PDF capture | **LIVE.** Free built-in parser by default; auto-upgrades to AI if `ANTHROPIC_API_KEY` set. |

**Bottom line:** The app and both automated/assisted data flows (Amazon email ingestion + Cocoblu invoice capture) are live in production.

### Deploying
- **Use the Vercel CLI** (authenticated on the owner's machine as `techniline-electronics-projects`): `npx vercel deploy --prod --yes` from the repo root. This is the reliable path and what every recent deploy used.
- A **deploy hook** also exists: `curl -X POST https://api.vercel.com/v1/integrations/deploy/prj_j29htaAWakkCLqipKv0MCOOyNOAl/yTT0ytsWze`.
- **Do NOT use the dashboard "Redeploy"** — it reuses the *old* deployment's env snapshot and won't pick up changed env vars (this caused a long debugging detour). A fresh `vercel deploy --prod` (or git push, if auto-deploy is working) is required after any env change.
- See `memory/vercel-ops.md` for the full deploy/env playbook.

---

## 2. Modules (all live)

| Module | Route | Access | Notes |
|---|---|---|---|
| Dashboard | `/dashboard` | all | Module cards + **KPI strip** scoped to the user's modules (checklist/cocoblu/amazon). |
| Checklist | `/checklist` | `checklist` cap | Daily tasks from `daily_tasks`/`task_definitions` (RPC `generate_daily_tasks`). |
| Cocoblu | `/cocoblu` | `cocoblu` cap | Ageing table + Add/Update Qty + **PDF invoice capture** + **Invoices browser** + manager **Edit**. |
| Amazon Actions | `/amazon-actions` | `finance` cap | Operational closure queue (see §4). **Cancellations** tab + inline detail rows. |
| Historical finance | `/remittances` `/returns` `/disputes` | `finance` cap | Guarded but **removed from nav** — do not re-promote. |

Users: **Maricel** (`227fdb27-…`, checklist+finance) · **Aaron** (`cbb81b27-…`, checklist+cocoblu) · **Vihan** (`c4abda49-…`, all + manager). Permissions are id+capability based (`src/lib/permissions/`), `role==='manager'` for cross-user override. **No email-based checks.**

---

## 3. Database Changes (all owner-run SQL; never auto-migrated)

Schema source of truth = generated `src/lib/database.types.ts` (does **not** yet include the columns added this cycle — see "regenerate" in §12).

| Change | Status |
|---|---|
| `amazon_action_log` table + enrichment columns | ✅ Created. Append-only audit of operational actions. |
| `ingest_log` table (email dedup for poller) | ✅ Created (message_id PK, mailbox, received_at, email_type, processed_at). RLS on; service-role writes. |
| `cocoblu_ageing` audit columns: `source`, `pdf_url`, `verified_by`(→users), `verified_at` | ✅ Created. Read from the base table (the ageing view doesn't carry them). |
| Storage bucket `cocoblu-invoices` (private) + authenticated insert/select policies | ✅ Created. Holds invoice PDFs; app reads via signed URLs. |

No pre-existing tables/enums/RPCs/RLS were modified.

---

## 4. Amazon Actions Architecture

Operational queue to drive Amazon issues to closure (recover money) — not reporting.

- **Spine:** `expected_actions` (inbound feed) is the source; resolution recorded in append-only **`amazon_action_log`**. Code ignores the stored `match_status`/`approval_status`.
- **Lib:** `src/lib/amazon-actions/` — `mapping.ts`, `sla.ts`, `validation.ts`, `duplicate.ts`, `queries.ts` (`fetchAmazonActions`, `logAction`, `searchAll`), `summary.ts` (`computeActionSummary`, `missingDocumentationQueue`).
- **Page:** `/amazon-actions` — Missing-Documentation queue, Advanced Search (read-only `search_all` RPC), category filter tabs (incl. **Cancellations**, split from PO at the UI layer via `rawType`), **click-to-expand inline detail rows** (enrichment, staff remarks, dispute status, cross-links to related PO/dispute/return records, "Add missing details"→log modal).
- **Write path (`logAction`):** validate closure → insert `amazon_action_log` → set `expected_actions.status='actioned'` (existing enum). Fail-safe.
- **Categories → `expected_actions.type`:** return→return_processed, shortage→shortage_claim, PO→vendor_po/po_cancellation, dispute→dispute_update, remittance→remittance.
- **SLA:** 0–3 green · 4–7 amber · 8–14 red · 15+ escalated.

---

## 5. Amazon Email Ingestion (LIVE)

Two server-side pieces (Node runtime, service-role writes, fail-closed) under `src/lib/amazon-ingest/` + `src/app/api/`:

1. **Receiver — `POST /api/amazon-email-ingest`.** `{messageId,from,subject,receivedAt,bodyText,dryRun}` → classify + plan upserts. Gated by `x-ingest-secret == AMAZON_INGEST_SECRET`. Dry-run by default. For Power Automate / manual forwarding.
2. **Graph Poller — `GET/POST /api/amazon-ingest-poll`.** The backbone, now live:
   - `graph.ts` (client-credentials token; `fetchMessages` headers-only + `fetchBody` for Amazon matches only), `poll.ts` (`runPoll`), `ingestLog.ts` (bulk `alreadyProcessed` + batch `recordProcessedMessages`).
   - Polls `vihan@` + `purchasing@`, filters Amazon, parses, dedups (message-id + cross-mailbox), upserts idempotently. **Self-healing.**
   - **Auth:** Vercel Cron (`Authorization: Bearer CRON_SECRET`) → live writes; manual (`x-ingest-secret`) → dry-run unless `?mode=live`.
   - **Cron:** `vercel.json` → `0 9 * * *` (daily — Hobby cap; the original `*/30` is Pro-only). Restore `*/30` on Pro, or use an external scheduler hitting the endpoint with `CRON_SECRET`.
   - **Performance:** optimized so a wide 14-day window completes in ~12s (header-only fetch + parallel bodies + bulk dedup). Fetch cap `INGEST_FETCH_CAP` (default 1000/mailbox).

---

## 6. Parser Status (Amazon ingestion)

`src/lib/amazon-ingest/` — pure functions, **validated against real Amazon email** (2026-06-07 dry-runs).

- `detectType`, `parseDispute`, `parseShortage`, `parsePO`, `parseReturn`, `parseRemittance`, `htmlToText` — ✅ live.
- Classification gaps found in the first real-email dry-run were fixed (`21f817b`, `b72dcc5`) and re-validated: real Amazon.ae PO ids (8-char alphanumeric) captured; delivery-appointment mail excluded; dispute requires a `DSPT` id; returns require a return id/PRT/SRT; remittance tightened; PO-cancellation ordered before dispute. Details: [PARSER-GAP-REPORT.md](PARSER-GAP-REPORT.md).
- Still heuristic — re-check periodically against new email phrasings.

---

## 7. Cocoblu PDF Invoice Capture (LIVE)

Flow: `/cocoblu` → **Upload Invoice (PDF)** → `POST /api/cocoblu/parse` (auth via Supabase JWT) extracts text with **unpdf** and captures header + line items → editable **Verify** modal → **Verify & Save** writes one `cocoblu_ageing` row per line, uploads the PDF to storage, and records `source`/`pdf_url`/`verified_by`/`verified_at`.

- **Capture engine:** free built-in parser (`src/lib/cocoblu/basicParse.ts`) **by default — no key, no cost**. If `ANTHROPIC_API_KEY` is set, auto-upgrades to **AI extraction (Claude Sonnet 4.6, structured output)** in `parseInvoice.ts` (~3¢/invoice) — no code change. The Verify modal labels which engine ran.
- **Verify step** is the safety net: every field is editable before saving (line items as labeled cards), so heuristic misses are corrected by a human. Validated on the sample invoice (`WS/2502628`): header + 11/11 line items.
- **Invoices browser:** the "Invoices" button lists every stored PDF (View/Download via signed URLs); each saved row also has a 📎 link.
- **Permissions:** upload/verify/save = `cocoblu` cap (Aaron, Vihan); **Edit saved records = managers**.
- **Setup:** see [COCOBLU-INVOICE-SETUP.md](COCOBLU-INVOICE-SETUP.md) (storage bucket + audit columns done; `ANTHROPIC_API_KEY` optional).

---

## 8. UI / Shell

- **Collapsible sidebar** on desktop (icon rail via chevron) + **off-canvas drawer on mobile** (hamburger in a sticky top bar, backdrop). `AppShell.tsx` (client) + `Sidebar.tsx`.
- **Dashboard KPI strip** (`/dashboard`): per-module metric tiles, each module loaded independently (`Promise.allSettled`), shown only for capabilities the user holds.
- Shared `Modal` / cocoblu `ModalShell` support a `wide` layout; premium spacing, gradients, transitions.
- New dependencies: `@anthropic-ai/sdk`, `unpdf`.

---

## 9. Environment Variables

| Variable | Scope | Set? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | ✅ | Browser Supabase client |
| `AMAZON_INGEST_SECRET` | Prod+Preview | ✅ | `x-ingest-secret` gate (held securely) |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | Prod+Preview | ✅ | Graph app "Techniline Ops Amazon Ingest" (Mail.Read application, admin-consented). **Rotate `AZURE_CLIENT_SECRET` before its Expires date** or the poller silently stops fetching. |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod | ✅ | Server-only DB writes (ingestion). Never expose client-side. |
| `CRON_SECRET` | Prod | ✅ | Arms the daily Vercel cron (held securely). |
| `ANTHROPIC_API_KEY` | Prod+Preview | ❌ optional | Enables AI invoice capture (Sonnet 4.6). Without it, Cocoblu uses the free parser. |
| `INGEST_MAILBOXES` / `INGEST_LOOKBACK_HOURS` / `INGEST_FETCH_CAP` | Prod | optional | Defaults: `vihan@,purchasing@` / `48` / `1000`. |

All secrets are marked **Sensitive** in Vercel → **write-only** (not readable via UI or `vercel env pull`). To fix one, `vercel env rm NAME production` then `echo "value" | vercel env add NAME production` (the trailing newline is trimmed; a `printf '%s'` pipe without a newline does **not** save) → then `vercel deploy --prod`.

---

## 10. Known Issues / Watch-outs

1. **Parser is heuristic** (both Amazon ingestion and Cocoblu basic capture) — re-validate against new real samples periodically. Cocoblu's Verify step mitigates this.
2. **Auto-deploy-on-git-push** historically flaky — the CLI/deploy-hook is the dependable path (§1). If you want push-to-deploy, redeliver the GitHub webhook / reconnect Git (owner OAuth).
3. **Cron cadence is daily** (Hobby). Fine for steady mail; move to Pro (`*/30`) or an external scheduler for near-real-time.
4. **`database.types.ts` is stale** for the new columns (`ingest_log`, `cocoblu_ageing` audit). Code compensates with local types / casts; regenerate to clean up.
5. CRLF warnings on commit (cosmetic).

---

## 11. Things Explicitly NOT to Change

- **Supabase schema** — no table/column/enum/RLS changes without explicit approval; always "provide SQL, owner runs it". Never auto-migrate.
- **Existing CHECK constraints / enums** (`expected_actions.status`, `disputes.dispute_status`, `purchase_orders.outcome`, `amazon_action_log.action_type`, `daily_tasks.status/source`) — map onto allowed values; don't widen without approval. (This is why Cocoblu "Cancellations" is a UI-layer split, not a new DB category.)
- **Backend automation populating `expected_actions`** — the ingester upserts PO/dispute/etc. rows deduped on `ref_number`; verify no duplication vs the feed (see §12).
- **`SUPABASE_SERVICE_ROLE_KEY`** — server-only; never import client-side; never log secrets.
- **Historical finance pages** — kept with guards, off-nav; do not re-promote. Operational surface is `/amazon-actions`.
- **Dry-run / fail-closed defaults** on ingest + parse endpoints.
- **Permissions** — id/capability + `role==='manager'`; no email-based checks.

---

## 12. Outstanding / Next Steps

**Owner data tasks (Claude can't reach the DB — Supabase mgmt token returns 401; provide SQL, owner runs):**
1. **Data-accuracy check on the ingestion go-live:** run the verification SQL in [GO-LIVE.md](GO-LIVE.md) — especially the **duplicate `ref_number`** query (must return zero) — to confirm the ingester didn't duplicate backend-fed rows.
2. **Remove Aaron's duplicate checklist** definition (diagnostic + fix SQL in [GO-LIVE.md](GO-LIVE.md)).
3. **Monitor the first daily cron runs** (`ingest_log`, `expected_actions`); optionally add a least-privilege Exchange Application Access Policy for the two mailboxes.

**Optional / when needed:**
4. **AI invoice capture:** add `ANTHROPIC_API_KEY` in Vercel → Cocoblu upgrades from free parser to Sonnet 4.6 automatically.
5. **Tune the Cocoblu parser** when real (non-sample) invoices arrive — `basicParse.ts` (free) and the prompt in `parseInvoice.ts` (AI) are both easy to adjust.
6. **Regenerate `src/lib/database.types.ts`** now that `ingest_log` + `cocoblu_ageing` audit columns exist, then drop the local mini-types/casts.
7. **Rotate `AZURE_CLIENT_SECRET`** before it expires.
8. Move ingestion cron to `*/30` if upgrading to Vercel Pro.

**Deferred:** Manager Overview dashboard (recovery reporting), broader KPI history/trends.
