/**
 * CcoQuotationModal.tsx — Advanced Quotation Management for CCO Portal
 *
 * Exact feature parity with admin dashboard QuotationFromBookingModal + QuotationEditor:
 *
 * APPLIANCE FLOW:
 *   - Shows customer's registered appliances first (from /appliances/customer/:id)
 *   - Can pick existing OR enter manually (with optional "save as customer appliance")
 *   - Duplicate label guard
 *
 * SERVICE FLOW:
 *   - Search by name; city-price auto-applied (domain overrides)
 *   - Not found → submit as new service with name+price → admin verifies later
 *
 * PARTS FLOW:
 *   - OFFICE STOCK: search technician's assigned inventory → select → set qty+sale price
 *   - MARKET PURCHASE: search catalogue first (may have existing price structure)
 *     → shows all price structures → pick one OR enter brand-new
 *     → new price structure → is_new_part=true → pending admin verify
 *     → usable instantly in quotation regardless
 *
 * FINANCIALS:
 *   - service_charges defaults to 0 (not booking base_amount)
 *   - Coupon: read-only, auto-applied on 1st quotation only
 *   - Discount (CCO/Admin only): manual adjustment after approval
 *   - GST: B2C / B2B / Non-Tax; B2B auto-fills customer GST profile
 *
 * WS SYNC: QUOTATION_* events reload silently (skip own actor)
 */

import { todayIST, fmtDateIST, fmtDateTimeIST } from "../../lib/tz";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { AlertBanner } from '../ui/AlertBanner';
import { quotationService } from '../../services/quotation.service';
import { useBookingWebSocket } from '../../hooks/useCCOWebSocket';

