// Shared option sets for the Logistics module. Keep values in sync with the
// CHECK-free text columns defined in LOGISTICS-SETUP.md.

export const LOGISTICS_STATUS: { value: string; label: string }[] = [
  { value: "new_order", label: "New Order" },
  { value: "checking_stock", label: "Checking Stock" },
  { value: "awaiting_branch", label: "Awaiting Branch Product" },
  { value: "prt_requested", label: "PRT Requested" },
  { value: "ready_to_dispatch", label: "Ready to Dispatch" },
  { value: "tracking_pending", label: "Tracking Pending" },
  { value: "tracking_updated", label: "Tracking Updated" },
  { value: "fulfilled_shopify", label: "Fulfilled in Shopify" },
  { value: "out_for_delivery", label: "Out for Delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "issue_hold", label: "Issue / Hold" },
];

export const SOURCE_LOCATIONS: { value: string; label: string }[] = [
  { value: "warehouse", label: "Warehouse" },
  { value: "hq", label: "Techniline HQ" },
  { value: "al_shoala", label: "Al Shoala Showroom" },
  { value: "soundline", label: "Soundline Main / SLM" },
  { value: "other", label: "Other" },
];

export const PICKING_STATUS: { value: string; label: string }[] = [
  { value: "not_checked", label: "Not Checked" },
  { value: "available", label: "Available" },
  { value: "requested", label: "Requested from Branch" },
  { value: "picked", label: "Picked" },
  { value: "packed", label: "Packed" },
  { value: "not_available", label: "Not Available" },
  { value: "issue", label: "Issue" },
];

export const COURIERS: { value: string; label: string }[] = [
  { value: "aramex", label: "Aramex" },
  { value: "quiqup", label: "Quiqup" },
  { value: "jeebly", label: "Jeebly" },
  { value: "team", label: "Team Delivery" },
  { value: "cargo", label: "Cargo" },
  { value: "other", label: "Other" },
];

export const PRT_STATUS: { value: string; label: string }[] = [
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "picking", label: "Picking" },
  { value: "in_transit", label: "In Transit" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
  { value: "not_available", label: "Not Available" },
  { value: "closed", label: "Closed" },
];

export const PRT_URGENCY: { value: string; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "urgent", label: "Urgent" },
  { value: "same_day", label: "Same Day" },
  { value: "customer_waiting", label: "Customer Waiting" },
];

export const RESELLER_STATUS: { value: string; label: string }[] = [
  { value: "new", label: "New" },
  { value: "preparing", label: "Preparing" },
  { value: "ready", label: "Ready to Dispatch" },
  { value: "out_for_delivery", label: "Out for Delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "issue", label: "Issue / Hold" },
];

export const CARGO_STATUS: { value: string; label: string }[] = [
  { value: "new", label: "New" },
  { value: "packing", label: "Packing" },
  { value: "waiting_pickup", label: "Waiting for Pickup" },
  { value: "picked_up", label: "Picked Up" },
  { value: "in_transit", label: "In Transit" },
  { value: "delivered", label: "Delivered" },
  { value: "issue", label: "Issue / Hold" },
  { value: "cancelled", label: "Cancelled" },
];

export function labelFor(set: { value: string; label: string }[], value: string | null | undefined): string {
  if (!value) return "—";
  return set.find((o) => o.value === value)?.label ?? value;
}
