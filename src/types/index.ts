// ─── Auth ────────────────────────────────────────────────────────────────────
export interface AuthUser {
  user_id?: string;
  id?: string;
  name: string;
  email: string;
  role: 'CCO' | 'ADMIN' | 'SUPER_ADMIN';
  mobile?: string | null;
  profile_image?: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// ─── Customer ────────────────────────────────────────────────────────────────
export interface Customer {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  alternate_mobile?: string;
  customer_code?: string;
  notes?: string;
  total_bookings?: string;
  created_at: string;
  addresses?: CustomerAddress[];
}

export interface CustomerAddress {
  id: string;
  customer_id: string;
  label: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  pincode: string;
  is_default: boolean;
  latitude?: number | null;
  longitude?: number | null;
}

// ─── Booking ─────────────────────────────────────────────────────────────────
export type BookingStatus =
  | 'PENDING' | 'CONFIRMED' | 'ASSIGNED' | 'ACCEPTED'
  | 'EN_ROUTE' | 'ARRIVED' | 'INSPECTING' | 'IN_PROGRESS'
  | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED' | 'NO_SHOW'
  | 'PENDING_VERIFICATION' | 'TECHNICIAN_ACCEPTED'
  | 'INVOICE_GENERATED' | 'PAYMENT_PENDING' | 'WORK_STARTED'
  | 'WORK_PAUSED' | 'REFUND_INITIATED' | 'PAID' | 'CLOSED'
  | 'SETTLED' | 'QUOTATION_APPROVED' | 'CANCELLATION_REQUESTED';

export type BookingSource = 'WEBSITE' | 'MOBILE_APP' | 'CALL_CENTER' | 'WALK_IN' | 'FRANCHISE';

export interface Booking {
  id: string;
  booking_number: string;
  customer_id: string;
  technician_id?: string;
  service_id?: string;
  service_name?: string;
  address_id?: string;
  address_line?: string;
  address_str?: string;
  address_label?: string;
  city?: string;
  address_latitude?: number;
  address_longitude?: number;
  location_source?: string;
  status: BookingStatus;
  source: BookingSource;
  scheduled_date: string;
  scheduled_slot?: string;
  notes?: string;
  appliance_brand?: string;
  appliance_model?: string;
  base_amount: number;
  discount_amount: number;
  gst_amount: number;
  total_amount: number;
  priority: string;
  cancelled_reason?: string;
  // Status the booking was in before it was rescheduled (e.g. 'IN_PROGRESS', 'INSPECTING').
  // Used to show the correct repair stage context after a mid-repair reschedule.
  pre_reschedule_status?: string;
  // Pay Later enrichment — set by the booking list API when a PENDING PAY_LATER
  // payment transaction exists for this booking.
  has_pay_later?: boolean;
  pay_later_due?: string | null;
  created_at: string;
  customer?: Customer;
  technician?: Technician;
}

// ─── Technician ──────────────────────────────────────────────────────────────
export interface Technician {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  status?: string;
  city?: string;
  profile_image?: string;
}

// ─── Escalation ──────────────────────────────────────────────────────────────
export type EscalationStatus = 'OPEN' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

export interface Escalation {
  id: string;
  created_by: string;
  booking_id?: string;
  subject: string;
  description: string;
  priority: string;
  status: EscalationStatus;
  assigned_to?: string;
  escalation_level: number;
  resolution_notes?: string;
  resolved_at?: string;
  updated_at?: string;
  created_at: string;
}

// ─── CRM ─────────────────────────────────────────────────────────────────────
export interface CRMNote {
  id: string;
  customer_id: string;
  added_by: string;
  note: string;
  note_type: string;
  created_at: string;
}

export interface CallLog {
  id: string;
  customer_id: string;
  cco_id: string;
  duration_seconds?: number;
  outcome: string;
  summary: string;
  created_at: string;
}

// ─── Payment ─────────────────────────────────────────────────────────────────
export type PaymentMethod = 'RAZORPAY' | 'UPI' | 'CASH' | 'BANK_TRANSFER' | 'WALLET' | 'PAY_LATER';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'CANCELLED';

export interface PaymentTransaction {
  id: string;
  transaction_number: string;
  invoice_id: string;
  invoice_number?: string;        // returned by backend _payment_summary
  booking_id: string;
  booking_number?: string;        // returned by backend _payment_summary
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  notes?: string;
  paid_at?: string;
  created_at: string;
  due_collect_at?: string;        // PAY_LATER scheduled collection date
  last_reminder_at?: string;
  customer_name?: string;         // returned by backend _payment_summary
  customer?: {
    id: string;
    name: string;
    mobile: string;
  };
}

// ─── API helpers ─────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}
