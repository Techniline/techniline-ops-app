# Cocoblu PDF Invoice Capture — Setup

_The feature is built and deployed. It runs on the **free built-in parser** by default — **no API key or per-invoice cost**. It needs **two owner-run setup items** before it can save. Until then it fails safe (nothing partial is written)._

**Flow:** On `/cocoblu`, click **Upload Invoice (PDF)** → the server extracts the text and auto-captures the invoice number, date, and line items (SKU/qty/unit cost) → a **Verify** modal opens pre-filled and fully editable → Aaron (or any Cocoblu user) corrects anything and clicks **Verify & Save** → one `cocoblu_ageing` record is created per line item, the PDF is stored, and who/when verified is recorded. Saved records get an **Edit** button for managers and a 📎 link to view the original PDF.

---

## Required — 2 items (free, no cost)

### 1. Create the Storage bucket + policies (Supabase → SQL Editor)
Holds the original PDFs. Private bucket; the app reads via short-lived signed URLs.
```sql
insert into storage.buckets (id, name, public)
values ('cocoblu-invoices', 'cocoblu-invoices', false)
on conflict (id) do nothing;

-- drop-then-create so the block is safely re-runnable
drop policy if exists "cocoblu invoices upload" on storage.objects;
drop policy if exists "cocoblu invoices read"   on storage.objects;

create policy "cocoblu invoices upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cocoblu-invoices');

create policy "cocoblu invoices read"
  on storage.objects for select to authenticated
  using (bucket_id = 'cocoblu-invoices');
```

### 2. Add the audit columns to `cocoblu_ageing` (Supabase → SQL Editor)
New nullable columns — no change to the ageing view, no existing data touched.
```sql
alter table public.cocoblu_ageing
  add column if not exists source       text,
  add column if not exists pdf_url      text,
  add column if not exists verified_by  uuid references public.users(id),
  add column if not exists verified_at  timestamptz;
```
*(Done 2026-06-08: these columns are now typed in `src/lib/database.types.ts` and the temporary casts in `src/lib/cocoblu/invoice.ts` were removed.)*

After these two, open `/cocoblu` → **Upload Invoice (PDF)** → pick the sample → verify → **Verify & Save**.

---

## Optional — upgrade to AI capture later (better accuracy)

The free parser captures the invoice number, date, and (on the sample) all line items, but it's heuristic — on a different invoice layout it may misread some line items, which Aaron then fixes in the Verify step. To upgrade to **AI extraction (Claude Sonnet 4.6, ≈3¢/invoice)** with **zero code changes**, just add the key:

- Vercel → Settings → Environment Variables → add **`ANTHROPIC_API_KEY`** (Production + Preview) → redeploy.
- The parse route auto-detects the key and switches from "Basic capture" to "✨ AI-captured" (shown in the Verify modal). Remove the key to revert to free.

Get a key from console.anthropic.com (pay-as-you-go). Everything else stays the same.

---

## Permissions
- **Upload / verify / save:** any user with the `cocoblu` capability (Aaron, Vihan).
- **Edit saved records:** managers (`role = 'manager'`).

## Accuracy note
This sample is the only Cocoblu format seen so far. Once real invoices arrive, upload a couple and tell me which fields are misread — the free parser (`src/lib/cocoblu/basicParse.ts`) and the AI prompt (`src/lib/cocoblu/parseInvoice.ts`) are both easy to tune. The Verify step keeps the saved data correct regardless.
