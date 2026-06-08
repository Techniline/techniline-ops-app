/**
 * Shared CSV + print-to-PDF export toolkit. Every report in the app is defined
 * as a single `{ title, subtitle, headers, rows }` dataset and rendered to
 * either CSV (Excel) or PDF (print) from that one shape — so a CSV download can
 * sit next to every PDF download.
 */

export type Cell = string | number | null;

/** A printable/exportable report: one dataset, two output formats. */
export interface ReportTable {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Cell[][];
}

function cell(value: Cell): string {
  if (value == null) return "";
  return typeof value === "number" ? String(value) : value;
}

/** Escape one CSV field per RFC 4180 (quote if it contains ", , or newline). */
function csvField(value: Cell): string {
  const s = cell(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build an RFC-4180 CSV string from headers + rows. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  return lines.join("\r\n");
}

/**
 * Concatenate several tables into one CSV (each preceded by an optional title
 * row and separated by a blank line) — used for the entity report's
 * detail + totals blocks.
 */
export function tablesToCsv(tables: ReportTable[]): string {
  return tables
    .map((t) => {
      const head = t.title ? `${csvField(t.title)}\r\n` : "";
      return head + toCsv(t.headers, t.rows);
    })
    .join("\r\n\r\n");
}

/** Trigger a client-side CSV file download. */
export function downloadCsv(filename: string, csv: string): void {
  // Prepend a BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** Render one report dataset as an HTML table (used by PDF print + email body). */
export function renderTableReportHtml(table: ReportTable): string {
  const head = table.headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body =
    table.rows
      .map(
        (r) =>
          `<tr>${r
            .map((c, i) => `<td${i === 0 ? "" : ' style="text-align:right"'}>${esc(cell(c))}</td>`)
            .join("")}</tr>`
      )
      .join("") ||
    `<tr><td colspan="${table.headers.length}" style="text-align:center;color:#888">No rows.</td></tr>`;

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111">
    <h2 style="margin:0 0 4px">${esc(table.title)}</h2>
    ${table.subtitle ? `<p style="margin:0 0 12px;color:#666">${esc(table.subtitle)}</p>` : ""}
    <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12px">
      <thead><tr style="background:#f1f5f9;text-align:left">${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

/** Render several report tables stacked into one HTML document body. */
export function renderTablesHtml(tables: ReportTable[]): string {
  return tables.map((t) => renderTableReportHtml(t)).join('<div style="height:18px"></div>');
}

/**
 * Open a print-friendly window for the given HTML body and trigger the browser
 * print dialog (→ "Save as PDF"). Returns false if a pop-up blocker stopped it.
 */
export function printReportHtml(title: string, bodyHtml: string): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(
    `<!doctype html><html><head><title>${esc(title)}</title></head><body>${bodyHtml}<script>window.onload=function(){window.print();}</script></body></html>`
  );
  w.document.close();
  return true;
}
