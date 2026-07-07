import api from './api';
import { ApiResponse, PaymentTransaction, PaginatedResponse } from '../types';

// Payments that are fully settled — hidden from CCO default view
export const SETTLED_PAYMENT_STATUSES = ['SUCCESS', 'REFUNDED'];

export const paymentService = {
  // Main list — by default excludes SUCCESS/REFUNDED so CCO sees only actionable transactions
  async list(params: Record<string, any> = {}): Promise<PaginatedResponse<PaymentTransaction>> {
    const defaults: Record<string, any> = {
      per_page: '20',
      exclude_status: SETTLED_PAYMENT_STATUSES.join(','),
    };
    const merged = { ...defaults, ...params };
    const query = new URLSearchParams(merged).toString();
    const res = await api.get<ApiResponse<PaginatedResponse<PaymentTransaction>>>(`/payments/history?${query}`);
    return res.data.data;
  },

  // Full history — all statuses including SUCCESS (used when CCO explicitly wants full view)
  async listAll(params: Record<string, any> = {}): Promise<PaginatedResponse<PaymentTransaction>> {
    const merged = { per_page: '20', ...params };
    const query = new URLSearchParams(merged).toString();
    const res = await api.get<ApiResponse<PaginatedResponse<PaymentTransaction>>>(`/payments/history?${query}`);
    return res.data.data;
  },

  // Pay-later pending collections — always shows only PAY_LATER+PENDING
  async getPayLaterDue(): Promise<PaymentTransaction[]> {
    const res = await api.get<ApiResponse<PaginatedResponse<PaymentTransaction>>>(
      '/payments/history?method=PAY_LATER&status=PENDING&per_page=100'
    );
    return res.data.data?.items || [];
  },

  async markCollected(transactionId: string): Promise<{ id: string; status: string; paid_at: string }> {
    const res = await api.post<any>(`/payments/${transactionId}/mark-collected`, {});
    return res.data.data;
  },

  async voidPayLater(transactionId: string): Promise<void> {
    await api.post(`/payments/${transactionId}/void`, {});
  },

  async recordPayment(data: {
    invoice_id: string;
    booking_id: string;
    method: string;
    amount: number;
    notes?: string;
    due_collect_at?: string;
  }): Promise<PaymentTransaction> {
    const res = await api.post<ApiResponse<PaymentTransaction>>('/payments/cash', data);
    return res.data.data;
  },
};
