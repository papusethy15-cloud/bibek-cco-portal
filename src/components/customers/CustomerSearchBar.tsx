import React, { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface Props {
  onSearch: (mobile: string) => void;
  loading?: boolean;
}

export const CustomerSearchBar: React.FC<Props> = ({ onSearch, loading }) => {
  const [mobile, setMobile] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = mobile.trim();
    if (trimmed.length < 10) return;
    onSearch(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            label="Customer mobile number"
            placeholder="Enter 10-digit mobile number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/[^\d+]/g, ''))}
            autoFocus
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            }
          />
        </div>
        <Button type="submit" loading={loading} size="md">
          Search
        </Button>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Always search the mobile number first — every call starts here.
      </p>
    </form>
  );
};
