import { surface } from "@/components/ui";

export function ComingSoon({ channel }: { channel: string }) {
  return (
    <div className={`${surface} flex flex-col items-center justify-center gap-3 p-12 text-center`}>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{channel}</h2>
      <p className="max-w-md text-sm text-slate-500">
        Coming Soon — This module will be connected later.
      </p>
    </div>
  );
}
