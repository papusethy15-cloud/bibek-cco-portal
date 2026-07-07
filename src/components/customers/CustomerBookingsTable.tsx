import React from 'react';
import { Spinner } from '../ui/Spinner';

interface BookingRow {
  id: string;
  booking_number: string;
  status: string;
  scheduled_date: string;
  total_amount: number;
  service_name: string;
  service_id?: string;
  address_str: string;
  appliance_brand?: string;
  appliance_model?: string;
}

interface Props {
  bookings: BookingRow[];
  loading: boolean;
  onSelect?: (bookingId: string) => void;
  onRepeat?: (booking: BookingRow) => void;
  onRaiseTicket?: (bookingId: string) => void;
}

const statusTone: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-emerald-100 text-emerald-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-red-100 text-red-800',
  NO_SHOW: 'bg-red-100 text-red-800',
  PENDING: 'bg-gray-100 text-gray-700',
  PAYMENT_PENDING: 'bg-amber-100 text-amber-800',
  RESCHEDULED: 'bg-amber-100 text-amber-800',
};

export const CustomerBookingsTable: React.FC<Props> = ({ bookings, loading, onSelect, onRepeat, onRaiseTicket }) => {
  if (loading) return <div className="py-8"><Spinner /></div>;

  if (bookings.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No bookings yet for this customer.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
            <th className="py-2 pr-4">Booking</th>
            <th className="py-2 pr-4">Service</th>
            <th className="py-2 pr-4">Scheduled</th>
            <th className="py-2 pr-4">Address</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4 text-right">Amount</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr
              key={b.id}
              onClick={() => onSelect?.(b.id)}
              className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition"
            >
              <td className="py-2.5 pr-4 font-medium text-gray-900">{b.booking_number}</td>
              <td className="py-2.5 pr-4 text-gray-600">{b.service_name}</td>
              <td className="py-2.5 pr-4 text-gray-600">{new Date(b.scheduled_date).toLocaleDateString()}</td>
              <td className="py-2.5 pr-4 text-gray-500 max-w-[200px] truncate">{b.address_str}</td>
              <td className="py-2.5 pr-4">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusTone[b.status] || 'bg-gray-100 text-gray-700'}`}>
                  {b.status.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-right font-medium text-gray-900">₹{b.total_amount?.toLocaleString('en-IN')}</td>
              <td className="py-2.5 pr-4">
                <div className="flex flex-col gap-1">
                  {onRepeat && ['COMPLETED','CLOSED','PAID','CANCELLED'].includes(b.status) && (
                    <button
                      onClick={e => { e.stopPropagation(); onRepeat(b); }}
                      className="text-xs px-2 py-1 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 font-medium whitespace-nowrap"
                    >
                      🔁 Repeat
                    </button>
                  )}
                  {onRaiseTicket && !['CANCELLED'].includes(b.status) && (
                    <button
                      onClick={e => { e.stopPropagation(); onRaiseTicket(b.id); }}
                      className="text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 font-medium whitespace-nowrap"
                    >
                      🎫 Ticket
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
