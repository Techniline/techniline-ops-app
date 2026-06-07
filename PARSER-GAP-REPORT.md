# Real-Email Parser-Gap Report — 2026-06-07

First dry-run of the Graph poller against **real** Amazon mail (the parsers had
only ever seen synthetic samples). Endpoint: `POST /api/amazon-ingest-poll?lookbackHours=336`
(manual, dry-run — **zero writes**). Mailboxes: `vihan@`, `purchasing@`.

## Headline numbers
| Metric | Value |
|---|---|
| Fetched (both mailboxes, ~200 each = Graph page cap) | **400** |
| Matched Amazon filter (`isAmazonEmail`) | **106** |
| Written / Skipped / Errors | 0 / 0 / 0 (dry-run) |

> Note: `fetchMessages` (`graph.ts`) *does* page via `@odata.nextLink` but
> hard-stops at **`cap = 200` per mailbox**. 400 is therefore a ceiling — a busy
> 14-day window **silently truncates the oldest mail**. Raise the cap (or shorten
> the cron window) before go-live.

## What works ✅
- **Remittance Advice** (`FW: Remittance Advice … Payment# …`) → `remittance`, 2 ops. Consistent across both mailboxes.
- **Shortage disputes** (`Dispute ID DSPT… Dispute against invoices with shortage …`) → `shortage_claim`, 2 ops. (Shortage correctly wins over dispute — intended ordering.)
- **Vendor returns** (`PRT for Amazon Vendor Return – PO# …`) → `return_processed`, 1 op.
- **Cross-mailbox dedup** will work live: the same remittance carries one `internetMessageId` in both boxes → message-id dedup skips the 2nd copy.
- **Noise correctly ignored** (`unknown`, 0 ops): "Sold, ship now…", "We found something you might like", "Welcome…", "Account Settings", webinars. The bulk of traffic is correctly dropped.

## False positives & mis-classifications ❌ (root causes in `detectType.ts`)

`detectType` order is: remittance → shortage → dispute → return → po_cancellation → vendor_po → unknown. Several gaps stem from **order + over-broad keywords matching boilerplate in the body**.

| # | Real email (subject) | Got | Ops | Should be | Root cause |
|---|---|---|---|---|---|
| 1 | **Delivery appointments**: `XAEC/DXB3/DXB6: Appointment Confirmed …`, `XAEC RESCHEDULE …` | `vendor_po` | **1** | `unknown` | vendor_po rule matches the word **`confirm`** → "Appointment **Confirm**ed". ~8–9 emails, each plans 1 spurious op. |
| 2 | `DXB6 DELETE: Appointment #… Deleted`, `RE: Request to Change Appointment Location …` | `po_cancellation` | **1** | `unknown` | body contains `cancel` + `po` boilerplate. Spurious cancellation op. |
| 3 | `Line item(s) on your Amazon.ae PO(s) have been cancelled [CUFZ7]` | `dispute_update` | 1 | **`po_cancellation`** | **dispute check precedes po_cancellation**, and the body contains the word "dispute" (boilerplate) → fires first. This is a genuine PO cancellation mis-routed. |
| 4 | `Your payment is on the way` | `dispute_update` | 1 | `remittance`/`unknown` | body contains "dispute" boilerplate → dispute rule fires. |
| 5 | `Dispute ID DSPT20065219423: Dispute against vendor returns …` | `remittance` (1 copy) / `dispute_update` (other copy) | 2 | `dispute_update` | **remittance rule is first and over-broad** (`payment advice`/`net paid`); a dispute body that mentions payment is caught as remittance. Inconsistent between the two copies. |
| 6 | `Notification: Your request has been automatically processed.` | `return_processed` | **2** | unclear | generic subject; body has "return". Plans 2 writes off a vague trigger. |
| 7 | `RE: Payment Received / Debit Balance Inquiries` | `return_processed` | **2** | `remittance`/`unknown` | body has "return"; over-broad `\breturn\b`. Plans 2 writes. |

