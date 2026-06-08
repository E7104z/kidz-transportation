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
  const DAY_FULL: Record<number, string> = {
    0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
  };

  const DOW_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Group assignments by booking for line items
  const lineItems = useMemo(() => {
    return assignments.map(a => {
      const booking = bookings.find(b => b.id === a.bookingId);
      const client = booking ? clients.find(c => c.id === booking.clientId) : null;
      const rate = dailyRateFor(a);

      // Compute actual days worked with run-log verification
      const dayDetails = DOW_ORDER.filter(d => (a.daysWorked || []).includes(d)).map(d => {
        // Find the actual date for this day abbreviation in the period
        const dayIdx = DOW_ORDER.indexOf(d);
        // The week starts on Monday. Map the day index to a date offset from periodStart.
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
  const driverEmail = driver.email || '—';
  const driverPhone = driver.phone || '—';
  const driverTypeLabel =
    driver.driverType === 'contractor'
      ? 'Independent Contractor'
      : driver.driverType === 'subcontractor_company'
      ? 'Subcontractor (Company)'
      : 'Employee';
  const splitPercent = driver.payoutSplit || 70;

  return (
    <div className="paystub-container max-w-[800px] mx-auto bg-white text-black font-sans">
      {/* ===== TOP STUB ===== */}
      <div className="paystub-stub border-2 border-slate-800 rounded-lg p-6 mb-6">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-300 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="KIDZ Transportation"
              className="h-14 w-auto object-contain print:h-14"
            />
            <div>
              <h1 className="text-xl font-extrabold text-slate-800 leading-tight">
                KIDZ Transportation
              </h1>
              <p className="text-xs text-slate-500">Safe Rides for Little Lives</p>
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-lg font-bold text-slate-700 uppercase tracking-wide">
              PAYCHECK STUB
            </h2>
            <p className="text-xs text-slate-500">{periodLabel}</p>
          </div>
        </div>

        {/* Driver Info & Period */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Pay To
            </h3>
            <p className="text-base font-bold text-slate-800">{driverName}</p>
            <p className="text-xs text-slate-600">{driverAddress}</p>
            <p className="text-xs text-slate-600">{driverEmail}</p>
            <p className="text-xs text-slate-600">{driverPhone}</p>
            <p className="text-xs text-slate-400 mt-1">{driverTypeLabel}</p>
          </div>
          <div className="text-right">
            <div className="inline-block text-left">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-500 font-semibold">Pay Period:</span>
                <span className="text-slate-800">
                  {format(periodStart, 'MMM d')} – {format(periodEnd, 'MMM d, yyyy')}
                </span>
                <span className="text-slate-500 font-semibold">Printed:</span>
                <span className="text-slate-800">{format(printedAt, 'MMM d, yyyy h:mm a')}</span>
                <span className="text-slate-500 font-semibold">Driver Split:</span>
                <span className="text-slate-800 font-bold">{splitPercent}%</span>
                <span className="text-slate-500 font-semibold">Assignment Count:</span>
                <span className="text-slate-800">{assignments.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <table className="w-full text-xs border-collapse mb-4">
          <thead>
            <tr className="border-b-2 border-slate-300">
              <th className="text-left py-2 font-semibold text-slate-600 uppercase text-[10px] tracking-wider">
                Client / Route
              </th>
              <th className="text-center py-2 font-semibold text-slate-600 uppercase text-[10px] tracking-wider w-[90px]">
                Days
              </th>
              <th className="text-center py-2 font-semibold text-slate-600 uppercase text-[10px] tracking-wider w-[80px]">
                Rate
              </th>
              <th className="text-right py-2 font-semibold text-slate-600 uppercase text-[10px] tracking-wider w-[90px]">
                Driver Pay
              </th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, i) => (
              <tr key={i} className="border-b border-slate-150">
                <td className="py-2">
                  <div className="font-semibold text-slate-700">{item.clientName}</div>
                  <div className="text-slate-400 truncate max-w-[300px]">{item.route}</div>
                  <div className="flex gap-1 mt-1">
                    {item.dayDetails.map(d => (
                      <span
                        key={d.day}
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[9px] font-bold ${
                          d.ran
                            ? 'bg-emerald-100 text-emerald-700'
                            : d.missed
                            ? 'bg-red-100 text-red-500'
                            : d.unconfirmed
                            ? 'bg-amber-50 text-amber-400'
                            : 'bg-slate-50 text-slate-300'
                        }`}
                        title={`${d.day} ${d.date} — ${d.ran ? 'Completed' : d.missed ? 'Missed' : d.unconfirmed ? 'Unconfirmed' : 'Not Scheduled'}`}
                      >
                        {d.day.charAt(0)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="text-center py-2">
                  <span className="font-bold text-slate-700">{item.daysWorkedCount}</span>
                  <span className="text-slate-400">/{item.daysScheduled}</span>
                </td>
                <td className="text-center py-2 text-slate-600">
                  ${item.rate.toFixed(2)}
                </td>
                <td className="text-right py-2 font-bold text-slate-800">
                  ${item.driverCut.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-bold">
              <td className="py-2 text-slate-600">Totals</td>
              <td className="text-center py-2 text-slate-800">
                {totals.daysWorked}/{totals.daysScheduled}
              </td>
              <td className="text-center py-2" />
              <td className="text-right py-2 text-base text-slate-800">
                ${totals.driverCut.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Summary Box */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block">Expected Pay</span>
              <span className="font-bold text-slate-700">${totals.expectedPay.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Actual Pay</span>
              <span className="font-bold text-emerald-600">${totals.actualPay.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">
                Driver Cut ({splitPercent}%)
              </span>
              <span className="font-bold text-lg text-slate-800">
                ${totals.driverCut.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Business Share</span>
              <span className="font-bold text-violet-600">
                ${(totals.actualPay - totals.driverCut).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== PERFORATION LINE ===== */}
      <div className="paystub-perforation border-t-2 border-dashed border-slate-400 my-6 relative">
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-3 text-[9px] text-slate-400 font-semibold uppercase tracking-widest">
          ✂ Detach Here
        </span>
      </div>

      {/* ===== BOTTOM STUB (Driver Copy) ===== */}
      <div className="paystub-stub border-2 border-slate-800 rounded-lg p-6">
        <div className="flex items-start justify-between border-b-2 border-slate-300 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="KIDZ Transportation"
              className="h-10 w-auto object-contain print:h-10"
            />
            <div>
              <h1 className="text-lg font-extrabold text-slate-800 leading-tight">
                KIDZ Transportation
              </h1>
              <p className="text-xs text-slate-500">Driver Copy — {periodLabel}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-extrabold text-slate-800">
              ${totals.driverCut.toFixed(2)}
            </div>
            <p className="text-xs text-slate-500">
              Net Pay ({splitPercent}% of ${totals.actualPay.toFixed(2)})
            </p>
          </div>
        </div>

        {/* Compact line items for stub */}
        <table className="w-full text-[10px] border-collapse mb-3">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-1 font-semibold text-slate-500 uppercase tracking-wide">
                Client
              </th>
              <th className="text-center py-1 font-semibold text-slate-500 uppercase tracking-wide w-[40px]">
                Days
              </th>
              <th className="text-right py-1 font-semibold text-slate-500 uppercase tracking-wide w-[70px]">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1 text-slate-700 font-medium">{item.clientName}</td>
                <td className="text-center py-1 text-slate-600">{item.daysWorkedCount}</td>
                <td className="text-right py-1 text-slate-700 font-semibold">
                  ${item.driverCut.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300 font-bold text-xs">
              <td className="py-1 text-slate-600">Total</td>
              <td className="text-center py-1 text-slate-800">{totals.daysWorked}</td>
              <td className="text-right py-1 text-slate-800">
                ${totals.driverCut.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>

        <div className="text-[10px] text-slate-400 border-t border-slate-200 pt-2 text-center">
          Printed {format(printedAt, 'MMM d, yyyy h:mm a')} · KIDZ Transportation · Safe Rides for Little Lives
        </div>
      </div>
    </div>
  );
};

export default PayStub;