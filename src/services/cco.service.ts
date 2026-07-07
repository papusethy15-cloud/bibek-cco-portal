import api from './api';
import { ApiResponse } from '../types';

export interface CCOCreatePayload {
  name: string;
  mobile: string;
  email: string;
  password: string;
  city?: string;
  role: 'CCO';
}

export interface PermissionOverride {
  permission_code: string;
  is_granted: boolean;
}

export interface CreatedUser {
  id: string;
  name: string;
  mobile: string;
  email: string;
  role: string;
  city?: string;
  is_verified: boolean;
  created_at: string;
}

export const ccoService = {
  async createCCO(data: CCOCreatePayload): Promise<CreatedUser> {
    const res = await api.post<ApiResponse<CreatedUser>>('/users', { ...data, role: 'CCO' });
    return res.data.data;
  },

  async updatePermissions(userId: string, overrides: PermissionOverride[]): Promise<void> {
    await api.put(`/users/${userId}/permissions`, { overrides });
  },

  async listCCOs(): Promise<any> {
    const res = await api.get('/users?role=CCO&per_page=50');
    return res.data.data;
  },
};
