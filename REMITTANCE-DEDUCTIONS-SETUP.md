# Remittance negative-payment tracking — Setup (owner-run)

Adds a **Remittance — Negative Payments** band to the dashboard (Maricel + managers).
Every negative line on an Amazon payment must be categorised with mandatory evidence
before it can be closed, so accounts knows what each deduction is for.

## Table + RLS (Supabase → SQL Editor)
```sql
create table if not exists public.remittance_deductions (
  id                  uuid primary key default gen_random_uuid(),
  remittance_ref      text not null,                 -- Amazon payment number
  amount_aed          numeric,                       -- the deduction (minus) value
  charge_type         text,                          -- vendor_return | return_dispute | shortage_claim | price_claim | coop_mdf | chargeback_compliance | damage_defective | other
  return_id           text,
  po_number           text,
  tle_invoice_number  text,
  srt_number          text,
  prt_number          text,
  dispute_id          text,
  amazon_case_id      text,
  return_missing      boolean not null default false,
  claim_amount_aed    numeric,
  approved_amount_aed numeric,
  recovery_date       date,
  dispute_status      text,                          -- Open | Pending Amazon | Approved | Partially Approved | Rejected | Closed
  remark              text,
  status              text not null default 'open',  -- open | closed
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  closed_by           uuid references public.users(id),
  closed_at           timestamptz
);
create index if not exists remittance_deductions_status_idx on public.remittance_deductions(status);
create index if not exists remittance_deductions_ref_idx on public.remittance_deductions(remittance_ref);

alter table public.remittance_deductions enable row level security;

-- Managers + Maricel may read/write.
drop policy if exists "remittance_deductions_rw" on public.remittance_deductions;
create policy "remittance_deductions_rw" on public.remittance_deductions for all to authenticated
using (public.current_user_role() = 'manager' or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7')
with check (public.current_user_role() = 'manager' or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7');
```
(`227fdb27-…` = Maricel.)

## Closure rules (enforced in the form and on save)
| Charge type | Mandatory to close |
|---|---|
| Vendor Return | Return ID (or Amazon Case ID if return not found) · PO Number · TLE Invoice Number · Remark |
| Return Dispute | Return ID (or Case ID) · Dispute ID · PO Number · TLE Invoice Number · Claim Amount · Remark (tracks Dispute Status / Approved Amount / Recovery Date; shows Recovery %) |
| Shortage Claim | (SRT # **or** Dispute ID **or** Amazon Case ID) · Remark |
| Price Claim | PRT Number · Remark |
| Co-op / MDF · Chargeback / Compliance · Damage / Defective · Other | Remark |

Remark is mandatory for every deduction. Recovery % = Approved ÷ Claim.

## After setup
Reload **/dashboard** as Maricel (or a manager) → the rose **Remittance** band appears.
Add a deduction against a payment ref (auto-suggested from ingested remittances),
categorise it, fill the required evidence, and **Close deduction**.
