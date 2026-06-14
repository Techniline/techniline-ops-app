# Change management

How changes reach production for Techniline Operations.

## Process
1. **Branch** — work on a feature branch off `main` (never edit prod directly).
2. **Scan** — CI runs on every push: `npm audit` (dependencies) + CodeQL
   (static code analysis). See `.github/workflows/security.yml`.
3. **Test environment** — every branch/PR gets an automatic **Vercel preview
   deployment**, isolated from production, used to verify the change.
4. **Review & approve** — the change is reviewed before promotion; the repo
   owner approves the merge to `main`.
5. **Promote to production** — production is deployed deliberately
   (`vercel deploy --prod`), separate from preview. Database schema changes are
   applied as owner-run SQL (see the `*-SETUP.md` files).
6. **Verify** — confirm the change in production (typecheck + build always pass
   before deploy).

## Responsibilities
- **Author:** branch, implement, ensure CI passes, request review.
- **Owner (Vihan):** review, approve, run any owner SQL, promote to prod.

## Access restriction
- Production deploys and environment variables are restricted to the owner's
  Vercel account. Database write access for syncs is via the server-side
  service role only; the browser/client never holds privileged keys.

## Rollback
- Revert the offending commit and redeploy; Vercel keeps prior deployments for
  instant rollback if needed.
