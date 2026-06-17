# Wazzup chat tracking — setup

Feeds the **Chats** card on the dashboard: pending (unanswered) chats, oldest
waiting time, new chats today, and **% replied within 15 min** — team-wide,
derived from Wazzup message webhooks.

## Pending count that respects "No reply needed" / "Mark as read" (optional)

The pending number is computed from messages by default. To make it honour the
**"No reply needed"** and **"Mark as read"** buttons in the Wazzup chat, point it
at Wazzup's own unanswered counter (`GET /v3/unanswered/{userId}`). Set two
Vercel env vars (Production), then redeploy:

- `WAZZUP_API_KEY` — the Wazzup integration API key.
- `WAZZUP_USER_ID` — the Wazzup user whose counter to read (the shared-inbox
  owner / Aaron). To find it: sign in to the app, then open
  `/api/wazzup/unanswered?users=1` (it lists `{id, name}` for each Wazzup user).

When both are set, the **Chats** card shows Wazzup's live counter ("X customers
waiting") and the names list is kept as a helper. If unset, it falls back to the
computed count — nothing breaks.

## 1. Database (run once in Supabase → SQL editor)

```sql
create table if not exists public.wazzup_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text unique,
  chat_id text,
  chat_type text,
  direction text,            -- 'inbound' (customer) | 'outbound' (agent)
  contact_name text,
  body text,
  message_at timestamptz,
  response_minutes integer,  -- inbound only: minutes to first reply (null = still pending)
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists wazzup_chat_idx on public.wazzup_messages (chat_id, message_at);
create index if not exists wazzup_pending_idx on public.wazzup_messages (direction, response_minutes, message_at);

alter table public.wazzup_messages enable row level security;
-- Read: Aaron + managers/admin (the card shows on their dashboard)
drop policy if exists wazzup_read on public.wazzup_messages;
create policy wazzup_read on public.wazzup_messages for select to authenticated
  using (public.current_user_role() in ('manager','admin')
         or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');  -- Aaron
-- Writes happen only through the service-role webhook; no client write policy.
```

## 2. Vercel env var
Add `WAZZUP_WEBHOOK_SECRET` (any long random string) in Vercel, then redeploy.

## 3. Point Wazzup at our webhook
In Wazzup (admin), set the **webhook URL** to:

```
https://techniline-ops-app.vercel.app/api/wazzup/webhook?secret=YOUR_WAZZUP_WEBHOOK_SECRET
```

(Set it via the Wazzup API `PATCH /v3/webhooks` with `{ "uri": "<the URL above>", "subscriptions": { "messagesAndStatuses": true } }`, or in the Wazzup integration settings.) Wazzup sends a `{test:true}` ping first — our endpoint returns 200 to confirm.

Once messages start flowing, the dashboard **Chats** card fills automatically.
