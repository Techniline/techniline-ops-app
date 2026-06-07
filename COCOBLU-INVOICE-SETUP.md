# Cocoblu PDF Invoice Capture — Setup

_The feature is built and deployed. It needs **three owner-run setup items** before it works end-to-end. Until then it fails safe — nothing partial is written._

**Flow:** On `/cocoblu`, click **Upload Invoice (PDF)** → the server extracts the text and uses Claude (Sonnet 4.6) to auto-capture the invoice number, date, and line items → a **Verify** modal opens pre-filled and fully editable → Aaron (or any Cocoblu user) corrects anything and clicks **Verify & Save** → one `cocoblu_ageing` record is created per line item, the PDF is stored, and who/when verified is recorded. Saved records get an **Edit** button for managers, and a 📎 link to view the original PDF.

---

## 1. Add `ANTHROPIC_API_KEY` (Vercel) — powers the auto-capture
- Get a key from the Anthropic Console (console.anthropic.com → API keys). It's pay-as-you-go; this uses **Claude Sonnet 4.6 ≈ 3¢ per invoice**.
- Vercel → Settings → Environment Variables → add `ANTHROPIC_API_KEY` (Production + Preview) → **redeploy** (tell me and I'll trigger it).
- Without it, Upload returns "ANTHROPIC_API_KEY is not configured."

## 2. Create the Storage bucket + policies (Supabase → SQL Editor)
Holds the original PDFs. Private bucket; the app reads via short-lived signed URLs.
```sql
insert into storage.buckets (id, name, public)
values ('cocoblu-invoices', 'cocoblu-invoices', false)
on conflict (id) do nothing;

-- authenticated users may upload invoice PDFs
create policy "cocoblu invoices upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cocoblu-invoices');

-- authenticated users may read them (needed to generate signed view links)
create policy "cocoblu invoices read"
  on storage.objects for select to authenticated
  using (bucket_id = 'cocoblu-invoices');
```

## 3. Add the audit columns to `cocoblu_ageing` (Supabase → SQL Editor)
New nullable columns — no change to the ageing view, no existing data touched.
```sql
alter table public.cocoblu_ageing
  add column if not exists source       text,
  add column if not exists pdf_url      text,
  add column if not exists verified_by  uuid references public.users(id),
  add column if not exists verified_at  timestamptz;
```
*(Optional, later: regenerate `src/lib/database.types.ts` so these columns are typed and the temporary casts in `src/lib/cocoblu/invoice.ts` can be removed.)*

---

## After all three
Open `/cocoblu` → **Upload Invoice (PDF)** → pick the sample (`WS-2502628`) → verify the captured header + line items → **Verify & Save**. The rows appear in the table with a 📎 PDF link; managers see an **Edit** button.

**Note on accuracy:** the sample is the only invoice format seen so far. Once real Cocoblu invoices arrive, do a couple of uploads and tell me which fields the AI gets wrong — the extraction prompt in `src/lib/cocoblu/parseInvoice.ts` is easy to tune. The Verify step means even imperfect capture is safe: nothing is saved until a human confirms it.

## Permissions
- **Upload / verify / save:** any user with the `cocoblu` capability (Aaron, Vihan).
- **Edit saved records:** managers (`role = 'manager'`).
