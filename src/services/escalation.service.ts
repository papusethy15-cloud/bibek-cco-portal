import api from './api';
import { ApiResponse, Escalation, PaginatedResponse } from '../types';

export const escalationService = {
  async create(data: {
    booking_id?: string;
    subject: string;
    description: string;
    priority?: string;
  }): Promise<Escalation> {
    const res = await api.post<ApiResponse<Escalation>>('/escalations', data);
    return res.data.data;
  },

  async list(params: Record<string, any> = {}): Promise<PaginatedResponse<Escalation>> {
    const query = new URLSearchParams({ limit: '20', ...params }).toString();
    const res = await api.get<ApiResponse<PaginatedResponse<Escalation>>>(`/escalations?${query}`);
    return res.data.data;
  },

  async getById(id: string): Promise<Escalation> {
    const res = await api.get<ApiResponse<Escalation>>(`/escalations/${id}`);
    return res.data.data;
  },

  async updateStatus(id: string, status: string, notes?: string): Promise<Escalation> {
    const payload: Record<string, any> = { status };
    if (notes !== undefined) payload.resolution_notes = notes;
    const res = await api.patch<ApiResponse<Escalation>>(`/escalations/${id}`, payload);
    return res.data.data;
  },

  async updatePriority(id: string, priority: string): Promise<Escalation> {
    const res = await api.patch<ApiResponse<Escalation>>(`/escalations/${id}`, { priority });
    return res.data.data;
  },
};
