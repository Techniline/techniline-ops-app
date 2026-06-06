/**
 * Internal helper: fetch ALL rows from a query, paging past PostgREST's
 * default 1,000-row cap. `invoices` and `remittance_lines` both exceed it, so
 * a single select would silently truncate and corrupt match results.
 *
 * `page` must build a FRESH ranged query on each call (a query can only be
 * awaited once).
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) {
      const message = (error as { message?: string } | null)?.message ?? "Query failed";
      throw new Error(message);
    }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}
