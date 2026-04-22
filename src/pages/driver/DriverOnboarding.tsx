import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import { signOut as authSignOut } from '../../services/authService';
import {
  Check, ChevronLeft, ChevronRight, UploadCloud, FileText, ExternalLink,
  Car, User as UserIcon, ShieldCheck, CheckCircle2, AlertCircle, Download, Loader2, LogOut,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type DocType = 'driversLicense' | 'insurance' | 'registration' | 'w9';

interface UploadedDoc {
  name: string;
  size: number;
  url: string;
  path: string;
  uploadedAt: number;
}

type Uploads = Record<DocType, UploadedDoc | null>;
type UploadProgress = Record<DocType, number | null>;

interface Step1Data {
  fullName: string;
  dateOfBirth: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}
interface Step2Data {
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  vehicleColor: string;
  licensePlate: string;
  plateState: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NAVY = '#1a2e4a';
const AMBER = '#f59e0b';
const MAX_FILE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/jpg';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const DOC_META: Record<DocType, { label: string; help: string }> = {
  driversLicense: { label: "Driver's License",      help: 'Clear photo of the front of your valid driver\'s license.' },
  insurance:      { label: 'Vehicle Insurance Card', help: 'Current proof of insurance for the vehicle you\'ll drive.' },
  registration:   { label: 'Vehicle Registration',   help: 'Current vehicle registration document.' },
  w9:             { label: 'Signed W-9 Form',        help: 'Download the W-9, fill it out, sign it, and upload the completed form.' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const onlyDigits = (s: string) => s.replace(/\D/g, '');
const isValidZip = (s: string) => /^\d{5}(-\d{4})?$/.test(s.trim());
const isValidPhone = (s: string) => onlyDigits(s).length === 10 || onlyDigits(s).length === 11;
const isFutureDate = (iso: string) => {
  if (!iso) return false;
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  return d.getTime() > today.getTime();
};
const isPastDate = (iso: string) => {
  if (!iso) return false;
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  return d.getTime() < today.getTime();
};
const fileExt = (name: string) => {
  const parts = name.split('.');
  return (parts.length > 1 ? parts.pop() : 'bin')!.toLowerCase();
};
const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
};

// ── Component ─────────────────────────────────────────────────────────────────

const DriverOnboarding: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loadingInit, setLoadingInit]   = useState(true);
  const [driverId, setDriverId]         = useState<string>('');
  const [step, setStep]                 = useState<1 | 2 | 3 | 4>(1);
  const [submitting, setSubmitting]     = useState(false);
  const [submitted, setSubmitted]       = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);

  const [s1, setS1] = useState<Step1Data>({
    fullName: '', dateOfBirth: '', street: '', city: '', state: '', zip: '',
    phone: '', emergencyContactName: '', emergencyContactPhone: '',
  });
  const [s2, setS2] = useState<Step2Data>({
    licenseNumber: '', licenseState: '', licenseExpiration: '',
    vehicleMake: '', vehicleModel: '', vehicleYear: '', vehicleColor: '',
    licensePlate: '', plateState: '',
  });
  const [uploads, setUploads] = useState<Uploads>({
    driversLicense: null, insurance: null, registration: null, w9: null,
  });
  const [progress, setProgress] = useState<UploadProgress>({
    driversLicense: null, insurance: null, registration: null, w9: null,
  });
  const [uploadErrors, setUploadErrors] = useState<Record<DocType, string | null>>({
    driversLicense: null, insurance: null, registration: null, w9: null,
  });

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [agree1, setAgree1] = useState(false);
  const [agree2, setAgree2] = useState(false);

  // Load driver doc — pre-fill name, bail if already complete.
  useEffect(() => {
    if (!user) { setLoadingInit(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const linkedId = userSnap.data()?.linkedId as string | undefined;
        if (!linkedId) { if (!cancelled) setLoadingInit(false); return; }
        const drvSnap = await getDoc(doc(db, 'drivers', linkedId));
        if (cancelled) return;
        setDriverId(linkedId);
        const d = drvSnap.data() || {};
        if (d.onboardingStatus === 'complete') {
          navigate('/driver/today', { replace: true });
          return;
        }
        setS1(s => ({
          ...s,
          fullName: (d.name as string) || userSnap.data()?.name || '',
          phone:    (d.phone as string) || '',
        }));
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, navigate]);

  // ── Validation ──────────────────────────────────────────────────────────────

  const s1Errors = useMemo(() => {
    const e: Partial<Record<keyof Step1Data, string>> = {};
    if (!s1.fullName.trim())              e.fullName = 'Required';
    if (!s1.dateOfBirth)                  e.dateOfBirth = 'Required';
    else if (!isPastDate(s1.dateOfBirth)) e.dateOfBirth = 'Date of birth must be in the past';
    if (!s1.street.trim())                e.street = 'Required';
    if (!s1.city.trim())                  e.city = 'Required';
    if (!s1.state)                        e.state = 'Required';
    if (!s1.zip.trim())                   e.zip = 'Required';
    else if (!isValidZip(s1.zip))         e.zip = 'Enter a valid ZIP (12345 or 12345-6789)';
    if (!s1.phone.trim())                 e.phone = 'Required';
    else if (!isValidPhone(s1.phone))     e.phone = 'Enter a valid 10-digit phone number';
    if (!s1.emergencyContactName.trim())  e.emergencyContactName = 'Required';
    if (s1.emergencyContactPhone.trim() && !isValidPhone(s1.emergencyContactPhone))
      e.emergencyContactPhone = 'Enter a valid 10-digit phone number';
    return e;
  }, [s1]);

  const s2Errors = useMemo(() => {
    const e: Partial<Record<keyof Step2Data, string>> = {};
    if (!s2.licenseNumber.trim())             e.licenseNumber = 'Required';
    if (!s2.licenseState)                     e.licenseState = 'Required';
    if (!s2.licenseExpiration)                e.licenseExpiration = 'Required';
    else if (!isFutureDate(s2.licenseExpiration))
      e.licenseExpiration = 'License must not be expired';
    if (!s2.vehicleMake.trim())               e.vehicleMake = 'Required';
    if (!s2.vehicleModel.trim())              e.vehicleModel = 'Required';
    if (!s2.vehicleYear.trim())               e.vehicleYear = 'Required';
    else if (!/^\d{4}$/.test(s2.vehicleYear) || +s2.vehicleYear < 1980 || +s2.vehicleYear > new Date().getFullYear() + 1)
      e.vehicleYear = 'Enter a valid 4-digit year';
    if (!s2.vehicleColor.trim())              e.vehicleColor = 'Required';
    if (!s2.licensePlate.trim())              e.licensePlate = 'Required';
    if (!s2.plateState)                       e.plateState = 'Required';
    return e;
  }, [s2]);

  const s1Valid = Object.keys(s1Errors).length === 0;
  const s2Valid = Object.keys(s2Errors).length === 0;
  const s3Valid = Object.values(uploads).every(u => u != null);
  const s4Valid = agree1 && agree2;

  // ── Upload handler ──────────────────────────────────────────────────────────

  const uploadFile = (docType: DocType, file: File) => {
    setUploadErrors(e => ({ ...e, [docType]: null }));
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'].includes(file.type)) {
      setUploadErrors(e => ({ ...e, [docType]: 'File must be PDF, JPG, or PNG.' }));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadErrors(e => ({ ...e, [docType]: `File exceeds ${MAX_FILE_MB} MB.` }));
      return;
    }
    if (!driverId) {
      setUploadErrors(e => ({ ...e, [docType]: 'Driver record not ready — please refresh.' }));
      return;
    }

    const ts = Date.now();
    const ext = fileExt(file.name);
    const path = `drivers/${driverId}/onboarding/${docType}_${ts}.${ext}`;
    const r = storageRef(storage, path);
    const task = uploadBytesResumable(r, file, { contentType: file.type });

    setProgress(p => ({ ...p, [docType]: 0 }));

    task.on('state_changed',
      snap => {
        const pct = snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
        setProgress(p => ({ ...p, [docType]: pct }));
      },
      err => {
        setProgress(p => ({ ...p, [docType]: null }));
        setUploadErrors(e => ({ ...e, [docType]: err.message || 'Upload failed.' }));
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          setUploads(u => ({
            ...u,
            [docType]: { name: file.name, size: file.size, url, path, uploadedAt: ts },
          }));
        } catch (err) {
          setUploadErrors(e => ({ ...e, [docType]: (err as Error).message || 'Upload completed but URL failed.' }));
        } finally {
          setProgress(p => ({ ...p, [docType]: null }));
        }
      },
    );
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!driverId || !s1Valid || !s2Valid || !s3Valid || !s4Valid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const profilePayload = {
        // Step 1
        fullName: s1.fullName.trim(),
        dateOfBirth: s1.dateOfBirth,
        address: {
          street: s1.street.trim(),
          city: s1.city.trim(),
          state: s1.state,
          zip: s1.zip.trim(),
        },
        phone: s1.phone.trim(),
        emergencyContact: {
          name: s1.emergencyContactName.trim(),
          phone: s1.emergencyContactPhone.trim(),
        },
        // Step 2
        license: {
          number: s2.licenseNumber.trim(),
          state: s2.licenseState,
          expiration: s2.licenseExpiration,
        },
        vehicle: {
          make: s2.vehicleMake.trim(),
          model: s2.vehicleModel.trim(),
          year: s2.vehicleYear.trim(),
          color: s2.vehicleColor.trim(),
          plate: s2.licensePlate.trim().toUpperCase(),
          plateState: s2.plateState,
        },
        // Step 3
        documents: {
          driversLicense: uploads.driversLicense!,
          insurance:      uploads.insurance!,
          registration:   uploads.registration!,
          w9:             uploads.w9!,
        },
        // Step 4
        agreements: {
          contractorAgreement: true,
          certification: true,
          acceptedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      };

      await setDoc(
        doc(db, 'drivers', driverId, 'onboarding', 'profile'),
        profilePayload,
        { merge: true },
      );

      await updateDoc(doc(db, 'drivers', driverId), {
        name: s1.fullName.trim(),
        phone: s1.phone.trim(),
        onboardingStatus: 'complete',
        onboardingCompletedAt: serverTimestamp(),
      });

      setSubmitted(true);
      setTimeout(() => { navigate('/driver/today', { replace: true }); }, 2500);
    } catch (err) {
      setSubmitError((err as Error).message || 'Submission failed. Please try again.');
      setSubmitting(false);
    }
  };

  // ── Render guards ───────────────────────────────────────────────────────────

  if (loadingInit) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin" size={32} style={{ color: NAVY }} />
      </div>
    );
  }

  if (!driverId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full text-center">
          <AlertCircle className="mx-auto mb-3 text-red-500" size={40} />
          <h2 className="text-lg font-bold text-slate-800 mb-2">Driver record not found</h2>
          <p className="text-sm text-slate-600 mb-4">
            We couldn't find a driver record linked to your account. Contact KIDZ Transportation
            to be added as a driver.
          </p>
          <button
            onClick={async () => { await authSignOut(); navigate('/login', { replace: true }); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold"
            style={{ backgroundColor: NAVY }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div
            className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center animate-[ping_1s_ease-out_1]"
            style={{ backgroundColor: NAVY }}
          >
            <CheckCircle2 size={48} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: NAVY }}>You're all set!</h2>
          <p className="text-slate-600">Redirecting to your dashboard…</p>
          <Loader2 className="animate-spin mx-auto mt-4 text-slate-400" size={20} />
        </div>
      </div>
    );
  }

  // ── Step header ─────────────────────────────────────────────────────────────

  const steps: { n: 1|2|3|4; label: string; icon: React.FC<{ size?: number }> }[] = [
    { n: 1, label: 'Personal', icon: UserIcon },
    { n: 2, label: 'Vehicle',  icon: Car },
    { n: 3, label: 'Documents',icon: FileText },
    { n: 4, label: 'Agree',    icon: ShieldCheck },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header bar */}
      <div className="px-5 py-4 shadow-md" style={{ backgroundColor: NAVY }}>
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-lg leading-tight">Driver Onboarding</div>
            <div className="text-white/70 text-xs">Complete your profile to start driving</div>
          </div>
          <button
            onClick={async () => { await authSignOut(); navigate('/login', { replace: true }); }}
            className="text-white/80 hover:text-white text-xs font-medium flex items-center gap-1"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>

      {/* Step indicator */}
      <div className="max-w-xl mx-auto px-5 pt-5">
        <div className="flex items-center justify-between">
          {steps.map((s, i) => {
            const done    = step > s.n;
            const current = step === s.n;
            return (
              <React.Fragment key={s.n}>
                <div className="flex flex-col items-center flex-1 min-w-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors"
                    style={
                      done    ? { backgroundColor: NAVY, color: '#fff' } :
                      current ? { backgroundColor: AMBER, color: '#fff' } :
                                { backgroundColor: '#e2e8f0', color: '#64748b' }
                    }
                  >
                    {done ? <Check size={18} /> : s.n}
                  </div>
                  <div
                    className="text-[10px] mt-1 font-semibold uppercase tracking-wide truncate"
                    style={{ color: current ? AMBER : done ? NAVY : '#94a3b8' }}
                  >
                    {s.label}
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className="h-0.5 flex-1 mx-1 -mt-5"
                    style={{ backgroundColor: step > s.n ? NAVY : '#e2e8f0' }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-xl mx-auto px-4 sm:px-5 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
          {step === 1 && (
            <Step1
              data={s1} setData={setS1}
              errors={s1Errors} touched={touched} setTouched={setTouched}
            />
          )}
          {step === 2 && (
            <Step2
              data={s2} setData={setS2}
              errors={s2Errors} touched={touched} setTouched={setTouched}
            />
          )}
          {step === 3 && (
            <Step3
              uploads={uploads}
              progress={progress}
              errors={uploadErrors}
              onUpload={uploadFile}
            />
          )}
          {step === 4 && (
            <Step4
              s1={s1} s2={s2} uploads={uploads}
              agree1={agree1} setAgree1={setAgree1}
              agree2={agree2} setAgree2={setAgree2}
              submitError={submitError}
            />
          )}
        </div>

        {/* Nav buttons */}
        <div className="flex gap-3 mt-5">
          {step > 1 && (
            <button
              onClick={() => setStep(s => (s - 1) as 1|2|3|4)}
              disabled={submitting}
              className="flex-1 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              <ChevronLeft size={16} /> Back
            </button>
          )}
          {step < 4 && (
            <button
              onClick={() => {
                if (step === 1 && !s1Valid) {
                  setTouched(t => ({ ...t, ...Object.fromEntries(Object.keys(s1Errors).map(k => [k, true])) }));
                  return;
                }
                if (step === 2 && !s2Valid) {
                  setTouched(t => ({ ...t, ...Object.fromEntries(Object.keys(s2Errors).map(k => [k, true])) }));
                  return;
                }
                if (step === 3 && !s3Valid) return;
                setStep(s => (s + 1) as 1|2|3|4);
              }}
              disabled={
                (step === 1 && !s1Valid) ||
                (step === 2 && !s2Valid) ||
                (step === 3 && !s3Valid)
              }
              className="flex-1 text-white rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              style={{ backgroundColor: AMBER }}
            >
              Next <ChevronRight size={16} />
            </button>
          )}
          {step === 4 && (
            <button
              onClick={handleSubmit}
              disabled={!s4Valid || submitting}
              className="flex-1 text-white rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              style={{ backgroundColor: NAVY }}
            >
              {submitting
                ? <><Loader2 size={16} className="animate-spin" /> Submitting…</>
                : <><Check size={16} /> Complete Setup</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriverOnboarding;

// ── Shared UI bits ────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

const Field: React.FC<FieldProps> = ({
  label, name, value, onChange, onBlur, error, touched, type = 'text',
  placeholder, autoComplete, maxLength, inputMode,
}) => {
  const showErr = touched && error;
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
        {label}
      </label>
      <input
        id={name} name={name} type={type} placeholder={placeholder}
        autoComplete={autoComplete} maxLength={maxLength} inputMode={inputMode}
        value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition ${
          showErr
            ? 'border-red-400 focus:ring-red-200'
            : 'border-slate-200 focus:ring-amber-200 focus:border-amber-400'
        }`}
      />
      {showErr && <div className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={12} /> {error}</div>}
    </div>
  );
};

interface SelectProps {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
  options: string[];
  placeholder?: string;
}
const Select: React.FC<SelectProps> = ({
  label, name, value, onChange, onBlur, error, touched, options, placeholder = 'Select…',
}) => {
  const showErr = touched && error;
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
        {label}
      </label>
      <select
        id={name} name={name}
        value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        className={`w-full rounded-xl border px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 transition ${
          showErr
            ? 'border-red-400 focus:ring-red-200'
            : 'border-slate-200 focus:ring-amber-200 focus:border-amber-400'
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {showErr && <div className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={12} /> {error}</div>}
    </div>
  );
};

// ── Step 1 ───────────────────────────────────────────────────────────────────

const Step1: React.FC<{
  data: Step1Data;
  setData: React.Dispatch<React.SetStateAction<Step1Data>>;
  errors: Partial<Record<keyof Step1Data, string>>;
  touched: Record<string, boolean>;
  setTouched: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}> = ({ data, setData, errors, touched, setTouched }) => {
  const markTouched = (k: keyof Step1Data) => setTouched(t => ({ ...t, [k]: true }));
  return (
    <div>
      <h2 className="text-lg font-bold mb-1" style={{ color: NAVY }}>Personal & Contact Info</h2>
      <p className="text-sm text-slate-500 mb-5">We need this info to verify your identity.</p>
      <div className="space-y-4">
        <Field label="Full Legal Name" name="fullName" value={data.fullName}
          onChange={v => setData(d => ({ ...d, fullName: v }))}
          onBlur={() => markTouched('fullName')}
          error={errors.fullName} touched={touched.fullName}
          autoComplete="name" placeholder="John A. Smith" />
        <Field label="Date of Birth" name="dateOfBirth" type="date" value={data.dateOfBirth}
          onChange={v => setData(d => ({ ...d, dateOfBirth: v }))}
          onBlur={() => markTouched('dateOfBirth')}
          error={errors.dateOfBirth} touched={touched.dateOfBirth} />
        <Field label="Street Address" name="street" value={data.street}
          onChange={v => setData(d => ({ ...d, street: v }))}
          onBlur={() => markTouched('street')}
          error={errors.street} touched={touched.street}
          autoComplete="street-address" placeholder="123 Main St" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" name="city" value={data.city}
            onChange={v => setData(d => ({ ...d, city: v }))}
            onBlur={() => markTouched('city')}
            error={errors.city} touched={touched.city}
            autoComplete="address-level2" />
          <Select label="State" name="state" value={data.state}
            onChange={v => setData(d => ({ ...d, state: v }))}
            onBlur={() => markTouched('state')}
            error={errors.state} touched={touched.state}
            options={US_STATES} />
        </div>
        <Field label="ZIP Code" name="zip" value={data.zip}
          onChange={v => setData(d => ({ ...d, zip: v }))}
          onBlur={() => markTouched('zip')}
          error={errors.zip} touched={touched.zip}
          autoComplete="postal-code" inputMode="numeric" maxLength={10} />
        <Field label="Phone Number" name="phone" type="tel" value={data.phone}
          onChange={v => setData(d => ({ ...d, phone: v }))}
          onBlur={() => markTouched('phone')}
          error={errors.phone} touched={touched.phone}
          autoComplete="tel" inputMode="tel" placeholder="(314) 555-0000" />
        <div className="pt-2 border-t border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Emergency Contact</div>
          <div className="space-y-4">
            <Field label="Contact Name" name="emergencyContactName" value={data.emergencyContactName}
              onChange={v => setData(d => ({ ...d, emergencyContactName: v }))}
              onBlur={() => markTouched('emergencyContactName')}
              error={errors.emergencyContactName} touched={touched.emergencyContactName} />
            <Field label="Contact Phone (optional)" name="emergencyContactPhone" type="tel" value={data.emergencyContactPhone}
              onChange={v => setData(d => ({ ...d, emergencyContactPhone: v }))}
              onBlur={() => markTouched('emergencyContactPhone')}
              error={errors.emergencyContactPhone} touched={touched.emergencyContactPhone}
              inputMode="tel" />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Step 2 ───────────────────────────────────────────────────────────────────

const Step2: React.FC<{
  data: Step2Data;
  setData: React.Dispatch<React.SetStateAction<Step2Data>>;
  errors: Partial<Record<keyof Step2Data, string>>;
  touched: Record<string, boolean>;
  setTouched: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}> = ({ data, setData, errors, touched, setTouched }) => {
  const markTouched = (k: keyof Step2Data) => setTouched(t => ({ ...t, [k]: true }));
  return (
    <div>
      <h2 className="text-lg font-bold mb-1" style={{ color: NAVY }}>Vehicle & License</h2>
      <p className="text-sm text-slate-500 mb-5">The vehicle you will be driving children in.</p>
      <div className="space-y-4">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Driver's License</div>
        <Field label="License Number" name="licenseNumber" value={data.licenseNumber}
          onChange={v => setData(d => ({ ...d, licenseNumber: v }))}
          onBlur={() => markTouched('licenseNumber')}
          error={errors.licenseNumber} touched={touched.licenseNumber} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="License State" name="licenseState" value={data.licenseState}
            onChange={v => setData(d => ({ ...d, licenseState: v }))}
            onBlur={() => markTouched('licenseState')}
            error={errors.licenseState} touched={touched.licenseState}
            options={US_STATES} />
          <Field label="Expiration" name="licenseExpiration" type="date" value={data.licenseExpiration}
            onChange={v => setData(d => ({ ...d, licenseExpiration: v }))}
            onBlur={() => markTouched('licenseExpiration')}
            error={errors.licenseExpiration} touched={touched.licenseExpiration} />
        </div>

        <div className="pt-2 border-t border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Vehicle</div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Make" name="vehicleMake" value={data.vehicleMake}
                onChange={v => setData(d => ({ ...d, vehicleMake: v }))}
                onBlur={() => markTouched('vehicleMake')}
                error={errors.vehicleMake} touched={touched.vehicleMake}
                placeholder="Toyota" />
              <Field label="Model" name="vehicleModel" value={data.vehicleModel}
                onChange={v => setData(d => ({ ...d, vehicleModel: v }))}
                onBlur={() => markTouched('vehicleModel')}
                error={errors.vehicleModel} touched={touched.vehicleModel}
                placeholder="Sienna" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Year" name="vehicleYear" value={data.vehicleYear}
                onChange={v => setData(d => ({ ...d, vehicleYear: v.replace(/\D/g, '').slice(0, 4) }))}
                onBlur={() => markTouched('vehicleYear')}
                error={errors.vehicleYear} touched={touched.vehicleYear}
                inputMode="numeric" maxLength={4} placeholder="2022" />
              <Field label="Color" name="vehicleColor" value={data.vehicleColor}
                onChange={v => setData(d => ({ ...d, vehicleColor: v }))}
                onBlur={() => markTouched('vehicleColor')}
                error={errors.vehicleColor} touched={touched.vehicleColor}
                placeholder="Silver" />
            </div>
            <Field label="License Plate" name="licensePlate" value={data.licensePlate}
              onChange={v => setData(d => ({ ...d, licensePlate: v.toUpperCase() }))}
              onBlur={() => markTouched('licensePlate')}
              error={errors.licensePlate} touched={touched.licensePlate}
              maxLength={10} placeholder="ABC1234" />
            <Select label="Plate State" name="plateState" value={data.plateState}
              onChange={v => setData(d => ({ ...d, plateState: v }))}
              onBlur={() => markTouched('plateState')}
              error={errors.plateState} touched={touched.plateState}
              options={US_STATES} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Step 3 ───────────────────────────────────────────────────────────────────

const Step3: React.FC<{
  uploads: Uploads;
  progress: UploadProgress;
  errors: Record<DocType, string | null>;
  onUpload: (d: DocType, f: File) => void;
}> = ({ uploads, progress, errors, onUpload }) => {
  return (
    <div>
      <h2 className="text-lg font-bold mb-1" style={{ color: NAVY }}>Upload Documents</h2>
      <p className="text-sm text-slate-500 mb-5">
        PDF, JPG, or PNG — max {MAX_FILE_MB} MB each.
      </p>

      <div className="mb-5 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
        <FileText size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800">Need a W-9?</div>
          <div className="text-xs text-slate-600 mb-2">
            Download the official IRS W-9 form, fill it out, sign it, then upload the signed PDF below.
          </div>
          <a
            href="/fw9 (1).pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-800"
          >
            <Download size={12} /> Download blank W-9
          </a>
        </div>
      </div>

      <div className="space-y-4">
        {(Object.keys(DOC_META) as DocType[]).map(dt => (
          <UploadField
            key={dt}
            label={DOC_META[dt].label}
            help={DOC_META[dt].help}
            uploaded={uploads[dt]}
            progress={progress[dt]}
            error={errors[dt]}
            onSelect={file => onUpload(dt, file)}
          />
        ))}
      </div>
    </div>
  );
};

const UploadField: React.FC<{
  label: string;
  help: string;
  uploaded: UploadedDoc | null;
  progress: number | null;
  error: string | null;
  onSelect: (f: File) => void;
}> = ({ label, help, uploaded, progress, error, onSelect }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const uploading = progress != null;

  const handleFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    onSelect(files[0]);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-semibold text-slate-800">{label}</label>
        {uploaded && (
          <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
            <CheckCircle2 size={14} /> Uploaded
          </span>
        )}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (!uploading) handleFiles(e.dataTransfer.files); }}
        onClick={() => { if (!uploading) inputRef.current?.click(); }}
        className={`rounded-xl border-2 border-dashed px-4 py-4 cursor-pointer transition-colors ${
          error    ? 'border-red-300 bg-red-50' :
          uploaded ? 'border-emerald-300 bg-emerald-50' :
          drag     ? 'border-amber-400 bg-amber-50' :
                     'border-slate-300 bg-slate-50 hover:border-amber-300 hover:bg-amber-50/40'
        }`}
      >
        <input
          ref={inputRef} type="file" accept={ACCEPT} className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />

        {uploaded && !uploading && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <FileText size={20} className="text-emerald-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">{uploaded.name}</div>
              <div className="text-xs text-slate-500">{fmtBytes(uploaded.size)}</div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a
                href={uploaded.url} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"
              >
                View <ExternalLink size={11} />
              </a>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                Replace
              </button>
            </div>
          </div>
        )}

        {uploading && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Loader2 size={16} className="animate-spin text-amber-600" />
              <span className="text-sm font-semibold text-slate-700">
                Uploading… {Math.round(progress ?? 0)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full transition-all"
                style={{ width: `${progress ?? 0}%`, backgroundColor: AMBER }}
              />
            </div>
          </div>
        )}

        {!uploaded && !uploading && (
          <div className="text-center py-2">
            <UploadCloud className="mx-auto mb-1 text-slate-400" size={28} />
            <div className="text-sm font-semibold text-slate-700">
              Tap to upload, or drag a file here
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{help}</div>
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </div>
      )}
    </div>
  );
};

// ── Step 4 ───────────────────────────────────────────────────────────────────

const Step4: React.FC<{
  s1: Step1Data;
  s2: Step2Data;
  uploads: Uploads;
  agree1: boolean;
  setAgree1: (v: boolean) => void;
  agree2: boolean;
  setAgree2: (v: boolean) => void;
  submitError: string | null;
}> = ({ s1, s2, uploads, agree1, setAgree1, agree2, setAgree2, submitError }) => {
  return (
    <div>
      <h2 className="text-lg font-bold mb-1" style={{ color: NAVY }}>Review & Agree</h2>
      <p className="text-sm text-slate-500 mb-5">
        Please confirm the information below, then sign off on the agreements.
      </p>

      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 mb-5 text-sm">
        <ReviewRow label="Name"      value={s1.fullName} />
        <ReviewRow label="Phone"     value={s1.phone} />
        <ReviewRow label="Address"   value={`${s1.street}, ${s1.city}, ${s1.state} ${s1.zip}`} />
        <ReviewRow label="Vehicle"   value={`${s2.vehicleYear} ${s2.vehicleMake} ${s2.vehicleModel} · ${s2.vehicleColor}`} />
        <ReviewRow label="Plate"     value={`${s2.licensePlate} (${s2.plateState})`} />
        <ReviewRow label="License"   value={`${s2.licenseNumber} (${s2.licenseState}) — exp ${s2.licenseExpiration}`} />
        <ReviewRow label="Documents" value={
          <div className="flex flex-col gap-0.5">
            {(Object.keys(DOC_META) as DocType[]).map(dt => (
              <div key={dt} className="flex items-center gap-1.5 text-xs">
                <CheckCircle2 size={12} className="text-emerald-600 flex-shrink-0" />
                <span className="font-medium">{DOC_META[dt].label}:</span>
                <a
                  href={uploads[dt]?.url} target="_blank" rel="noopener noreferrer"
                  className="text-emerald-700 hover:underline truncate"
                >
                  {uploads[dt]?.name}
                </a>
              </div>
            ))}
          </div>
        } />
      </div>

      <div className="space-y-3">
        <AgreementRow
          checked={agree1}
          onChange={setAgree1}
          text={<>I confirm that I am an <b>independent contractor</b> and agree to the KIDZ Transportation Independent Contractor Agreement.</>}
        />
        <AgreementRow
          checked={agree2}
          onChange={setAgree2}
          text={<>I certify that <b>all information and documents</b> I have provided are accurate and complete.</>}
        />
      </div>

      {submitError && (
        <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {submitError}
        </div>
      )}
    </div>
  );
};

const ReviewRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="px-3 py-2.5 flex items-start gap-3">
    <div className="w-24 text-xs font-semibold uppercase tracking-wide text-slate-400 flex-shrink-0">{label}</div>
    <div className="flex-1 text-slate-700 min-w-0 break-words">{value}</div>
  </div>
);

const AgreementRow: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  text: React.ReactNode;
}> = ({ checked, onChange, text }) => (
  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
    checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'
  }`}>
    <input
      type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
      className="mt-0.5 w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-400"
    />
    <span className="text-sm text-slate-700 leading-snug">{text}</span>
  </label>
);
