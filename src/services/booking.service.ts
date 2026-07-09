import api from './api';
import { ApiResponse, Booking, PaginatedResponse } from '../types';

// Statuses that mean the job is fully done & paid — hidden from the main list by default
export const CLOSED_STATUSES = ['PAID', 'CLOSED', 'SETTLED'];

// Statuses excluded from the CCO bookings list view (active/actionable only)
const CCO_EXCLUDE = CLOSED_STATUSES.join(',');

export const bookingService = {
  // Main list — active/actionable bookings only (excludes PAID/CLOSED/SETTLED by default)
  async list(params: Record<string, any> = {}): Promise<PaginatedResponse<Booking>> {
    const defaults: Record<string, any> = { per_page: '20', exclude_status: CCO_EXCLUDE };
    const merged = { ...defaults, ...params };
    const query = new URLSearchParams(merged).toString();
    const res = await api.get<ApiResponse<PaginatedResponse<Booking>>>(`/bookings?${query}`);
    return res.data.data;
  },

  // Customer detail view — shows ALL bookings including closed ones for a specific customer
  async listByCustomer(customerId: string, params: Record<string, any> = {}): Promise<PaginatedResponse<Booking>> {
    const merged = { per_page: '50', customer_id: customerId, ...params };
    const query = new URLSearchParams(merged).toString();
    const res = await api.get<ApiResponse<PaginatedResponse<Booking>>>(`/bookings?${query}`);
    return res.data.data;
  },

  async getById(id: string): Promise<Booking> {
    const res = await api.get<ApiResponse<Booking>>(`/bookings/${id}`);
    return res.data.data;
  },

  async create(data: Partial<Booking>): Promise<Booking> {
    const res = await api.post<ApiResponse<Booking>>('/bookings', { ...data, source: 'CALL_CENTER' });
    return res.data.data;
  },

  async updateStatus(id: string, status: string, reason?: string): Promise<Booking> {
    const res = await api.patch<ApiResponse<Booking>>(`/bookings/${id}/status`, { status, reason });
    return res.data.data;
  },

  async slotSummary(date: string): Promise<Record<string, number>> {
    const res = await api.get<ApiResponse<{ date: string; slot_counts: Record<string, number> }>>(
      `/bookings/slot-summary?date=${date}`
    );
    return res.data.data.slot_counts;
  },

  async reschedule(id: string, date: string, slot: string): Promise<Booking> {
    const res = await api.patch<ApiResponse<Booking>>(`/bookings/${id}/reschedule`, {
      scheduled_date: date,
      scheduled_slot: slot,
    });
    return res.data.data;
  },

  async getTodayBookings(): Promise<Booking[]> {
    // Use local date (IST), NOT toISOString() which gives UTC and can be off by one day
    const d    = new Date();
    const pad  = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    // Use date_from + date_to (backend supports these; bare ?date= param is silently ignored).
    // Do not pass exclude_status — CCO scheduler shows ALL statuses including RESCHEDULED/CLOSED.
    const res = await api.get<ApiResponse<PaginatedResponse<Booking>>>(
      `/bookings?date_from=${today}&date_to=${today}&per_page=100`
    );
    return res.data.data?.items || [];
  },


  async patchBookingAddressGeo(
    bookingId: string,
    payload: { latitude?: number; longitude?: number; whatsapp_url?: string; location_source?: string }
  ): Promise<{ latitude: number; longitude: number; location_source: string }> {
    const res = await api.patch<any>(`/bookings/${bookingId}/address-geo`, payload);
    return res.data.data;
  },
    async getOverdue(): Promise<Booking[]> {
    const res = await api.get<ApiResponse<Booking[]>>('/bookings/overdue');
    return res.data.data || [];
  },
};

// ── All booking workflow action endpoints ──
export const bookingActionsService = {
  accept:          (id: string)                => api.post(`/bookings/${id}/accept`, {}),
  arrived:         (id: string)                => api.post(`/bookings/${id}/arrived`, {}),
  startInspection: (id: string)                => api.post(`/bookings/${id}/start-inspection`, {}),
  startWork:       (id: string)                => api.post(`/bookings/${id}/start-work`, {}),
  pauseWork:       (id: string)                => api.post(`/bookings/${id}/pause-work`, {}),
  resumeWork:      (id: string)                => api.post(`/bookings/${id}/resume-work`, {}),
  completeWork:    (id: string)                => api.post(`/bookings/${id}/complete-work`, {}),
  markPaid:        (id: string)                => api.post(`/bookings/${id}/mark-paid`, {}),
  timeline:        (id: string)                => api.get(`/bookings/${id}/timeline`),
  cancel:          (id: string, reason: string) => api.post(`/bookings/${id}/cancel`, { reason }),
  confirmCancellation: (id: string, reason?: string) => api.post(`/bookings/${id}/confirm-cancellation`, { reason }),
  rejectCancellation:  (id: string, reason?: string) => api.post(`/bookings/${id}/reject-cancellation`, { reason }),
  visitingCharge:      (id: string, amount: number, notes?: string) => api.post(`/bookings/${id}/visiting-charge`, { amount, notes }),
};
