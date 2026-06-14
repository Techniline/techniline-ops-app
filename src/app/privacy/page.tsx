/**
 * Public privacy & data-handling page (no auth guard) — the URL Amazon's
 * Solution Provider security questionnaire asks for. Describes how Amazon
 * Information is handled in Techniline Ops.
 */
export const metadata = {
  title: "Privacy & Data Handling — Techniline Operations",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800 dark:text-slate-200">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Privacy &amp; Data Handling Policy</h1>
      <p className="mt-1 text-sm text-slate-500">Techniline Electronics LLC — Operations application. Last updated: June 2026.</p>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Who we are</h2>
        <p>
          This application is a private, internal operations tool built and used solely by Techniline Electronics LLC. It is not offered
          to or used by any third party.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-slate-900 dark:text-slate-100">What data we handle</h2>
        <p>
          We process information from our own Amazon Selling Partner account via the Amazon Selling Partner API (SP-API) — purchase
          orders, orders, fulfillment and return records, and financial settlement data — together with operational records we create
          (delivery, transfer and return logs). We deliberately minimise personally identifiable information (PII): order records are
          stored without buyer names, addresses, phone numbers or payment details.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-slate-900 dark:text-slate-100">How it is stored and protected</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Data is stored in a managed PostgreSQL database (Supabase, on AWS), encrypted at rest (AES-256) with provider-managed keys.</li>
          <li>All traffic is encrypted in transit using TLS/HTTPS.</li>
          <li>API credentials and secrets are held only as server-side encrypted environment variables; they are never exposed to the browser or stored in source code.</li>
          <li>Access is restricted by authenticated accounts with row-level security and role/capability-based permissions, on a need-to-know basis.</li>
        </ul>

        <h2 className="mt-6 text-lg font-semibold text-slate-900 dark:text-slate-100">Sharing &amp; sources</h2>
        <p>
          Amazon Information is used only internally by authorised Techniline staff. It is never sold, shared with, or processed by any
          third party. Our only source of Amazon Information is the Amazon SP-API for our own account.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-slate-900 dark:text-slate-100">Retention</h2>
        <p>
          Operational records are retained only as long as needed for fulfilment, returns processing, reconciliation and our legal/tax
          obligations, after which they are deleted or anonymised.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-slate-900 dark:text-slate-100">Incident response &amp; contact</h2>
        <p>
          We maintain an incident-response plan with defined roles, periodic reviews, and a commitment to notify Amazon within 24 hours of
          a confirmed security incident affecting Amazon Information. Privacy or security questions:{" "}
          <a className="text-indigo-600 underline dark:text-indigo-400" href="mailto:vihan@techniline.org">vihan@techniline.org</a>.
        </p>
      </section>
    </main>
  );
}
