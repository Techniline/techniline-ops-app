export type BookingStatus = "pending" | "called" | "no_answer" | "closed";

export interface ConsultBooking {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  preferred_slot: string | null;
  notes: string | null;
  status: BookingStatus;
  sla_deadline: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  call_notes: string | null;
}

export interface ConsultBookingInsert {
  name: string;
  phone: string;
  email?: string | null;
  preferred_slot?: string | null;
  notes?: string | null;
  sla_deadline: string;
}

export interface ConsultBookingPatch {
  status?: BookingStatus;
  call_notes?: string | null;
}

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Pending",
  called: "Called",
  no_answer: "No Answer",
  closed: "Closed",
};
