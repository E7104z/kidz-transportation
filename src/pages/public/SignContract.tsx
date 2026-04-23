import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { pdf } from '@react-pdf/renderer';
import { createElement } from 'react';
import { format } from 'date-fns';
import { Bus, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import ContractPDF from '../../components/contracts/ContractPDF';
import type { Client, Student, Booking } from '../../types';

interface LoadResponse {
  contract: {
    id: string;
    pdfUrl: string;
    studentNames: string[];
    signedAt: unknown;
    signedByName: string | null;
    signedPdfUrl: string | null;
  };
  booking: Booking & { serviceStartDate: string | null };
  client: Client;
  students: Student[];
  alreadySigned: boolean;
}

const SignContract: React.FC = () => {
  const { contractId } = useParams<{ contractId: string }>();
  const [params] = useSearchParams();
  const token = params.get('t') || '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<LoadResponse | null>(null);
  const [typedName, setTypedName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ signedPdfUrl: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasStrokesRef = useRef(false);

  // ── Load the contract ────────────────────────────────────────────────
  useEffect(() => {
    if (!contractId || !token) {
      setLoadError('This signing link is missing required information.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const fn = httpsCallable<{ contractId: string; token: string }, LoadResponse>(
          getFunctions(), 'getContractForSigning'
        );
        const res = await fn({ contractId, token });
        setData(res.data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unable to load this contract.';
        setLoadError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [contractId, token]);

  // ── Signature pad: high-DPI canvas setup ─────────────────────────────
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  useEffect(() => {
    if (!data || data.alreadySigned) return;
    setupCanvas();
    const onResize = () => setupCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [data, setupCanvas]);

  const pointFromEvent = (e: PointerEvent | React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !lastPointRef.current) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPointRef.current = p;
    hasStrokesRef.current = true;
  };

  const onPointerUp = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const clearCanvas = () => {
    setupCanvas();
    hasStrokesRef.current = false;
  };

  // ── Submit ───────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!data || !contractId || !token) return;
    if (!typedName.trim() || typedName.trim().length < 2) {
      setSubmitError('Please type your full legal name.');
      return;
    }
    if (!hasStrokesRef.current) {
      setSubmitError('Please draw your signature in the box above.');
      return;
    }
    if (!agreed) {
      setSubmitError('Please acknowledge the terms to continue.');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSubmitError(null);
    setSubmitting(true);
    try {
      const signatureDataUrl = canvas.toDataURL('image/png');
      const signedDate = format(new Date(), 'MMMM d, yyyy');

      // Regenerate the PDF with the signature baked in
      const element = createElement(ContractPDF, {
        data: {
          client: data.client,
          students: data.students,
          // Re-hydrate serviceStartDate to a Date for the PDF renderer
          booking: {
            ...data.booking,
            serviceStartDate: data.booking.serviceStartDate
              ? new Date(data.booking.serviceStartDate)
              : (null as unknown as Date),
          },
          generatedDate: signedDate,
          applicationFeePaid: data.booking.applicationFeePaid,
          signature: {
            dataUrl: signatureDataUrl,
            signedName: typedName.trim(),
            signedDate,
          },
        },
      });
      const blob = await pdf(element as unknown as Parameters<typeof pdf>[0]).toBlob();

      // Convert to base64 (strip the "data:application/pdf;base64," prefix)
      const signedPdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = String(reader.result || '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });

      const finalize = httpsCallable<
        {
          contractId: string;
          token: string;
          signedPdfBase64: string;
          signatureDataUrl: string;
          signedByName: string;
        },
        { signedPdfUrl: string }
      >(getFunctions(), 'finalizeContractSignature');

      const res = await finalize({
        contractId,
        token,
        signedPdfBase64,
        signatureDataUrl,
        signedByName: typedName.trim(),
      });

      setDone({ signedPdfUrl: res.data.signedPdfUrl });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render states ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-violet-600" size={36} />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
            <span className="text-red-600 text-2xl">!</span>
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Link not valid</h1>
          <p className="text-sm text-slate-600 mb-6">
            {loadError ?? 'This signing link is invalid or has already been used.'}
          </p>
          <p className="text-xs text-slate-400">
            Questions? Call or text <strong>(314) 425-9668</strong>.
          </p>
        </div>
      </div>
    );
  }

  if (done || data.alreadySigned) {
    const pdfUrl = done?.signedPdfUrl || data.contract.signedPdfUrl || data.contract.pdfUrl;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="text-green-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">
            {done ? 'Signed — thank you!' : 'Already signed'}
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            {done
              ? 'Your signed agreement has been received. A copy is available below for your records.'
              : `This agreement was previously signed${data.contract.signedByName ? ` by ${data.contract.signedByName}` : ''}.`}
          </p>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors"
          >
            View Signed Agreement
          </a>
          <p className="text-xs text-slate-400 mt-6">
            Questions? Call or text <strong>(314) 425-9668</strong>.
          </p>
        </div>
      </div>
    );
  }

  // ── Signing UI ───────────────────────────────────────────────────────
  const { booking, client, contract } = data;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-violet-700 text-white">
        <div className="max-w-2xl mx-auto px-6 py-6 flex items-center gap-3">
          <Bus size={26} />
          <div>
            <div className="font-bold text-lg leading-tight">KIDZ Transportation</div>
            <div className="text-xs text-violet-200">Transportation Service Agreement</div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h1 className="text-xl font-bold text-slate-800 mb-1">Sign your agreement</h1>
          <p className="text-sm text-slate-500 mb-5">
            Hello <strong className="text-slate-700">{client.name}</strong> — please review the agreement, then
            sign below to activate transportation service for{' '}
            <strong className="text-slate-700">{contract.studentNames.join(', ')}</strong>.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-1.5 mb-5">
            <div><span className="text-slate-500">Pickup:</span> <strong>{booking.pickupAddress}</strong></div>
            <div><span className="text-slate-500">Dropoff:</span> <strong>{booking.dropoffAddress}</strong></div>
            <div><span className="text-slate-500">Days:</span> <strong>{booking.daysOfWeek?.join(', ') || '—'}</strong></div>
            <div><span className="text-slate-500">Weekly rate:</span> <strong>${Number(booking.weeklyRate || 0).toFixed(2)}</strong></div>
            <div><span className="text-slate-500">Service start:</span> <strong>{booking.serviceStartDate ? format(new Date(booking.serviceStartDate), 'MMMM d, yyyy') : '—'}</strong></div>
          </div>

          <a
            href={contract.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-violet-700 hover:text-violet-900 font-semibold mb-6"
          >
            Read full agreement (PDF) →
          </a>

          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
            Full legal name *
          </label>
          <input
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            placeholder="Type your full name"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mb-5"
          />

          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">
              Signature *
            </label>
            <button
              type="button"
              onClick={clearCanvas}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              <RefreshCw size={11} /> Clear
            </button>
          </div>
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white overflow-hidden" style={{ touchAction: 'none' }}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{ width: '100%', height: 160, cursor: 'crosshair', display: 'block' }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1.5 mb-5">Draw with your finger, stylus, or mouse.</p>

          <label className="flex items-start gap-2.5 cursor-pointer mb-5">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-violet-600"
            />
            <span className="text-sm text-slate-700">
              I have read the Transportation Service Agreement and agree to the terms and pricing.
              I understand that typing my name and signing above constitutes my legal electronic
              signature binding me to this agreement.
            </span>
          </label>

          {submitError && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {submitError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-colors"
          >
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> Submitting…</>
              : 'Sign and Submit'}
          </button>

          <p className="text-xs text-slate-400 mt-4 text-center">
            Your IP address and timestamp are recorded with this signature for audit purposes.
          </p>
        </section>
      </main>
    </div>
  );
};

export default SignContract;
