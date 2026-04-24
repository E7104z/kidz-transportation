import React, { useEffect, useState } from 'react';
import { MessageSquare, Phone, Mail, FileText, Plus, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { logCommunication, subscribeToClientCommunications } from '../services/commsService';
import type { ClientCommunication, CommunicationChannel, CommunicationDirection } from '../types';
import { format } from 'date-fns';

interface Props {
  clientId: string;
}

const CHANNEL_ICONS: Record<CommunicationChannel, React.ReactNode> = {
  phone:  <Phone size={13} />,
  email:  <Mail size={13} />,
  sms:    <MessageSquare size={13} />,
  portal: <FileText size={13} />,
  inPerson: <MessageSquare size={13} />,
};

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  phone:    'Phone',
  email:    'Email',
  sms:      'SMS',
  portal:   'Portal',
  inPerson: 'In Person',
};

const CommsLog: React.FC<Props> = ({ clientId }) => {
  const { user } = useAuth();
  const [items,     setItems]     = useState<ClientCommunication[]>([]);
  const [showForm,  setShowForm]  = useState(false);
  const [channel,   setChannel]   = useState<CommunicationChannel>('phone');
  const [direction, setDirection] = useState<CommunicationDirection>('outbound');
  const [body,      setBody]      = useState('');
  const [subject,   setSubject]   = useState('');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    const unsub = subscribeToClientCommunications(clientId, setItems);
    return unsub;
  }, [clientId]);

  const handleLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !body.trim()) return;
    setSaving(true);
    try {
      await logCommunication({
        clientId,
        channel,
        direction,
        subject:      subject.trim() || undefined,
        body:         body.trim(),
        loggedByUid:  user.uid,
        loggedByName: user.displayName ?? user.email ?? 'Admin',
      });
      setBody('');
      setSubject('');
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
          <MessageSquare size={15} /> Communications
        </h4>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          <Plus size={13} /> Log
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleLog} className="bg-slate-50 rounded-xl border border-slate-200 p-3 mb-3 space-y-2">
          <div className="flex gap-2">
            <select
              value={channel}
              onChange={e => setChannel(e.target.value as CommunicationChannel)}
              className="text-xs rounded-lg border border-slate-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 flex-1"
            >
              {(Object.keys(CHANNEL_LABELS) as CommunicationChannel[]).map(c => (
                <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
              ))}
            </select>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as CommunicationDirection)}
              className="text-xs rounded-lg border border-slate-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 flex-1"
            >
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </select>
          </div>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="w-full text-xs rounded-lg border border-slate-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            maxLength={120}
          />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Notes…"
            rows={3}
            className="w-full text-xs rounded-lg border border-slate-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
            maxLength={2000}
            required
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Send size={11} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-500 hover:text-slate-700">
              Cancel
            </button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-4">No communications logged.</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {items.map(item => (
            <div key={item.id} className="bg-white rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-slate-400">{CHANNEL_ICONS[item.channel]}</span>
                <span className="text-xs font-semibold text-slate-700">{CHANNEL_LABELS[item.channel]}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  item.direction === 'outbound'
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-emerald-50 text-emerald-600'
                }`}>
                  {item.direction}
                </span>
                <span className="ml-auto text-[10px] text-slate-400">
                  {item.createdAt ? format((item.createdAt as any).toDate(), 'MMM d, h:mm a') : '—'}
                </span>
              </div>
              {item.subject && <div className="text-xs font-medium text-slate-600 mb-0.5">{item.subject}</div>}
              <div className="text-xs text-slate-500 line-clamp-3">{item.body}</div>
              <div className="text-[10px] text-slate-400 mt-1">Logged by {item.loggedByName}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CommsLog;
