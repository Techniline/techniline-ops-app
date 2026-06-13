# Logistics Operations Module

_Complete functional + technical reference. Status: **live in production**, all
DB migrations applied & verified (14/14). Last updated 2026-06-13._

The Logistics module lives **inside** the Ops app (not a separate app) as a
role-gated portal at `/logistics/*`. It covers MusicMajlis (Shopify) order
fulfillment, reseller & cargo deliveries, product transfers (PRT), TLE invoice
verification, delivery reports, and a manager-curated master-data store.

Setup SQL for everything below is in **`LOGISTICS-SETUP.md`** (owner-run; Steps 1,
1b–1g). Don't run Step 2 again — it's the one-time Kesh account.

---

## 1. Access control (RBAC)

Gating is enforced at the **routing layer** (`RouteGuard`) and the **database**
(RLS), not just by hiding sidebar items.

| User | Role | Sees |
|---|---|---|
| Kesh Rana (`warehouse2@`) | `logistics` | **Only** the Logistics portal; bounced from any other route. |
| Maricel | `staff` + page grant | Logistics: **Reseller, PRT, Delivery Reports** only. |
| Aaron | `staff` + page grant | Logistics: **Shopify / MusicMajlis Orders** only. |
| Vihan / managers | `manager` | Everything, incl. Logistics **Master Data**. |
| (future) admin | `admin` | Everything. |

- Per-page grants live in `LOGISTICS_PAGE_GRANTS` (keyed by Supabase UID) in
  `src/lib/permissions/index.ts`; helpers `logisticsPages`,
  `canViewLogistics`, `canViewLogisticsPage`, `isLogisticsOnly`.
- **Master Data** (`masters`) is manager/admin only — never the logistics user.
- DB-layer: each logistics table has a `*_logistics_rw` policy allowing
  `manager/admin/logistics` **plus** Maricel's & Aaron's UIDs (Step 1b). Master
  tables: team can read/insert, only manager/admin update/delete. Storage bucket
  mirrors this.

Kesh's UID and the page grants are recorded in `memory/logistics-users.md`.

---

## 2. Pages & features

Sidebar (categorised): **Dashboard · Channels** (Shopify/MusicMajlis) **·
Deliveries** (Reseller, Cargo) **· Operations** (PRT, Delivery Reports, Master
Data*) **· Marketplace** (Amazon Vendor/DF/Seller, Noon — Coming Soon).
*Master Data shows for managers only.

### Dashboard (`/logistics`)
KPI tiles (orders today, pending fulfillment, tracking pending, PRT requested,
ready to dispatch, delivered today, delayed >24h/>48h, on hold, **missing
invoice**, reseller pending/due-today/delayed, cargo pending) + glossy module
cards. "Missing invoice" excludes cancelled orders (internal status **and**
Shopify `cancelled_at`).

### Shopify / MusicMajlis Orders (`/logistics/orders`)
- **Sync now** — pulls orders from Shopify into `shopify_orders`/`_items`
  (deduped on Shopify order id / line id; internal state preserved on re-sync).
  **⋯ More → Backfill 2025→now** runs a one-time month-by-month historical pull.
  **Import ledger** (manager) backfills TLE invoice no + value from the SIS
  ledger xlsx, matched by the S-number.
- **Bidirectional status**: Shopify `fulfilled` → `fulfilled_shopify`;
  `cancelled`/voided → `cancelled` (triggers SRT/PRT closure); archived/closed →
  fulfilled. Never downgrades a more advanced internal state.
- **List & Board views.** List splits **Needs action (unfulfilled)** on top and
  **Fulfilled & closed** below; sticky header + sticky first column; columns are
  drag-reorderable / hideable with a **per-user saved view** (localStorage +
  `user_prefs`). Board = kanban by logistics status; **drag a card to change
  status**. Premium search (order/customer/mobile/email/SKU; phone matching is
  format-insensitive). Filters: fulfillment, logistics status, city, method, date.
- **Order detail** (modal from a row, or `/logistics/orders/[id]`):
  customer/order panels, **View in Shopify ↗**, logistics-status selector +
  Ready-to-Dispatch guard, line-item **packing checklist** (picked/packed/source/
  picking status), **TLE invoice** panel (below), **Tracking & Shopify
  fulfillment** (courier incl. **In-Store Pickup**, tracking no/url/date/notes;
  validates all picked+packed and a tracking no unless pickup; pushes fulfillment
  to Shopify, keeps internal record + logs error on failure), tracking history.

### TLE invoice verification (per order)
Enter or **upload the invoice PDF** to capture invoice no, value, invoiced SKUs.
On save the server checks value vs order value and invoiced SKUs vs order line
SKUs; a mismatch **requires mandatory remarks** to complete. **Missing invoice**
is alerted + KPI'd (cancelled orders never require an invoice). Cancelled orders
**reopen for closure**: if invoiced → **SRT + PRT** numbers mandatory; if
cancelled before invoicing → a **reason/remark** is enough. Everything logged to
the activity log.

