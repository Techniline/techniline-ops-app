"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import type { PackingListRow } from "@/lib/packing/types";

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

function modeLabel(mode: string) {
  return mode === "invoice" ? "Packing + Invoice" : "Packing Only";
}

export default function PackingListPage() {
  const router = useRouter();
  const [lists, setLists] = useState<PackingListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<"all" | "techniline" | "soundline">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "final">("all");

  useEffect(() => {
    setLoading(true);
    getToken().then((token) => {
      fetch("/api/packing/lists", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((json) => {
          if (json.ok) setLists(json.lists ?? []);
          else setError(json.error ?? "Load failed.");
        })
        .catch(() => setError("Network error."))
        .finally(() => setLoading(false));
    }).catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lists.filter((l) => {
      if (q && !l.consignee_name?.toLowerCase().includes(q) && !l.invoice_no?.toLowerCase().includes(q)) return false;
      if (companyFilter !== "all" && l.company !== companyFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      return true;
    });
  }, [lists, search, companyFilter, statusFilter]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this packing list? This cannot be undone.")) return;
    setDeleting(id);
    const token = await getToken();
    try {
      await fetch(`/api/packing/lists/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      setLists((p) => p.filter((l) => l.id !== id));
    } finally { setDeleting(null); }
  }

  void router;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-indigo-50 p-6 md:p-8">

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-violet-900">Packing Lists</h1>
          <p className="mt-1 text-sm font-medium text-violet-400">
            {lists.length} list{lists.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/logistics/packing-list/catalog"
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 3px 10px rgba(139,92,246,0.14), 0 1px 2px rgba(0,0,0,0.06)" }}
            className="rounded-xl border border-violet-100 bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 transition-all hover:border-violet-200 hover:shadow-lg hover:shadow-violet-100"
          >
            SKU Catalog
          </Link>
          <Link
            href="/logistics/packing-list/new"
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 5px 18px rgba(124,58,237,0.50), 0 0 0 1px rgba(109,40,217,0.25)" }}
            className="rounded-xl bg-gradient-to-b from-violet-500 to-violet-700 px-6 py-2.5 text-sm font-bold text-white transition-all hover:from-violet-600 hover:to-violet-800 hover:shadow-2xl hover:shadow-violet-300"
          >
            + New Packing List
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-violet-300 text-sm">⌕</span>
          <input
            type="search"
            placeholder="Search by customer or invoice no…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ boxShadow: "inset 0 2px 5px rgba(109,40,217,0.07), 0 1px 2px rgba(0,0,0,0.04)" }}
            className="w-72 rounded-xl border border-violet-100 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          />
        </div>

        {/* Company pills */}
        <div
          style={{ boxShadow: "inset 0 1px 4px rgba(109,40,217,0.07), 0 1px 2px rgba(0,0,0,0.04)" }}
          className="flex items-center gap-1 rounded-xl border border-violet-100 bg-white p-1"
        >
          {(["all", "techniline", "soundline"] as const).map((c) => (
            <button
              key={c} type="button" onClick={() => setCompanyFilter(c)}
              style={companyFilter === c ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 3px 10px rgba(124,58,237,0.40)" } : {}}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                companyFilter === c
                  ? "bg-gradient-to-b from-violet-500 to-violet-700 text-white"
                  : "text-slate-400 hover:text-violet-600"
              }`}
            >
              {c === "all" ? "All" : c === "techniline" ? "Techniline" : "Soundline"}
            </button>
          ))}
        </div>

        {/* Status pills */}
        <div
          style={{ boxShadow: "inset 0 1px 4px rgba(109,40,217,0.07), 0 1px 2px rgba(0,0,0,0.04)" }}
          className="flex items-center gap-1 rounded-xl border border-violet-100 bg-white p-1"
        >
          {(["all", "draft", "final"] as const).map((s) => (
            <button
              key={s} type="button" onClick={() => setStatusFilter(s)}
              style={statusFilter === s ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 3px 10px rgba(124,58,237,0.40)" } : {}}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                statusFilter === s
                  ? "bg-gradient-to-b from-violet-500 to-violet-700 text-white"
                  : "text-slate-400 hover:text-violet-600"
              }`}
            >
              {s === "all" ? "All" : s === "draft" ? "Draft" : "Final"}
            </button>
          ))}
        </div>

        {!loading && (
          <span className="text-xs font-semibold text-violet-300">{filtered.length} of {lists.length}</span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-violet-100/60" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div className="flex h-52 flex-col items-center justify-center gap-4 rounded-2xl border border-violet-100 bg-white/70">
          <p className="text-sm font-medium text-violet-300">
            {lists.length === 0 ? "No packing lists yet." : "No results match your filters."}
          </p>
          {lists.length === 0 && (
            <Link
              href="/logistics/packing-list/new"
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 5px 18px rgba(124,58,237,0.45)" }}
              className="rounded-xl bg-gradient-to-b from-violet-500 to-violet-700 px-6 py-2.5 text-sm font-bold text-white"
            >
              Create your first packing list →
            </Link>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div
          style={{ boxShadow: "0 8px 32px rgba(139,92,246,0.12), 0 2px 6px rgba(0,0,0,0.04)" }}
          className="overflow-hidden rounded-2xl border border-violet-100 bg-white"
        >
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-violet-50 bg-gradient-to-r from-violet-50/80 to-purple-50/80">
                <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Invoice No</th>
                <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Customer</th>
                <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Company</th>
                <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Mode</th>
                <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Date</th>
                <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Status</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-violet-50">
              {filtered.map((l) => (
                <tr key={l.id} className="bg-white transition-all hover:bg-violet-50/30">
                  <td className="px-5 py-4 font-mono text-xs font-bold text-violet-500">
                    {l.invoice_no || <span className="font-normal text-slate-200">—</span>}
                  </td>
                  <td className="px-5 py-4 font-semibold text-slate-800">
                    {l.consignee_name || <span className="text-xs font-normal text-slate-300">No name</span>}
                  </td>
                  <td className="px-5 py-4 font-medium capitalize text-slate-500">{l.company}</td>
                  <td className="px-5 py-4 text-slate-400">{modeLabel(l.mode)}</td>
                  <td className="px-5 py-4 text-slate-400">
                    {l.list_date
                      ? new Date(l.list_date).toLocaleDateString("en-AE", { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-5 py-4">
                    {l.status === "final" ? (
                      <span
                        style={{ boxShadow: "0 0 12px rgba(52,211,153,0.40)" }}
                        className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-600"
                      >
                        Final
                      </span>
                    ) : (
                      <span
                        style={{ boxShadow: "0 0 12px rgba(251,191,36,0.35)" }}
                        className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-600"
                      >
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/logistics/packing-list/${l.id}`}
                        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 8px rgba(109,40,217,0.14), 0 1px 2px rgba(0,0,0,0.05)" }}
                        className="rounded-lg border border-violet-100 bg-white px-4 py-1.5 text-xs font-bold text-violet-600 transition-all hover:border-violet-200 hover:shadow-md hover:shadow-violet-100"
                      >
                        View
                      </Link>
                      <Link
                        href={`/logistics/packing-list/new?edit=${l.id}`}
                        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 8px rgba(109,40,217,0.14), 0 1px 2px rgba(0,0,0,0.05)" }}
                        className="rounded-lg border border-violet-100 bg-white px-4 py-1.5 text-xs font-bold text-violet-600 transition-all hover:border-violet-200 hover:shadow-md hover:shadow-violet-100"
                      >
                        Edit
                      </Link>
                      <button
                        type="button" onClick={() => handleDelete(l.id)} disabled={deleting === l.id}
                        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 2px 8px rgba(239,68,68,0.12)" }}
                        className="rounded-lg border border-red-100 bg-red-50 px-4 py-1.5 text-xs font-bold text-red-500 transition-all hover:bg-red-100 hover:shadow-md hover:shadow-red-100 disabled:opacity-40"
                      >
                        {deleting === l.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
