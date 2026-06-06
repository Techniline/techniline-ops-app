import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";

/** Shared chrome for protected pages: persistent sidebar + main content area. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
