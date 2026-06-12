import { useMemo } from 'react';
import { format } from 'date-fns';
import type { Driver, Client, Booking, RouteAssignment } from '../../types';
import logo from '../../assets/KIDZ logo4 site.png';

export interface PayStubProps {
  driver: Driver;
  assignments: RouteAssignment[];
  bookings: Booking[];
  clients: Client[];
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  printedAt: Date;
  /** 'single' (default): apply visibility CSS to hide sidebar etc. 'batch': skip it, parent handles visibility */
  printMode?: 'single' | 'batch';
  /** If true, renders at larger scale for on-screen preview instead of print */
  preview?: boolean;
}

const ONES  = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const TEENS = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS  = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function numberToWords(n: number): string {
  if (n === 0) return 'Zero';
  const dollars = Math.floor(n);
  const cents   = Math.round((n - dollars) * 100);

  function h(num: number): string {
    if (num === 0)   return '';
    if (num < 10)    return ONES[num];
    if (num < 20)    return TEENS[num - 10];
    if (num < 100)   { const t = TENS[Math.floor(num / 10)]; const o = ONES[num % 10]; return o ? `${t}-${o}` : t; }
    const hi = ONES[Math.floor(num / 100)];
    const lo = h(num % 100);
    return lo ? `${hi} Hundred ${lo}` : `${hi} Hundred`;
  }

  const dPart = dollars < 1000
    ? h(dollars)
    : (() => { const t = h(Math.floor(dollars / 1000)) + ' Thousand'; const r = h(dollars % 1000); return r ? `${t} ${r}` : t; })();

  return `${dPart} and ${String(cents).padStart(2, '0')}/100`;
}

function checkNum(assignments: RouteAssignment[], driverId: string): string {
  const seed = assignments.length > 0
    ? assignments.map(a => a.id.slice(0, 6)).join('')
    : driverId.slice(0, 8);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) { hash = ((hash << 5) - hash) + seed.charCodeAt(i); hash |= 0; }
  return String(Math.abs(hash) % 90000 + 10000);
}

function fmtMoney(n: number): string {
  const [d, c] = n.toFixed(2).split('.');
  return `$${d.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${ c }`;
}

// ─── styles ──────────────────────────────────────────────────────────────────

