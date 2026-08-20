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

function badge(status: string) {
  return status === "final"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
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

  // Filters
  const [search, setSearch] = useState(""); // customer name search
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
      await fetch(`/api/packing/lists/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setLists((p) => p.filter((l) => l.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  const inputCls = "rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Packing Lists</h1>
        <div className="flex gap-2">
          <Link href="/packing-list/catalog"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
            SKU Catalog
          </Link>
          <Link href="/packing-list/new"
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
            + New Packing List
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search by customer or invoice no…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`w-72 ${inputCls}`}
        />
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
          {(["all", "techniline", "soundline"] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCompanyFilter(c)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${companyFilter === c ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400"}`}>
              {c === "all" ? "All" : c === "techniline" ? "Techniline" : "Soundline"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
          {(["all", "draft", "final"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${statusFilter === s ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400"}`}>
              {s === "all" ? "All" : s === "draft" ? "Draft" : "Final"}
            </button>
          ))}
        </div>
        {!loading && (
          <span className="text-xs text-slate-400">{filtered.length} of {lists.length}</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
          <p className="text-sm">{lists.length === 0 ? "No packing lists yet." : "No results match your filters."}</p>
          {lists.length === 0 && (
            <Link href="/packing-list/new" className="text-sm font-medium text-indigo-600 hover:underline">
              Create your first packing list →
            </Link>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                <th className="px-4 py-3 text-left">Invoice No</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Mode</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((l) => (
                <tr key={l.id} className="bg-white transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono text-xs text-indigo-600">
                    {l.invoice_no || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                    {l.consignee_name || <span className="text-slate-400 text-xs">No name</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 capitalize">{l.company}</td>
                  <td className="px-4 py-3 text-slate-500">{modeLabel(l.mode)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {l.list_date ? new Date(l.list_date).toLocaleDateString("en-AE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${badge(l.status)}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/packing-list/${l.id}`}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700">
                        View
                      </Link>
                      <Link href={`/packing-list/new?edit=${l.id}`}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700">
                        Edit
                      </Link>
                      <button type="button" onClick={() => handleDelete(l.id)} disabled={deleting === l.id}
                        className="rounded-lg px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50">
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
