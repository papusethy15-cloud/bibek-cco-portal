import api from './api';
import { ApiResponse } from '../types';

export type CallbackStatus = 'PENDING' | 'CALLED' | 'RESOLVED' | 'SKIPPED';

export interface CallbackRequest {
  id: string;
  mobile: string;
  name: string | null;
  message: string | null;
  source: string;
  status: CallbackStatus;
  admin_notes: string | null;
  called_at: string | null;
  created_at: string;
  has_customer: boolean;
  customer_id: string | null;
  customer_name: string | null;
  page_url: string | null;
  ip_address: string | null;
  location: string | null;
}

export interface CallbackListResponse {
  items: CallbackRequest[];
  total: number;
  skip: number;
  limit: number;
}

export interface CallbackDetail extends CallbackRequest {
  user_agent: string | null;
  customer: {
    id: string;
    name: string;
    mobile: string;
    email: string | null;
    customer_code: string;
    total_bookings: number;
    addresses: any[];
    last_bookings: any[];
  } | null;
}

export const callbackRequestService = {
  async list(params: {
    status?: string;
    search?: string;
    skip?: number;
    limit?: number;
  } = {}): Promise<CallbackListResponse> {
    const p: Record<string, string> = {
      skip: String(params.skip ?? 0),
      limit: String(params.limit ?? 50),
    };
    if (params.status) p.status = params.status;
    if (params.search) p.search = params.search;
    const res = await api.get<ApiResponse<CallbackListResponse>>(
      `/chatbot/callback-requests?${new URLSearchParams(p)}`
    );
    return res.data.data;
  },

  async getById(id: string): Promise<CallbackDetail> {
    const res = await api.get<ApiResponse<CallbackDetail>>(`/chatbot/callback-requests/${id}`);
    return res.data.data;
  },

  async update(id: string, data: { status?: string; admin_notes?: string }): Promise<void> {
    await api.put(`/chatbot/callback-requests/${id}`, data);
  },
};
