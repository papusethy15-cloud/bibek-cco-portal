import api from './api';
import { ApiResponse, PaginatedResponse } from '../types';

export type CallOutcome =
  | 'RESOLVED'
  | 'TICKET_RAISED'
  | 'NO_ANSWER'
  | 'CALLBACK_REQUESTED'
  | 'PAYMENT_REMINDER'
  | 'OTHER';

export interface CallLogEntry {
  id: string;
  customer_id: string;
  cco_id: string;
  cco_name: string;
  booking_id?: string;
  direction: 'INBOUND' | 'OUTBOUND';
  duration_seconds?: number;
  outcome: CallOutcome;
  summary: string;
  created_at: string;
}

export interface CreateCallLogPayload {
  customer_id: string;
  booking_id?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  duration_seconds?: number;
  outcome: CallOutcome;
  summary: string;
}

export const callLogService = {
  async create(data: CreateCallLogPayload): Promise<{ id: string }> {
    const res = await api.post<ApiResponse<{ id: string }>>('/crm/call-logs', data);
    return res.data.data;
  },

  // Global listing — customer_id and outcome are optional filters
  async list(params: {
    customer_id?: string;
    outcome?: string;
    direction?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    per_page?: number;
  } = {}): Promise<PaginatedResponse<CallLogEntry>> {
    const p: Record<string, string> = {
      page: String(params.page || 1),
      per_page: String(params.per_page || 20),
    };
    if (params.customer_id) p.customer_id = params.customer_id;
    if (params.outcome)     p.outcome     = params.outcome;
    if (params.direction)   p.direction   = params.direction;
    if (params.date_from)   p.date_from   = params.date_from;
    if (params.date_to)     p.date_to     = params.date_to;
    const query = new URLSearchParams(p).toString();
    const res = await api.get<ApiResponse<PaginatedResponse<CallLogEntry>>>(
      `/crm/call-logs?${query}`
    );
    return res.data.data;
  },

  // Convenience alias used by customers zone
  async listByCustomer(customerId: string, page = 1): Promise<PaginatedResponse<CallLogEntry>> {
    return callLogService.list({ customer_id: customerId, page });
  },
};