### Reseller Deliveries (`/logistics/reseller`)
- Manual deliveries with **scheduled (requested) date** — delay counted from it.
- **Two upload slots**: Upload Invoice + Upload DO. Each **auto-fills** the form
  (customer, invoice no, DO no, PO/ref, value, delivery address, items) **and
  stores the PDF** in the `logistics-docs` bucket; **INV/DO** download links.
- Driver name/phone, vehicle number, DO/invoice numbers.
- **Autocomplete from master data + history**: typing a known customer/driver
  back-fills linked fields; new names auto-capture into the master tables.
- **Recall section** (not a giant list): latest 25 + search by customer/invoice/
  DO/reference + scheduled-date range.
- **Print** a clean delivery note (driver/vehicle, signature lines).
- Default columns: Customer/Invoice/DO/Value/Status/Actions (others under
  Columns ▾).

### Cargo Deliveries (`/logistics/cargo`)
Manual CRUD (consignee, ref, destination, cartons, weight, dimensions, AWB,
company, dispatch, status). _Not yet upgraded with upload/master-data — candidate
for a future pass._

### Product Transfers / PRT (`/logistics/prt`)
Branch-to-branch transfer requests (order, SKU, product, brand, qty, from/to,
required date, urgency, status). Inline status pipeline. **PRT email generator**:
branded HTML email (embossed header, field table, urgency badge), **sent as the
logged-in user** and **always CC `purchasing@techniline.org`**; or Copy text.
**Delete** requires a reason (logged as evidence).

### Delivery Reports (`/logistics/reports`)
Tabs: **Delay** (pending Shopify orders + reseller deliveries overdue vs
scheduled date), **Branch Support** (PRTs by source branch), **Courier**
(shipments/pushed/failed), **Activity Log**, **API Errors**.

### Master Data (`/logistics/masters`) — manager only
Customers (contact/phone/city/TRN/terms/address), Drivers (phone/license +
expiry), Vehicles (plate/type/reg + insurance expiry), each active/inactive.
Auto-filled from deliveries; only manager/admin can edit/delete. Feeds the
reseller autocomplete.

---

## 3. Data model

Tables (all `public`, RLS on): `shopify_orders`, `shopify_order_items`
(`shopify_line_id` unique), `tracking_updates`, `prt_requests`,
`reseller_deliveries`, `cargo_deliveries`, `logistics_activity_logs`,
`logistics_api_error_logs`, `logistics_customers`, `logistics_drivers`,
`logistics_vehicles`, `user_prefs`. `users` gained `portal_access`, `active`.
Storage bucket `logistics-docs` (private) holds reseller invoice/DO PDFs.
Last-sync timestamp in `app_settings` key `logistics_shopify_last_sync`.

Hand-maintained types in `src/lib/database.types.ts`.

---

## 4. Server routes (`src/app/api/logistics/`)

| Route | Purpose |
|---|---|
| `sync` | Pull Shopify orders (incremental; `?since/?until` for backfill); bidirectional status. |
| `fulfill` | Validate pick/pack + tracking, push fulfillment to Shopify, log failures. |
| `order` | `set_status` / `update_item` / `save_invoice` / `close_cancellation`. |
| `prt-email` | Send PRT email via Graph (as caller, CC purchasing@). |
| `parse-invoice` | Extract a TLE order invoice (order flow). |
| `parse-doc` | Extract invoice **or** delivery note (reseller flow). |
| `import-ledger` | Manager-only xlsx backfill of TLE invoice no/value. |

All authorise via `authorizeLogistics` (Bearer token → `canViewLogistics`).
Emails send **as the logged-in user** (Graph `Mail.Send` application perm).

---

## 5. Document parsing

- Engine: `unpdf` text extraction + Claude structured output
  (`claude-sonnet-4-6`) **when `ANTHROPIC_API_KEY` is set**.
- **It is currently NOT set** (owner declined paid usage), so parsing runs the
  **deterministic regex fallback** tuned to the Techniline ERP invoice/DO layout
  (`parseDoc.ts` / `parseInvoice.ts`). It reliably captures header fields
  (invoice no `WS/…`, DO no `DO/…`, customer, PO#, net amount, delivery address)
  but **not line items**. Adding the key (Vercel → Production → redeploy) turns on
  full AI extraction everywhere (Cocoblu, order invoice, reseller invoice/DO).
- Cost if enabled: ~$0.001 per document.

---

## 6. Known limitations / future work

- **Line items** aren't auto-extracted without `ANTHROPIC_API_KEY`.
- **Cargo** module hasn't had the upload/master-data/print upgrade.
- **Amazon Vendor/DF/Seller, Noon** are Coming-Soon placeholders.
- Master-data **expiry alerts** (license/insurance) not surfaced on the dashboard
  yet.
- Reseller delivery note isn't brand-styled like the PRT email yet.
