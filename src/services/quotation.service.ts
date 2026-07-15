/**
 * quotation.service.ts — Full quotation API client for CCO portal
 * Mirrors admin dashboard quotationsAPI + appliancesAPI + inventoryAPI + customersAPI
 */
import api from './api';

export interface Quotation {
  id: string;
  quotation_number: string;
  status: string;
  version: number;
  total_amount: number;
  coupon_code?: string;
  coupon_discount?: number;
  tax_mode?: string;
  [key: string]: any;
}

export const quotationService = {
  // ── Quotation CRUD ──────────────────────────────────────────────────────────
  listByBooking: (bookingId: string) =>
    api.get(`/quotations?booking_id=${bookingId}&per_page=50`),
  get:           (id: string) => api.get(`/quotations/${id}`),
  create:        (d: any)     => api.post('/quotations', d),
  update:        (id: string, d: any) => api.put(`/quotations/${id}`, d),
  delete:        (id: string)         => api.delete(`/quotations/${id}`),

  // ── Workflow ────────────────────────────────────────────────────────────────
  submit:        (id: string)                => api.post(`/quotations/${id}/submit`, {}),
  approve:       (id: string)                => api.post(`/quotations/${id}/approve`, {}),
  reject:        (id: string, reason: string) => api.post(`/quotations/${id}/reject`, { reason }),
  revise:        (id: string, notes?: string) => api.post(`/quotations/${id}/revise`, { notes: notes || 'Revision by CCO' }),
  revertToDraft: (id: string)                => api.post(`/quotations/${id}/revert-to-draft`, {}),
  history:       (id: string)                => api.get(`/quotations/${id}/history`),

  // ── Services ────────────────────────────────────────────────────────────────
  addService:    (id: string, d: any)                  => api.post(`/quotations/${id}/services`, d),
  updateService: (id: string, itemId: string, d: any)  => api.put(`/quotations/${id}/services/${itemId}`, d),
  deleteService: (id: string, itemId: string)          => api.delete(`/quotations/${id}/services/${itemId}`),

  // ── Parts ───────────────────────────────────────────────────────────────────
  addPart:       (id: string, d: any)                  => api.post(`/quotations/${id}/parts`, d),
  updatePart:    (id: string, partId: string, d: any)  => api.put(`/quotations/${id}/parts/${partId}`, d),
  deletePart:    (id: string, partId: string)          => api.delete(`/quotations/${id}/parts/${partId}`),

  // ── Appliances ──────────────────────────────────────────────────────────────
  listAppliances:  (id: string)              => api.get(`/quotations/${id}/appliances`),
  addAppliance:    (id: string, d: any)      => api.post(`/quotations/${id}/appliances`, d),
  removeAppliance: (id: string, label: string) =>
    api.delete(`/quotations/${id}/appliances/${encodeURIComponent(label)}`),
  markRepeat:      (id: string, d: any)      => api.post(`/quotations/${id}/appliances/repeat`, d),

  // ── Financials ──────────────────────────────────────────────────────────────
  discount:   (id: string, d: any) => api.post(`/quotations/${id}/discount`, d),
  adjustment: (id: string, d: any) => api.post(`/quotations/${id}/adjustment`, d),

  // ── Service search + city price ─────────────────────────────────────────────
  searchServices: (q: string) =>
    api.get('/services', { params: { search: q, visible_only: false, per_page: 500 } }),
  cityPrices: (serviceId: string) =>
    api.get(`/services/${serviceId}/city-prices`),

  // ── Inventory parts (office stock + catalogue search) ───────────────────────
  searchInventory: (q: string, technicianId?: string) =>
    api.get('/inventory', { params: { search: q, per_page: 50, ...(technicianId ? { technician_id: technicianId } : {}) } }),

  // ── Customer appliances ─────────────────────────────────────────────────────
  customerAppliances: (customerId: string) =>
    api.get(`/appliances/customer/${customerId}`),
  addCustomerAppliance: (d: any) =>
    api.post('/appliances', d),

  // ── Customer GST profile ────────────────────────────────────────────────────
  getCustomer: (customerId: string) =>
    api.get(`/customers/${customerId}`),

  // ── PDF download ─────────────────────────────────────────────────────────────
  pdf: (id: string) =>
    api.get(`/quotations/${id}/pdf`, { responseType: 'blob' }),
};
