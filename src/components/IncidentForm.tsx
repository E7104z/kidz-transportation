import React, { useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import type { IncidentType, IncidentSeverity } from '../types';
import { AlertTriangle, CheckCircle } from 'lucide-react';

interface Props {
  driverId?: string;
  bookingId?: string;
  studentId?: string;
  clientId?: string;
  onClose?: () => void;
}

const INCIDENT_TYPES: { value: IncidentType; label: string }[] = [
  { value: 'vehicle_accident',   label: 'Vehicle Accident' },
  { value: 'vehicle_breakdown',  label: 'Vehicle Breakdown' },
  { value: 'child_behavior',     label: 'Child Behavior Issue' },
  { value: 'medical_event',      label: 'Medical Event' },
  { value: 'parent_no_show',     label: 'Parent No-Show' },
  { value: 'school_issue',       label: 'School Issue' },
  { value: 'traffic_delay',      label: 'Traffic / Weather Delay' },
  { value: 'other',              label: 'Other' },
];

const SEVERITIES: { value: IncidentSeverity; label: string; color: string }[] = [
  { value: 'low',      label: 'Low',      color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { value: 'medium',   label: 'Medium',   color: 'bg-amber-100   text-amber-700   border-amber-300'   },
  { value: 'high',     label: 'High',     color: 'bg-orange-100  text-orange-700  border-orange-300'  },
  { value: 'critical', label: 'Critical', color: 'bg-red-100     text-red-700     border-red-300'     },
];

const IncidentForm: React.FC<Props> = ({ driverId, bookingId, studentId, clientId, onClose }) => {
  const { user, role } = useAuth();

  const [type,     setType]     = useState<IncidentType>('other');
  const [severity, setSeverity] = useState<IncidentSeverity>('low');
  const [title,    setTitle]    = useState('');
  const [notes,    setNotes]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!title.trim()) { setError('Please enter a brief title for the incident.'); return; }
    setError('');
    setSaving(true);
    try {
      await addDoc(collection(db, 'incidents'), {
        reportedByUid:  user.uid,
        reportedByName: user.displayName ?? user.email ?? 'Unknown',
        reportedByRole: (role === 'admin' ? 'admin' : 'driver') as 'admin' | 'driver',
        driverId:  driverId  ?? null,
        bookingId: bookingId ?? null,
        studentId: studentId ?? null,
        clientId:  clientId  ?? null,
        type,
        severity,
        title: title.trim(),
        description: notes.trim(),
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        resolvedAt:  null,
        resolvedBy:  null,
        resolutionNotes: null,
        attachmentUrls: [],
      });
      setSaved(true);
    } catch {
      setError('Failed to submit incident. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="text-center py-8">
        <CheckCircle size={40} className="text-green-500 mx-auto mb-3" />
        <p className="font-semibold text-slate-800">Incident Reported</p>
        <p className="text-sm text-slate-500 mt-1">Admin has been notified.</p>
        {onClose && (
          <button onClick={onClose} className="mt-4 text-sm text-indigo-600 hover:underline">
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={18} className="text-red-500" />
        <h3 className="font-semibold text-slate-800">Report Incident</h3>
      </div>

      {/* Type */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Incident Type</label>
        <select
          value={type}
          onChange={e => setType(e.target.value as IncidentType)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        >
          {INCIDENT_TYPES.map(it => (
            <option key={it.value} value={it.value}>{it.label}</option>
          ))}
        </select>
      </div>

      {/* Severity */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Severity</label>
        <div className="flex gap-2 flex-wrap">
          {SEVERITIES.map(s => (
            <button
              type="button"
              key={s.value}
              onClick={() => setSeverity(s.value)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                severity === s.value ? s.color + ' ring-2 ring-offset-1 ring-current' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Brief Title</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Minor fender-bender at school pickup"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          maxLength={120}
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Details (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="Describe what happened, who was involved, and any immediate actions taken…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
          maxLength={2000}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors"
        >
          {saving ? 'Submitting…' : 'Submit Incident Report'}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

export default IncidentForm;
