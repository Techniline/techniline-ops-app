import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";

/** Shared chrome for protected pages: persistent sidebar + scrollable content. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 sm:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
