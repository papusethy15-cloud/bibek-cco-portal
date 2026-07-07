import api from './api';
import { ApiResponse } from '../types';

export interface Invoice {
  id: string;
  invoice_number: string;
  booking_id: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  total_amount: number;
  balance_amount?: number;   // authoritative server-side balance (after all SUCCESS payments)
  paid_amount?: number;
  due_date?: string;
  created_at: string;
}

export const invoiceService = {
  async getByBooking(bookingId: string): Promise<Invoice | null> {
    try {
      const res = await api.get<ApiResponse<Invoice[]>>(`/invoices?booking_id=${bookingId}&limit=1`);
      const items = (res.data.data as any)?.items || res.data.data;
      return Array.isArray(items) && items.length > 0 ? items[0] : null;
    } catch {
      return null;
    }
  },

  async generate(
    bookingId: string,
    quotationId: string,
    invoiceType?: string,
    gstin?: string,
    businessName?: string,
    businessAddress?: string,
    notes?: string,
  ): Promise<Invoice> {
    const res = await api.post<ApiResponse<Invoice>>('/invoices', {
      booking_id: bookingId,
      quotation_id: quotationId,
      invoice_type: invoiceType || 'GST_B2C',
      gstin: gstin || undefined,
      business_name: businessName || undefined,
      business_address: businessAddress || undefined,
      notes: notes || undefined,
    });
    return res.data.data;
  },

  async recordCashPayment(invoiceId: string, bookingId: string, amount: number, notes?: string): Promise<void> {
    await api.post('/payments/cash', { invoice_id: invoiceId, booking_id: bookingId, amount, notes });
  },
};
