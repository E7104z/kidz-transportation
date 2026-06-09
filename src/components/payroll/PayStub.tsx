import { useMemo } from 'react';
import { format } from 'date-fns';
import type { Driver, Client, Booking, RouteAssignment, RouteLog } from '../../types';
import logo from '../../assets/KIDZ logo4 site.png';

export interface PayStubProps {
  driver: Driver;
  assignments: RouteAssignment[];
  bookings: Booking[];
  clients: Client[];
  periodLabel: string;       // e.g. "Week of Jun 1, 2026" or "June 2026"
  periodStart: Date;
  periodEnd: Date;
  getLog: (bookingId: string, day: Date) => RouteLog | undefined;
  dailyRateFor: (a: RouteAssignment) => number;
  printedAt: Date;
}

// ── Number-to-words for check amount line ──────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const TEENS = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function numberToWords(n: number): string {
  if (n === 0) return 'Zero';
  const dollars = Math.floor(n);
  const cents = Math.round((n - dollars) * 100);

  function convertHundreds(num: number): string {
    if (num === 0) return '';
    if (num < 10) return ONES[num];
    if (num < 20) return TEENS[num - 10];
    if (num < 100) {
      const t = TENS[Math.floor(num / 10)];
      const o = ONES[num % 10];
      return o ? `${t}-${o}` : t;
    }
    const h = ONES[Math.floor(num / 100)];
    const rest = convertHundreds(num % 100);
    return rest ? `${h} Hundred ${rest}` : `${h} Hundred`;
  }

  if (dollars < 1000) {
    const dPart = convertHundreds(dollars);
    const cPart = cents > 0 ? ` and ${cents.toString().padStart(2, '0')}/100` : ' and 00/100';
    return dPart + cPart;
  }

  const thousands = Math.floor(dollars / 1000);
  const remainder = dollars % 1000;
  const tPart = convertHundreds(thousands) + ' Thousand';
  const rPart = convertHundreds(remainder);
  const dollarWords = rPart ? `${tPart} ${rPart}` : tPart;
  const cPart = cents > 0 ? ` and ${cents.toString().padStart(2, '0')}/100` : ' and 00/100';
  return dollarWords + cPart;
}

// ── Check-number generator ─────────────────────────────────────────────────
function generateCheckNumber(assignments: RouteAssignment[], driverId: string): string {
  // Deterministic check number from driver + first assignment
  const seed = assignments.length > 0
    ? assignments.map(a => a.id.slice(0, 6)).join('')
    : driverId.slice(0, 8);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return String(Math.abs(hash) % 90000 + 10000); // 5-digit check number
}

