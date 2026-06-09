import React, { useState, useMemo, useEffect } from 'react';
import { useParentContext } from '../../context/ParentDataContext';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../services/firebase';
import type { Invoice } from '../../types';
import { format } from 'date-fns';
import {
  Receipt, Calendar, CheckCircle, Clock, AlertCircle,
  FileText, ChevronDown, ChevronUp, CreditCard, Shield,
  Zap, ToggleLeft, ToggleRight, Loader2,
  DollarSign, TrendingUp,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Status styling ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  draft:   { label: 'Draft',    color: 'text-slate-500',   bg: 'bg-slate-50',    border: 'border-slate-200', icon: FileText },
  sent:    { label: 'Due',      color: 'text-blue-700',    bg: 'bg-blue-50',     border: 'border-blue-200',  icon: Clock },
  paid:    { label: 'Paid',     color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200', icon: CheckCircle },
  overdue: { label: 'Overdue',  color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200',  icon: AlertCircle },
  waived:  { label: 'Waived',   color: 'text-violet-700',  bg: 'bg-violet-50',   border: 'border-violet-200', icon: Shield },
};

type ViewFilter = 'all' | 'unpaid' | 'paid';

const Billing: React.FC = () => {
  const { loading, invoices, bookings, client, permissions, isPrimary } = useParentContext();
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [togglingAutoPay, setTogglingAutoPay] = useState(false);

  const [updatingCard, setUpdatingCard] = useState(false);

  // Handle post-payment / post-card-update redirects
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid')) {
      toast.success('Payment received! Thank you.');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('cancelled')) {
      toast('Payment cancelled', { icon: '↩️' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('card_updated')) {
      toast.success('Payment method updated successfully.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleUpdateCard = async () => {
    setUpdatingCard(true);
    try {
      const fn = httpsCallable(functions, 'createSetupSession');
      const result = await fn({});
      const { url } = result.data as { url: string };
      if (url) window.location.href = url;
      else toast.error('Could not start card update session');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update card');
    } finally {
      setUpdatingCard(false);
    }
  };

  // Gate: secondary parents and coordinators do not see billing.
  if (!permissions.canSeeBilling) {
    return (
      <div className="max-w-xl mx-auto mt-16 p-8 bg-white rounded-2xl shadow-sm border border-slate-200 text-center">
        <Shield size={40} className="mx-auto text-slate-300 mb-3" />
        <h2 className="text-lg font-bold text-slate-800">Billing access is restricted</h2>
        <p className="text-sm text-slate-500 mt-2">
          Your account doesn&apos;t have permission to view billing information for this family.
          If you believe this is a mistake, please contact the primary parent or KIDZ Transportation.
        </p>
      </div>
    );
  }

  const sorted = useMemo(() =>
    [...invoices].sort((a, b) => (b.weekOf || b.periodEnd || '').localeCompare(a.weekOf || a.periodEnd || '')),
    [invoices],
  );

  const filtered = useMemo(() =>
    sorted.filter(inv => {
      if (filter === 'unpaid') return inv.status === 'sent' || inv.status === 'overdue';
      if (filter === 'paid') return inv.status === 'paid' || inv.status === 'waived';
      return true;
    }),
    [sorted, filter],
  );

  const upcoming = useMemo(() =>
    sorted.find(inv => inv.status === 'sent' || inv.status === 'overdue'),
    [sorted],
  );

  const totalOwed = invoices
    .filter(i => i.status === 'sent' || i.status === 'overdue')
    .reduce((sum, i) => sum + i.totalAmount, 0);
  const totalPaid = invoices
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + i.totalAmount, 0);
  const weeklyTotal = bookings
    .filter(b => b.status === 'active')
    .reduce((sum, b) => sum + (b.weeklyRate || 0), 0);

  // ── Pay handler ─────────────────────────────────────────────────────────

  const handlePay = async (invoiceId: string) => {
    setPayingId(invoiceId);
    try {
      const fn = httpsCallable(functions, 'createCheckoutSession');
      const result = await fn({ invoiceId });
      const { url } = result.data as { url: string };
      if (url) {
        window.location.href = url;
      } else {
        toast.error('Could not create payment session');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Payment failed');
    } finally {
      setPayingId(null);
    }
  };

  // ── Auto-pay toggle ────────────────────────────────────────────────────

  const handleToggleAutoPay = async () => {
    setTogglingAutoPay(true);
    try {
      const fn = httpsCallable(functions, 'setupAutoPay');
      const result = await fn({ enabled: !client?.autoPay });
      const { autoPay } = result.data as { autoPay: boolean };
      toast.success(autoPay ? 'Auto-pay enabled' : 'Auto-pay disabled');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update auto-pay');
    } finally {
      setTogglingAutoPay(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse h-36" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Billing & Payments</h1>
        <p className="text-slate-500 text-sm mt-1">Pay invoices and manage your payment settings</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          icon={TrendingUp} iconBg="bg-blue-50" iconColor="text-blue-600"
          label="Weekly Rate" value={`$${weeklyTotal.toFixed(2)}`} sub="active services"
        />
        <SummaryCard
          icon={DollarSign} iconBg="bg-amber-50" iconColor="text-amber-600"
          label="Balance Due" value={`$${totalOwed.toFixed(2)}`} sub="unpaid invoices"
          highlight={totalOwed > 0}
        />
        <SummaryCard
          icon={CheckCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600"
          label="Total Paid" value={`$${totalPaid.toFixed(2)}`} sub="all time"
        />
      </div>

      {/* Upcoming payment CTA */}
      {upcoming && (
        <div className={`rounded-2xl border-2 p-5 ${
          upcoming.status === 'overdue'
            ? 'border-red-300 bg-gradient-to-br from-red-50 to-orange-50'
            : 'border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-50'
        }`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                {upcoming.status === 'overdue' ? (
                  <AlertCircle size={18} className="text-red-500" />
                ) : (
                  <CreditCard size={18} className="text-blue-600" />
                )}
                <span className="font-bold text-slate-800">
                  {upcoming.status === 'overdue' ? 'Payment Overdue' : 'Upcoming Payment'}
                </span>
              </div>
              <div className="text-sm text-slate-600">
                Week of {upcoming.weekOf || upcoming.periodStart} · Due{' '}
                <span className={upcoming.status === 'overdue' ? 'text-red-600 font-semibold' : 'font-medium'}>
                  {upcoming.dueDate}
                </span>
              </div>
              <div className="text-2xl font-bold text-slate-800 mt-2">
                ${upcoming.totalAmount.toFixed(2)}
              </div>
            </div>
            <button
              onClick={() => handlePay(upcoming.id)}
              disabled={payingId === upcoming.id}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white shadow-lg transition-all ${
                upcoming.status === 'overdue'
                  ? 'bg-red-600 hover:bg-red-700 shadow-red-200'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
              } disabled:opacity-50`}
            >
              {payingId === upcoming.id ? (
                <><Loader2 size={16} className="animate-spin" /> Processing…</>
              ) : (
                <><CreditCard size={16} /> Pay Now</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Auto-pay card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
              <Zap size={20} className="text-violet-600" />
            </div>
            <div>
              <div className="font-semibold text-slate-800 text-sm">Auto-Pay</div>
              <div className="text-xs text-slate-400">
                {client?.autoPay
                  ? `Enabled · Card ending in ${client?.paymentMethodLast4 || '****'}`
                  : 'Automatically pay each week — never miss a deadline'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isPrimary && client?.paymentMethodLast4 && (
              <button
                onClick={handleUpdateCard}
                disabled={updatingCard}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {updatingCard
                  ? <Loader2 size={12} className="animate-spin" />
                  : <CreditCard size={12} />}
                Update Card
              </button>
            )}
            <button
              onClick={handleToggleAutoPay}
              disabled={togglingAutoPay || !isPrimary}
              title={!isPrimary ? 'Only the primary parent can change auto-pay' : undefined}
              className="flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {togglingAutoPay ? (
                <Loader2 size={20} className="animate-spin text-slate-400" />
              ) : client?.autoPay ? (
                <ToggleRight size={32} className="text-violet-600" />
              ) : (
                <ToggleLeft size={32} className="text-slate-300 hover:text-slate-400" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['all', 'unpaid', 'paid'] as ViewFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              filter === f
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300'
            }`}
          >
            {f === 'all' ? 'All' : f === 'unpaid' ? 'Unpaid' : 'Paid'}
            <span className={`ml-1.5 text-xs ${filter === f ? 'text-blue-200' : 'text-slate-400'}`}>
              {f === 'all' ? invoices.length
                : f === 'unpaid' ? invoices.filter(i => i.status === 'sent' || i.status === 'overdue').length
                : invoices.filter(i => i.status === 'paid' || i.status === 'waived').length}
            </span>
          </button>
        ))}
      </div>

      {/* Invoice list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Receipt size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-slate-500 font-medium">No invoices found</p>
          <p className="text-slate-400 text-sm mt-1">
            {invoices.length === 0
              ? 'Invoices will appear here once they are generated for the upcoming week.'
              : 'No invoices match the selected filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(inv => (
            <InvoiceRow
              key={inv.id}
              invoice={inv}
              expanded={expandedId === inv.id}
              onToggle={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
              onPay={() => handlePay(inv.id)}
              paying={payingId === inv.id}
            />
          ))}
        </div>
      )}

      {/* Secure payments footer */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={14} className="text-slate-400" />
          <span className="font-semibold text-slate-600 text-xs">Secure Payments</span>
        </div>
        <div className="text-xs text-slate-500 space-y-1">
          <p>All payments are securely processed through Stripe. Your card details are never stored on our servers.</p>
          <p>Payment is due by Saturday for the following week's service. If you need to make alternative arrangements, contact us at <a href="tel:+13144259668" className="font-semibold text-blue-600 hover:underline">(314) 425-9668</a>.</p>
        </div>
      </div>
    </div>
  );
};

// ── Summary card ──────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, iconBg, iconColor, label, value, sub, highlight }: {
  icon: React.ElementType; iconBg: string; iconColor: string;
  label: string; value: string; sub: string; highlight?: boolean;
}) {
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 ${highlight ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'}`}>
      <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center mb-3`}>
        <Icon size={20} className={iconColor} />
      </div>
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      <div className={`text-xl font-bold ${highlight ? 'text-amber-600' : 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}

// ── Invoice row ───────────────────────────────────────────────────────────

function InvoiceRow({ invoice: inv, expanded, onToggle, onPay, paying }: {
  invoice: Invoice; expanded: boolean; onToggle: () => void; onPay: () => void; paying: boolean;
}) {
  const style = STATUS_STYLES[inv.status] || STATUS_STYLES.sent;
  const StatusIcon = style.icon;
  const isPaid = inv.status === 'paid' || inv.status === 'waived';

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${style.border}`}>
      <div
        className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50/50 transition"
        onClick={onToggle}
      >
        <div className={`w-10 h-10 ${style.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <StatusIcon size={18} className={style.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-800 text-sm">
            Week of {inv.weekOf || inv.periodStart || 'N/A'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.color}`}>
              {style.label}
            </span>
            {inv.dueDate && (
              <span className="flex items-center gap-1">
                <Calendar size={10} /> Due {inv.dueDate}
              </span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0 flex items-center gap-3">
          <div className="text-lg font-bold text-slate-800">${inv.totalAmount.toFixed(2)}</div>
          {!isPaid && (
            <button
              onClick={e => { e.stopPropagation(); onPay(); }}
              disabled={paying}
              className="hidden sm:flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
            >
              {paying ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
              Pay
            </button>
          )}
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
          {inv.lineItems && inv.lineItems.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Line Items</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-200">
                    <th className="text-left py-1.5 font-medium">Description</th>
                    <th className="text-center py-1.5 font-medium">Days</th>
                    <th className="text-right py-1.5 font-medium">Rate</th>
                    <th className="text-right py-1.5 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lineItems.map((item, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-2 text-slate-700">{item.description}</td>
                      <td className="py-2 text-center text-slate-600">{item.quantity}</td>
                      <td className="py-2 text-right text-slate-600">${item.unitPrice.toFixed(2)}</td>
                      <td className="py-2 text-right font-medium text-slate-800">${item.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="pt-2 text-right font-semibold text-slate-600">Total</td>
                    <td className="pt-2 text-right font-bold text-slate-800">${inv.totalAmount.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex flex-col gap-1 text-xs text-slate-500">
              {inv.paidAt && (
                <span className="flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle size={12} />
                  Paid {typeof (inv.paidAt as any)?.toDate === 'function'
                    ? format((inv.paidAt as any).toDate(), 'MMM d, yyyy \'at\' h:mm a')
                    : ''}
                </span>
              )}
              {inv.notes && <span className="text-slate-400">{inv.notes}</span>}
            </div>
            {!isPaid && (
              <button
                onClick={onPay}
                disabled={paying}
                className="sm:hidden flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 shadow-sm w-full justify-center"
              >
                {paying ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                Pay ${inv.totalAmount.toFixed(2)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Billing;
