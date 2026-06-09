import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  collection, getDocs, query, orderBy, doc, onSnapshot,
  addDoc, serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from '../../services/firebase';
import type { Invoice, Client, Booking } from '../../types';
import { format, startOfWeek, addDays } from 'date-fns';
import toast from 'react-hot-toast';
import {
  DollarSign, CheckCircle, AlertCircle, Clock, FileText,
  Receipt, RefreshCw, Loader2, Shield, ChevronDown, ChevronUp,
  Calendar, Zap, Plus, Search,
  Ban, Trash2,
} from 'lucide-react';

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:   { label: 'Draft',   color: 'text-slate-600',   bg: 'bg-slate-100',   icon: FileText },
  sent:    { label: 'Sent',    color: 'text-blue-700',    bg: 'bg-blue-50',     icon: Clock },
  paid:    { label: 'Paid',    color: 'text-emerald-700', bg: 'bg-emerald-50',  icon: CheckCircle },
  overdue: { label: 'Overdue', color: 'text-red-700',     bg: 'bg-red-50',      icon: AlertCircle },
  waived:  { label: 'Waived',  color: 'text-violet-700',  bg: 'bg-violet-50',   icon: Shield },
};

type Tab = 'overview' | 'invoices' | 'create';

// ── main component ──────────────────────────────────────────────────────────