// ─── constants ────────────────────────────────────────────────────────────────
const EDITABLE = ['DRAFT', 'REJECTED', 'REVISED'];
const money = (n: number | null | undefined) =>
  `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const fmtDT = (d: string) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// ─── QBadge ──────────────────────────────────────────────────────────────────
function QBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string }> = {
    DRAFT:                { bg: '#F1F5F9', color: '#475569' },
    SUBMITTED:            { bg: '#DBEAFE', color: '#1D4ED8' },
    APPROVED:             { bg: '#DCFCE7', color: '#166534' },
    REJECTED:             { bg: '#FEE2E2', color: '#DC2626' },
    REVISED:              { bg: '#FEF3C7', color: '#92400E' },
    CONVERTED_TO_INVOICE: { bg: '#ECFDF5', color: '#059669' },
  };
  const s = cfg[status] || cfg.DRAFT;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700,
      padding:'2px 9px', borderRadius:20, background:s.bg, color:s.color,
    }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:s.color }} />
      {status === 'CONVERTED_TO_INVOICE' ? 'INVOICED' : status.replace(/_/g,' ')}
    </span>
  );
}

function ErrBox({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', padding:'8px 12px', borderRadius:6, fontSize:12, marginBottom:10 }}>⚠ {msg}</div>;
}
function InfoBox({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', color:'#1D4ED8', padding:'8px 12px', borderRadius:6, fontSize:12, marginBottom:10 }}>ℹ {msg}</div>;
}

const lbl: React.CSSProperties = { display:'block', fontSize:12, fontWeight:600, marginBottom:4 };
const inp: React.CSSProperties = { width:'100%', border:'1px solid #E2E8F0', borderRadius:6, padding:'7px 10px', fontSize:13, outline:'none', boxSizing:'border-box' };

// ─── ServiceSearchPanel ───────────────────────────────────────────────────────
function ServiceSearchPanel({ quotationId, quotationStatus, bookingCity, applianceLabel, onAdded, onCancel }: {
  quotationId: string; quotationStatus: string; bookingCity: string;
  applianceLabel: string; onAdded: () => void; onCancel: () => void;
}) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding]   = useState<string | null>(null);
  const [addedNames, setAddedNames] = useState<string[]>([]);
  const [err, setErr]         = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  // New service form (when not found in DB)
  const [newSvcForm, setNewSvcForm] = useState({ name: '', price: 0 });
  const [addingNew, setAddingNew]   = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const search = async (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    setSearching(true); setErr(''); setHasSearched(true);
    try {
      const r = await quotationService.searchServices(term);
      const items = (r as any).data?.data?.items || (r as any).data?.data?.services || (r as any).data?.data || [];
      setResults(Array.isArray(items) ? items : []);
    } catch { setErr('Search failed'); } finally { setSearching(false); }
  };

  useEffect(() => {
    if (!query.trim()) { setResults([]); setHasSearched(false); return; }
    const t = setTimeout(() => search(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  const add = async (svc: any) => {
    if (!EDITABLE.includes(quotationStatus)) { setErr(`Quotation is ${quotationStatus} — cannot add services`); return; }
    setAdding(svc.id); setErr('');
    try {
      let unitPrice = svc.base_price || 0;
      if (bookingCity) {
        try {
          const cpRes = await quotationService.cityPrices(svc.id);
          const cityPrices: any[] = (cpRes as any).data?.data || [];
          const cityLower = bookingCity.toLowerCase().trim();
          const match = cityPrices.find((cp: any) =>
            cp.is_available &&
            (cp.city_name?.toLowerCase().trim() === cityLower ||
             cp.city_name?.toLowerCase().includes(cityLower) ||
             cityLower.includes(cp.city_name?.toLowerCase().trim() || ''))
          );
          if (match) unitPrice = match.price;
        } catch {}
      }
      await quotationService.addService(quotationId, {
        service_id: svc.id,
        quantity: 1,
        unit_price: unitPrice,
        appliance_label: applianceLabel || undefined,
      });
      setAddedNames(n => [...n, svc.name]);
      onAdded();
      setQuery(''); setResults([]);
    } catch (ex: any) {
      setErr(ex.response?.data?.detail || `Failed to add "${svc.name}"`);
    } finally { setAdding(null); }
  };

  return (
    <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8, padding:12, marginTop:8 }}>
      <div style={{ fontSize:12, fontWeight:700, color:'#1D4ED8', marginBottom:8 }}>
        🔍 Add Service — <span style={{ color:'#6366F1' }}>{applianceLabel}</span>
        {bookingCity && <span style={{ color:'#64748B', fontWeight:400, marginLeft:6 }}>· 📍{bookingCity} (city price auto-applied)</span>}
      </div>
      {addedNames.length > 0 && (
        <div style={{ fontSize:11, color:'#059669', background:'#F0FDF4', borderRadius:4, padding:'4px 8px', marginBottom:8 }}>
          ✅ Added: {addedNames.join(', ')}
        </div>
      )}
      <div style={{ display:'flex', gap:8, marginBottom:8 }}>
        <input style={{ ...inp, flex:1, fontSize:13 }}
          placeholder="Type service name (e.g. AC Gas Refill) then Enter…"
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search(query)} autoFocus />
        <button onClick={() => search(query)} disabled={searching}
          style={{ padding:'6px 14px', background:'#1D4ED8', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700 }}>
          {searching ? '…' : 'Search'}
        </button>
        <button onClick={onCancel}
          style={{ padding:'6px 12px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:6, cursor:'pointer', fontSize:12 }}>
          ✕ Done
        </button>
      </div>
      <ErrBox msg={err} />
      {results.length > 0 && (
        <div style={{ border:'1px solid #BFDBFE', borderRadius:6, overflow:'hidden', maxHeight:240, overflowY:'auto' }}>
          {results.map((s: any) => (
            <div key={s.id} style={{ padding:'8px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #DBEAFE', background:'#fff' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:13, color:'#0F172A' }}>{s.name}</div>
                <div style={{ fontSize:11, color:'#94A3B8' }}>Base: {money(s.base_price)} · {s.category_name || ''}</div>
              </div>
              <button onClick={() => add(s)} disabled={adding === s.id}
                style={{ padding:'5px 14px', background:'#1D4ED8', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700, opacity: adding === s.id ? 0.5 : 1 }}>
                {adding === s.id ? '…' : '+ Add'}
              </button>
            </div>
          ))}
        </div>
      )}
      {results.length === 0 && hasSearched && !searching && (
        <div style={{ background:'#FFF7ED', border:'1px solid #FED7AA', borderRadius:6, padding:10, marginTop:6 }}>
          <div style={{ fontSize:12, color:'#92400E', fontWeight:700, marginBottom:6 }}>
            ⚠️ No service found for "{query}". Submit as a new service:
          </div>
          {!showNewForm ? (
            <button onClick={() => { setNewSvcForm(f => ({ ...f, name: query })); setShowNewForm(true); }}
              style={{ padding:'5px 14px', background:'#F97316', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 }}>
              + Submit New Service
            </button>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr auto', gap:8, alignItems:'flex-end' }}>
              <div>
                <div style={{ fontSize:11, fontWeight:600, marginBottom:3 }}>Service Name</div>
                <input style={inp} value={newSvcForm.name} onChange={e => setNewSvcForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. PCB Board Repair" />
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:600, marginBottom:3 }}>Price (₹)</div>
                <input style={inp} type="number" min={0} step={1} value={newSvcForm.price} onChange={e => setNewSvcForm(f => ({ ...f, price: parseFloat(e.target.value)||0 }))} />
              </div>
              <button
                disabled={addingNew || !newSvcForm.name.trim()}
                onClick={async () => {
                  setAddingNew(true); setErr('');
                  try {
                    await quotationService.addService(quotationId, {
                      custom_service_name: newSvcForm.name.trim(),
                      quantity: 1,
                      unit_price: newSvcForm.price,
                      appliance_label: applianceLabel || undefined,
                    });
                    setAddedNames(n => [...n, newSvcForm.name.trim()]);
                    setShowNewForm(false);
                    setNewSvcForm({ name: '', price: 0 });
                    onAdded();
                  } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed'); }
                  finally { setAddingNew(false); }
                }}
                style={{ padding:'7px 14px', background:'#F97316', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700, opacity:addingNew?0.5:1 }}>
                {addingNew ? '…' : '+ Add'}
              </button>
            </div>
          )}
          <div style={{ fontSize:10, color:'#92400E', marginTop:6, opacity:0.8 }}>
            ℹ️ New service will be used immediately. Admin reviews &amp; adds to catalogue.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AddPartPanel ─────────────────────────────────────────────────────────────
function AddPartPanel({ quotationId, applianceLabel, bookingCity, hasTechnician, technicianId, onAdded, onCancel }: {
  quotationId: string; applianceLabel: string; bookingCity: string;
  hasTechnician: boolean; technicianId?: string; onAdded: () => void; onCancel: () => void;
}) {
  const [source, setSource] = useState<'OFFICE_STOCK' | 'MARKET_PURCHASE'>(hasTechnician ? 'OFFICE_STOCK' : 'MARKET_PURCHASE');

  // Office stock state
  const [stockQuery, setStockQuery]     = useState('');
  const [stockResults, setStockResults] = useState<any[]>([]);
  const [stockSearching, setStockSearching] = useState(false);
  const [selectedStock, setSelectedStock]   = useState<any>(null);
  const [stockQty, setStockQty]             = useState(1);
  const [stockSalePrice, setStockSalePrice] = useState(0);

  // Market purchase state
  const [mpQuery, setMpQuery]     = useState('');
  const [mpResults, setMpResults] = useState<any[]>([]);
  const [mpSearching, setMpSearching] = useState(false);
  const [mpForm, setMpForm] = useState({
    part_name: '', quantity: 1, purchase_price: 0, unit_price: 0,
    vendor_name: '', bill_number: '', notes: '', is_new_part: false, inventory_item_id: '',
  });
  const setMP = (k: string, v: any) => setMpForm(f => ({ ...f, [k]: v }));

  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const [info, setInfo]     = useState('');

  const searchStock = async () => {
    if (!stockQuery.trim()) return;
    setStockSearching(true); setErr('');
    try {
      const r = await quotationService.searchInventory(stockQuery.trim(), technicianId);
      setStockResults((r as any).data?.data?.items || (r as any).data?.data || []);
    } catch { setErr('Search failed'); } finally { setStockSearching(false); }
  };

  const selectStockItem = (item: any) => {
    setSelectedStock(item);
    setStockSalePrice(item.selling_price || item.sale_price || 0);
    setStockResults([]);
    setStockQuery('');
    const avail = item.technician_qty ?? item.current_stock ?? 0;
    setInfo(`Available: ${avail} ${item.unit || 'pcs'} · Cost: ${money(item.cost_price)} · Sale: ${money(item.selling_price || item.sale_price)}`);
  };

  const searchMP = async () => {
    if (!mpQuery.trim()) return;
    setMpSearching(true); setErr('');
    try {
      const r = await quotationService.searchInventory(mpQuery.trim());
      setMpResults((r as any).data?.data?.items || (r as any).data?.data || []);
    } catch { setErr('Search failed'); } finally { setMpSearching(false); }
  };

  // Select existing price structure from catalogue
  const selectMpItem = (item: any) => {
    setMpForm(f => ({
      ...f,
      part_name: item.name,
      purchase_price: item.cost_price || 0,
      unit_price: item.selling_price || item.sale_price || 0,
      inventory_item_id: item.id,
      is_new_part: false,
    }));
    setMpResults([]);
    setMpQuery('');
    setInfo(`Existing: ${item.name} · Catalogue cost: ${money(item.cost_price)} · Sale: ${money(item.selling_price || item.sale_price)} · Override below if current market price differs`);
  };

  const addOfficeStock = async () => {
    if (!selectedStock) { setErr('Select an item first'); return; }
    if (stockQty < 1)   { setErr('Quantity must be ≥ 1'); return; }
    setSaving(true); setErr('');
    try {
      await quotationService.addPart(quotationId, {
        part_name: selectedStock.name,
        part_source: 'OFFICE_STOCK',
        quantity: stockQty,
        unit_price: stockSalePrice,
        purchase_price: selectedStock.cost_price || 0,
        appliance_label: applianceLabel,
        inventory_item_id: selectedStock.id,
        is_new_part: false,
        notes: `SKU: ${selectedStock.sku || ''}`,
      });
      onAdded();
      setSelectedStock(null); setStockQty(1); setInfo('');
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed to add part'); }
    finally { setSaving(false); }
  };

  const addMarketPurchase = async () => {
    if (!mpForm.part_name.trim()) { setErr('Part name required'); return; }
    if (!mpForm.unit_price)       { setErr('Sale price required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await quotationService.addPart(quotationId, {
        part_name: mpForm.part_name.trim(),
        part_source: 'MARKET_PURCHASE',
        quantity: mpForm.quantity,
        unit_price: mpForm.unit_price,
        purchase_price: mpForm.purchase_price,
        vendor_name: mpForm.vendor_name || undefined,
        bill_number: mpForm.bill_number || undefined,
        notes: mpForm.notes || undefined,
        appliance_label: applianceLabel,
        inventory_item_id: mpForm.inventory_item_id || undefined,
        is_new_part: mpForm.is_new_part,
      });
      if ((res as any).data?.data?.is_pending_verify === 1) {
        setInfo('✅ Part added. Submitted to admin for catalogue verification — usable immediately.');
      }
      onAdded();
      setMpForm({ part_name:'', quantity:1, purchase_price:0, unit_price:0, vendor_name:'', bill_number:'', notes:'', is_new_part:false, inventory_item_id:'' });
      setInfo('');
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed to add part'); }
    finally { setSaving(false); }
  };

  const btn = (active: boolean) => ({
    padding:'6px 14px', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700,
    border:`2px solid ${active ? '#F59E0B' : '#E2E8F0'}`,
    background: active ? '#FEF3C7' : '#F8FAFC',
    color: active ? '#92400E' : '#64748B',
  } as React.CSSProperties);

  return (
    <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8, padding:14, marginTop:8 }}>
      <div style={{ fontSize:12, fontWeight:700, color:'#92400E', marginBottom:10 }}>
        🔩 Add Spare Part — <span style={{ color:'#6366F1' }}>{applianceLabel}</span>
      </div>
      <div style={{ display:'flex', gap:6, marginBottom:14 }}>
        <button style={btn(source === 'OFFICE_STOCK')} onClick={() => { setSource('OFFICE_STOCK'); setErr(''); setInfo(''); setSelectedStock(null); }}>
          🏭 Office Stock
          <div style={{ fontSize:9, fontWeight:400, color:'#94A3B8' }}>From assigned inventory</div>
        </button>
        <button style={btn(source === 'MARKET_PURCHASE')} onClick={() => { setSource('MARKET_PURCHASE'); setErr(''); setInfo(''); }}>
          🛒 Market Purchase
          <div style={{ fontSize:9, fontWeight:400, color:'#94A3B8' }}>Bought from market</div>
        </button>
        <button onClick={onCancel} style={{ marginLeft:'auto', alignSelf:'flex-start', padding:'5px 10px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:6, cursor:'pointer', fontSize:12 }}>
          ✕ Done
        </button>
      </div>
      <ErrBox msg={err} />
      <InfoBox msg={info} />

      {/* ── OFFICE STOCK ── */}
      {source === 'OFFICE_STOCK' && (
        <>
          {!hasTechnician && (
            <div style={{ background:'#FEF3C7', border:'1px solid #FDE68A', borderRadius:6, padding:'8px 12px', fontSize:12, color:'#92400E', marginBottom:10 }}>
              ⚠️ No technician assigned. Stock deducted from warehouse.
            </div>
          )}
          {!selectedStock ? (
            <>
              <div style={{ fontSize:12, color:'#64748B', marginBottom:8 }}>Search technician's assigned stock:</div>
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <input style={{ ...inp, flex:1 }} placeholder="Part name, SKU…"
                  value={stockQuery} onChange={e => setStockQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchStock()} autoFocus />
                <button onClick={searchStock} disabled={stockSearching}
                  style={{ padding:'6px 14px', background:'#1D4ED8', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700 }}>
                  {stockSearching ? '…' : '🔍 Search'}
                </button>
              </div>
              {stockResults.length > 0 && (
                <div style={{ border:'1px solid #E2E8F0', borderRadius:6, overflow:'hidden', maxHeight:200, overflowY:'auto' }}>
                  {stockResults.map((item: any) => (
                    <div key={item.id} onClick={() => selectStockItem(item)}
                      style={{ padding:'8px 12px', cursor:'pointer', borderBottom:'1px solid #F1F5F9', background:'#fff' }}>
                      <div style={{ fontWeight:600, fontSize:13 }}>{item.name}</div>
                      <div style={{ fontSize:11, color:'#94A3B8' }}>
                        SKU: {item.sku || '—'} · Stock: {item.current_stock ?? '?'} · Cost: {money(item.cost_price)} · Sale: {money(item.selling_price || item.sale_price)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {stockResults.length === 0 && stockQuery && !stockSearching && (
                <div style={{ fontSize:12, color:'#94A3B8', padding:8 }}>No items found — try Market Purchase for unlisted parts.</div>
              )}
            </>
          ) : (
            <div style={{ background:'#F0FDF4', border:'1px solid #86EFAC', borderRadius:8, padding:12, marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>✅ {selectedStock.name}</div>
                  <div style={{ fontSize:11, color:'#64748B' }}>SKU: {selectedStock.sku || '—'}</div>
                </div>
                <button onClick={() => { setSelectedStock(null); setInfo(''); }}
                  style={{ padding:'4px 10px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:6, cursor:'pointer', fontSize:11 }}>
                  Change
                </button>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={lbl}>Quantity</label>
                  <input style={inp} type="number" min={1} value={stockQty} onChange={e => setStockQty(parseInt(e.target.value)||1)} />
                </div>
                <div>
                  <label style={lbl}>Sale Price (₹) to Customer</label>
                  <input style={inp} type="number" min={0} step={0.01} value={stockSalePrice} onChange={e => setStockSalePrice(parseFloat(e.target.value)||0)} />
                  {stockSalePrice > 0 && <div style={{ fontSize:11, color:'#059669', marginTop:2 }}>Total: {money(stockSalePrice * stockQty)}</div>}
                </div>
              </div>
              <button onClick={addOfficeStock} disabled={saving}
                style={{ marginTop:10, padding:'7px 16px', background:'#1D4ED8', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, opacity:saving?0.5:1 }}>
                {saving ? '…' : `+ Add ${stockQty} × ${selectedStock.name}`}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── MARKET PURCHASE ── */}
      {source === 'MARKET_PURCHASE' && (
        <>
          {/* Step 1: search existing catalogue price structures */}
          <div style={{ marginBottom:10 }}>
            <label style={{ ...lbl, color:'#64748B' }}>Search Catalogue (for existing price structures)</label>
            <div style={{ display:'flex', gap:8 }}>
              <input style={{ ...inp, flex:1 }} placeholder="Search part name to find catalogue price…"
                value={mpQuery} onChange={e => setMpQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchMP()} />
              <button onClick={searchMP} disabled={mpSearching}
                style={{ padding:'6px 12px', background:'#F59E0B', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700 }}>
                {mpSearching ? '…' : '🔍'}
              </button>
            </div>
            {mpResults.length > 0 && (
              <div style={{ border:'1px solid #E2E8F0', borderRadius:6, marginTop:6, overflow:'hidden', maxHeight:180, overflowY:'auto' }}>
                {mpResults.map((item: any) => (
                  <div key={item.id} onClick={() => selectMpItem(item)}
                    style={{ padding:'7px 12px', cursor:'pointer', borderBottom:'1px solid #F1F5F9', background:'#fff', fontSize:12 }}>
                    <b>{item.name}</b> · Cost: {money(item.cost_price)} · Sale: {money(item.selling_price || item.sale_price)}
                    <span style={{ color:'#94A3B8', marginLeft:8 }}>SKU: {item.sku || '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {mpResults.length === 0 && mpQuery && !mpSearching && (
              <div style={{ fontSize:11, color:'#94A3B8', padding:'4px 0' }}>
                Not in catalogue — fill below and check "Submit as new part" to add for admin verification.
              </div>
            )}
          </div>

          {/* Step 2: part details (pre-filled from catalogue or blank for new) */}
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={lbl}>Part Name *</label>
              <input style={inp} placeholder="e.g. Capacitor 35+5 MFD…" value={mpForm.part_name} onChange={e => setMP('part_name', e.target.value)} autoFocus={!mpForm.part_name} />
            </div>
            <div>
              <label style={lbl}>Quantity</label>
              <input style={inp} type="number" min={1} value={mpForm.quantity} onChange={e => setMP('quantity', parseInt(e.target.value)||1)} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={lbl}>Purchase Price (₹) — cost</label>
              <input style={inp} type="number" min={0} step={0.01} value={mpForm.purchase_price} onChange={e => setMP('purchase_price', parseFloat(e.target.value)||0)} />
            </div>
            <div>
              <label style={lbl}>Sale Price (₹) to Customer *</label>
              <input style={inp} type="number" min={0} step={0.01} value={mpForm.unit_price} onChange={e => setMP('unit_price', parseFloat(e.target.value)||0)} />
              {mpForm.unit_price > 0 && (
                <div style={{ fontSize:11, marginTop:2 }}>
                  <span style={{ color:'#059669' }}>Total: {money(mpForm.unit_price * mpForm.quantity)}</span>
                  {mpForm.purchase_price > 0 && <span style={{ color:'#64748B', marginLeft:8 }}>Margin: {money((mpForm.unit_price - mpForm.purchase_price) * mpForm.quantity)}</span>}
                </div>
              )}
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={lbl}>Vendor / Shop Name</label>
              <input style={inp} placeholder="Where purchased from" value={mpForm.vendor_name} onChange={e => setMP('vendor_name', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Bill / Receipt No.</label>
              <input style={inp} placeholder="Invoice or receipt number" value={mpForm.bill_number} onChange={e => setMP('bill_number', e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom:10 }}>
            <label style={lbl}>Notes</label>
            <input style={inp} value={mpForm.notes} onChange={e => setMP('notes', e.target.value)} placeholder="Additional notes" />
          </div>

          {/* New part submission for admin verification */}
          {!mpForm.inventory_item_id && mpForm.part_name.trim() && (
            <div style={{ background:'#F5F3FF', border:'1px solid #DDD6FE', borderRadius:6, padding:'8px 12px', marginBottom:10 }}>
              <label style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer', fontSize:12 }}>
                <input type="checkbox" checked={mpForm.is_new_part} onChange={e => setMP('is_new_part', e.target.checked)} style={{ marginTop:2 }} />
                <span>
                  <b style={{ color:'#7C3AED' }}>Submit as new catalogue part</b> — adds "{mpForm.part_name}" as{' '}
                  <em>pending admin verification</em>. Usable in this quotation immediately; admin reviews price structure for future use by any technician.
                </span>
              </label>
            </div>
          )}
          {mpForm.inventory_item_id && (
            <div style={{ fontSize:11, color:'#059669', background:'#F0FDF4', padding:'4px 8px', borderRadius:4, marginBottom:10 }}>
              ✅ Linked to existing catalogue — using catalogue prices (overridden above if market price differs)
            </div>
          )}

          <button onClick={addMarketPurchase} disabled={saving}
            style={{ padding:'7px 16px', background:'#F59E0B', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, opacity:saving?0.5:1 }}>
            {saving ? '…' : '+ Add Part'}
          </button>
        </>
      )}
    </div>
  );
}

// ─── CustomerAppliancePicker ──────────────────────────────────────────────────
function CustomerAppliancePicker({ customerId, quotationId, existingLabels, existingApplianceIds, onPicked, onManual, onCancel }: {
  customerId: string; quotationId: string; existingLabels: string[]; existingApplianceIds: string[];
  onPicked: () => void; onManual: (label: string) => void; onCancel: () => void;
}) {
  const [appliances, setAppliances]     = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [adding, setAdding]             = useState<string | null>(null);
  const [manualLabel, setManualLabel]   = useState('');
  const [saveAsAppliance, setSaveAsAppliance] = useState(false);
  const [manualBrand, setManualBrand]   = useState('');
  const [manualModel, setManualModel]   = useState('');
  const [manualCategory, setManualCategory] = useState('');
  const [err, setErr]                   = useState('');

  useEffect(() => {
    quotationService.customerAppliances(customerId)
      .then(r => setAppliances((r as any).data?.data || []))
      .catch(() => setAppliances([]))
      .finally(() => setLoading(false));
  }, [customerId]);

  const pickExisting = async (appliance: any) => {
    const label = [appliance.brand_name, appliance.model, appliance.category].filter(Boolean).join(' ').trim() || appliance.id.slice(0, 8);
    if (existingLabels.includes(label) || existingApplianceIds.includes(appliance.id)) { setErr(`⚠ "${label}" is already added to this quotation`); return; }
    setAdding(appliance.id); setErr('');
    try {
      await quotationService.addAppliance(quotationId, { appliance_id: appliance.id, appliance_label: label });
      onPicked();
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed'); }
    finally { setAdding(null); }
  };

  const addManual = async () => {
    const label = manualLabel.trim();
    if (!label) return;
    if (existingLabels.includes(label)) { setErr(`"${label}" already added`); return; }
    setAdding('manual'); setErr('');
    try {
      let applianceId: string | null = null;
      if (saveAsAppliance && customerId) {
        try {
          const appRes = await quotationService.addCustomerAppliance({
            customer_id: customerId,
            model: manualModel.trim() || label,
            category: manualCategory.trim() || undefined,
            notes: 'Registered during quotation',
            status: 'ACTIVE',
          });
          applianceId = (appRes as any).data?.data?.id || null;
        } catch {}
      }
      await quotationService.addAppliance(quotationId, { appliance_id: applianceId, appliance_label: label });
      onManual(label);
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed'); }
    finally { setAdding(null); }
  };

  const available = appliances.filter(a => {
    const label = [a.brand_name, a.model, a.category].filter(Boolean).join(' ').trim() || a.id.slice(0, 8);
    // Exclude by label OR by appliance_id — guards against label-mismatch cases
    return !existingLabels.includes(label) && !existingApplianceIds.includes(a.id);
  });

  return (
    <div style={{ background:'#F0FDF4', border:'1.5px solid #86EFAC', borderRadius:10, padding:14, marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div style={{ fontWeight:800, fontSize:13, color:'#166534' }}>🔧 Add Appliance / Machine</div>
        <button onClick={onCancel} style={{ padding:'4px 10px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:6, cursor:'pointer', fontSize:12 }}>✕ Cancel</button>
      </div>
      <ErrBox msg={err} />
      {loading ? <div style={{ padding:16, textAlign:'center' }}><Spinner /></div> : (
        <>
          {available.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#64748B', textTransform:'uppercase', marginBottom:6 }}>Customer's Registered Appliances</div>
              <div style={{ border:'1px solid #D1FAE5', borderRadius:8, overflow:'hidden' }}>
                {available.map((a: any) => {
                  const label = [a.brand_name, a.model, a.category].filter(Boolean).join(' ').trim() || a.id.slice(0, 8);
                  return (
                    <div key={a.id} style={{ padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #D1FAE5', background:'#fff' }}>
                      <div>
                        <div style={{ fontWeight:700, fontSize:13 }}>🔩 {label}</div>
                        <div style={{ fontSize:11, color:'#64748B' }}>
                          {a.category && `Category: ${a.category} · `}
                          {a.serial_number && `S/N: ${a.serial_number} · `}
                          <span style={{ background: a.status==='ACTIVE'?'#DCFCE7':'#FEF3C7', color: a.status==='ACTIVE'?'#166534':'#92400E', borderRadius:4, padding:'1px 5px', fontSize:10 }}>{a.status}</span>
                        </div>
                      </div>
                      <button onClick={() => pickExisting(a)} disabled={adding === a.id}
                        style={{ padding:'5px 14px', background:'#059669', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700, opacity:adding===a.id?0.5:1 }}>
                        {adding === a.id ? '…' : '+ Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {appliances.length === 0 && (
            <div style={{ fontSize:12, color:'#64748B', background:'#fff', border:'1px solid #E2E8F0', borderRadius:6, padding:'10px 12px', marginBottom:10 }}>
              No registered appliances for this customer.
            </div>
          )}

          <div style={{ borderTop: available.length > 0 ? '1px dashed #86EFAC' : 'none', paddingTop: available.length > 0 ? 10 : 0 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#64748B', textTransform:'uppercase', marginBottom:6 }}>Enter Machine Name Manually</div>
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input style={{ ...inp, flex:1, fontSize:13 }} placeholder="e.g. LG 1.5T Split AC, Samsung 7kg Washer…"
                value={manualLabel} onChange={e => setManualLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addManual()}
                autoFocus={appliances.length === 0} />
              <button onClick={addManual} disabled={!manualLabel.trim() || adding === 'manual'}
                style={{ padding:'6px 14px', background:'#059669', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, opacity:(!manualLabel.trim()||adding==='manual')?0.5:1 }}>
                {adding === 'manual' ? '…' : 'Add →'}
              </button>
            </div>
            <label style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer', fontSize:12, color:'#475569', marginBottom: saveAsAppliance ? 8 : 0 }}>
              <input type="checkbox" checked={saveAsAppliance} onChange={e => setSaveAsAppliance(e.target.checked)} style={{ marginTop:2 }} />
              <span><b style={{ color:'#059669' }}>💾 Save as customer appliance</b> — registers for future tracking & repeat complaint detection</span>
            </label>
            {saveAsAppliance && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, padding:'8px 10px', background:'#F0FDF4', borderRadius:8, border:'1px solid #86EFAC' }}>
                {[['Brand', manualBrand, setManualBrand, 'e.g. LG, Samsung…'],['Model', manualModel, setManualModel, 'e.g. 1.5T 5 Star…'],['Category', manualCategory, setManualCategory, 'e.g. AC, Fridge…']].map(([label, val, setter, ph]: any) => (
                  <div key={label as string}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#374151', marginBottom:3 }}>{label as string}</div>
                    <input style={{ ...inp, fontSize:12 }} placeholder={ph as string} value={val as string} onChange={e => setter(e.target.value)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── ApplianceCard ────────────────────────────────────────────────────────────
function ApplianceCard({ label, services, parts, canEdit, quotationId, quotationStatus, bookingCity, hasTechnician, technicianId, onReload, onRemove }: {
  label: string; services: any[]; parts: any[]; canEdit: boolean;
  quotationId: string; quotationStatus: string; bookingCity: string;
  hasTechnician: boolean; technicianId?: string; onReload: () => void; onRemove: (label: string) => void;
}) {
  const [openPanel, setOpenPanel]         = useState<'service' | 'part' | null>(null);
  const [removing, setRemoving]           = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removingAppliance, setRemovingAppliance] = useState(false);

  const removeService = async (id: string) => {
    setRemoving(id);
    try { await quotationService.deleteService(quotationId, id); onReload(); } catch {}
    finally { setRemoving(null); }
  };
  const removePart = async (id: string) => {
    setRemoving(id);
    try { await quotationService.deletePart(quotationId, id); onReload(); } catch {}
    finally { setRemoving(null); }
  };
  const removeAppliance = async () => {
    setRemovingAppliance(true);
    try { await quotationService.removeAppliance(quotationId, label); onRemove(label); }
    catch {} finally { setRemovingAppliance(false); setConfirmRemove(false); }
  };

  return (
    <div style={{ border:'1.5px solid #E2E8F0', borderRadius:10, marginBottom:12, overflow:'visible', background:'#fff' }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(90deg,#F8FAFC,#EFF6FF)', borderBottom:'1px solid #E2E8F0', padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontWeight:800, fontSize:13, color:'#0F172A', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:18 }}>🔧</span>
          {label}
          <span style={{ fontWeight:400, fontSize:11, color:'#94A3B8' }}>
            {services.length} svc · {parts.length} part{parts.length !== 1 ? 's' : ''}
          </span>
        </div>
        {canEdit && (
          <div style={{ display:'flex', gap:5 }}>
            <button onClick={() => setOpenPanel(p => p === 'service' ? null : 'service')}
              style={{ padding:'4px 10px', background: openPanel==='service'?'#DBEAFE':'#EFF6FF', color:'#1D4ED8', border:'1px solid #BFDBFE', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 }}>
              + Service
            </button>
            <button onClick={() => setOpenPanel(p => p === 'part' ? null : 'part')}
              style={{ padding:'4px 10px', background: openPanel==='part'?'#FEF3C7':'#FFFBEB', color:'#92400E', border:'1px solid #FDE68A', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 }}>
              + Part
            </button>
            {confirmRemove ? (
              <>
                <button onClick={removeAppliance} disabled={removingAppliance}
                  style={{ padding:'4px 10px', background:'#EF4444', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:11 }}>
                  {removingAppliance ? '…' : '✓ Confirm'}
                </button>
                <button onClick={() => setConfirmRemove(false)}
                  style={{ padding:'4px 10px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:6, cursor:'pointer', fontSize:11 }}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmRemove(true)}
                style={{ padding:'4px 10px', color:'#EF4444', border:'1px solid #FECACA', background:'#FFF5F5', borderRadius:6, cursor:'pointer', fontSize:11 }}>
                🗑 Remove
              </button>
            )}
          </div>
        )}
      </div>

      {/* Services table */}
      {services.length > 0 && (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'#FAFAFA' }}>
              <th style={{ padding:'5px 14px', textAlign:'left', fontSize:10, fontWeight:700, color:'#64748B', textTransform:'uppercase' }}>Service</th>
              <th style={{ padding:'5px 8px', textAlign:'center', fontSize:10, fontWeight:700, color:'#64748B', width:50 }}>Qty</th>
              <th style={{ padding:'5px 8px', textAlign:'right', fontSize:10, fontWeight:700, color:'#64748B', width:90 }}>Unit</th>
              <th style={{ padding:'5px 8px', textAlign:'right', fontSize:10, fontWeight:700, color:'#64748B', width:90 }}>Total</th>
              {canEdit && <th style={{ width:30 }} />}
            </tr>
          </thead>
          <tbody>
            {services.map((s: any) => (
              <tr key={s.id} style={{ borderTop:'1px solid #F1F5F9' }}>
                <td style={{ padding:'8px 14px', color:'#0F172A' }}>{s.display_name}</td>
                <td style={{ padding:'8px', textAlign:'center', color:'#64748B' }}>{s.quantity}</td>
                <td style={{ padding:'8px', textAlign:'right', color:'#64748B' }}>{money(s.unit_price)}</td>
                <td style={{ padding:'8px', textAlign:'right', fontWeight:700 }}>{money(s.total_price)}</td>
                {canEdit && (
                  <td style={{ padding:'4px 8px', textAlign:'center' }}>
                    {removing === s.id ? <Spinner /> :
                      <button onClick={() => removeService(s.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#EF4444', fontSize:14 }}>✕</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Parts */}
      {parts.map((p: any) => (
        <div key={p.id} style={{ padding:'8px 14px', borderTop:'1px solid #FEF3C7', background:'#FFFBEB', display:'flex', justifyContent:'space-between', alignItems:'flex-start', fontSize:12 }}>
          <div>
            <div style={{ fontWeight:700, color:'#0F172A' }}>
              🔩 {p.part_name}
              {p.is_pending_verify === 1 && (
                <span style={{ marginLeft:6, fontSize:10, background:'#F5F3FF', color:'#7C3AED', border:'1px solid #DDD6FE', borderRadius:4, padding:'1px 5px' }}>Pending Verify</span>
              )}
            </div>
            <div style={{ color:'#64748B', marginTop:2 }}>
              {p.part_source?.replace('_',' ')} · Qty: {p.quantity}
              {p.purchase_price > 0 && <span style={{ color:'#94A3B8', marginLeft:6 }}>Cost: {money(p.purchase_price)}</span>}
              {p.vendor_name && <span style={{ marginLeft:6 }}>· {p.vendor_name}</span>}
              {p.bill_number && <span style={{ marginLeft:6 }}>· Bill: {p.bill_number}</span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:10, alignItems:'center', flexShrink:0 }}>
            <div>
              <div style={{ fontWeight:700, textAlign:'right' }}>{money(p.total_price)}</div>
              {p.purchase_price > 0 && (
                <div style={{ fontSize:10, color:'#059669', textAlign:'right' }}>Margin: {money((p.unit_price - p.purchase_price) * p.quantity)}</div>
              )}
            </div>
            {canEdit && (
              removing === p.id ? <Spinner /> :
                <button onClick={() => removePart(p.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#EF4444', fontSize:14 }}>✕</button>
            )}
          </div>
        </div>
      ))}

      {services.length === 0 && parts.length === 0 && !openPanel && (
        <div style={{ padding:'12px 14px', fontSize:12, color:'#94A3B8', textAlign:'center' }}>No items yet. Click + Service or + Part above.</div>
      )}

      {/* Inline panels */}
      {openPanel && (
        <div style={{ padding:'0 14px 14px' }}>
          {openPanel === 'service'
            ? <ServiceSearchPanel quotationId={quotationId} quotationStatus={quotationStatus}
                bookingCity={bookingCity} applianceLabel={label}
                onAdded={() => onReload()} onCancel={() => setOpenPanel(null)} />
            : <AddPartPanel quotationId={quotationId} applianceLabel={label}
                bookingCity={bookingCity} hasTechnician={hasTechnician} technicianId={technicianId}
                onAdded={() => onReload()} onCancel={() => setOpenPanel(null)} />
          }
        </div>
      )}
    </div>
  );
}

// ─── QuotationEditor ──────────────────────────────────────────────────────────
function QuotationEditor({ initQuotation, initBooking, onClose, onRefresh }: {
  initQuotation: any; initBooking: any; onClose: () => void; onRefresh: () => void;
}) {
  const [quotation, setQuotation]     = useState<any>(initQuotation);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState('');
  const [info, setInfo]               = useState('');
  const [showAddAppliance, setShowAddAppliance] = useState(false);

  // Edit form (financials)
  const [editForm, setEditForm] = useState({
    service_charges: initQuotation.service_charges || 0,
    discount_amount: initQuotation.discount_amount || 0,
    adjustment_amount: initQuotation.adjustment_amount || 0,
    tax_percent: initQuotation.tax_percent ?? 18,
    tax_mode: initQuotation.tax_mode || 'B2C',
    customer_gst_number: initQuotation.customer_gst_number || '',
    customer_gst_name: initQuotation.customer_gst_name || '',
    customer_gst_address: initQuotation.customer_gst_address || '',
    remarks: initQuotation.remarks || '',
  });
  const setEF = (k: string, v: any) => setEditForm(f => ({ ...f, [k]: v }));
  const [savingFinancials, setSavingFinancials] = useState(false);
  const [financialsOpen, setFinancialsOpen]     = useState(false);

  // Workflow
  const [submitting, setSubmitting]   = useState(false);
  const [rejecting, setRejecting]     = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [reverting, setReverting]     = useState(false);

  // Appliance groups derived from quotation data
  const canEdit = EDITABLE.includes(quotation.status);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await quotationService.get(quotation.id);
      setQuotation((r as any).data?.data);
    } catch { setErr('Failed to reload quotation'); }
    finally { setLoading(false); }
  }, [quotation.id]);

  // WS: reload on external QUOTATION_* events
  const { lastEvent: wsEvent } = useBookingWebSocket(initBooking.id);
  useEffect(() => {
    if (wsEvent?.type?.startsWith('QUOTATION_')) reload();
  }, [wsEvent]);

  // Build appliance groups from quotation_appliances + services + parts.
  // Appliances are seeded first (from quotation.appliances) so that a newly-added
  // appliance with no services/parts yet still renders as a card in the UI.
  const buildGroups = () => {
    const applianceRows: any[] = quotation.appliances || [];
    const services: any[] = quotation.services || [];
    const parts: any[]    = quotation.parts    || [];
    const map = new Map<string, { services: any[]; parts: any[] }>();
    const ensure = (label: string) => {
      if (!map.has(label)) map.set(label, { services: [], parts: [] });
      return map.get(label)!;
    };
    // Seed from quotation_appliances so empty appliances are visible
    applianceRows.forEach((a: any) => ensure(a.appliance_label));
    services.forEach((s: any) => {
      const fullName: string = s.display_name || s.service_name || '';
      if (fullName.includes(' :: ')) {
        const idx = fullName.indexOf(' :: ');
        ensure(fullName.substring(0, idx)).services.push({ ...s, display_name: fullName.substring(idx + 4) });
      } else {
        ensure(s.appliance_label || 'General').services.push(s);
      }
    });
    parts.forEach((p: any) => ensure(p.appliance_label || 'General').parts.push(p));
    return map;
  };

  const groups    = buildGroups();
  const labels    = Array.from(groups.keys());
  const hasTech   = !!(initBooking.technician_id);
  const techId    = initBooking.technician_id;
  const bookingCity = initBooking.city || '';

  // Check if coupon applies (only first quotation)
  const couponApplies = initBooking?.coupon_code && quotation.coupon_code;

  // Save financials
  const saveFinancials = async () => {
    setSavingFinancials(true); setErr(''); setInfo('');
    try {
      const payload: any = {
        service_charges: editForm.service_charges,
        tax_percent: editForm.tax_mode === 'NONE' ? 0 : editForm.tax_percent,
        tax_mode: editForm.tax_mode,
        remarks: editForm.remarks || undefined,
      };
      if (editForm.tax_mode === 'B2B') {
        if (editForm.customer_gst_number) payload.customer_gst_number = editForm.customer_gst_number;
        if (editForm.customer_gst_name)   payload.customer_gst_name   = editForm.customer_gst_name;
        if (editForm.customer_gst_address) payload.customer_gst_address = editForm.customer_gst_address;
      }
      await quotationService.update(quotation.id, payload);
      await quotationService.discount(quotation.id, { amount: editForm.discount_amount });
      await quotationService.adjustment(quotation.id, { amount: editForm.adjustment_amount });
      setInfo('✅ Financial settings saved');
      await reload();
      setFinancialsOpen(false);
    } catch (ex: any) {
      setErr(ex.response?.data?.detail || 'Failed to save financials');
    } finally { setSavingFinancials(false); }
  };

  // Workflow actions
  const submit = async () => {
    setSubmitting(true); setErr('');
    try {
      await quotationService.submit(quotation.id);
      await reload();
      setInfo('✅ Quotation submitted for approval');
      onRefresh();
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Submit failed'); }
    finally { setSubmitting(false); }
  };

  const revertToDraft = async () => {
    setReverting(true); setErr('');
    try {
      await quotationService.revertToDraft(quotation.id);
      await reload();
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Revert failed'); }
    finally { setReverting(false); }
  };

  const rejectQ = async () => {
    if (!rejectReason.trim()) { setErr('Enter a rejection reason'); return; }
    setRejecting(true); setErr('');
    try {
      await quotationService.reject(quotation.id, rejectReason.trim());
      await reload();
      setShowRejectBox(false); setRejectReason('');
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Reject failed'); }
    finally { setRejecting(false); }
  };

  const deleteQuotation = async () => {
    if (!window.confirm(`Delete quotation ${quotation.quotation_number}? This cannot be undone.`)) return;
    setSubmitting(true); setErr('');
    try {
      await quotationService.delete(quotation.id);
      setInfo('🗑 Quotation deleted');
      onRefresh();
      onClose();
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Delete failed'); }
    finally { setSubmitting(false); }
  };

  const revise = async () => {
    setReverting(true); setErr('');
    try {
      const rv = await quotationService.revise(quotation.id, 'Revision by CCO');
      const newId = (rv as any).data?.data?.id;
      if (newId) {
        const detail = await quotationService.get(newId);
        setQuotation((detail as any).data?.data);
      } else { await reload(); }
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Revise failed'); }
    finally { setReverting(false); }
  };

  const removeApplianceLabel = async (label: string) => {
    try { await quotationService.removeAppliance(quotation.id, label); await reload(); } catch {}
  };

  // Sync editForm when quotation reloads
  useEffect(() => {
    setEditForm(f => ({
      ...f,
      service_charges: quotation.service_charges || 0,
      discount_amount: quotation.discount_amount || 0,
      adjustment_amount: quotation.adjustment_amount || 0,
      tax_percent: quotation.tax_percent ?? 18,
      tax_mode: quotation.tax_mode || 'B2C',
      customer_gst_number: quotation.customer_gst_number || '',
      customer_gst_name: quotation.customer_gst_name || '',
      customer_gst_address: quotation.customer_gst_address || '',
      remarks: quotation.remarks || '',
    }));
  }, [quotation.id, quotation.status]);

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <Modal
      open={true}
      title={`${quotation.quotation_number} · v${quotation.version} · ${quotation.status}`}
      onClose={onClose}
      size="xl"
    >
      {/* ── Quotation header ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
        <span style={{ fontFamily:'monospace', fontSize:15, fontWeight:800, color:'#1B4FD8' }}>{quotation.quotation_number}</span>
        <QBadge status={quotation.status} />
        <span style={{ fontSize:11, color:'#94A3B8' }}>v{quotation.version}</span>
      </div>
      {/* ── Booking strip ── */}
      <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8, padding:'10px 14px', marginBottom:12, fontSize:12 }}>
        <span style={{ fontWeight:800, color:'#1E40AF', fontFamily:'monospace', marginRight:10 }}>{initBooking.booking_number}</span>
        👤 {initBooking.customer_name}
        {bookingCity && <> · 📍 {bookingCity}</>}
        {initBooking.technician_name && <> · 👷 {initBooking.technician_name}</>}
      </div>

      {err  && <ErrBox  msg={err} />}
      {info && <InfoBox msg={info} />}

      {/* ── Coupon banner ── */}
      {couponApplies && (
        <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8, padding:'8px 14px', marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontWeight:700, fontSize:12, color:'#92400E' }}>🏷️ Coupon Applied — {quotation.coupon_code}</div>
            <div style={{ fontSize:11, color:'#92400E', opacity:0.8 }}>Customer applied at booking — auto-calculated on this 1st quotation only</div>
          </div>
          <div style={{ fontWeight:800, fontSize:15, color:'#DC2626' }}>−{money(quotation.coupon_discount)}</div>
        </div>
      )}
      {!couponApplies && initBooking?.coupon_code && (
        <div style={{ background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:8, padding:'6px 12px', marginBottom:10, fontSize:11, color:'#64748B' }}>
          ℹ️ Customer applied coupon <b>{initBooking.coupon_code}</b> at booking — coupon discount applied to 1st quotation only (not this one).
        </div>
      )}

      {/* ── Add appliance button / picker ── */}
      {canEdit && !showAddAppliance && (
        <div style={{ marginBottom:12 }}>
          <button
            onClick={() => setShowAddAppliance(true)}
            style={{ padding:'8px 16px', background:'linear-gradient(90deg,#059669,#10B981)', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:8 }}
          >
            + Add Appliance / Machine
          </button>
        </div>
      )}
      {showAddAppliance && (
        <CustomerAppliancePicker
          customerId={initBooking.customer_id}
          quotationId={quotation.id}
          existingLabels={labels}
          existingApplianceIds={(quotation.appliances || []).map((a: any) => a.appliance_id).filter(Boolean)}
          onPicked={() => { setShowAddAppliance(false); reload(); }}
          onManual={(label) => { setShowAddAppliance(false); reload(); }}
          onCancel={() => setShowAddAppliance(false)}
        />
      )}

      {/* ── Appliance cards ── */}
      {loading && <div style={{ textAlign:'center', padding:20 }}><Spinner /></div>}
      {!loading && labels.length === 0 && !showAddAppliance && (
        <div style={{ padding:'20px 0', textAlign:'center', fontSize:13, color:'#94A3B8' }}>
          No appliances yet. Click <b>+ Add Appliance / Machine</b> to begin.
        </div>
      )}
      {!loading && labels.map(label => {
        const g = groups.get(label)!;
        return (
          <ApplianceCard
            key={label}
            label={label}
            services={g.services}
            parts={g.parts}
            canEdit={canEdit}
            quotationId={quotation.id}
            quotationStatus={quotation.status}
            bookingCity={bookingCity}
            hasTechnician={hasTech}
            technicianId={techId}
            onReload={reload}
            onRemove={removeApplianceLabel}
          />
        );
      })}

      {/* ── Financial Summary ── */}
      <div style={{ background:'#F8FAFC', border:'1px solid #E2E8F0', borderRadius:10, padding:'12px 16px', marginTop:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: financialsOpen ? 12 : 0 }}>
          <div style={{ fontWeight:800, fontSize:13, color:'#0F172A' }}>💰 Financial Summary</div>
          {canEdit && (
            <button onClick={() => setFinancialsOpen(o => !o)}
              style={{ padding:'4px 12px', background: financialsOpen?'#EFF6FF':'#F1F5F9', border:'1px solid #BFDBFE', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700, color:'#1D4ED8' }}>
              {financialsOpen ? '✕ Close' : '✏️ Edit Financials'}
            </button>
          )}
        </div>

        {/* Edit financials panel (CCO only) */}
        {financialsOpen && canEdit && (
          <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:8, padding:'12px 14px', marginBottom:12 }}>
            {/* Tax mode */}
            <div style={{ marginBottom:12 }}>
              <label style={{ ...lbl, color:'#7C3AED' }}>🧾 Tax / GST Mode</label>
              <div style={{ display:'flex', gap:8 }}>
                {[
                  { val:'B2C', label:'B2C Consumer', hint:'Default GST' },
                  { val:'B2B', label:'B2B Business', hint:'Require GSTIN' },
                  { val:'NONE', label:'No Tax', hint:'Tax exempt — CCO/Admin only' },
                ].map(t => (
                  <button key={t.val} onClick={() => setEF('tax_mode', t.val)}
                    style={{ flex:1, padding:'7px 10px', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700, textAlign:'center',
                      border: `2px solid ${editForm.tax_mode===t.val?'#7C3AED':'#E2E8F0'}`,
                      background: editForm.tax_mode===t.val?'#EDE9FE':'#F8FAFC',
                      color: editForm.tax_mode===t.val?'#5B21B6':'#64748B' }}>
                    {t.label}
                    <div style={{ fontSize:9, fontWeight:400, color:'#94A3B8' }}>{t.hint}</div>
                  </button>
                ))}
              </div>
              {editForm.tax_mode !== 'NONE' && (
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8 }}>
                  <label style={{ ...lbl, marginBottom:0, whiteSpace:'nowrap' }}>GST %</label>
                  <input style={{ ...inp, width:90 }} type="number" min={0} max={100} step={0.1}
                    value={editForm.tax_percent} onChange={e => setEF('tax_percent', parseFloat(e.target.value)||0)} />
                </div>
              )}
              {editForm.tax_mode === 'NONE' && (
                <div style={{ fontSize:11, color:'#64748B', marginTop:4 }}>⚠️ Tax-exempt — no GST on this quotation.</div>
              )}
            </div>

            {/* B2B GST fields */}
            {editForm.tax_mode === 'B2B' && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12, background:'#F5F3FF', border:'1px solid #DDD6FE', borderRadius:8, padding:'10px 12px' }}>
                <div style={{ gridColumn:'1/-1' }}>
                  <label style={lbl}>Customer GSTIN *</label>
                  <input style={inp} placeholder="e.g. 21AABCP1234M1ZV" value={editForm.customer_gst_number} onChange={e => setEF('customer_gst_number', e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Business Name *</label>
                  <input style={inp} placeholder="Registered business name" value={editForm.customer_gst_name} onChange={e => setEF('customer_gst_name', e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Business Address</label>
                  <input style={inp} placeholder="Registered address" value={editForm.customer_gst_address} onChange={e => setEF('customer_gst_address', e.target.value)} />
                </div>
              </div>
            )}

            {/* Charges */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
              <div>
                <label style={lbl}>Service Charges (₹) <span style={{ fontWeight:400, color:'#94A3B8' }}>— default 0</span></label>
                <input style={inp} type="number" min={0} step={0.01} value={editForm.service_charges} onChange={e => setEF('service_charges', parseFloat(e.target.value)||0)} />
              </div>
              <div>
                <label style={lbl}>Coupon Discount <span style={{ fontWeight:400, color:'#94A3B8' }}>— read-only</span></label>
                <input style={{ ...inp, background:'#F1F5F9', color:'#94A3B8' }} readOnly
                  value={quotation.coupon_code ? `${quotation.coupon_code} — −${money(quotation.coupon_discount)}` : 'No coupon'} />
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
              <div>
                <label style={lbl}>CCO/Admin Discount (₹) <span style={{ fontWeight:400, color:'#94A3B8', fontSize:10 }}>adjustment after approval</span></label>
                <input style={inp} type="number" min={0} step={0.01} value={editForm.discount_amount} onChange={e => setEF('discount_amount', parseFloat(e.target.value)||0)} />
              </div>
              <div>
                <label style={lbl}>Adjustment (₹)</label>
                <input style={inp} type="number" min={0} step={0.01} value={editForm.adjustment_amount} onChange={e => setEF('adjustment_amount', parseFloat(e.target.value)||0)} />
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={lbl}>Remarks</label>
              <textarea style={{ ...inp, minHeight:52, resize:'vertical' }} value={editForm.remarks} onChange={e => setEF('remarks', e.target.value)} placeholder="Optional remarks…" />
            </div>
            <button onClick={saveFinancials} disabled={savingFinancials}
              style={{ padding:'7px 18px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, opacity:savingFinancials?0.5:1 }}>
              {savingFinancials ? '…' : '💾 Save Financial Settings'}
            </button>
          </div>
        )}

        {/* Summary rows */}
        <div style={{ display:'flex', flexDirection:'column', gap:4, fontSize:13 }}>
          {[
            ['Services Subtotal', money((quotation.services||[]).reduce((a:number,s:any)=>a+(s.total_price||0),0))],
            ['Parts Subtotal',    money((quotation.parts||[]).reduce((a:number,p:any)=>a+(p.total_price||0),0))],
            ['Service Charges',  money(quotation.service_charges)],
            ...(quotation.coupon_code ? [[`🏷️ Coupon (${quotation.coupon_code})`, `−${money(quotation.coupon_discount)}`]] : []),
            ...(quotation.discount_amount > 0 ? [['CCO Discount (−)', `−${money(quotation.discount_amount)}`]] : []),
            ...(quotation.adjustment_amount > 0 ? [['Adjustment', money(quotation.adjustment_amount)]] : []),
          ].map(([label, value]) => (
            <div key={label as string} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:'1px solid #F1F5F9' }}>
              <span style={{ color:'#64748B' }}>{label as string}</span>
              <span style={{ fontWeight:600, color: (label as string).includes('−') || (label as string).includes('Coupon') || (label as string).includes('Discount') ? '#DC2626' : '#0F172A' }}>{value as string}</span>
            </div>
          ))}
          {quotation.tax_mode !== 'NONE' && (
            <div style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:'1px solid #F1F5F9' }}>
              <span style={{ color:'#64748B' }}>
                GST {quotation.tax_percent}%
                {quotation.tax_mode === 'B2B' && <span style={{ marginLeft:6, background:'#EDE9FE', color:'#5B21B6', borderRadius:4, padding:'1px 4px', fontSize:9, fontWeight:700 }}>B2B</span>}
              </span>
              <span style={{ fontWeight:600 }}>{money(quotation.tax_amount)}</span>
            </div>
          )}
          {quotation.tax_mode === 'NONE' && (
            <div style={{ fontSize:11, color:'#64748B', padding:'3px 0' }}>🚫 Tax Exempt (Non-GST Invoice)</div>
          )}
          <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0 0', marginTop:4 }}>
            <span style={{ fontWeight:800, fontSize:15 }}>TOTAL</span>
            <span style={{ fontWeight:800, fontSize:16, color:'#059669' }}>{money(quotation.total_amount)}</span>
          </div>
        </div>

        {/* B2B GST strip */}
        {quotation.tax_mode === 'B2B' && quotation.customer_gst_number && (
          <div style={{ marginTop:8, background:'#EDE9FE', borderRadius:6, padding:'6px 10px', fontSize:11, color:'#5B21B6' }}>
            🏢 <b>B2B:</b> {quotation.customer_gst_name && <><b>{quotation.customer_gst_name}</b> · </>}GSTIN: <b>{quotation.customer_gst_number}</b>
          </div>
        )}
      </div>

      {/* ── Workflow Buttons ── */}
      <div style={{ display:'flex', gap:10, marginTop:14, flexWrap:'wrap' }}>
        {quotation.status === 'DRAFT' && (
          <>
            <button onClick={submit} disabled={submitting || labels.length === 0}
              style={{ padding:'9px 20px', background:'#1D4ED8', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700, opacity:submitting||labels.length===0?0.5:1 }}>
              {submitting ? '…' : '📤 Submit for Approval'}
            </button>
            <button onClick={deleteQuotation} disabled={submitting}
              style={{ padding:'9px 16px', background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700, opacity:submitting?0.5:1 }}>
              🗑 Delete
            </button>
          </>
        )}
        {quotation.status === 'SUBMITTED' && (
          <button onClick={revertToDraft} disabled={reverting}
            style={{ padding:'9px 20px', background:'#F59E0B', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700, opacity:reverting?0.5:1 }}>
            {reverting ? '…' : '↩ Revert to Draft'}
          </button>
        )}
        {quotation.status === 'APPROVED' && (
          <>
            <button onClick={revise} disabled={reverting}
              style={{ padding:'9px 20px', background:'#F59E0B', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700, opacity:reverting?0.5:1 }}>
              {reverting ? '…' : '↩ Revise & Edit'}
            </button>
            <button onClick={revertToDraft} disabled={reverting}
              style={{ padding:'9px 20px', background:'#EF4444', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700, opacity:reverting?0.5:1 }}>
              {reverting ? '…' : '🔄 Un-Approve (Edit)'}
            </button>
          </>
        )}
        {quotation.status === 'REJECTED' && (
          <div style={{ fontSize:12, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'8px 14px', flex:1 }}>
            ❌ Rejected — open and re-edit to resubmit.
          </div>
        )}
        {!showRejectBox && ['DRAFT','SUBMITTED'].includes(quotation.status) && (
          <button onClick={() => setShowRejectBox(true)}
            style={{ padding:'9px 16px', background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700 }}>
            ✕ Reject
          </button>
        )}
        {showRejectBox && (
          <div style={{ display:'flex', gap:8, flex:1, alignItems:'center' }}>
            <input style={{ ...inp, flex:1 }} placeholder="Reason for rejection…"
              value={rejectReason} onChange={e => setRejectReason(e.target.value)} autoFocus />
            <button onClick={rejectQ} disabled={rejecting}
              style={{ padding:'7px 14px', background:'#EF4444', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, opacity:rejecting?0.5:1 }}>
              {rejecting ? '…' : 'Confirm Reject'}
            </button>
            <button onClick={() => { setShowRejectBox(false); setRejectReason(''); }}
              style={{ padding:'7px 12px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:6, cursor:'pointer', fontSize:12 }}>
              Cancel
            </button>
          </div>
        )}
        <button onClick={onClose}
          style={{ padding:'9px 16px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:8, cursor:'pointer', fontSize:12 }}>
          ✕ Close
        </button>
      </div>

      {labels.length === 0 && canEdit && (
        <div style={{ fontSize:11, color:'#94A3B8', marginTop:6 }}>⚠️ Add at least one appliance before submitting.</div>
      )}
    </Modal>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// Main Export: CcoQuotationModal
// Phase manager: loading → list → create → editor
// ══════════════════════════════════════════════════════════════════════════════
export default function CcoQuotationModal({ booking, onClose, onDone }: {
  booking: any; onClose: () => void; onDone: () => void;
}) {
  const [phase, setPhase]           = useState<'loading' | 'list' | 'create' | 'editor'>('loading');
  const [existingQ, setExistingQ]   = useState<any[]>([]);
  const [quotation, setQuotation]   = useState<any>(null);
  const [openingId, setOpeningId]   = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [creating, setCreating]     = useState(false);
  const [err, setErr]               = useState('');

  // ── Customer GST profile for B2B pre-fill ──
  const [custGst, setCustGst]         = useState<any>(null);
  const [custGstLoading, setCustGstLoading] = useState(false);

  // ── Create form ──
  const [form, setForm] = useState({
    labour_charges: 0,
    service_charges: 0,       // ← default 0, NOT booking.base_amount
    tax_percent: 18,
    remarks: '',
    tax_mode: 'B2C',
    customer_gst_number: '',
    customer_gst_name: '',
    customer_gst_address: '',
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  // Load customer GST once
  useEffect(() => {
    const custId = booking?.customer_id;
    if (!custId) return;
    setCustGstLoading(true);
    quotationService.getCustomer(custId)
      .then((r: any) => {
        const c = r.data?.data || r.data;
        if (c?.gst_number) setCustGst({ gst_number: c.gst_number, gst_name: c.gst_name, gst_address: c.gst_address });
      })
      .catch(() => {})
      .finally(() => setCustGstLoading(false));
  }, [booking?.customer_id]);

  const useSavedGst = () => {
    if (!custGst) return;
    setForm(f => ({
      ...f,
      customer_gst_number: custGst.gst_number || f.customer_gst_number,
      customer_gst_name: custGst.gst_name || f.customer_gst_name,
      customer_gst_address: custGst.gst_address || f.customer_gst_address,
    }));
  };

  // Load existing quotations
  useEffect(() => {
    setPhase('loading');
    quotationService.listByBooking(booking.id)
      .then(async (r: any) => {
        const items: any[] = r.data?.data?.items || r.data?.data || [];
        setExistingQ(items);
        // Auto-open if single editable
        const editables = items.filter((q: any) => EDITABLE.includes(q.status));
        if (editables.length === 1 && items.length === 1) {
          try {
            const detail = await quotationService.get(editables[0].id);
            setQuotation((detail as any).data?.data);
            setPhase('editor');
          } catch { setPhase('list'); }
        } else {
          setPhase(items.length === 0 ? 'create' : 'list');
        }
      })
      .catch(() => setPhase('list'));
  }, [booking.id]);

  const openQuotation = async (qid: string) => {
    setOpeningId(qid); setErr('');
    try {
      const r = await quotationService.get(qid);
      setQuotation((r as any).data?.data);
      setPhase('editor');
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed to load'); }
    finally { setOpeningId(null); }
  };

  const revertAndOpen = async (qid: string) => {
    setRevertingId(qid); setErr('');
    try {
      await quotationService.revertToDraft(qid);
      const r = await quotationService.get(qid);
      setQuotation((r as any).data?.data);
      setPhase('editor');
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed to revert'); }
    finally { setRevertingId(null); }
  };

  const reviseAndOpen = async (qid: string) => {
    setRevertingId(qid + '_revise'); setErr('');
    try {
      const rv = await quotationService.revise(qid, 'Revision by CCO');
      const newId = (rv as any).data?.data?.id;
      if (newId) {
        const r = await quotationService.get(newId);
        setQuotation((r as any).data?.data);
        setPhase('editor');
      } else {
        const refetch: any = await quotationService.listByBooking(booking.id);
        const items: any[] = refetch.data?.data?.items || refetch.data?.data || [];
        setExistingQ(items);
        const newest = items.find((q: any) => EDITABLE.includes(q.status));
        if (newest) { await openQuotation(newest.id); } else { setPhase('list'); }
      }
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed to revise'); }
    finally { setRevertingId(null); }
  };

  const createNew = async () => {
    setCreating(true); setErr('');
    try {
      const payload: any = {
        booking_id: booking.id,
        labour_charges: form.labour_charges,
        service_charges: form.service_charges,   // 0 by default
        tax_percent: form.tax_mode === 'NONE' ? 0 : form.tax_percent,
        remarks: form.remarks || undefined,
        tax_mode: form.tax_mode,
        on_behalf_technician_id: booking?.technician_id || undefined,
      };
      // Coupon: only on first quotation, read from booking
      if (booking?.coupon_code && existingQ.length === 0) {
        payload.coupon_code = booking.coupon_code.trim().toUpperCase();
      }
      if (form.tax_mode === 'B2B') {
        if (form.customer_gst_number) payload.customer_gst_number = form.customer_gst_number;
        if (form.customer_gst_name)   payload.customer_gst_name   = form.customer_gst_name;
        if (form.customer_gst_address) payload.customer_gst_address = form.customer_gst_address;
      }
      const r: any = await quotationService.create(payload);
      const newId = r.data?.data?.id;
      if (!newId) throw new Error('No quotation ID returned');
      const detail = await quotationService.get(newId);
      setQuotation((detail as any).data?.data);
      setPhase('editor');
    } catch (ex: any) { setErr(ex.response?.data?.detail || 'Failed to create quotation'); }
    finally { setCreating(false); }
  };

  // ── PHASE: loading ─────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <Modal open={true} title={`Quotation — ${booking.booking_number}`} onClose={onClose} size="xl">
        <div style={{ padding:80, textAlign:'center' }}>
          <Spinner />
          <div style={{ marginTop:12, fontSize:13, color:'#94A3B8' }}>Loading quotations…</div>
        </div>
      </Modal>
    );
  }

  // ── PHASE: editor ──────────────────────────────────────────────────────────
  if (phase === 'editor' && quotation) {
    return (
      <QuotationEditor
        initQuotation={quotation}
        initBooking={booking}
        onClose={() => { onDone(); onClose(); }}
        onRefresh={onDone}
      />
    );
  }

  // ── PHASE: list + create ───────────────────────────────────────────────────
  const hasExisting   = existingQ.length > 0;
  const hasApproved   = existingQ.some((q: any) => q.status === 'APPROVED');
  const b2bIncomplete = form.tax_mode === 'B2B' && (!form.customer_gst_number.trim() || !form.customer_gst_name.trim());

  return (
    <Modal open={true} title={`Quotation — ${booking.booking_number}`} onClose={onClose} size="xl">
      {/* Booking strip */}
      <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12 }}>
        <div style={{ fontWeight:800, color:'#1E40AF', fontFamily:'monospace', fontSize:14 }}>{booking.booking_number}</div>
        <div style={{ color:'#3B82F6', marginTop:3 }}>
          👤 {booking.customer_name}
          {booking.city && <> · 📍 {booking.city}</>}
          {booking.service_name && <> · 🔧 {booking.service_name}</>}
          {booking.technician_name && <> · 👷 {booking.technician_name}</>}
        </div>
      </div>

      <ErrBox msg={err} />

      {/* ── Existing quotations ── */}
      {hasExisting && (
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#0F172A', marginBottom:10 }}>
            📋 {existingQ.length} existing quotation{existingQ.length !== 1 ? 's' : ''} for this booking:
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {existingQ.map((eq: any) => {
              const isEditable    = EDITABLE.includes(eq.status);
              const isApproved    = eq.status === 'APPROVED';
              const isSubmitted   = eq.status === 'SUBMITTED';
              const isLoadingThis = openingId === eq.id;
              const isRevising    = revertingId === eq.id + '_revise';
              return (
                <div key={eq.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px', background:'#F8FAFC', borderRadius:8, border: isEditable?'1.5px solid #86EFAC':'1px solid #E2E8F0' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                      <span style={{ fontWeight:700, fontSize:13, color:'#1B4FD8', fontFamily:'monospace' }}>{eq.quotation_number}</span>
                      <QBadge status={eq.status} />
                      <span style={{ fontSize:11, color:'#94A3B8' }}>v{eq.version}</span>
                    </div>
                    <div style={{ fontSize:11, color:'#64748B' }}>
                      Total: <b style={{ color:'#059669' }}>₹{(eq.total_amount||0).toLocaleString('en-IN')}</b>
                      {eq.coupon_code && <span style={{ marginLeft:8, fontSize:10, fontWeight:700, background:'#FFFBEB', color:'#92400E', border:'1px solid #FDE68A', borderRadius:10, padding:'1px 7px' }}>🏷️ {eq.coupon_code}</span>}
                      {isEditable   && <span style={{ marginLeft:10, color:'#166534', fontWeight:600 }}>✏️ Can edit</span>}
                      {isApproved   && <span style={{ marginLeft:10, color:'#92400E' }}>🔒 Approved — revise to edit</span>}
                      {isSubmitted  && <span style={{ marginLeft:10, color:'#1D4ED8' }}>📤 Awaiting approval</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6, flexShrink:0, flexWrap:'wrap' }}>
                    <button onClick={() => openQuotation(eq.id)} disabled={!!openingId || !!revertingId}
                      style={{ padding:'5px 12px', background: isEditable?'#DCFCE7':'#EFF6FF', color: isEditable?'#166534':'#1D4ED8', border:`1px solid ${isEditable?'#86EFAC':'#BFDBFE'}`, borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 }}>
                      {isLoadingThis ? <Spinner /> : isEditable ? '✏️ Open & Edit' : '👁 View'}
                    </button>
                    {isSubmitted && (
                      <button onClick={() => revertAndOpen(eq.id)} disabled={!!openingId || !!revertingId}
                        style={{ padding:'5px 12px', background:'#FEF3C7', color:'#92400E', border:'1px solid #FDE68A', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 }}>
                        {revertingId===eq.id ? <Spinner /> : '✏️ Edit (Revert Draft)'}
                      </button>
                    )}
                    {isApproved && (
                      <>
                        <button onClick={() => reviseAndOpen(eq.id)} disabled={!!openingId || !!revertingId}
                          style={{ padding:'5px 12px', background:'#FEF3C7', color:'#92400E', border:'1px solid #FDE68A', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 }}>
                          {isRevising ? <Spinner /> : '↩ Revise'}
                        </button>
                        <button onClick={() => revertAndOpen(eq.id)} disabled={!!openingId || !!revertingId}
                          style={{ padding:'5px 12px', background:'#FEE2E2', color:'#DC2626', border:'1px solid #FECACA', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 }}>
                          {revertingId===eq.id ? <Spinner /> : '🔄 Un-Approve'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {!hasApproved && (
            <div style={{ margin:'16px 0', display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ flex:1, height:1, background:'#E2E8F0' }} />
              <span style={{ fontSize:11, color:'#94A3B8', fontWeight:600 }}>OR CREATE A NEW QUOTATION</span>
              <div style={{ flex:1, height:1, background:'#E2E8F0' }} />
            </div>
          )}
        </div>
      )}

      {/* ── Create form ── */}
      {hasApproved ? (
        <div style={{ background:'#DCFCE7', border:'1px solid #86EFAC', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#166534' }}>
          ✅ An <b>approved</b> quotation exists. Use <b>Revise</b> or <b>Un-Approve</b> above to make changes.
        </div>
      ) : (
        <>
          {/* Tax / GST settings */}
          <div style={{ background:'#F5F3FF', border:'1px solid #DDD6FE', borderRadius:8, padding:'12px 14px', marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#7C3AED', marginBottom:10 }}>🧾 Tax / GST Settings</div>
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              {[
                { val:'B2C',  label:'B2C (Consumer)', hint:'Default — apply GST' },
                { val:'B2B',  label:'B2B (Business)', hint:'Require customer GSTIN' },
                { val:'NONE', label:'No Tax', hint:'Non-GST / Tax exempt' },
              ].map(t => (
                <button key={t.val} onClick={() => set('tax_mode', t.val)}
                  style={{ flex:1, padding:'8px 10px', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, textAlign:'center',
                    border: `2px solid ${form.tax_mode===t.val?'#7C3AED':'#E2E8F0'}`,
                    background: form.tax_mode===t.val?'#EDE9FE':'#F8FAFC',
                    color: form.tax_mode===t.val?'#5B21B6':'#64748B' }}>
                  {t.label}
                  <div style={{ fontSize:9, fontWeight:400, color:'#94A3B8' }}>{t.hint}</div>
                </button>
              ))}
            </div>
            {form.tax_mode !== 'NONE' && (
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: form.tax_mode==='B2B'?10:0 }}>
                <label style={{ ...lbl, marginBottom:0 }}>GST %</label>
                <input style={{ ...inp, width:100 }} type="number" min={0} max={100} step={0.1}
                  value={form.tax_percent} onChange={e => set('tax_percent', parseFloat(e.target.value)||0)} />
                <span style={{ fontSize:11, color:'#94A3B8' }}>Applied on subtotal</span>
              </div>
            )}
            {form.tax_mode === 'NONE' && (
              <div style={{ fontSize:11, color:'#64748B' }}>⚠️ Tax-exempt — no GST will be applied. Non-Tax invoices are for CCO/Admin only.</div>
            )}
            {form.tax_mode === 'B2B' && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
                {custGst && !form.customer_gst_number && (
                  <div style={{ gridColumn:'1/-1', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8, padding:'8px 12px' }}>
                    <div style={{ fontSize:11, color:'#92400E', marginBottom:6 }}>
                      Saved GST: <b>{custGst.gst_name}</b> ({custGst.gst_number})
                    </div>
                    <button onClick={useSavedGst}
                      style={{ padding:'4px 12px', background:'#F59E0B', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:700 }}>
                      Use Saved GST Details
                    </button>
                  </div>
                )}
                {custGstLoading && !custGst && (
                  <div style={{ gridColumn:'1/-1', fontSize:11, color:'#64748B' }}>Checking customer's saved GST details…</div>
                )}
                <div style={{ gridColumn:'1/-1' }}>
                  <label style={lbl}>Customer GSTIN *</label>
                  <input style={inp} placeholder="e.g. 21AABCP1234M1ZV" value={form.customer_gst_number} onChange={e => set('customer_gst_number', e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Business Name *</label>
                  <input style={inp} placeholder="Registered business name" value={form.customer_gst_name} onChange={e => set('customer_gst_name', e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Business Address</label>
                  <input style={inp} placeholder="Registered address" value={form.customer_gst_address} onChange={e => set('customer_gst_address', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Charges */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
            <div>
              <label style={lbl}>Labour Charges (₹)</label>
              <input style={inp} type="number" min={0} step={0.01} value={form.labour_charges} onChange={e => set('labour_charges', parseFloat(e.target.value)||0)} />
            </div>
            <div>
              <label style={lbl}>Service Charges (₹) <span style={{ fontWeight:400, color:'#94A3B8', fontSize:10 }}>— default 0</span></label>
              <input style={inp} type="number" min={0} step={0.01} value={form.service_charges} onChange={e => set('service_charges', parseFloat(e.target.value)||0)} />
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Remarks (optional)</label>
            <textarea style={{ ...inp, minHeight:52, resize:'vertical' }} value={form.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Optional remarks…" />
          </div>

          {/* Coupon banner (read-only) */}
          {existingQ.length === 0 && booking?.coupon_code && (
            <div style={{ marginBottom:14, background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8, padding:'10px 14px' }}>
              <div style={{ fontSize:12, color:'#92400E', fontWeight:700, marginBottom:2 }}>🏷️ Coupon applied by customer</div>
              <div style={{ fontFamily:'monospace', fontWeight:700, letterSpacing:1, fontSize:14, color:'#92400E' }}>{booking.coupon_code}</div>
              <div style={{ fontSize:11, color:'#92400E', marginTop:3 }}>Discount will be auto-calculated on this quotation.</div>
            </div>
          )}

          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <button onClick={createNew} disabled={creating || b2bIncomplete}
              style={{ padding:'9px 20px', background:'#1D4ED8', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700, opacity:creating||b2bIncomplete?0.5:1 }}>
              {creating ? <Spinner /> : '✅ Create Quotation →'}
            </button>
            {b2bIncomplete && <span style={{ fontSize:11, color:'#DC2626' }}>B2B requires GSTIN &amp; Business Name</span>}
            <button onClick={onClose}
              style={{ padding:'9px 16px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:8, cursor:'pointer', fontSize:12 }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
