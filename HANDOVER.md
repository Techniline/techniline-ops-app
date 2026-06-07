# Techniline Ops v2 — Project Handover

_Last updated 2026-06-07. Repo: `Techniline/techniline-ops-app` · Stack: Next.js 16.2.7 (App Router, Turbopack) + Supabase + Vercel._

> **How to use this in a new chat:** open a Claude Code session in this repo and say
> _"Read HANDOVER.md and continue."_ Start at §12 (Next Recommended Steps).

---

## 1. Current Production Status

| Item | State |
|---|---|
| Live URL | https://techniline-ops-app.vercel.app — 200, serving |
| Live build commit | **`249d9c0`** ("Use Hobby-compatible daily cron") — deployed 2026-06-07 via Deploy Hook, now current with `origin/main`. |
| `origin/main` (GitHub) | **`249d9c0`** (HANDOVER commit `7495be1` + cron fix `249d9c0`, both pushed) |
| **Gap** | **None** — Production == `origin/main`. (Was behind because the `*/30` cron in `vercel.json` failed every Hobby-plan deploy; see §10 Bug #1.) |
| Live routes | `/login` 200 · `/dashboard` `/checklist` `/cocoblu` `/amazon-actions` live · `/api/amazon-email-ingest` live (405 on GET) · **`/api/amazon-ingest-poll` → 401 (LIVE, deployed 2026-06-07)** |
| **Active blocker** | Dry-run reaches Graph but fails: **`AZURE_CLIENT_SECRET` in Vercel holds the secret *ID*, not the secret *VALUE*** (AADSTS7000215). Owner must set the value + redeploy. See §10 Bug #5. |

**Bottom line:** app is live and working; the **email ingestion poller is committed but not yet deployed/promoted**.

---

## 2. Deployed / Committed Commits (oldest → newest)

`✅` = in current Production build · `⏳` = pushed to `main` but NOT in Production yet.

```
✅ 733d82c Initial Next.js scaffold
✅ 131ba78 Add Supabase auth and permissions foundation
✅ a0590bf Add login and protected shell
✅ 296c575 Fix permission helper signatures
✅ c63bceb Fix default user scoping column
✅ 53f573c Stop tracking Claude local settings
✅ 11e3906 Add generated Supabase types as schema source of truth
✅ 0ded9b9 Ignore Supabase CLI local artifacts
✅ 5e312c1 Add Checklist data layer
✅ ed4418b Add checklist page
✅ 88ff828 Align checklist completion status
✅ aa90305 Add Cocoblu data layer
✅ 9691fb5 Add Cocoblu page
✅ 21f468b Redesign UI with consistent design system
✅ 8778501 Restore checklist proof logging
✅ 876c18f Add remittances module
✅ 9ecbd35 Add returns module
✅ 8d18c08 Add disputes module
✅ ff43627 Add finance accuracy layer
✅ 0250598 Limit finance accuracy to 2025 and 2026 scope
✅ 872a333 Add Amazon Actions data layer
✅ 5b1d7cd Add Amazon Actions UI: missing-doc queue, actions list, action modal
✅ e53c94c Tune Amazon action workflow statuses
✅ 3b31770 Hide historical finance navigation
✅ ed7e1ac Auto-close confirmed PO actions
✅ ddee99e Add Amazon Actions enrichment, advanced search, and category tabs
✅ 4e122a3 Refine Amazon action status labels
✅ 3694006 Add Amazon email ingestion endpoint (dry-run + service-role upsert)
✅ cb353a7 Fix dispute approved amount parsing
✅ 0219750 Fix PO zero-count parser          ← current Production
⏳ c875f14 Normalize HTML email bodies in ingest parser
⏳ 801df32 Add Microsoft Graph mailbox poller for Amazon ingestion
⏳ 9cd5726 chore: trigger production redeploy (Graph poller)   ← origin/main HEAD
```

---

## 3. Database Changes Completed

Schema source of truth = generated `src/lib/database.types.ts`. All pre-existing tables/RPCs were built by the backend team.

| Change | Status |
|---|---|
| **`amazon_action_log`** table (operational action audit log) | ✅ Created (owner ran SQL). Cols: id, expected_action_id, action_type, outcome, reference_type/value, reason_note, workflow_status, amount_aed, recovered_aed, follow_up_date, duplicate_warning, confidence, created_by, created_at. RLS: own-or-manager read, own insert (append-only). |
| **`amazon_action_log` enrichment columns** | ✅ Created. tle_invoice_number, payment_number, return_id, srt_number, prt_number, invoice_date, invoice_value_aed, sku, approved_amount_aed, notes |
| **`ingest_log`** table (email dedup for poller) | ⏳ NOT created — SQL in §8, owner to run |

No existing tables, enums, RPCs, or RLS policies were modified.

---

## 4. Amazon Actions Architecture

Operational queue to drive Amazon issues to closure (recover money) — not reporting.

- **Spine:** `expected_actions` (inbound feed, ~384 rows, all 2026, assigned to Maricel) is the source. Resolution recorded in **`amazon_action_log`** (append-only). Code ignores the constant stored `match_status`/`approval_status`.
- **Lib:** `src/lib/amazon-actions/` — `mapping.ts` (categories, outcomes, closure rules, `operationalStatusLabel`), `sla.ts`, `validation.ts`, `duplicate.ts`, `queries.ts` (`fetchAmazonActions`, `logAction`, `searchAll`), `summary.ts`.
- **Page:** `/amazon-actions` (gated `canViewFinance` → Maricel + Vihan; Aaron blocked). Missing-Documentation queue (escalated → breached/red → oldest-first), Advanced Search (read-only `search_all` RPC), category tabs, action list, action modal (outcome → dynamic required fields + enrichment + duplicate warning + confidence).
- **Write path (`logAction`):** validate closure → insert `amazon_action_log` → set `expected_actions.status='actioned'` (existing enum). Fail-safe.
- **Categories → `expected_actions.type`:** return→return_processed, shortage→shortage_claim, PO→vendor_po/po_cancellation, dispute→dispute_update, remittance→remittance.
- **Statuses (derived over `workflow_status` + latest outcome):**
  - Dispute: Open / Pending Amazon / Approved / Rejected / Reopened / Closed / Partial Credit
  - Returns: Open / Pending SRT / Pending PRT / Pending Amazon / Dispute Raised / Accepted / Invalid / Closed
  - SLA: 0–3 green · 4–7 amber · 8–14 red · 15+ escalated

---

## 5. Email Ingestion Architecture

Two server-side pieces (Node runtime, service-role writes, fail-closed):

1. **Receiver — `POST /api/amazon-email-ingest`** (`3694006`, live). `{messageId,from,subject,receivedAt,bodyText,dryRun}` → classify + plan upserts. Gated by `x-ingest-secret == AMAZON_INGEST_SECRET`. Defaults to dry-run; writes only on explicit `dryRun:false`. For Power Automate / manual forwarding.
2. **Graph Poller — `GET/POST /api/amazon-ingest-poll`** (`801df32`, ⏳ not deployed). Reliable backbone:
   - `graph.ts` (client-credentials token + `fetchMessages`), `poll.ts` (`runPoll`), `ingestLog.ts` (message-id dedup via `ingest_log`).
   - Polls `vihan@` + `purchasing@`, filters Amazon, parses, dedups, upserts idempotently. **Self-healing** (overlapping lookback + message-id dedup → missed runs catch up).
   - Auth: Vercel Cron (`Authorization: Bearer CRON_SECRET`) → live; manual (`x-ingest-secret`) → dry-run unless `?mode=live`.
   - `vercel.json` cron `*/30 * * * *` (needs Vercel Pro; Hobby = daily → use external scheduler otherwise).
   - Topology: PO/dispute/shortage/return → purchasing@ + vihan@; **remittances forwarded from finance@/umesh@ → vihan@**.

Decision: Graph poller > Power Automate for stability (app identity, checkpoint+idempotency = no lost emails, version-controlled).

---

## 6. Parser Status

`src/lib/amazon-ingest/` — pure functions, validated in dry-run only.

- `detectType`, `parseDispute` (incl. two-amount approved fix `cb353a7`), `parseShortage`, `parsePO` (incl. zero-count fix `0219750`), `parseReturn`, `parseRemittance` — ✅.
- `htmlToText` HTML→text normalization (`c875f14`) — ✅ committed, ⏳ not in Production. Required for real (HTML) forwarded emails.
- Dedup keys: dispute_number, po_number, return_id, remittance_ref, expected_actions.ref_number, + message-id.
- ⚠️ Regexes are **heuristic**, only validated against synthetic samples. **Not validated against real Amazon emails yet** (the planned parser-gap report was superseded by the ingestion build).

---

## 7. Dry-Run Status

- Receiver: all local dry-run cases pass (dispute approved incl. 2-amount, shortage pending, PO zero-count, safety default), zero writes. ✅
- Poller: **never run** (route 404 in prod; blocked on deploy). ❌
- Real-email validation: not done. ❌
- No `dryRun:false` ever used. No production DB writes have occurred.

---

## 8. Pending Tasks

1. **Promote latest `main` (`9cd5726`) to Production.** Deploy Hook fired (job `HI7Ni5GHbc1DkqIo1TyW`); awaiting promotion. *Immediate blocker.*
2. **Run `ingest_log` SQL** in Supabase:
   ```sql
   create table if not exists public.ingest_log (
     message_id   text primary key,
     mailbox      text,
     received_at  timestamptz,
     email_type   text,
     processed_at timestamptz not null default now()
   );
   alter table public.ingest_log enable row level security;
   ```
3. **Dry-run the poller** (manual, `x-ingest-secret`, `?lookbackHours=336`) → confirm it reads real Amazon emails, zero writes. Capture as the real-email parser-gap report.
4. **Refine parser regexes** against real misses (dry-run only).
5. **Go-live (Phase 2):** set `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` → cron writes.
6. **Fix Vercel auto-deploy** (see §10).
7. Regenerate `database.types.ts` after `ingest_log` exists (poller currently uses a local mini-type for it).

---

## 9. Environment Variables Required

| Variable | Scope | Set in Vercel? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All | ✅ | Browser Supabase client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | ✅ | Browser Supabase client |
| `AMAZON_INGEST_SECRET` | Prod+Preview | ✅ | `x-ingest-secret` gate (value held securely) |
| `AZURE_TENANT_ID` | Prod+Preview | ✅ | `7d357fbb-17fa-43eb-a5d8-1a88736f7806` |
| `AZURE_CLIENT_ID` | Prod+Preview | ✅ | `6dc96d87-9427-4615-b810-9e90dca1ab3d` |
| `AZURE_CLIENT_SECRET` | Prod+Preview | ✅ | Graph app secret (Vercel only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod | ❌ not set (intentional) | Enables DB writes — set at go-live only |
| `CRON_SECRET` | Prod | ❌ not set (intentional) | Cron auth — set at go-live only (generated, held securely) |
| `INGEST_MAILBOXES` | Prod | optional | default `vihan@techniline.org,purchasing@techniline.org` |
| `INGEST_LOOKBACK_HOURS` | Prod | optional | default `48` |

`SUPABASE_SERVICE_ROLE_KEY` is server-only — never expose to the browser.
Azure app: "Techniline Ops Amazon Ingest", single-tenant, **Mail.Read (Application) admin-consented**, client secret created.
Two generated secrets (`AMAZON_INGEST_SECRET`, `CRON_SECRET`) are held outside this doc.

---

## 10. Outstanding Bugs

1. **✅ RESOLVED — was misdiagnosed as "webhook not firing."** Real cause: `vercel.json` had a `*/30 * * * *` cron, which the **Vercel Hobby plan rejects** (cron capped at once/day), so **every deploy after `801df32` failed the build** and Production froze at `0219750` (the last pre-cron commit). Fixed in `249d9c0` by switching to a daily cron (`0 9 * * *`); Deploy Hook then landed cleanly (route → 401). *Still verify whether auto-deploy-on-push works now that builds are valid; if not, the GitHub↔Vercel webhook may genuinely need a redeliver/reconnect (owner OAuth). Deploy Hook `prj_j29htaAWakkCLqipKv0MCOOyNOAl/yTT0ytsWze` remains the manual lever.*
2. **~~Production lag~~** — resolved by the `249d9c0` deploy (poller live, HTML normalization now in Production).
3. **Parser unverified against real emails** (coverage risk, not a code bug yet) — still true; blocked on Bug #5.
4. CRLF warnings on commit (cosmetic).
5. **🔴 `AZURE_CLIENT_SECRET` wrong value in Vercel.** Dry-run (2026-06-07) authenticated and reached Graph, then failed with **AADSTS7000215: "Invalid client secret provided… send the secret VALUE, not the secret ID."** The Vercel env var holds the secret's **ID** (or a stale/expired value), not the **VALUE**. Fix (owner): Azure Portal → App registrations → "Techniline Ops Amazon Ingest" (`6dc96d87-9427-4615-b810-9e90dca1ab3d`) → Certificates & secrets → copy an existing secret's **Value** (only visible at creation — create a new one if not saved) → set `AZURE_CLIENT_SECRET` in Vercel (Production+Preview) → **redeploy** (env changes need a new deploy) → re-run the dry-run. Until then the poller cannot fetch mail.

No known runtime bugs in the deployed app (auth, checklist, cocoblu, amazon-actions verified live for Maricel/Aaron/Vihan).

---

## 11. Things Explicitly NOT to Change

- **Supabase schema** — no table/column/enum/RLS changes without explicit approval; always "provide SQL, owner runs it manually". Never auto-migrate.
- **Existing CHECK constraints / enums** (`expected_actions.status`, `disputes.dispute_status`, `purchase_orders.outcome`, etc.) — map onto allowed values; don't widen without approval.
- **Backend automation populating `expected_actions`** — app only reads the feed and writes `amazon_action_log` + `expected_actions.status` (within enum).
- **`SUPABASE_SERVICE_ROLE_KEY`** — server-only; never import client-side; never log secrets.
- **Historical finance pages** (`/remittances`, `/returns`, `/disputes`) — kept with guards but removed from nav; do not re-promote. Operational surface is `/amazon-actions`.
- **Dry-run default** on both ingest endpoints — keep fail-closed; write only on explicit live mode.
- **Permissions** — id/capability + `role==='manager'`; **no email-based permission checks**.

---

## 12. Next Recommended Steps (in order)

1. ~~**Promote to Production.**~~ ✅ DONE 2026-06-07. `249d9c0` deployed via Deploy Hook (after the cron fix). Verified `/api/amazon-ingest-poll` → 401, `/login` → 200.
2. **🔴 Fix `AZURE_CLIENT_SECRET` in Vercel** (Bug #5) — set the secret **VALUE** (not ID) for the Azure app, redeploy. *Immediate blocker for the dry-run.*
3. **Run the `ingest_log` SQL** (§8) — needed only for live writes, not the dry-run.
4. **Dry-run the poller**: `POST /api/amazon-ingest-poll?lookbackHours=336` with `x-ingest-secret` → confirm it fetches + classifies real Amazon emails, zero writes. *(Attempted 2026-06-07; route + auth OK, blocked on Bug #5.)* Use output as the real-email parser-gap report.
5. **Refine parser regexes** for any misses (dry-run iterations).
6. **Verify auto-deploy-on-push** now that builds are valid; if still broken, redeliver GitHub webhook / reconnect Git (owner OAuth).
7. **Go-live (Phase 2):** set `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` → redeploy. Cron runs daily on Hobby (`0 9 * * *`) — restore `*/30` if moving to Pro, or use an external scheduler hitting the endpoint with `CRON_SECRET`.
8. **Monitor first live runs** (`ingest_log`, `expected_actions`, `amazon_action_log`), then optionally add least-privilege Exchange Application Access Policy for the two mailboxes.
9. Later (deferred): Manager Overview dashboard (Vihan), recovery reporting.

**One-liner:** _Build is live ✅ → fix `AZURE_CLIENT_SECRET` value in Vercel + redeploy → dry-run the poller → run `ingest_log` SQL → then flip the two go-live secrets._
