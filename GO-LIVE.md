# Go-Live & Data-Accuracy Runbook — Amazon Ingestion

_Prepared 2026-06-07. Everything here is **owner-run** (Supabase SQL + Vercel env), per the project rule that schema/secret changes are done by hand. Once you complete steps 1–2 and tell me, I run the controlled live ingest (step 3) and we verify together._

---

## Step 1 — Create the `ingest_log` table (Supabase → SQL Editor)
Write-dedup table so the poller never processes the same email twice. Append-only, new table, no existing object touched.

```sql
create table if not exists public.ingest_log (
  message_id   text primary key,
  mailbox      text,
  received_at  timestamptz,
  email_type   text,
  processed_at timestamptz not null default now()
);
alter table public.ingest_log enable row level security;
-- service-role writes bypass RLS; no policy needed for the poller.
```

## Step 2 — Set the two production env vars (Vercel → Settings → Environment Variables, Production)
| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | *(from Supabase → Settings → API → `service_role` secret)* | **Only you have this.** Server-only — never expose to the browser. Enables DB writes. |
| `CRON_SECRET` | `59b26d17572d01cb26cf27086c2f9f5ca53d57473e91620d` | Generated for you. Arms the daily Vercel cron (Vercel sends it as `Authorization: Bearer …`). |
| `INGEST_FETCH_CAP` | `1000` *(optional)* | Already the default; raise only if a single mailbox exceeds 1000 emails in the lookback window. |

After setting them, **redeploy** (env changes only apply to a new deployment) — tell me and I'll trigger it.

## Step 3 — Controlled first live ingest (I run this)
Instead of letting the daily cron loose immediately, I run **one** live poll over a **short** window and we inspect the result:

```
POST /api/amazon-ingest-poll?mode=live&lookbackHours=72
header: x-ingest-secret: <AMAZON_INGEST_SECRET>
```
This writes only emails from the last 72h, records each in `ingest_log`, and upserts `expected_actions` (PO/dispute/return/shortage/remittance) **deduped on the reference/PO number**.

## Step 4 — Verify data accuracy (before trusting the daily cron)
In Supabase, check for any duplication against the backend-fed rows:
```sql
-- POs the ingester just wrote/updated
select id, type, ref_number, status, email_subject, email_received_at
from public.expected_actions
where type in ('vendor_po','po_cancellation')
order by email_received_at desc
limit 50;

-- Duplicate ref_numbers (should be ZERO rows if dedup is working)
select ref_number, count(*)
from public.expected_actions
where ref_number is not null
group by ref_number having count(*) > 1
order by 2 desc;
```
Then open **/amazon-actions → PO Confirmation** and **Cancellations** tabs and confirm the real POs appear, click a row to expand details, and check the cross-links. If duplicates appear, stop and we adjust the dedup key before widening the window.

## Step 5 — Enable the automated daily run
Once step 4 is clean, **nothing more to do** — the Vercel cron (`vercel.json`, `0 9 * * *`) is already armed by `CRON_SECRET` and will poll + write daily. (For more frequent polling you'd move to Vercel Pro and restore `*/30`, or add an external scheduler hitting the endpoint with the `CRON_SECRET`.)

---

## Cleanup — remove Aaron's duplicate checklist item
The checklist is generated from `task_definitions` (per-user, `is_active`). A "duplicate" is almost certainly two active definitions with the same title. **Diagnose first, then deactivate the extra** (we deactivate, not hard-delete, to preserve history).

```sql
-- 1) Find Aaron's user id
select id, full_name, email, role from public.users where full_name ilike '%aaron%';

-- 2) Duplicate ACTIVE definitions (same title) — review before changing anything
select title, count(*) as n, array_agg(id) as definition_ids, array_agg(assigned_to) as assigned
from public.task_definitions
where is_active is true
group by title
having count(*) > 1
order by n desc;
```
Then deactivate the **extra** definition (replace the id with the newer/duplicate one from the query above):
```sql
update public.task_definitions set is_active = false where id = '<DUPLICATE_DEFINITION_ID>';

-- remove today's still-open duplicate task so it disappears immediately
delete from public.daily_tasks
where task_def_id = '<DUPLICATE_DEFINITION_ID>'
  and task_date = current_date
  and status = 'open';
```
Send me the output of queries (1) and (2) if you'd like me to tell you exactly which id to deactivate.
