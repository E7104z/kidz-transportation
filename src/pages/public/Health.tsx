import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { CheckCircle, XCircle, Loader } from 'lucide-react';

interface HealthCheck {
  name:    string;
  status:  'ok' | 'error' | 'checking';
  latency?: number;
  detail?: string;
}

async function checkFirestore(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await getDoc(doc(db, '_health', 'ping'));
    return { name: 'Firestore', status: 'ok', latency: Date.now() - start };
  } catch (e: any) {
    return { name: 'Firestore', status: 'error', detail: e?.message };
  }
}

const HealthPage: React.FC = () => {
  const [checks, setChecks] = useState<HealthCheck[]>([
    { name: 'Firestore',  status: 'checking' },
    { name: 'App',        status: 'ok',     detail: import.meta.env.VITE_APP_VERSION ?? 'dev' },
    { name: 'App Check',  status: import.meta.env.VITE_RECAPTCHA_SITE_KEY ? 'ok' : 'error', detail: import.meta.env.VITE_RECAPTCHA_SITE_KEY ? 'Configured' : 'VITE_RECAPTCHA_SITE_KEY not set' },
    { name: 'Sentry',     status: import.meta.env.VITE_SENTRY_DSN ? 'ok' : 'error', detail: import.meta.env.VITE_SENTRY_DSN ? 'Connected' : 'VITE_SENTRY_DSN not set' },
  ]);

  useEffect(() => {
    checkFirestore().then(result => {
      setChecks(prev => prev.map(c => c.name === 'Firestore' ? result : c));
    });
  }, []);

  const allOk = checks.every(c => c.status === 'ok');

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className={`rounded-2xl border-2 p-6 shadow-sm ${allOk ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
          <h1 className="text-xl font-bold text-slate-800 mb-1">
            {allOk ? '✓ System Healthy' : '⚠ Degraded'}
          </h1>
          <p className="text-sm text-slate-500 mb-5">KIDZ Transportation — System Status</p>
          <div className="space-y-3">
            {checks.map(c => (
              <div key={c.name} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-slate-200">
                <div className="flex items-center gap-2">
                  {c.status === 'checking' && <Loader size={16} className="text-slate-400 animate-spin" />}
                  {c.status === 'ok'       && <CheckCircle size={16} className="text-green-500" />}
                  {c.status === 'error'    && <XCircle     size={16} className="text-red-500" />}
                  <span className="text-sm font-medium text-slate-700">{c.name}</span>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-semibold ${c.status === 'ok' ? 'text-green-600' : c.status === 'error' ? 'text-red-600' : 'text-slate-400'}`}>
                    {c.status === 'checking' ? 'Checking…' : c.status.toUpperCase()}
                  </span>
                  {c.latency != null && (
                    <span className="block text-[10px] text-slate-400">{c.latency}ms</span>
                  )}
                  {c.detail && (
                    <span className="block text-[10px] text-slate-400 max-w-[160px] truncate">{c.detail}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-4 text-center">
            Last checked: {new Date().toLocaleTimeString()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default HealthPage;