## ⚠️ Real POs yield **0 operations** — confirmed regex bug
Every genuine `Amazon.ae PO <id>` email (e.g. `6SETIFRF`, `4P3FCXGW`, `6GJA64FN`,
… ~20+ of them) classifies as `vendor_po` but plans **0 operations**. So the
poller currently captures **nothing** from the core PO stream.

**Root cause (`parsePO.ts:29`):** the PO-number regex is
`/\bPO[\s#:-]*([0-9]{5,})/i` — it requires **5+ digits**. Real Amazon.ae PO ids
are **8-char alphanumeric** (`6SETIFRF`, `4P3FCXGW`), so `poNumber` is always
null and, with no positive count, `parsePO` returns 0 ops ("No PO number…"). The
synthetic samples must have used numeric ids, hiding this.

**Fix:** widen the id pattern to alphanumeric, e.g.
`/\bPO\(?s?\)?[\s#:-]*([A-Z0-9]{6,})/i` and `Amazon\.ae PO ([A-Z0-9]{6,})`,
anchored to avoid catching `PO Box` etc.

**Separate design question for the owner:** the backend automation already
populates `expected_actions` (~384 rows). Should the ingester *also* insert PO
`expected_actions` (risk of duplicate rows vs the feed), or only enrich/limit
itself to remittances/disputes/returns/shortages? This decides whether we fix
`parsePO` to write or route POs to `unknown`. **Confirm before changing.**

## Recommended fixes (dry-run only, pending confirmation)
1. **Reorder + tighten `detectType`**: move `po_cancellation` *before* `dispute`; gate the dispute rule on `\bdspt\d+\b` (a real dispute id) rather than the bare word "dispute"; narrow the remittance rule so it doesn't outrank disputes.
2. **Exclude delivery-appointment mail** (`appointment`, `XAEC`, `DXB\d`, `reschedule`, `appointment confirmed/deleted`) → `unknown`. Removes the #1 false-positive source.
3. **Tighten `vendor_po`**: don't classify on the bare word `confirm`; require `purchase order` / `Amazon.ae PO <id>` / `unconfirmed PO`.
4. **Tighten `return_processed`**: require a return id (`\bvret\d+`, `return id`, `PRT`/`SRT`) rather than the bare word "return", to kill the "Payment Received" / "automatically processed" false writes.
5. **Resolve the PO 0-ops question** (a vs b) — this drives whether `parsePO` needs real-format work.
6. **Graph paging**: confirm `fetchMessages` pages beyond 200/mailbox so a busy lookback window doesn't silently drop the oldest mail.

## Resolution — fixes applied + re-validated (2026-06-07)
Fixes shipped in `21f817b` + `b72dcc5`, re-validated by a second dry-run (zero writes):

| Finding | Status |
|---|---|
| Real POs yield 0 ops (numeric-only id regex) | ✅ Fixed — `parsePO` now extracts 8-char alphanumeric ids; **25/25 `Amazon.ae PO` emails captured** (was 0/25). Owner chose: ingester writes PO `expected_actions`, deduped on PO number (`ref_number` natural key, upsert). |
| Delivery-appointment mail mis-classified | ✅ Fixed — **11/11 appointment emails → `unknown`** (was vendor_po/po_cancellation). |
| `PO(s) have been cancelled` → dispute | ✅ Fixed — now `po_cancellation` (cancellation rule ordered before dispute). |
| Dispute over-broad (bare "dispute") | ✅ Fixed — requires a `DSPT` id. |
| Return over-broad (bare "return") | ✅ Fixed — requires return id / PRT / SRT / RMA / "vendor return". |
| Remittance over-broad ("payment advice"/"net paid") | ✅ Fixed — requires "remittance". |
| Graph fetch caps at 200/mailbox | 🟡 **Open** — `fetched: 400` means both mailboxes are at the cap; a busy window drops the oldest mail. Raise `cap` (and/or shorten the cron lookback) before high-volume go-live. |

Post-fix tally (106 Amazon emails): remittance 11 · vendor_po 33 (30 ops) · return 3 · dispute 2 · po_cancellation 1 · shortage 1 · unknown 55. **0 writes, 0 errors.**

_All findings are from zero-write dry-runs; no production data was modified._