const AdminBilling: React.FC = () => {
  const [tab, setTab] = useState<Tab>('overview');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [processingAutoPay, setProcessingAutoPay] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionInvoiceId, setActionInvoiceId] = useState<string | null>(null);

  // Manual invoice form
  const [manualClientId, setManualClientId] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualDueDate, setManualDueDate] = useState('');
  const [creatingManual, setCreatingManual] = useState(false);

  const clientMap = useMemo(() => {
    const m: Record<string, Client> = {};
    clients.forEach(c => { m[c.id] = c; });
    return m;
  }, [clients]);

  // ── data loading ────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [invSnap, cSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'bookings')),
      ]);
      setInvoices(invSnap.docs.map(d => ({ id: d.id, ...d.data() } as Invoice)));
      setClients(cSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
      setBookings(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as Booking)));
    } catch (err) {
      console.error('Failed to load billing data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── computed stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const unpaid = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
    const paid = invoices.filter(i => i.status === 'paid');
    const overdue = invoices.filter(i => i.status === 'overdue');
    const autoPayClients = clients.filter(c => c.autoPay);
    return {
      totalOutstanding: unpaid.reduce((s, i) => s + i.totalAmount, 0),
      totalCollected: paid.reduce((s, i) => s + i.totalAmount, 0),
      unpaidCount: unpaid.length,
      overdueCount: overdue.length,
      autoPayCount: autoPayClients.length,
      totalClients: clients.length,
    };
  }, [invoices, clients]);

  // ── filtered invoices ──────────────────────────────────────────────────

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (searchQuery) {
        const client = clientMap[inv.clientId];
        const name = client?.name?.toLowerCase() || '';
        const q = searchQuery.toLowerCase();
        if (!name.includes(q) && !inv.weekOf?.includes(q) && !inv.id.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, searchQuery, clientMap]);

  // ── generate invoices ──────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const monday = format(startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      // Write a task document — the processTask Cloud Function trigger picks it up
      const taskRef = await addDoc(collection(db, '_tasks'), {
        type: 'generateWeeklyInvoices',
        weekOf: monday,
        uid: auth.currentUser!.uid,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      // Listen for the function to update this doc with the result
      const unsub = onSnapshot(doc(db, '_tasks', taskRef.id), (snap) => {
        const data = snap.data();
        if (!data || data.status === 'pending') return;
        unsub();
        if (data.status === 'completed') {
          const { created, skipped } = data.result as { created: number; skipped: number };
          toast.success(`Generated ${created} invoice(s)${skipped ? `, ${skipped} already existed` : ''}`);
          loadData();
        } else {
          toast.error(data.error || 'Failed to generate invoices');
        }
        setGenerating(false);
      });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate invoices');
      setGenerating(false);
    }
  };

  // ── process auto-pay ──────────────────────────────────────────────────

  const handleProcessAutoPay = async () => {
    setProcessingAutoPay(true);
    try {
      const fn = httpsCallable(functions, 'processAutoPay');
      const result = await fn({});
      const { charged, failed } = result.data as { charged: number; failed: number };
      toast.success(`Charged ${charged} client(s)${failed ? `, ${failed} failed` : ''}`);
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to process auto-pay');
    } finally {
      setProcessingAutoPay(false);
    }
  };

  // ── delete invoice ───────────────────────────────────────────────────

  const handleDelete = async (invoiceId: string) => {
    if (!window.confirm('Permanently delete this invoice? This cannot be undone.')) return;
    setActionInvoiceId(invoiceId);
    try {
      const fn = httpsCallable(functions, 'deleteInvoice');
      await fn({ invoiceId });
      toast.success('Invoice deleted');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    } finally {
      setActionInvoiceId(null);
    }
  };

  // ── override invoice ──────────────────────────────────────────────────

  const handleOverride = async (invoiceId: string, action: 'mark_paid' | 'waive' | 'extend', note?: string, newDueDate?: string) => {
    setActionInvoiceId(invoiceId);
    try {
      const fn = httpsCallable(functions, 'adminOverrideInvoice');
      await fn({ invoiceId, action, note, newDueDate });
      toast.success(
        action === 'mark_paid' ? 'Marked as paid'
        : action === 'waive' ? 'Invoice waived'
        : 'Due date extended'
      );
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Override failed');
    } finally {
      setActionInvoiceId(null);
    }
  };

  // ── create manual invoice ─────────────────────────────────────────────

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(manualAmount);
    if (!manualClientId || !manualDesc || !manualDueDate || isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error('All fields are required with a valid positive amount');
      return;
    }
    setCreatingManual(true);
    try {
      const fn = httpsCallable(functions, 'createManualInvoice');
      await fn({
        clientId: manualClientId,
        description: manualDesc,
        amount: parsedAmount,
        dueDate: manualDueDate,
      });
      toast.success('Manual invoice created');
      setManualClientId('');
      setManualDesc('');
      setManualAmount('');
      setManualDueDate('');
      setTab('invoices');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create invoice');
    } finally {
      setCreatingManual(false);
    }
  };

  // ── loading skeleton ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse h-28" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Billing Management</h1>
          <p className="text-slate-500 text-sm mt-1">Generate invoices, process payments, and manage overrides</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadData()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} iconBg="bg-amber-50" iconColor="text-amber-600"
          label="Outstanding" value={`$${stats.totalOutstanding.toFixed(2)}`} sub={`${stats.unpaidCount} invoice(s)`}
          highlight={stats.totalOutstanding > 0} />
        <StatCard icon={CheckCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600"
          label="Collected" value={`$${stats.totalCollected.toFixed(2)}`} sub="all time" />
        <StatCard icon={AlertCircle} iconBg="bg-red-50" iconColor="text-red-600"
          label="Overdue" value={String(stats.overdueCount)} sub="invoice(s)" highlight={stats.overdueCount > 0} />
        <StatCard icon={Zap} iconBg="bg-violet-50" iconColor="text-violet-600"
          label="Auto-Pay" value={`${stats.autoPayCount}/${stats.totalClients}`} sub="clients enrolled" />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
          Generate Weekly Invoices
        </button>
        <button
          onClick={handleProcessAutoPay}
          disabled={processingAutoPay}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
        >
          {processingAutoPay ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          Process Auto-Pay
        </button>
        <button
          onClick={() => setTab('create')}
          className="flex items-center gap-2 border-2 border-slate-300 text-slate-700 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors hover:border-blue-400 hover:text-blue-600"
        >
          <Plus size={14} /> Manual Invoice
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 -mb-2">
        {([['overview', 'Overview'], ['invoices', 'All Invoices'], ['create', 'Create Invoice']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <OverviewTab invoices={invoices} clientMap={clientMap} onOverride={handleOverride} onDelete={handleDelete} actionInvoiceId={actionInvoiceId} />
      )}

      {tab === 'invoices' && (
        <InvoicesTab
          invoices={filteredInvoices}
          clientMap={clientMap}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          expandedId={expandedId}
          onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
          onOverride={handleOverride}
          onDelete={handleDelete}
          actionInvoiceId={actionInvoiceId}
        />
      )}

      {tab === 'create' && (
        <CreateTab
          clients={clients}
          clientId={manualClientId}
          onClientChange={setManualClientId}
          description={manualDesc}
          onDescChange={setManualDesc}
          amount={manualAmount}
          onAmountChange={setManualAmount}
          dueDate={manualDueDate}
          onDueDateChange={setManualDueDate}
          creating={creatingManual}
          onSubmit={handleCreateManual}
        />
      )}
    </div>
  );
};

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, iconBg, iconColor, label, value, sub, highlight }: {
  icon: React.ElementType; iconBg: string; iconColor: string;
  label: string; value: string; sub: string; highlight?: boolean;
}) {
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 ${highlight ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'}`}>
      <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center mb-3`}>
        <Icon size={18} className={iconColor} />
      </div>
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      <div className={`text-xl font-bold ${highlight ? 'text-amber-600' : 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────

function OverviewTab({ invoices, clientMap, onOverride, onDelete, actionInvoiceId }: {
  invoices: Invoice[];
  clientMap: Record<string, Client>;
  onOverride: (id: string, action: 'mark_paid' | 'waive' | 'extend', note?: string, newDueDate?: string) => void;
  onDelete: (id: string) => void;
  actionInvoiceId: string | null;
}) {
  const unpaid = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
  const recentPaid = invoices.filter(i => i.status === 'paid').slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Unpaid invoices */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <AlertCircle size={18} className="text-amber-500" />
          Unpaid Invoices ({unpaid.length})
        </h2>
        {unpaid.length === 0 ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
            <CheckCircle size={32} className="mx-auto text-emerald-400 mb-2" />
            <p className="text-emerald-700 font-medium">All invoices are paid!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {unpaid.map(inv => (
              <AdminInvoiceRow key={inv.id} invoice={inv} clientMap={clientMap} onOverride={onOverride} onDelete={onDelete} isActioning={actionInvoiceId === inv.id} />
            ))}
          </div>
        )}
      </div>

      {/* Recent payments */}
      {recentPaid.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <CheckCircle size={18} className="text-emerald-500" />
            Recent Payments
          </h2>
          <div className="space-y-2">
            {recentPaid.map(inv => (
              <AdminInvoiceRow key={inv.id} invoice={inv} clientMap={clientMap} onOverride={onOverride} onDelete={onDelete} isActioning={actionInvoiceId === inv.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Invoices tab ──────────────────────────────────────────────────────────

function InvoicesTab({ invoices, clientMap, searchQuery, onSearchChange, statusFilter, onStatusFilterChange, expandedId, onToggleExpand, onOverride, onDelete, actionInvoiceId }: {
  invoices: Invoice[];
  clientMap: Record<string, Client>;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onOverride: (id: string, action: 'mark_paid' | 'waive' | 'extend', note?: string, newDueDate?: string) => void;
  onDelete: (id: string) => void;
  actionInvoiceId: string | null;
}) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by client name or week..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => onStatusFilterChange(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        >
          <option value="all">All Statuses</option>
          <option value="sent">Sent / Due</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
          <option value="waived">Waived</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {/* Results count */}
      <div className="text-xs text-slate-400">{invoices.length} invoice(s)</div>

      {/* Invoice list */}
      {invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <Receipt size={32} className="mx-auto text-slate-200 mb-2" />
          <p className="text-slate-500 text-sm">No invoices match your filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => (
            <AdminInvoiceRow
              key={inv.id}
              invoice={inv}
              clientMap={clientMap}
              onOverride={onOverride}
              onDelete={onDelete}
              isActioning={actionInvoiceId === inv.id}
              expanded={expandedId === inv.id}
              onToggle={() => onToggleExpand(inv.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create manual invoice tab ────────────────────────────────────────────

function CreateTab({ clients, clientId, onClientChange, description, onDescChange, amount, onAmountChange, dueDate, onDueDateChange, creating, onSubmit }: {
  clients: Client[];
  clientId: string;
  onClientChange: (v: string) => void;
  description: string;
  onDescChange: (v: string) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  dueDate: string;
  onDueDateChange: (v: string) => void;
  creating: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Plus size={18} className="text-blue-600" /> Create Manual Invoice
        </h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Client</label>
            <select
              value={clientId}
              onChange={e => onClientChange(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="">Select a client</option>
              {clients.sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => onDescChange(e.target.value)}
              placeholder="e.g. Late fee, Additional service, etc."
              required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={e => onAmountChange(e.target.value)}
                placeholder="0.00"
                required
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => onDueDateChange(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create Invoice
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Admin invoice row ────────────────────────────────────────────────────

function AdminInvoiceRow({ invoice: inv, clientMap, onOverride, onDelete, isActioning, expanded, onToggle }: {
  invoice: Invoice;
  clientMap: Record<string, Client>;
  onOverride: (id: string, action: 'mark_paid' | 'waive' | 'extend', note?: string, newDueDate?: string) => void;
  onDelete: (id: string) => void;
  isActioning: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const style = STATUS_STYLES[inv.status] || STATUS_STYLES.sent;
  const StatusIcon = style.icon;
  const client = clientMap[inv.clientId];
  const isPaid = inv.status === 'paid' || inv.status === 'waived';
  const isExpandable = !!onToggle;
  const isOpen = expanded ?? false;

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${style.bg.replace('bg-', 'border-').replace('/50', '/200')}`}>
      <div
        className={`px-4 py-3 flex items-center gap-3 ${isExpandable ? 'cursor-pointer hover:bg-slate-50/50' : ''} transition`}
        onClick={onToggle}
      >
        <div className={`w-8 h-8 ${style.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          <StatusIcon size={14} className={style.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800 text-sm truncate">{client?.name || 'Unknown'}</span>
            {client?.autoPay && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded text-[10px] font-bold">
                <Zap size={8} /> AUTO
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
            <span>Week of {inv.weekOf || inv.periodStart || 'N/A'}</span>
            <span>·</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${style.bg} ${style.color}`}>{style.label}</span>
            {inv.dueDate && <span className="flex items-center gap-0.5"><Calendar size={9} /> {inv.dueDate}</span>}
          </div>
        </div>
        <div className="text-right flex items-center gap-2 flex-shrink-0">
          <span className="text-lg font-bold text-slate-800">${inv.totalAmount.toFixed(2)}</span>
          {!isPaid && (
            <div className="flex gap-1">
              <button
                onClick={e => { e.stopPropagation(); onOverride(inv.id, 'mark_paid', 'Admin marked as paid'); }}
                disabled={isActioning}
                className="px-2 py-1 text-[10px] font-semibold bg-emerald-100 text-emerald-700 rounded-md hover:bg-emerald-200 transition disabled:opacity-50"
                title="Mark paid"
              >
                {isActioning ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
              </button>
              <button
                onClick={e => { e.stopPropagation(); onOverride(inv.id, 'waive', 'Admin waived'); }}
                disabled={isActioning}
                className="px-2 py-1 text-[10px] font-semibold bg-violet-100 text-violet-700 rounded-md hover:bg-violet-200 transition disabled:opacity-50"
                title="Waive"
              >
                <Ban size={10} />
              </button>
            </div>
          )}
          {/* Delete button — always visible for any invoice */}
          <button
            onClick={e => { e.stopPropagation(); onDelete(inv.id); }}
            disabled={isActioning}
            className="px-2 py-1 text-[10px] font-semibold bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition disabled:opacity-50"
            title="Delete invoice"
          >
            <Trash2 size={10} />
          </button>
          {isExpandable && (
            isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />
          )}
        </div>
      </div>

      {isOpen && inv.lineItems && inv.lineItems.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-200">
                <th className="text-left py-1 font-medium">Description</th>
                <th className="text-center py-1 font-medium">Days</th>
                <th className="text-right py-1 font-medium">Rate</th>
                <th className="text-right py-1 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lineItems.map((item, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">{item.description}</td>
                  <td className="py-1.5 text-center text-slate-600">{item.quantity}</td>
                  <td className="py-1.5 text-right text-slate-600">${item.unitPrice.toFixed(2)}</td>
                  <td className="py-1.5 text-right font-medium text-slate-800">${item.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inv.adminOverride && (
            <div className="mt-2 text-[10px] text-violet-600 flex items-center gap-1">
              <Shield size={10} /> Admin override: {inv.overrideNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminBilling;