# Shopify Webhooks — real-time dashboard updates (owner-run)

Makes the MUSICMAJLIS band refresh **instantly** when a sale, refund, or checkout
happens (instead of the 3-minute poll). A webhook hits `/api/shopify/webhook`,
which verifies an HMAC signature and bumps a `shopify_sync` heartbeat row; the
dashboard subscribes to that row via Supabase Realtime.

If you skip this, nothing breaks — the band still auto-refreshes every 3 minutes.

## 1. Heartbeat table + RLS + Realtime (Supabase → SQL Editor)
```sql
create table if not exists public.shopify_sync (
  key           text primary key,
  last_event_at timestamptz not null default now(),
  last_topic    text
);
alter table public.shopify_sync enable row level security;

-- Managers + Aaron may read the heartbeat (so their dashboard can subscribe).
drop policy if exists "shopify_sync_read" on public.shopify_sync;
create policy "shopify_sync_read" on public.shopify_sync for select to authenticated
using (public.current_user_role() = 'manager' or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');

-- Enable Realtime change streaming on the table.
alter publication supabase_realtime add table public.shopify_sync;
```
(Writes happen via the server route using the service-role key, so no write policy
is needed.)

## 2. Webhook signing secret (Vercel → Production env, Sensitive)
| Variable | Value |
|---|---|
| `SHOPIFY_WEBHOOK_SECRET` | the webhook **signing secret** (see step 3) |

## 3. Register the webhooks (Shopify admin or API)
The endpoint is: `https://techniline-ops-app.vercel.app/api/shopify/webhook`

**Option A — Shopify admin (Settings → Notifications → Webhooks):**
Create webhooks (format JSON) for these topics, all pointing at the URL above:
- `orders/create`
- `orders/updated`
- `refunds/create`
- `checkouts/create`

Shopify shows a **signing secret** on that page — put it in `SHOPIFY_WEBHOOK_SECRET`.

**Option B — Admin API (custom app token), one per topic:**
```
POST https://musicmajlistest.myshopify.com/admin/api/2024-10/webhooks.json
{ "webhook": { "topic": "orders/create",
  "address": "https://techniline-ops-app.vercel.app/api/shopify/webhook",
  "format": "json" } }
```
For API-created webhooks the signing secret is the app's **API secret key**
(Shopify admin → the app → API credentials). Use that as `SHOPIFY_WEBHOOK_SECRET`.

## 4. Verify
- After registering, place a test order (or use Shopify's "Send test notification").
- The dashboard MUSICMAJLIS band should refresh within a second or two.
- The `shopify_sync` row's `last_event_at` / `last_topic` will update on each event.
