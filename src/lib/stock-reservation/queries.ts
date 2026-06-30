import { supabase as _supabase } from "@/lib/supabaseClient";
import type {
  Impo,
  ImpoLine,
  ImpoLineWithAvailability,
  ImpoWithLines,
  StockReservation,
} from "./types";

// The new tables (impos, impo_lines, stock_reservations) are not yet in the
// generated database.types.ts — regenerate with `supabase gen types typescript`
// after running the SQL migration. Until then, we bypass strict typing here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = _supabase as any;

// ── IMPOs ─────────────────────────────────────────────────────────────────────

export async function fetchImpos(): Promise<Impo[]> {
  const { data, error } = await supabase
    .from("impos")
    .select("*")
    .order("eta", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Impo[];
}

export async function fetchImpoWithLines(impoId: string): Promise<ImpoWithLines | null> {
  const [impoRes, linesRes, reservedRes] = await Promise.all([
    supabase.from("impos").select("*").eq("id", impoId).single(),
    supabase.from("impo_lines").select("*").eq("impo_id", impoId),
    supabase
      .from("stock_reservations")
      .select("impo_line_id, qty_requested, status")
      .in("status", ["pending", "approved"]),
  ]);

  if (impoRes.error || !impoRes.data) return null;
  const impo = impoRes.data as Impo;
  const lines = (linesRes.data ?? []) as ImpoLine[];

  // Aggregate reserved qty per line
  const reservedMap = new Map<string, number>();
  for (const r of reservedRes.data ?? []) {
    reservedMap.set(r.impo_line_id, (reservedMap.get(r.impo_line_id) ?? 0) + r.qty_requested);
  }

  const linesWithAvail: ImpoLineWithAvailability[] = lines.map((l) => {
    const reserved = reservedMap.get(l.id) ?? 0;
    return { ...l, qty_reserved: reserved, qty_available: l.qty_incoming - reserved, impo };
  });

  return { ...impo, lines: linesWithAvail };
}

/** All IMPO lines with availability, across all IMPOs — used by the sales view. */
export async function fetchAllLinesWithAvailability(): Promise<ImpoLineWithAvailability[]> {
  const [linesRes, imposRes, reservedRes] = await Promise.all([
    supabase.from("impo_lines").select("*"),
    supabase.from("impos").select("*").order("eta", { ascending: true }),
    supabase
      .from("stock_reservations")
      .select("impo_line_id, qty_requested, status")
      .in("status", ["pending", "approved"]),
  ]);

  if (linesRes.error) throw new Error(linesRes.error.message);

  const impoMap = new Map<string, Impo>(
    ((imposRes.data ?? []) as Impo[]).map((i) => [i.id, i])
  );
  const reservedMap = new Map<string, number>();
  for (const r of reservedRes.data ?? []) {
    reservedMap.set(r.impo_line_id, (reservedMap.get(r.impo_line_id) ?? 0) + r.qty_requested);
  }

  return ((linesRes.data ?? []) as ImpoLine[])
    .map((l) => {
      const impo = impoMap.get(l.impo_id);
      if (!impo) return null;
      const reserved = reservedMap.get(l.id) ?? 0;
      return { ...l, qty_reserved: reserved, qty_available: l.qty_incoming - reserved, impo };
    })
    .filter((l): l is ImpoLineWithAvailability => l !== null);
}

export async function updateImpoEta(impoId: string, eta: string): Promise<void> {
  const { error } = await supabase.from("impos").update({ eta }).eq("id", impoId);
  if (error) throw new Error(error.message);
}

// ── Reservations ──────────────────────────────────────────────────────────────

export async function fetchMyReservations(userId: string): Promise<StockReservation[]> {
  const { data, error } = await supabase
    .from("stock_reservations")
    .select("*, impo_line:impo_lines(*, impo:impos(*))")
    .eq("requested_by", userId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StockReservation[];
}

/** Manager: all pending reservations with requester name */
export async function fetchPendingReservations(): Promise<StockReservation[]> {
  const { data, error } = await supabase
    .from("stock_reservations")
    .select("*, impo_line:impo_lines(*, impo:impos(*)), requester:users!requested_by(full_name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: unknown) => ({
    ...(r as StockReservation),
    requester_name: ((r as Record<string, unknown>).requester as { full_name?: string } | null)?.full_name ?? null,
  }));
}

/** Manager: aggregate stats — reserved units, deposits, still-available units */
export async function fetchManagerStats(): Promise<{
  reservedUnits: number;
  depositsCollected: number;
  availableUnits: number;
}> {
  const [linesRes, reservedRes, depositsRes] = await Promise.all([
    supabase.from("impo_lines").select("qty_incoming"),
    supabase.from("stock_reservations").select("qty_requested").in("status", ["pending", "approved"]),
    supabase.from("stock_reservations").select("amount_paid").neq("status", "cancelled"),
  ]);

  const totalIn = ((linesRes.data ?? []) as { qty_incoming: number }[]).reduce((s, l) => s + l.qty_incoming, 0);
  const reserved = ((reservedRes.data ?? []) as { qty_requested: number }[]).reduce((s, r) => s + r.qty_requested, 0);
  const deposits = ((depositsRes.data ?? []) as { amount_paid: number | null }[]).reduce((s, r) => s + (r.amount_paid ?? 0), 0);

  return { reservedUnits: reserved, depositsCollected: deposits, availableUnits: Math.max(0, totalIn - reserved) };
}

/** Manager: all reservations (for the activity log view) */
export async function fetchAllReservations(): Promise<StockReservation[]> {
  const { data, error } = await supabase
    .from("stock_reservations")
    .select("*, impo_line:impo_lines(*, impo:impos(*)), requester:users!requested_by(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: unknown) => ({
    ...(r as StockReservation),
    requester_name: ((r as Record<string, unknown>).requester as { full_name?: string } | null)?.full_name ?? null,
  }));
}
