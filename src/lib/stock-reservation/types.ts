export type ImpoStatus = "pending" | "in_transit" | "arrived" | "cancelled";
export type ReservationStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface Impo {
  id: string;
  impo_number: string;
  eta: string;              // ISO date string
  status: ImpoStatus;
  notes: string | null;
  uploaded_by: string | null;
  source_file_name: string | null;
  total_skus: number;
  created_at: string;
}

export interface ImpoLine {
  id: string;
  impo_id: string;
  brand: string | null;
  item_code: string;
  description: string | null;
  category: string | null;
  qty_incoming: number;
  created_at: string;
}

export interface ImpoLineWithAvailability extends ImpoLine {
  qty_reserved: number;
  qty_available: number;
  impo: Impo;
}

export interface StockReservation {
  id: string;
  impo_line_id: string;
  requested_by: string;
  qty_requested: number;
  qty_approved: number | null;
  status: ReservationStatus;
  customer_ref: string | null;
  notes: string | null;
  grace_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  // joined
  impo_line?: ImpoLineWithAvailability;
  requester_name?: string | null;
}

export interface ImpoWithLines extends Impo {
  lines: ImpoLineWithAvailability[];
}

/** Shape used by the upload preview step */
export interface UploadPreviewGroup {
  eta: string;
  suggestedImpoNumber: string;
  lines: UploadPreviewLine[];
}

export interface UploadPreviewLine {
  brand: string | null;
  item_code: string;
  description: string | null;
  category: string | null;
  qty_incoming: number;
}

/** Shape sent to the confirm-upload endpoint */
export interface UploadConfirmPayload {
  groups: Array<{
    impo_number: string;
    eta: string;
    lines: UploadPreviewLine[];
  }>;
  source_file_name: string;
}
