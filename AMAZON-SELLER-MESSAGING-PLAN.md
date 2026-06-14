# Plan — Buyer messages (Amazon Messaging API), phase 2

Buyer–seller messages are **not available** with the current Seller SP-API app.
They need the **Messaging API** (`/messaging/v1/...`), which requires the
restricted **Buyer Communication** role. That role exposes buyer PII, so Amazon
gates it behind app review + a data-protection attestation — it can't be
self-authorized like Finance/Fulfillment/Orders were.

## What it takes to unlock

1. **Developer Console → the Seller app** (`Techniline Ops - Seller Integration`,
   Solution Provider Portal). Edit roles and add **Buyer Communication**
   (and decide on the PII-delegation answer — "No, not delegating to another
   developer").
2. **App review / restricted-role request.** Amazon requires the app to move
   beyond a purely private/draft posture for restricted roles: submit the use
   case ("display buyer messages to our internal ops team for support"), the
   data-handling description, and accept the Acceptable Use + Data Protection
   policies. Expect a review window (days–weeks).
3. **Re-authorize** the Seller account once the role is approved (new refresh
   token scope), or confirm the existing token now carries the role.
4. **Verify access** with the manager "Discover access" probe — add a Messaging
   check (`GET /messaging/v1/orders/{amazonOrderId}/messaging` → 200 vs 403).

## Build (once the role is approved)

- `sellerClient.fetchBuyerMessages(orderId)` / a messages-by-recent sweep.
- New `seller_messages` table (owner SQL) + sync into it.
- A **Messages** tab on the Amazon Seller Central page.

## Why not now

We deliberately kept the current app PII-free (orders store status/fulfillment
only, no buyer data) so it stays self-authorized and low-risk. Buyer messages
break that boundary, so they're a separate, deliberate step — not a quick tab.
