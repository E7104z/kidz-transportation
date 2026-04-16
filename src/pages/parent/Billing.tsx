import React, { useState } from 'react';
import { useParentContext } from '../../context/ParentDataContext';
import type { Invoice } from '../../types';
import { format } from 'date-fns';
import {
  Receipt, Calendar, CheckCircle, Clock, AlertCircle,
  FileText, ChevronDown, ChevronUp, CreditCard,
} from 'lucide-react';

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:   { label: 'Draft',    color: 'text-slate-500',   bg: 'bg-slate-100',   icon: FileText },
  sent:    { label: 'Sent',     color: 'text-blue-700',    bg: 'bg-blue-50',     icon: Clock },
  paid:    { label: 'Paid',     color: 'text-emerald-700', bg: 'bg-emerald-50',  icon: CheckCircle },
  overdue: { label: 'Overdue',  color: 'text-red-700',     bg: 'bg-red-50',      icon: AlertCircle },
};

type ViewFilter = 'all' | 'unpaid' | 'paid';

const Billing: React.FC = () => {
  const { loading, invoices, bookings } = useParentContext();
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse h-36" />
        ))}
      </div>
    );
  }

  const sorted = [...invoices].sort((a, b) => {
    const da = a.periodEnd || '';
    const db2 = b.periodEnd || '';
    return db2.localeCompare(da);
  });

  const filtered = sorted.filter(inv => {
    if (filter === 'unpaid') return inv.status === 'sent' || inv.status === 'overdue';
    if (filter === 'paid') return inv.status === 'paid';
    return true;
  });

  const totalOwed = invoices
    .filter(i => i.status === 'sent' || i.status === 'overdue')
    .reduce((sum, i) => sum + i.totalAmount, 0);
  const totalPaid = invoices
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + i.totalAmount, 0);

  // Weekly rates from active bookings
  const weeklyTotal = bookings
    .filter(b => b.status === 'active')
    .reduce((sum, b) => sum + (b.weeklyRate || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Billing</h1>
        <p className="text-slate-500 text-sm mt-1">Invoices and payment overview</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          icon={CreditCard} iconBg="bg-blue-50" iconColor="text-blue-600"
          label="Weekly Rate" value={`$${weeklyTotal.toFixed(2)}`} sub="active services"
        />
        <SummaryCard
          icon={AlertCircle} iconBg="bg-amber-50" iconColor="text-amber-600"
          label="Balance Due" value={`$${totalOwed.toFixed(2)}`} sub="unpaid invoices"
          highlight={totalOwed > 0}
        />
        <SummaryCard
          icon={CheckCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600"
          label="Total Paid" value={`$${totalPaid.toFixed(2)}`} sub="all time"
        />
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
            {f === 'all' ? 'All Invoices' : f === 'unpaid' ? 'Unpaid' : 'Paid'}
            <span className={`ml-1.5 text-xs ${filter === f ? 'text-blue-200' : 'text-slate-400'}`}>
              {f === 'all' ? invoices.length :
               f === 'unpaid' ? invoices.filter(i => i.status === 'sent' || i.status === 'overdue').length :
               invoices.filter(i => i.status === 'paid').length}
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
              ? 'Invoices will appear here once the admin generates them.'
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
            />
          ))}
        </div>
      )}

      {/* Payment instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4">
        <div className="font-semibold text-blue-800 text-sm mb-1">Payment Information</div>
        <div className="text-xs text-blue-600 space-y-1">
          <p>Payments are due weekly. Contact us at <a href="tel:+13144259668" className="font-semibold underline">(314) 425-9668</a> for payment methods including Zelle, Cash App, or direct bank transfer.</p>
        </div>
      </div>
    </div>
  );
};

function SummaryCard({ icon: Icon, iconBg, iconColor, label, value, sub, highlight }: {
  icon: React.ElementType; iconBg: string; iconColor: string;
  label: string; value: string; sub: string; highlight?: boolean;
}) {
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 ${highlight ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center mb-3`}>
        <Icon size={20} className={iconColor} />
      </div>
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      <div className={`text-xl font-bold ${highlight ? 'text-amber-600' : 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}

function InvoiceRow({ invoice: inv, expanded, onToggle }: {
  invoice: Invoice; expanded: boolean; onToggle: () => void;
}) {
  const style = STATUS_STYLES[inv.status] || STATUS_STYLES.sent;
  const StatusIcon = style.icon;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div
        className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50/50 transition"
        onClick={onToggle}
      >
        <div className={`w-10 h-10 ${style.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <StatusIcon size={18} className={style.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-800 text-sm">
            {inv.periodStart && inv.periodEnd
              ? `${inv.periodStart} — ${inv.periodEnd}`
              : 'Invoice'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.color}`}>
              {style.label}
            </span>
            {inv.dueDate && (
              <span className="flex items-center gap-1">
                <Calendar size={10} /> Due {inv.dueDate}
              </span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-bold text-slate-800">${inv.totalAmount.toFixed(2)}</div>
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
          {/* Line items */}
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

          <div className="grid grid-cols-2 gap-3 text-xs">
            {inv.paidAt && (
              <div className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle size={12} />
                Paid {typeof (inv.paidAt as any)?.toDate === 'function'
                  ? format((inv.paidAt as any).toDate(), 'MMM d, yyyy')
                  : ''}
              </div>
            )}
            {inv.notes && (
              <div className="col-span-2 text-slate-500">
                <span className="font-medium">Note:</span> {inv.notes}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Billing;
