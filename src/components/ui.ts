// Shared style tokens so every screen uses one consistent visual language.

/**
 * Card / panel surface — soft pastel gloss (top-down gradient + inset highlight)
 * with a layered, embossed shadow. Used across every screen.
 */
export const surface =
  "rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/80 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_6px_16px_-8px_rgba(15,23,42,0.12)] ring-1 ring-inset ring-white/60 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950 dark:ring-white/5";

/** Primary action button — glossy gradient with embossed highlight + press. */
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_-1px_rgba(79,70,229,0.4)] transition-all hover:from-indigo-500 hover:to-indigo-500 active:translate-y-px focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-900";

/** Secondary / neutral button — subtle gloss + emboss. */
export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-gradient-to-b from-white to-slate-100 px-4 py-2 text-sm font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(15,23,42,0.08)] transition-all hover:to-slate-200 active:translate-y-px focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:from-slate-800 dark:to-slate-900 dark:text-slate-200 dark:hover:to-slate-800 dark:focus:ring-offset-slate-900";

/** Small button (table row actions) — light gloss. */
export const btnSmall =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-gradient-to-b from-white to-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_1px_rgba(15,23,42,0.06)] transition-all hover:to-slate-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:from-slate-800 dark:to-slate-900 dark:text-slate-200 dark:hover:to-slate-800";

/** Text input / textarea. */
export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

/** Read-only field. */
export const readonlyClass =
  "w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400";

/** Table header cell. */
export const thCell =
  "whitespace-nowrap px-3 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400";

/** Table body cell. */
export const tdCell =
  "whitespace-nowrap px-3 py-2.5 text-slate-700 dark:text-slate-300";

/** Scrollable table container surface. */
export const tableWrap = `${surface} overflow-x-auto`;
