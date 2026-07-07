import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Customer } from '../../types';

interface Props {
  customer: Customer;
  onLogCall: () => void;
  callTimerDisplay?: string;  // e.g. "02:34" — shown when call timer is running
  onRaiseTicket: () => void;
}

export const CustomerProfileCard: React.FC<Props> = ({ customer, onLogCall, onRaiseTicket, callTimerDisplay }) => {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[#1B4FD8]/10 flex items-center justify-center text-[#1B4FD8] font-semibold text-lg shrink-0">
            {customer.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{customer.name}</h2>
              {customer.customer_code && <Badge label={customer.customer_code!} color="blue" />}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{customer.mobile}{customer.email ? ` · ${customer.email}` : ''}</p>
            <p className="text-xs text-gray-400 mt-1">
              {customer.total_bookings || 0} bookings · Customer since {new Date(customer.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate('/bookings', { state: { customerId: customer.id, customerName: customer.name } })}>
            New booking
          </Button>
          <div className="flex items-center gap-2">
            {callTimerDisplay && (
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-xs font-mono font-semibold text-emerald-700">{callTimerDisplay}</span>
              </div>
            )}
            <Button size="sm" variant="secondary" onClick={onLogCall}>Log call</Button>
          </div>
          <Button size="sm" variant="danger" onClick={onRaiseTicket}>Raise ticket</Button>
        </div>
      </div>

      {customer.notes && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Profile notes</p>
          <p className="text-sm text-gray-700">{customer.notes}</p>
        </div>
      )}
    </div>
  );
};
