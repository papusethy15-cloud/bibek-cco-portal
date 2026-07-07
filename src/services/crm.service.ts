import api from './api';
import { ApiResponse } from '../types';

export interface CRMFollowup {
  id: string;
  customer_id: string;
  subject: string;
  notes?: string;
  due_date: string;
  status: string;
}

export const crmService = {
  async createFollowup(data: {
    customer_id: string;
    subject: string;
    notes?: string;
    due_date: string;
  }): Promise<{ id: string }> {
    const res = await api.post<ApiResponse<{ id: string }>>('/crm/followup', data);
    return res.data.data;
  },

  async listFollowups(params: Record<string, any> = {}): Promise<CRMFollowup[]> {
    const query = new URLSearchParams({ per_page: '50', ...params }).toString();
    const res = await api.get<ApiResponse<CRMFollowup[]>>(`/crm/followups?${query}`);
    return res.data.data || [];
  },

  async markFollowupDone(id: string): Promise<void> {
    await api.patch(`/crm/followups/${id}/done`, {});
  },
};
