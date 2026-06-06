/**
 * A generic status pill that colour-codes common finance status words.
 * Statuses across these tables are free-form text, so we match by keyword.
 */
export function StatusPill({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;

  const v = value.toLowerCase();
  let style =
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";

  if (/(paid|closed|resolved|matched|complete|approved|credited|done)/.test(v)) {
    style =
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  } else if (
    /(open|pending|await|progress|partial|review|raised|submitted|new)/.test(v)
  ) {
    style =
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  } else if (/(reject|fail|gap|unmatch|overdue|cancel|missing)/.test(v)) {
    style = "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  }

  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
