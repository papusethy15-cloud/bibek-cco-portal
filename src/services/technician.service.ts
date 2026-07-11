import api from './api';
import { ApiResponse, Technician } from '../types';

// Backend returns { technicians: [...], total, page, per_page } — NOT items
interface TechnicianListResponse {
  technicians: Technician[];
  total: number;
  page: number;
  per_page: number;
}

// Normalised shape the rest of the app uses
export interface TechnicianPage {
  items: Technician[];
  total: number;
}

export const technicianService = {
  async list(params: Record<string, any> = {}): Promise<TechnicianPage> {
    const query = new URLSearchParams({ per_page: '50', ...params }).toString();
    const res = await api.get<ApiResponse<TechnicianListResponse>>(`/technicians?${query}`);
    const data = res.data.data;
    return {
      items: data?.technicians || [],
      total: data?.total || 0,
    };
  },

  async getById(id: string): Promise<Technician> {
    const res = await api.get<ApiResponse<Technician>>(`/technicians/${id}`);
    return res.data.data;
  },

  async getCandidates(bookingId: string): Promise<any[]> {
    const res = await api.get<ApiResponse<any[]>>(`/assignments/candidates/${bookingId}`);
    return res.data.data || [];
  },

  async manualAssign(bookingId: string, technicianId: string, notes?: string): Promise<any> {
    const res = await api.post('/assignments/manual', { booking_id: bookingId, technician_id: technicianId, notes: notes || undefined });
    return (res as any).data?.data || {};
  },

  async autoAssign(bookingId: string, notes?: string): Promise<{ technician_name?: string; score?: number }> {
    const res = await api.post('/assignments/auto', { booking_id: bookingId, notes: notes || undefined });
    return (res as any).data?.data || {};
  },

  async cancelAutoAssign(bookingId: string): Promise<void> {
    await api.post(`/assignments/cancel-auto/${bookingId}`);
  },
};
