# Data handling, classification & records of processing

Techniline Electronics LLC — Operations application. Companion to
[SECURITY.md](SECURITY.md) and the public [/privacy](../src/app/privacy/page.tsx)
page.

## Data classification
| Class | Examples | Handling |
|---|---|---|
| **Restricted** | (avoided) buyer name/address/phone/payment | Not stored. We deliberately exclude buyer PII from synced order/return records. |
| **Confidential** | Amazon order ids, PO numbers, SKUs, financial settlement amounts, invoice/PRT/SRT refs | Encrypted at rest; access restricted by role; never shared externally. |
| **Internal** | delivery/transfer/return logs, checklist data | Access restricted to authorised staff. |

## Records of processing
| Purpose | Data | Source | Storage | Retention |
|---|---|---|---|---|
| Vendor PO tracking | PO numbers, items, status, booking | SP-API Vendor Orders | Supabase | While operationally relevant + tax period |
| Seller order/fulfillment | order id, status, channel, amounts | SP-API Orders | Supabase | As above |
| Returns | order/return id, SKU, reason, status, docs | SP-API reports + manual logging | Supabase | As above |
| Finance/settlements | settlement groups, amounts | SP-API Finances | Supabase | As above |

## Principles
- **Minimisation** — collect only what operations need; exclude buyer PII.
- **Purpose limitation** — used only for our own fulfilment, returns,
  reconciliation and reporting. Never marketing, never resale, never shared.
- **Need-to-know access** — row-level security + role/capability gating.
- **Retention** — kept only as long as needed for operations and legal/tax
  obligations, then deleted or anonymised.

## Sharing & external sources
- **Shared with third parties:** none.
- **External (non-Amazon) sources of Amazon Information:** none — only the
  Amazon SP-API for our own account.
