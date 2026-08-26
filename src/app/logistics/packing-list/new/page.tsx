import { Suspense } from "react";
import PackingListBuilder from "../PackingListBuilder";

export default function NewPackingListPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
      <PackingListBuilder />
    </Suspense>
  );
}
