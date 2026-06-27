# Techniline — Information Security: Password & Access Control Policy

**Owner:** Vihan (Manager / Account Admin)
**Effective date:** 2026-06-26
**Review cadence:** Annually (next review due 2027-06-26)
**Applies to:** All staff and systems that access, store, or transmit Amazon
Selling Partner API (SP-API) data — including Amazon Seller Central, the
Techniline Ops app and its hosting (Vercel), source control (GitHub), the
Supabase database, and company email/identity (Microsoft 365 / Entra ID).

This policy exists to meet the Amazon SP-API Data Protection Policy and Acceptable
Use Policy, and to protect customer and business data handled by our integration.

---

## 1. Password requirements
All accounts in scope must use passwords that are:
- **At least 12 characters** long.
- **Complex** — containing at least one of each: uppercase letter, lowercase
  letter, number, and **special character** (e.g. `! @ # $ % &`).
- **Unique** — not reused across systems and not reused from a previous password.
- **Never shared** between individuals. Each person uses their own named account.

## 2. Multi-factor authentication (MFA)
- **MFA is mandatory** on every in-scope account: Amazon Seller Central, Microsoft
  365 / Entra ID, Vercel, GitHub, and Supabase.
- MFA uses an authenticator app or hardware key (SMS only where no stronger option
  exists).

## 3. Password expiration & rotation
- Passwords expire and must be changed **at least every 365 days**.
- Rotation is **reviewed and enforced annually** as part of this policy's review.
- Any password is rotated **immediately** if compromise is known or suspected, or
  when a staff member with access leaves.

## 4. Storage & handling
- Passwords and API secrets are stored only in an approved **password manager** or
  in the platform's encrypted secrets store (e.g. Vercel environment variables,
  marked Sensitive). **No plaintext** passwords/secrets in code, chat, email,
  spreadsheets, or documents.
- SP-API credentials (LWA client secret, refresh token) are treated as secrets
  under this policy and rotated on the same annual cadence (or sooner on suspicion
  of exposure).

## 5. Access control
- Access is granted on a **least-privilege** basis — only the systems and roles a
  person needs for their job.
- Access is **revoked promptly** when no longer required or upon offboarding.
- The Account Admin maintains the list of who has access to which systems.

## 6. Review & enforcement
- This policy is reviewed and re-affirmed **annually** by the Account Admin, who
  confirms the controls above remain enforced.
- Non-compliance is corrected on discovery; repeated non-compliance results in
  access removal.

---

**Approved by:** Vihan — Manager / Account Admin, Techniline
**Date:** 2026-06-26
