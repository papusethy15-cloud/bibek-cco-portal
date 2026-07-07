import React from 'react';

interface AlertBannerProps {
  type: 'warning' | 'error' | 'info' | 'success';
  // Support both: title+message (original) and message-only (shorthand)
  title?: string;
  message?: string;
  onDismiss?: () => void;
  onClose?: () => void; // alias for onDismiss
}

const styles = {
  warning: 'bg-amber-50 border-amber-400 text-amber-900',
  error:   'bg-red-50 border-red-400 text-red-900',
  info:    'bg-blue-50 border-blue-400 text-blue-900',
  success: 'bg-green-50 border-green-400 text-green-900',
};

const icons = {
  warning: (
    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  success: (
    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
};

export const AlertBanner: React.FC<AlertBannerProps> = ({
  type, title, message, onDismiss, onClose,
}) => {
  const dismiss = onDismiss || onClose;
  // If only message provided (no title), treat message as the primary text
  const primaryText = title || message;
  const secondaryText = title ? message : undefined;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border-l-4 ${styles[type]}`}>
      {icons[type]}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{primaryText}</p>
        {secondaryText && <p className="text-xs mt-0.5 opacity-80">{secondaryText}</p>}
      </div>
      {dismiss && (
        <button onClick={dismiss} className="text-current opacity-50 hover:opacity-80 transition flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};
