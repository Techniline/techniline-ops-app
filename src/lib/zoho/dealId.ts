/**
 * Extract a Zoho CRM deal (Potentials) id from either a full deal URL or a
 * raw id. Zoho record ids are long numeric strings, e.g.
 *   https://crm.zoho.com/crm/org712284897/tab/Potentials/4474214000036931008
 *   → 4474214000036931008
 * Returns null if no plausible id is found. (The org segment "org712284897"
 * is excluded because the digit-run must be 12+ long.)
 */
export function extractDealId(input: string): string | null {
  const s = (input ?? "").trim();
  if (s === "") return null;
  const afterPotentials = s.match(/Potentials\/(\d{6,})/i);
  if (afterPotentials) return afterPotentials[1];
  const longRun = s.match(/(\d{12,})/);
  if (longRun) return longRun[1];
  return null;
}

/** Build the canonical Zoho deal URL from an org id + deal id. */
export function buildDealUrl(orgId: string, dealId: string): string {
  return `https://crm.zoho.com/crm/org${orgId}/tab/Potentials/${dealId}`;
}
