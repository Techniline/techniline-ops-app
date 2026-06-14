# Plan — unlock restricted SP-API roles (returns report + buyer messages)

Two things our Seller app can't do today, both blocked by the **same gate**:

| Want | Needs role | Today |
|---|---|---|
| Sync seller-fulfilled (MFN) returns — the `/gp/returns/list/v2` data | Orders / **Inventory and Order Tracking** (returns reports) | `403` on `GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE` |
| Read buyer–seller messages in-app | **Buyer Communication** | not requestable |

Both are **restricted roles**. On a **private/draft** app they don't even appear
as selectable (confirmed). To get them, the app must go through Amazon's
**public app-listing / restricted-role request + review** — one submission can
request both roles together.

## Steps (Developer Console → Solution Provider Portal)

1. Open the app **Techniline Ops - Seller Integration**
   (`amzn1.sp.solution.8d039d6e-0f74-48c9-8bde-7b1aefccd282`).
2. Find the flow to **request additional / restricted roles** — this is usually
   behind "Edit app → Roles" (look for restricted roles that are greyed with a
   "request access" link) and/or a **publish / list app** step plus a complete
   **Developer Profile** (business info, security/data-protection answers).
3. Request both roles: **Inventory and Order Tracking** (for returns reports) and
   **Buyer Communication** (for messages).
4. Provide the use case (truthful, internal-use):

   > *"We are the seller (Techniline Electronics LLC). This is a private,
   > internal application used only by our own staff to (a) view our own
   > Amazon orders and returns so our warehouse/ops team can process returns
   > faster, and (b) read and reply to buyer–seller messages for our own orders.
   > Personal data is shown only to authorized internal staff, never shared with
   > any third party, never used for marketing, and retained only as long as
   > needed to resolve the matter."*

5. Complete the **data-protection / PII attestation** — owner decision, read
   carefully before agreeing (binding).
6. Submit → Amazon review (days–weeks). Status shows **pending** per role.

## After approval

- Re-authorize the seller account (self-authorize flow) so the new roles attach.
- Then in-app, with no further Amazon steps:
  - MFN returns start flowing into the seller sync → appear in **Marketplace
    Returns** (the merge + tagging is already built).
  - Buyer Messages tab can be switched from the deep-link to live message data.
- Also add the **KSA marketplace** (`A17E79C6D8DWNP`) to the sync if returns/
  orders from Saudi should be included (the Seller Central list spans UAE + KSA).

## Reality check

Amazon may decline restricted PII access for an internal tool, or ask for more
detail. The use case above is written to be honest for internal use. If declined,
the fallback stays: manual return logging + the Seller Central deep-links.