const PayStub: React.FC<PayStubProps> = ({
  driver,
  assignments,
  bookings,
  clients,
  periodLabel,
  periodStart,
  periodEnd,
  getLog,
  dailyRateFor,
  printedAt,
}) => {
  const DOW_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Group assignments by booking for line items
  const lineItems = useMemo(() => {
    return assignments.map(a => {
      const booking = bookings.find(b => b.id === a.bookingId);
      const client = booking ? clients.find(c => c.id === booking.clientId) : null;
      const rate = dailyRateFor(a);

      const dayDetails = DOW_ORDER.filter(d => (a.daysWorked || []).includes(d)).map(d => {
        const dayIdx = DOW_ORDER.indexOf(d);
        const date = new Date(periodStart);
        date.setDate(periodStart.getDate() + dayIdx);
        const log = getLog(a.bookingId, date);
        return {
          day: d,
          date: format(date, 'MMM d'),
          ran: log?.ran === true,
          missed: log?.ran === false,
          unconfirmed: log?.ran === undefined,
        };
      });

      const daysWorkedCount = dayDetails.filter(d => d.ran).length;
      const actualPay = daysWorkedCount * rate;
      const driverCut = actualPay * (driver.payoutSplit ? driver.payoutSplit / 100 : 0.70);

      return {
        assignmentId: a.id,
        bookingId: a.bookingId,
        clientName: client?.name || 'Unknown Client',
        route: booking
          ? `${booking.pickupAddress || 'N/A'} → ${booking.dropoffAddress || 'N/A'}`
          : 'N/A',
        type: booking?.transportationType || 'N/A',
        rate,
        daysWorkedCount,
        daysScheduled: (a.daysWorked || []).length,
        expectedPay: a.weeklyPayout || 0,
        actualPay,
        driverCut,
        dayDetails,
        status: a.status,
      };
    });
  }, [assignments, bookings, clients, dailyRateFor, getLog, periodStart]);

  // Totals
  const totals = useMemo(() => {
    return lineItems.reduce(
      (acc, item) => ({
        expectedPay: acc.expectedPay + item.expectedPay,
        actualPay: acc.actualPay + item.actualPay,
        driverCut: acc.driverCut + item.driverCut,
        daysWorked: acc.daysWorked + item.daysWorkedCount,
        daysScheduled: acc.daysScheduled + item.daysScheduled,
      }),
      { expectedPay: 0, actualPay: 0, driverCut: 0, daysWorked: 0, daysScheduled: 0 }
    );
  }, [lineItems]);

  const driverName = driver.companyName || driver.name;
  const driverAddress = driver.address || '—';
  const driverPhone = driver.phone || '—';
  const driverTypeLabel =
    driver.driverType === 'contractor'
      ? 'Independent Contractor'
      : driver.driverType === 'subcontractor_company'
      ? 'Subcontractor (Company)'
      : 'Employee';
  const splitPercent = driver.payoutSplit || 70;

  const netPay = totals.driverCut;
  const amountWords = numberToWords(netPay);
  const checkNumber = generateCheckNumber(assignments, driver.id);
  const checkDate = format(new Date(), 'MM/dd/yyyy');

  return (
    <div className="paystub-container max-w-[850px] mx-auto bg-white text-black font-sans print:max-w-full">
      {/* ================================================================= */}
      {/* TOP HALF — THE CHECK                                              */}
      {/* ================================================================= */}
      <div className="paystub-check relative border-2 border-slate-700 bg-[#fefcf5] p-8">
        {/* Subtle check-pattern background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 6px, #1e3a5f 6px, #1e3a5f 7px)`,
          }}
        />

        {/* Check Number — top right */}
        <div className="absolute top-5 right-6 text-right">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest block leading-none">Check No.</span>
          <span className="text-lg font-mono font-bold text-slate-700 tracking-wider">{checkNumber}</span>
        </div>

        {/* Company Header */}
        <div className="flex items-start gap-4 mb-6">
          <img
            src={logo}
            alt="KIDZ Transportation"
            className="h-12 w-auto object-contain print:h-12 flex-shrink-0"
          />
          <div>
            <h1 className="text-xl font-extrabold text-slate-800 leading-tight tracking-tight">
              KIDZ Transportation LLC
            </h1>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Safe Rides for Little Lives
            </p>
          </div>
        </div>

        {/* Date line */}
        <div className="flex items-center gap-3 mb-5 ml-[55%]">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex-shrink-0">Date</span>
          <div className="flex-1 border-b border-slate-400 pb-0.5">
            <span className="text-sm font-mono text-slate-700">{checkDate}</span>
          </div>
        </div>

        {/* Pay to the Order of */}
        <div className="mb-3">
          <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
            Pay to the Order of
          </span>
          <div className="border-b border-slate-500 pb-1">
            <span className="text-base font-bold text-slate-800">{driverName}</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
            {driverAddress}
          </p>
        </div>

        {/* Amount in Words */}
        <div className="mb-3">
          <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
            The Sum of
          </span>
          <div className="border-b border-slate-500 pb-1">
            <span className="text-sm font-semibold text-slate-700 italic">
              {amountWords} Dollars
            </span>
          </div>
        </div>

        {/* Amount Box */}
        <div className="absolute right-6 top-[120px] w-[180px]">
          <div className="border-2 border-slate-600 rounded-sm bg-white p-3">
            <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-0.5">Amount</span>
            <span className="text-2xl font-extrabold font-mono text-slate-800 tracking-tight">
              ${netPay.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Memo line */}
        <div className="flex items-center gap-3 mb-6 mt-8">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex-shrink-0">Memo</span>
          <div className="flex-1 border-b border-slate-400 pb-0.5">
            <span className="text-xs text-slate-600">
              {periodLabel} · {format(periodStart, 'MMM d')} – {format(periodEnd, 'MMM d, yyyy')} · {driverTypeLabel}
            </span>
          </div>
        </div>

        {/* Signature line */}
        <div className="flex items-center gap-3 mt-8 ml-[55%]">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex-shrink-0">Authorized Signature</span>
          <div className="flex-1 border-b border-slate-400 pb-0.5" />
        </div>

        {/* MICR line (stylized bank numbers at bottom) */}
        <div className="mt-8 pt-3 border-t border-slate-200">
          <div className="flex items-center justify-between font-mono text-[13px] tracking-[2px] text-slate-300 select-none">
            <span>⑆ :123456789:⑆</span>
            <span>⑆ 9876543210 :{checkNumber}:⑆</span>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* PERFORATION LINE                                                    */}
      {/* ================================================================= */}
      <div className="paystub-perforation border-t-2 border-dashed border-slate-400 my-5 relative">
        <div className="absolute -top-[10px] left-1/2 -translate-x-1/2 bg-white px-4">
          <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-[0.2em]">
            ✂ Detach — Retain This Stub For Your Records
          </span>
        </div>
      </div>

      {/* ================================================================= */}
      {/* BOTTOM HALF — THE PAY STUB                                         */}
      {/* ================================================================= */}
      <div className="paystub-stub border-2 border-slate-700 bg-[#fefcf5] p-7">
        {/* Stub Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-300 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="KIDZ Transportation"
              className="h-10 w-auto object-contain print:h-10"
            />
            <div>
              <h2 className="text-lg font-extrabold text-slate-800 leading-tight">
                KIDZ Transportation LLC
              </h2>
              <p className="text-[10px] text-slate-500">Earnings Statement · {periodLabel}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">This Period</div>
            <div className="text-2xl font-extrabold font-mono text-slate-800">
              ${netPay.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Driver & Period Info */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs mb-5 pb-4 border-b border-slate-200">
          <div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-400 font-medium">Driver</span>
              <span className="text-slate-700 font-semibold text-right">{driverName}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-400 font-medium">Status</span>
              <span className="text-slate-700 font-semibold text-right">{driverTypeLabel}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-400 font-medium">Contact</span>
              <span className="text-slate-600 text-right">{driverPhone}</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-400 font-medium">Pay Period</span>
              <span className="text-slate-700 font-semibold text-right">
                {format(periodStart, 'MMM d')} – {format(periodEnd, 'MMM d, yyyy')}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-400 font-medium">Split Rate</span>
              <span className="text-slate-700 font-semibold text-right">{splitPercent}% Driver / {100 - splitPercent}% Business</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-400 font-medium">Check No.</span>
              <span className="text-slate-700 font-mono font-semibold text-right">{checkNumber}</span>
            </div>
          </div>
        </div>

        {/* Earnings Table */}
        <div className="mb-5">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-2">
            Earnings Breakdown
          </h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-y-2 border-slate-300 bg-slate-50/50">
                <th className="text-left py-2 px-1 font-semibold text-slate-600 uppercase text-[10px] tracking-wider">
                  Client / Route
                </th>
                <th className="text-center py-2 px-1 font-semibold text-slate-600 uppercase text-[10px] tracking-wider w-[60px]">
                  Days
                </th>
                <th className="text-center py-2 px-1 font-semibold text-slate-600 uppercase text-[10px] tracking-wider w-[70px]">
                  Rate
                </th>
                <th className="text-right py-2 px-1 font-semibold text-slate-600 uppercase text-[10px] tracking-wider w-[80px]">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/30">
                  <td className="py-2.5 px-1">
                    <div className="font-semibold text-slate-700">{item.clientName}</div>
                    <div className="text-slate-400 truncate max-w-[320px] text-[11px] leading-tight mt-0.5">
                      {item.route}
                    </div>
                    <div className="flex gap-0.5 mt-1">
                      {item.dayDetails.map(d => (
                        <span
                          key={d.day}
                          className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-bold ${
                            d.ran
                              ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
                              : d.missed
                              ? 'bg-red-100 text-red-500 ring-1 ring-red-200'
                              : d.unconfirmed
                              ? 'bg-amber-50 text-amber-400 ring-1 ring-amber-200'
                              : 'bg-slate-50 text-slate-300'
                          }`}
                          title={`${d.day} ${d.date} — ${d.ran ? 'Completed' : d.missed ? 'Missed' : d.unconfirmed ? 'Unconfirmed' : 'Not Scheduled'}`}
                        >
                          {d.day.charAt(0)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-center py-2.5 px-1">
                    <span className="font-bold text-slate-700">{item.daysWorkedCount}</span>
                    <span className="text-slate-400">/{item.daysScheduled}</span>
                  </td>
                  <td className="text-center py-2.5 px-1 text-slate-600 font-mono">
                    ${item.rate.toFixed(2)}
                  </td>
                  <td className="text-right py-2.5 px-1 font-bold font-mono text-slate-800">
                    ${item.driverCut.toFixed(2)}
                  </td>
                </tr>
              ))}
              {lineItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-slate-400 text-xs italic">
                    No assignments in this pay period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals Section */}
        <div className="border-t-2 border-slate-300 pt-4">
          <div className="flex justify-end mb-3">
            <div className="w-[280px] space-y-1.5 text-xs">
              <div className="flex justify-between py-0.5">
                <span className="text-slate-500">Days Worked / Scheduled</span>
                <span className="text-slate-700 font-semibold">{totals.daysWorked} / {totals.daysScheduled}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-slate-500">Gross Earnings ({splitPercent}% split)</span>
                <span className="text-slate-700 font-mono font-semibold">${totals.driverCut.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-slate-500">Deductions</span>
                <span className="text-slate-400">$0.00</span>
              </div>
              <div className="flex justify-between py-1 border-t-2 border-slate-800 mt-1 pt-1">
                <span className="text-sm font-extrabold text-slate-800 uppercase tracking-wide">Net Pay</span>
                <span className="text-sm font-extrabold font-mono text-slate-800">${netPay.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-slate-200 text-center">
          <p className="text-[9px] text-slate-400 tracking-wide">
            KIDZ Transportation LLC · Printed {format(printedAt, 'MMM d, yyyy h:mm a')} · Check #{checkNumber} · Safe Rides for Little Lives
          </p>
        </div>
      </div>
    </div>
  );
};

export default PayStub;