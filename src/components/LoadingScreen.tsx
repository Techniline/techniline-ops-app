export function LoadingScreen({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 p-8">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400"
        aria-hidden="true"
      />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
