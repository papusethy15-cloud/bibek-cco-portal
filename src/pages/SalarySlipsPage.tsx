// CCO Portal — Salary Slips page
// Shows list of salary slips for the logged-in CCO; click to view full slip detail
import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface SlipSummary {
  id: string;
  month: number;
  year: number;
  gross_salary: number;
  net_salary: number;
  present_days: number;
  total_hours: number;
  status: string;
  paid_at: string | null;
}

interface SlipDetail extends SlipSummary {
  user_name: string;
  user_mobile: string;
  month_label: string;
  monthly_salary: number;
  petrol_amount: number;
  mobile_recharge: number;
  bonus_amount: number;
  hra_amount: number;
  other_allowances: number;
  deductions: number;
  deduction_notes: string | null;
  total_days: number;
  payment_method: string | null;
  payment_ref: string | null;
  salary_notes: string | null;
}

function fmt(n: number) { return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0 })}`; }
function fmtHours(h: number) {
  const hh = Math.floor(h); const mm = Math.round((h - hh) * 60);
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;
}

function SlipDetailModal({ slip, onClose }: { slip: SlipDetail; onClose: () => void }) {
  const rows = [
    { label: 'Basic Salary',      val: slip.monthly_salary   },
    { label: 'Petrol Allowance',  val: slip.petrol_amount    },
    { label: 'Mobile Recharge',   val: slip.mobile_recharge  },
    { label: 'Bonus',             val: slip.bonus_amount     },
    { label: 'HRA',               val: slip.hra_amount       },
    { label: 'Other Allowances',  val: slip.other_allowances },
  ].filter(r => r.val > 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'white', borderRadius: 16, maxWidth: 560, width: '100%',
        boxShadow: '0 20px 64px rgba(0,0,0,0.25)', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,#1B4FD8,#1e3a8a)', padding: '20px 24px', color: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Salary Slip</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{slip.month_label}</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{slip.user_name} · {slip.user_mobile}</div>
            </div>
            <span style={{
              background: slip.status === 'PAID' ? 'rgba(34,197,94,0.2)' : 'rgba(251,191,36,0.2)',
              color: slip.status === 'PAID' ? '#4ade80' : '#fbbf24',
              border: `1px solid ${slip.status === 'PAID' ? '#4ade80' : '#fbbf24'}`,
              borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 700,
            }}>
              {slip.status === 'PAID' ? '✅ PAID' : '⏳ PENDING'}
            </span>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Attendance Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Working Days', val: `${slip.present_days} / ${slip.total_days}` },
              { label: 'Hours Worked', val: fmtHours(slip.total_hours) },
              { label: 'Net Payable',  val: fmt(slip.net_salary), highlight: true },
            ].map(c => (
              <div key={c.label} style={{
                background: c.highlight ? '#EFF6FF' : '#F8FAFC',
                border: `1px solid ${c.highlight ? '#BFDBFE' : '#E2E8F0'}`,
                borderRadius: 10, padding: '10px 12px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: c.highlight ? 18 : 16, fontWeight: 800, color: c.highlight ? '#1B4FD8' : '#0F172A' }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* Earnings table */}
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ background: '#F8FAFC', padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Earnings
            </div>
            {rows.map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #F1F5F9', fontSize: 13 }}>
                <span style={{ color: '#374151' }}>{r.label}</span>
                <span style={{ fontWeight: 600, color: '#059669' }}>{fmt(r.val)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderTop: '2px solid #E2E8F0', fontSize: 14, fontWeight: 800, background: '#F0FDF4' }}>
              <span style={{ color: '#166534' }}>Gross Total</span>
              <span style={{ color: '#166534' }}>{fmt(slip.gross_salary)}</span>
            </div>
          </div>

          {/* Deductions */}
          {slip.deductions > 0 && (
            <div style={{ border: '1px solid #FEE2E2', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ background: '#FEF2F2', padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#DC2626', textTransform: 'uppercase' }}>Deductions</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', fontSize: 13 }}>
                <span style={{ color: '#374151' }}>{slip.deduction_notes || 'Deductions'}</span>
                <span style={{ fontWeight: 600, color: '#DC2626' }}>- {fmt(slip.deductions)}</span>
              </div>
            </div>
          )}

          {/* Net Salary highlight */}
          <div style={{ background: 'linear-gradient(135deg,#EFF6FF,#DBEAFE)', border: '2px solid #93C5FD', borderRadius: 12, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: '#1E40AF', fontWeight: 600 }}>Net Salary Payable</div>
              {slip.salary_notes && <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{slip.salary_notes}</div>}
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#1B4FD8' }}>{fmt(slip.net_salary)}</div>
          </div>

          {/* Payment info */}
          {slip.status === 'PAID' && (
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#166534' }}>
              ✅ <strong>Paid via {slip.payment_method || '—'}</strong>
              {slip.payment_ref && <> · Ref: {slip.payment_ref}</>}
              {slip.paid_at && <> · {new Date(slip.paid_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}</>}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC', textAlign: 'right' }}>
          <button onClick={onClose} style={{ background: '#1B4FD8', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function SalarySlipsPage() {
  const { user } = useAuthStore();
  const [slips, setSlips]   = useState<SlipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail]   = useState<SlipDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api.get('/cco-attendance/my-slips')
      .then(r => setSlips(r.data.data?.slips || []))
      .catch(() => setSlips([]))
      .finally(() => setLoading(false));
  }, []);

  const openSlip = async (id: string) => {
    setDetailLoading(true);
    try {
      const r = await api.get(`/cco-attendance/my-slips/${id}`);
      setDetail(r.data.data);
    } catch { /* ignore */ }
    finally { setDetailLoading(false); }
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>💰 My Salary Slips</h1>
        <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Monthly salary records generated by admin</p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>Loading…</div>
      ) : slips.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, background: 'white', borderRadius: 16, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#334155' }}>No salary slips yet</div>
          <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 6 }}>Your admin will generate salary slips each month</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {slips.map(s => (
            <div key={s.id} style={{
              background: 'white', border: '1px solid #E2E8F0', borderRadius: 14,
              padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}>
              {/* Month badge */}
              <div style={{
                width: 56, height: 56, borderRadius: 14, flexShrink: 0,
                background: 'linear-gradient(135deg,#1B4FD8,#1e3a8a)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: 'white',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{MONTHS[s.month-1]}</div>
                <div style={{ fontSize: 14, fontWeight: 900 }}>{s.year}</div>
              </div>

              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>
                  {MONTHS[s.month-1]} {s.year}
                </div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                  {s.present_days} days present · {fmtHours(s.total_hours)} worked
                </div>
              </div>

              {/* Amount */}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#1B4FD8' }}>{fmt(s.net_salary)}</div>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>net salary</div>
              </div>

              {/* Status */}
              <span style={{
                background: s.status === 'PAID' ? '#DCFCE7' : '#FEF3C7',
                color: s.status === 'PAID' ? '#166534' : '#92400E',
                border: `1px solid ${s.status === 'PAID' ? '#BBF7D0' : '#FCD34D'}`,
                borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>
                {s.status === 'PAID' ? '✅ Paid' : '⏳ Pending'}
              </span>

              {/* View button */}
              <button
                onClick={() => openSlip(s.id)}
                disabled={detailLoading}
                style={{
                  background: '#EFF6FF', color: '#1B4FD8', border: '1px solid #BFDBFE',
                  borderRadius: 8, padding: '8px 18px', fontWeight: 700, fontSize: 13,
                  cursor: 'pointer', flexShrink: 0,
                }}
              >
                {detailLoading ? '…' : '📄 View'}
              </button>
            </div>
          ))}
        </div>
      )}

      {detail && <SlipDetailModal slip={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
