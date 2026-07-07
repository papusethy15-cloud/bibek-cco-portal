export type BookingStatus =
  | 'PENDING' | 'CONFIRMED' | 'ASSIGNED' | 'ACCEPTED'
  | 'EN_ROUTE' | 'ARRIVED' | 'INSPECTING' | 'IN_PROGRESS'
  | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED' | 'NO_SHOW'
  | 'PENDING_VERIFICATION' | 'TECHNICIAN_ACCEPTED'
  | 'INVOICE_GENERATED' | 'PAYMENT_PENDING' | 'WORK_STARTED'
  | 'WORK_PAUSED' | 'REFUND_INITIATED' | 'PAID' | 'CLOSED'
  | 'SETTLED' | 'QUOTATION_APPROVED' | 'CANCELLATION_REQUESTED';

export const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  ASSIGNED: 'bg-indigo-100 text-indigo-800',
  ACCEPTED: 'bg-cyan-100 text-cyan-800',
  EN_ROUTE: 'bg-sky-100 text-sky-800',
  ARRIVED: 'bg-teal-100 text-teal-800',
  INSPECTING: 'bg-purple-100 text-purple-800',
  IN_PROGRESS: 'bg-violet-100 text-violet-800',
  WORK_STARTED: 'bg-violet-100 text-violet-800',
  WORK_PAUSED: 'bg-orange-100 text-orange-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  PAID: 'bg-green-100 text-green-800',
  CLOSED: 'bg-green-100 text-green-900',
  SETTLED: 'bg-green-100 text-green-900',
  CANCELLED: 'bg-red-100 text-red-800',
  NO_SHOW: 'bg-red-100 text-red-700',
  RESCHEDULED: 'bg-amber-100 text-amber-800',
  PAYMENT_PENDING: 'bg-orange-100 text-orange-700',
  INVOICE_GENERATED: 'bg-blue-100 text-blue-700',
  QUOTATION_APPROVED: 'bg-teal-100 text-teal-800',
  PENDING_VERIFICATION: 'bg-yellow-100 text-yellow-700',
  TECHNICIAN_ACCEPTED: 'bg-cyan-100 text-cyan-700',
  REFUND_INITIATED: 'bg-pink-100 text-pink-800',
  CANCELLATION_REQUESTED: 'bg-red-100 text-red-600',
};

export const statusLabels: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  EN_ROUTE: 'En Route',
  ARRIVED: 'Arrived',
  INSPECTING: 'Inspecting',
  IN_PROGRESS: 'In Progress',
  WORK_STARTED: 'Work Started',
  WORK_PAUSED: 'Paused',
  COMPLETED: 'Completed',
  PAID: 'Paid',
  CLOSED: 'Closed',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No Show',
  RESCHEDULED: 'Rescheduled',
  PAYMENT_PENDING: 'Payment Pending',
  INVOICE_GENERATED: 'Invoice Generated',
  QUOTATION_APPROVED: 'Quotation Approved',
  PENDING_VERIFICATION: 'Pending Verification',
  TECHNICIAN_ACCEPTED: 'Tech Accepted',
  REFUND_INITIATED: 'Refund Initiated',
  CANCELLATION_REQUESTED: 'Cancel Requested',
};