const S = {
  // containers
  root:    { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 12, color: '#000', maxWidth: 680, margin: '0 auto', backgroundColor: '#fff' },
  check:   { border: '1.5px solid #475569', padding: '20px 24px 14px', backgroundColor: '#f8fbff', position: 'relative' as const, overflow: 'hidden' },
  stub:    { border: '1.5px solid #475569', borderTop: 'none', backgroundColor: '#fff' },

  // check internals
  checkNumBox:  { position: 'absolute' as const, top: 14, right: 20, textAlign: 'right' as const },
  checkNumLabel:{ fontSize: 7.5, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.1em', display: 'block', lineHeight: 1 },
  checkNumVal:  { fontFamily: 'Courier New, monospace', fontWeight: 700, fontSize: 17, color: '#1e293b', letterSpacing: '0.12em' },
  header:       { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  co:           { fontWeight: 800, fontSize: 14, color: '#1e293b', letterSpacing: '-0.01em' },
  coSub:        { fontSize: 9, color: '#64748b', marginTop: 1 },
  fieldRow:     { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 },
  fieldLabel:   { fontSize: 8, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.1em', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  fieldLine:    { flex: 1, borderBottom: '1px solid #64748b', paddingBottom: 2 },
  payeeName:    { fontWeight: 700, fontSize: 15, color: '#1e293b' },
  payeeAddr:    { fontSize: 9.5, color: '#475569', marginTop: 3 },
  wordsLine:    { fontSize: 10.5, color: '#334155', fontStyle: 'italic' as const },
  amtBox:       { border: '2px solid #1e293b', borderRadius: 2, padding: '5px 10px', backgroundColor: '#fff', textAlign: 'right' as const, minWidth: 130, flexShrink: 0 },
  amtLabel:     { fontSize: 7.5, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 2, display: 'block' },
  amtVal:       { fontFamily: 'Courier New, monospace', fontWeight: 800, fontSize: 20, color: '#1e293b', letterSpacing: '0.04em' },
  memoRow:      { display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 16 },
  sigRow:       { display: 'flex', alignItems: 'center', gap: 6, marginLeft: '50%' },
  micrLine:     { marginTop: 12, paddingTop: 8, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontFamily: 'Courier New, monospace', fontSize: 10, color: '#cbd5e1', letterSpacing: '0.18em', userSelect: 'none' as const },

  // perforation
  perf:         { position: 'relative' as const, borderTop: '2px dashed #94a3b8', margin: '12px 0' },
  perfLabel:    { position: 'absolute' as const, top: -9, left: '50%', transform: 'translateX(-50%)', backgroundColor: '#fff', padding: '0 10px', fontSize: 7.5, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.2em', whiteSpace: 'nowrap' as const },

  // stub header bar
  stubHead:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', backgroundColor: '#1e293b' },
  stubCoName:   { fontWeight: 700, fontSize: 12, color: '#fff' },
  stubCoSub:    { fontSize: 8.5, color: '#94a3b8', letterSpacing: '0.08em' },
  stubNetLabel: { fontSize: 8, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  stubNetVal:   { fontFamily: 'Courier New, monospace', fontWeight: 800, fontSize: 17, color: '#34d399' },

  // info grid
  infoGrid:     { display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #e2e8f0' },
  infoCell:     { padding: '10px 20px' },
  infoTitle:    { fontSize: 7.5, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 5, fontWeight: 700 },
  infoName:     { fontWeight: 700, fontSize: 12, color: '#1e293b', marginBottom: 2 },
  infoLine:     { fontSize: 9.5, color: '#475569', marginBottom: 1 },
  badge:        { display: 'inline-block', fontSize: 8.5, color: '#6366f1', backgroundColor: '#eef2ff', borderRadius: 2, padding: '1px 6px', fontWeight: 600, marginTop: 4 },
  infoRow:      { display: 'flex', justifyContent: 'space-between', marginBottom: 3 },
  infoKey:      { fontSize: 9.5, color: '#64748b' },
  infoVal:      { fontSize: 9.5, color: '#1e293b', fontWeight: 600 },

  // earnings table
  earningsWrap: { padding: '10px 20px 0' },
  earningsTitle:{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.1em', fontWeight: 700, marginBottom: 5 },
  th:           { fontSize: 7.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.08em', padding: '5px 8px', backgroundColor: '#f1f5f9', borderTop: '1px solid #e2e8f0', borderBottom: '1.5px solid #cbd5e1' },
  td:           { padding: '6px 8px', fontSize: 10.5, borderBottom: '1px solid #f1f5f9' },

  // totals
  totalsWrap:   { display: 'flex', justifyContent: 'flex-end', padding: '6px 20px 14px' },
  totalsTable:  { width: 270, fontSize: 10.5, borderCollapse: 'collapse' as const },
  totalRow:     { borderTop: '1px solid #e2e8f0' },
  totalKey:     { padding: '4px 8px', color: '#64748b' },
  totalVal:     { padding: '4px 8px', textAlign: 'right' as const, fontFamily: 'Courier New, monospace', color: '#334155' },
  netRow:       { borderTop: '2px solid #1e293b' },
  netKey:       { padding: '6px 8px', fontWeight: 800, fontSize: 11.5, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  netVal:       { padding: '6px 8px', textAlign: 'right' as const, fontFamily: 'Courier New, monospace', fontWeight: 800, fontSize: 13, color: '#1e293b' },

  // footer
  footer:       { borderTop: '1px solid #e2e8f0', padding: '6px 20px', backgroundColor: '#f8faff', textAlign: 'center' as const, fontSize: 8, color: '#94a3b8', letterSpacing: '0.04em' },
} as const;

// ─── component ───────────────────────────────────────────────────────────────

const PayStub: React.FC<PayStubProps> = ({
  driver, assignments, bookings, clients,
  periodLabel, periodStart, periodEnd, printedAt,
  printMode = 'single',
  preview = false,
}) => {
  const grossPay = useMemo(
    () => assignments.reduce((s, a) => s + (a.weeklyPayout || 0), 0),
    [assignments],
  );

  // Group earnings by client — totals only, no per-route detail
  const earningRows = useMemo(() => {
    const map: Record<string, { name: string; total: number; count: number }> = {};
    assignments.forEach(a => {
      const booking = bookings.find(b => b.id === a.bookingId);
      const client  = booking ? clients.find(c => c.id === booking.clientId) : null;
      const key     = client?.id ?? '__unknown__';
      const entry   = (map[key] ??= { name: client?.name ?? 'Route Services', total: 0, count: 0 });
      entry.total  += a.weeklyPayout || 0;
      entry.count  += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [assignments, bookings, clients]);

  const driverName     = driver.companyName || driver.name;
  const driverAddress  = driver.address || '';
  const driverPhone    = driver.phone   || '';
  const driverType     = driver.driverType === 'contractor'            ? 'Independent Contractor'
                       : driver.driverType === 'subcontractor_company' ? 'Subcontractor (Company)'
                       : 'Employee';
  const splitPct       = driver.payoutSplit || 70;
  const checkNo        = checkNum(assignments, driver.id);
  const checkDate      = format(new Date(), 'MM/dd/yyyy');
  const pStart         = format(periodStart, 'MM/dd/yyyy');
  const pEnd           = format(periodEnd,   'MM/dd/yyyy');

  return (
    <>
      {/* Single-print: use visibility trick so sidebar/layout disappears.
          Batch print: parent (Payroll.tsx) handles visibility via print:hidden. */}
      {printMode === 'single' && (
        <style>{`
          @media print {
            @page { size: letter portrait; margin: 0.5in; }
            body { visibility: hidden !important; }
            .paystub-print-root, .paystub-print-root * { visibility: visible !important; }
            .paystub-print-root { position: absolute; top: 0; left: 0; width: 100%; }
          }
        `}</style>
      )}
      {printMode === 'batch' && (
        <style>{`
          @media print {
            @page { size: letter portrait; margin: 0.5in; }
          }
        `}</style>
      )}

      <div className="paystub-print-root" style={{ ...S.root, ...(preview ? { transform: 'scale(1.05)', transformOrigin: 'top center' } : {}) }}>

        {/* ══ CHECK ══════════════════════════════════════════════════════════ */}
        <div style={S.check}>
          {/* Security background */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.025, backgroundImage: 'repeating-linear-gradient(45deg,#1e40af 0,#1e40af 1px,transparent 0,transparent 50%)', backgroundSize: '8px 8px', pointerEvents: 'none' }} />

          {/* Check number */}
          <div style={S.checkNumBox}>
            <span style={S.checkNumLabel}>Check No.</span>
            <span style={S.checkNumVal}>{checkNo}</span>
          </div>

          {/* Header */}
          <div style={S.header}>
            <img src={logo} alt="KIDZ Transportation" style={{ height: 42, width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
            <div>
              <div style={S.co}>KIDZ Transportation LLC</div>
              <div style={S.coSub}>Contractor Payment</div>
            </div>
          </div>

          {/* Date */}
          <div style={{ ...S.fieldRow, marginLeft: '50%' }}>
            <span style={S.fieldLabel}>Date</span>
            <div style={S.fieldLine}>
              <span style={{ fontFamily: 'Courier New, monospace', fontSize: 11.5, color: '#1e293b' }}>{checkDate}</span>
            </div>
          </div>

          {/* Pay to */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...S.fieldLabel, marginBottom: 3 }}>Pay to the Order of</div>
            <div style={{ ...S.fieldLine, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={S.payeeName}>{driverName}</span>
            </div>
            {driverAddress && <div style={S.payeeAddr}>{driverAddress}</div>}
          </div>

          {/* Amount in words + dollar box */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.fieldLabel, marginBottom: 3 }}>The Sum of</div>
              <div style={S.fieldLine}>
                <span style={S.wordsLine}>
                  {numberToWords(grossPay)} Dollars {'—'.repeat(20)}
                </span>
              </div>
            </div>
            <div style={S.amtBox}>
              <span style={S.amtLabel}>Amount</span>
              <span style={S.amtVal}>{fmtMoney(grossPay)}</span>
            </div>
          </div>

          {/* Memo */}
          <div style={S.memoRow}>
            <span style={S.fieldLabel}>Memo</span>
            <div style={{ ...S.fieldLine }}>
              <span style={{ fontSize: 10, color: '#475569' }}>
                {periodLabel} &nbsp;·&nbsp; Pay Period: {pStart} – {pEnd} &nbsp;·&nbsp; {driverType}
              </span>
            </div>
          </div>

          {/* Signature */}
          <div style={S.sigRow}>
            <span style={S.fieldLabel}>Authorized Signature</span>
            <div style={{ flex: 1, borderBottom: '1px solid #94a3b8' }} />
          </div>

          {/* MICR */}
          <div style={S.micrLine}>
            <span>⑆ :123456789: ⑆</span>
            <span>⑆ 9876543210 :{checkNo}: ⑆</span>
          </div>
        </div>

        {/* ══ PERFORATION ════════════════════════════════════════════════════ */}
        <div style={S.perf}>
          <span style={S.perfLabel}>✂ DETACH — RETAIN THIS STUB FOR YOUR RECORDS</span>
        </div>

        {/* ══ EARNINGS STUB ══════════════════════════════════════════════════ */}
        <div style={S.stub}>

          {/* Header bar */}
          <div style={S.stubHead}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={logo} alt="KIDZ" style={{ height: 28, width: 'auto', objectFit: 'contain', filter: 'brightness(10)' }} />
              <div>
                <div style={S.stubCoName}>KIDZ Transportation LLC</div>
                <div style={S.stubCoSub}>EARNINGS STATEMENT — NOT A CHECK</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={S.stubNetLabel}>Net Pay</div>
              <div style={S.stubNetVal}>{fmtMoney(grossPay)}</div>
            </div>
          </div>

          {/* Info grid */}
          <div style={S.infoGrid}>
            {/* Contractor info */}
            <div style={{ ...S.infoCell, borderRight: '1px solid #e2e8f0' }}>
              <div style={S.infoTitle}>Contractor</div>
              <div style={S.infoName}>{driverName}</div>
              {driverAddress && <div style={S.infoLine}>{driverAddress}</div>}
              {driverPhone   && <div style={S.infoLine}>{driverPhone}</div>}
              <div style={S.badge}>{driverType}</div>
            </div>
            {/* Pay details */}
            <div style={S.infoCell}>
              <div style={S.infoTitle}>Pay Details</div>
              {([
                ['Pay Period',    `${pStart} – ${pEnd}`],
                ['Pay Date',      checkDate],
                ['Check No.',     checkNo],
                ['Revenue Split', `${splitPct}% Contractor / ${100 - splitPct}% Company`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={S.infoRow}>
                  <span style={S.infoKey}>{k}</span>
                  <span style={{ ...S.infoVal, fontFamily: k === 'Check No.' ? 'Courier New, monospace' : undefined }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Earnings */}
          <div style={S.earningsWrap}>
            <div style={S.earningsTitle}>Earnings</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...S.th, textAlign: 'left'  }}>Description</th>
                  <th style={{ ...S.th, textAlign: 'center', width: 70 }}>Routes</th>
                  <th style={{ ...S.th, textAlign: 'right',  width: 110 }}>This Period</th>
                </tr>
              </thead>
              <tbody>
                {earningRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ ...S.td, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>
                      No assignments in this pay period
                    </td>
                  </tr>
                ) : (
                  earningRows.map((row, i) => (
                    <tr key={i}>
                      <td style={S.td}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{row.name}</span>
                        <span style={{ marginLeft: 6, fontSize: 9, color: '#94a3b8' }}>Transportation Services</span>
                      </td>
                      <td style={{ ...S.td, textAlign: 'center', color: '#475569' }}>{row.count}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: 700, color: '#1e293b' }}>
                        {fmtMoney(row.total)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div style={S.totalsWrap}>
            <table style={S.totalsTable}>
              <tbody>
                <tr style={S.totalRow}>
                  <td style={S.totalKey}>Gross Pay</td>
                  <td style={S.totalVal}>{fmtMoney(grossPay)}</td>
                </tr>
                <tr>
                  <td style={S.totalKey}>Federal Income Tax</td>
                  <td style={S.totalVal}>$0.00</td>
                </tr>
                <tr>
                  <td style={S.totalKey}>State Income Tax</td>
                  <td style={S.totalVal}>$0.00</td>
                </tr>
                <tr>
                  <td style={S.totalKey}>Total Deductions</td>
                  <td style={S.totalVal}>$0.00</td>
                </tr>
                <tr style={S.netRow}>
                  <td style={S.netKey}>Net Pay</td>
                  <td style={S.netVal}>{fmtMoney(grossPay)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div style={S.footer}>
            KIDZ Transportation LLC &nbsp;·&nbsp; Check #{checkNo} &nbsp;·&nbsp;
            This document is not a negotiable instrument &nbsp;·&nbsp;
            Printed {format(printedAt, 'MM/dd/yyyy h:mm a')}
          </div>
        </div>

      </div>
    </>
  );
};

export default PayStub;
