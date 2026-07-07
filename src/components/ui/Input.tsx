import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({ label, error, hint, icon, className = '', ...props }) => (
  <div className="flex flex-col gap-1">
    {label && <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</label>}
    <div className="relative">
      {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>}
      <input
        {...props}
        className={`
          w-full rounded-lg border px-3 py-2 text-sm text-gray-900
          bg-white outline-none transition
          border-gray-300 focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20
          ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}
          ${icon ? 'pl-9' : ''}
          ${className}
        `}
      />
    </div>
    {error && <p className="text-xs text-red-600">{error}</p>}
    {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
  </div>
);
