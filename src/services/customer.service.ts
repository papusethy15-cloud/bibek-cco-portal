import api from './api';
import { ApiResponse, Customer, CustomerAddress, PaginatedResponse } from '../types';

export const customerService = {
  async searchByMobile(mobile: string): Promise<Customer | null> {
    const res = await api.get<ApiResponse<Customer | null>>(`/customers/check-mobile/${mobile}`);
    return res.data.data || null;
  },

  async getById(id: string): Promise<Customer> {
    const res = await api.get<ApiResponse<Customer>>(`/customers/${id}`);
    return res.data.data;
  },

  async create(data: Partial<Customer>): Promise<Customer> {
    const res = await api.post<ApiResponse<Customer>>('/customers', data);
    return res.data.data;
  },

  async getAddresses(customerId: string): Promise<CustomerAddress[]> {
    const res = await api.get<ApiResponse<CustomerAddress[]>>(`/customers/${customerId}/addresses`);
    return res.data.data;
  },

  async addAddress(customerId: string, address: Partial<CustomerAddress>): Promise<CustomerAddress> {
    const res = await api.post<ApiResponse<CustomerAddress>>(`/customers/${customerId}/addresses`, address);
    return res.data.data;
  },

  async updateAddress(customerId: string, addressId: string, data: Partial<CustomerAddress>): Promise<CustomerAddress> {
    const res = await api.put<ApiResponse<CustomerAddress>>(`/customers/${customerId}/addresses/${addressId}`, data);
    return res.data.data;
  },

  async deleteAddress(customerId: string, addressId: string): Promise<void> {
    await api.delete(`/customers/${customerId}/addresses/${addressId}`);
  },

  async patchAddressGeo(
    customerId: string,
    addressId: string,
    payload: { latitude?: number; longitude?: number; whatsapp_url?: string; location_source?: string }
  ): Promise<{ latitude: number; longitude: number; location_source: string }> {
    const res = await api.patch<any>(`/customers/${customerId}/addresses/${addressId}/geo`, payload);
    return res.data.data;
  },

  async setDefaultAddress(customerId: string, addressId: string): Promise<void> {
    await api.patch(`/customers/${customerId}/addresses/${addressId}/set-default`, {});
  },

  async getBookings(customerId: string, page = 1): Promise<PaginatedResponse<any>> {
    const res = await api.get<ApiResponse<PaginatedResponse<any>>>(`/customers/${customerId}/bookings?page=${page}`);
    return res.data.data;
  },

  async addNote(customerId: string, note: string, noteType = 'GENERAL'): Promise<void> {
    await api.post('/crm/notes', { customer_id: customerId, note, note_type: noteType });
  },

  async getNotes(customerId: string): Promise<any[]> {
    const res = await api.get<ApiResponse<any[]>>(`/crm/notes?customer_id=${customerId}`);
    return res.data.data || [];
  },

  async list(page = 1, search = ''): Promise<PaginatedResponse<Customer>> {
    const res = await api.get<ApiResponse<PaginatedResponse<Customer>>>(
      `/customers?page=${page}&search=${search}&limit=20`
    );
    return res.data.data;
  },
};
