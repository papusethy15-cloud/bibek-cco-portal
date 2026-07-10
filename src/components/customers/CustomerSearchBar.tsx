import React, { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface Props {
  onSearch: (mobile: string) => void;
  loading?: boolean;
}

export const CustomerSearchBar: React.FC<Props> = ({ onSearch, loading }) => {
  const [mobile, setMobile] = useState('');

  const [validationErr, setValidationErr] = React.useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = mobile.replace(/\D/g, '');
    if (digits.length !== 10) { setValidationErr('Enter exactly 10 digits.'); return; }
    if (!/^[6-9]/.test(digits)) { setValidationErr('Mobile must start with 6, 7, 8, or 9.'); return; }
    setValidationErr('');
    onSearch(digits);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Customer mobile number</label>
          <div className="flex rounded-xl overflow-hidden border border-gray-200 focus-within:ring-2 focus-within:ring-blue-500 transition">
            <span className="px-3 flex items-center bg-gray-50 text-gray-500 text-sm border-r border-gray-200 select-none font-medium">+91</span>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="9XXXXXXXXX"
              value={mobile}
              onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '').slice(0, 10)); setValidationErr(''); }}
              autoFocus
              className="flex-1 px-3 py-2.5 text-sm outline-none"
            />
          </div>
          {validationErr && <p className="text-xs text-red-500 mt-1">{validationErr}</p>}
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
