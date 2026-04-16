import React, { useState } from 'react';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import type { TransportationType, BookingStatus } from '../../types';
import { Upload, Plus, Trash2, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import AddressAutocomplete from '../../components/AddressAutocomplete';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ParentForm {
  name: string; email: string; phone: string; address: string;
}
interface StudentImport {
  name: string; dob: string; age: string; phone: string;
  grade: string; schoolName: string; schoolContact: string;
  allergies: string; specialRequirements: string;
}
interface BookingForm {
  transportationType: TransportationType;
  daysOfWeek: string[];
  pickupAddress: string; dropoffAddress: string;
  schoolStartTime: string; schoolEndTime: string;
  serviceStartDate: string;
  weeklyRate: string; dailyRate: string;
  emergencyContact: string; emergencyPhone: string;
  applicationFeePaid: boolean;
  notes: string;
}

const BLANK_STUDENT: StudentImport = {
  name: '', dob: '', age: '', phone: '',
  grade: '', schoolName: '', schoolContact: '',
  allergies: '', specialRequirements: '',
};
const BLANK_BOOKING: BookingForm = {
  transportationType: 'roundtrip', daysOfWeek: [],
  pickupAddress: '', dropoffAddress: '',
  schoolStartTime: '', schoolEndTime: '',
  serviceStartDate: '', weeklyRate: '', dailyRate: '',
  emergencyContact: '', emergencyPhone: '',
  applicationFeePaid: false, notes: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Full TSV parser — handles quoted fields with embedded commas/newlines */
function parseTSV(raw: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cur = '';
  let inQ = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      if (inQ && raw[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === '\t' && !inQ) {
      cells.push(cur); cur = '';
    } else if ((c === '\n' || c === '\r') && !inQ) {
      if (cur || cells.length) { cells.push(cur); rows.push(cells); }
      cells = []; cur = '';
      if (c === '\r' && raw[i + 1] === '\n') i++;
    } else {
      cur += c;
    }
  }
  if (cur || cells.length) { cells.push(cur); rows.push(cells); }
  return rows;
}

// ─── Header-based column mapping ────────────────────────────────────────────

type ColMap = Record<string, number>;

/** Normalize a header: lowercase, collapse whitespace */
const nh = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// ─── Canonical column schema ──────────────────────────────────────────────────
// Source of truth: the exact Google Form header row.
// Col 0  = timestamp
// Col 1  = Email Address
// Col 2  = What is the purpose of your transportation?
// Col 3  = How many passengers will be traveling?
// Col 4  = Students' Full Name
// Col 5  = Students' D.O.B
// Col 6  = Students' Age
// Col 7  = Students' Phone # (if applicable)
// Col 8  = School/Program Name
// Col 9  = Column 37  (school address / extra — ignored)
// Col 10 = School/Program Point of Contact
// Col 11 = Students' Grade Level
// Col 12 = Transportation Type Needed
// Col 13 = Days of Transportation
// Col 14 = Time Request for services
// Col 15 = Time School Starts
// Col 16 = Time School Ends
// Col 17 = Pick up Location
// Col 18 = Drop off Location
// Col 19 = Start Date of Transportation
// Col 20 = Parent's Full Name
// Col 21 = Parent's Phone Number
// Col 22 = Parent's Home Address
// Col 23 = Does your child have any allergies or medical conditions…
// Col 24 = Emergency Contact
// Col 25 = Emergency Contact #
// Col 26 = Do you have any special requirements?
// Col 27 = Application Fee
// Col 28 = DRY RUN
// Col 29 = Meet & Greet
// Col 30 = Notes
// Col 31 = Weekly Rate
// Col 32 = Daily Rate
// Col 33–36 = Column 2/3/4/5 (extra / ignored)

const POS: Record<string, number> = {
  email: 1, purpose: 2, studentName: 4, studentDob: 5, studentAge: 6,
  studentPhone: 7, schoolName: 8, schoolContact: 10, gradeLevel: 11,
  transportType: 12, days: 13, timeRequest: 14, schoolStart: 15, schoolEnd: 16,
  pickup: 17, dropoff: 18, startDate: 19, parentName: 20, parentPhone: 21,
  parentAddress: 22, allergies: 23, emergencyContact: 24, emergencyPhone: 25,
  specialReqs: 26, appFee: 27, dryRun: 28, meetGreet: 29, notes: 30,
  weeklyRate: 31, dailyRate: 32,
};

// FIELD_MATCHERS — used only when a header row is pasted alongside the data.
// Needles are listed most-specific first so a substring match on a longer
// header doesn't steal a shorter one.
const FIELD_MATCHERS: Array<{ key: string; needles: string[] }> = [
  { key: 'email',            needles: ['email address', 'email'] },
  { key: 'purpose',          needles: ['purpose of your transportation', 'purpose'] },
  { key: 'studentName',      needles: ["students' full name", 'students full name', 'student full name'] },
  { key: 'studentDob',       needles: ["students' d.o.b", "d.o.b", 'dob', 'date of birth'] },
  { key: 'studentAge',       needles: ["students' age", 'student age'] },
  { key: 'studentPhone',     needles: ["students' phone #", "students' phone", 'student phone'] },
  { key: 'schoolName',       needles: ['school/program name', 'school name', 'program name'] },
  { key: 'schoolContact',    needles: ['school/program point of contact', 'point of contact'] },
  { key: 'gradeLevel',       needles: ["students' grade level", 'grade level', "students' grade"] },
  { key: 'transportType',    needles: ['transportation type needed', 'transportation type'] },
  { key: 'days',             needles: ['days of transportation', 'days of service'] },
  { key: 'timeRequest',      needles: ['time request for services', 'time request'] },
  { key: 'schoolStart',      needles: ['time school starts', 'school starts'] },
  { key: 'schoolEnd',        needles: ['time school ends', 'school ends'] },
  { key: 'pickup',           needles: ['pick up location', 'pickup location'] },
  { key: 'dropoff',          needles: ['drop off location', 'dropoff location'] },
  { key: 'startDate',        needles: ['start date of transportation', 'start date'] },
  { key: 'parentName',       needles: ["parent's full name", 'parents full name', 'parent full name'] },
  { key: 'parentPhone',      needles: ["parent's phone number", 'parents phone number', 'parents phone', 'parent phone'] },
  { key: 'parentAddress',    needles: ["parent's home address", 'parents home address', 'home address'] },
  { key: 'allergies',        needles: ['allergies or medical conditions', 'allergies'] },
  // emergencyPhone MUST come before emergencyContact (more specific)
  { key: 'emergencyPhone',   needles: ['emergency contact #', 'emergency contact number', 'emergency phone'] },
  { key: 'emergencyContact', needles: ['emergency contact'] },
  { key: 'specialReqs',      needles: ['special requirements'] },
  { key: 'appFee',           needles: ['application fee'] },
  { key: 'dryRun',           needles: ['dry run'] },
  { key: 'meetGreet',        needles: ['meet & greet', 'meet and greet', 'meet greet'] },
  { key: 'notes',            needles: ['notes'] },
  { key: 'weeklyRate',       needles: ['weekly rate'] },
  { key: 'dailyRate',        needles: ['daily rate'] },
];

function buildColMap(headers: string[]): ColMap {
  const map: ColMap = {};
  const usedIdx = new Set<number>();
  const normed = headers.map(nh);
  for (const { key, needles } of FIELD_MATCHERS) {
    for (let i = 0; i < normed.length; i++) {
      if (usedIdx.has(i)) continue;
      const h = normed[i];
      for (const needle of needles) {
        if (h.includes(nh(needle))) { map[key] = i; usedIdx.add(i); break; }
      }
      if (map[key] !== undefined) break;
    }
  }
  return map;
}

function isHeaderRow(row: string[]): boolean {
  const sample = row.slice(0, 8).join(' ').toLowerCase();
  return (
    sample.includes('email') || sample.includes('student') ||
    sample.includes('parent') || sample.includes('timestamp') ||
    sample.includes('transportation')
  );
}

/**
 * Parse raw pasted text.
 * - 2 rows (header + data): uses dynamic column map keyed by header names.
 * - 1 row (data only):      uses the canonical POS positional map.
 */
function parseInput(raw: string): { dataRow: string[]; colMap: ColMap | null } {
  const rows = parseTSV(raw.trim()).filter(r => r.some(c => c.trim()));
  if (!rows.length) return { dataRow: [], colMap: null };
  if (rows.length >= 2 && isHeaderRow(rows[0])) {
    return { dataRow: rows[1], colMap: buildColMap(rows[0]) };
  }
  return { dataRow: rows[0], colMap: null };
}

// ─── Shared value parsers ─────────────────────────────────────────────────────

const DAY_MAP: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

function parseTransportType(val: string): TransportationType {
  const v = val.toLowerCase();
  if (v.includes('round')) return 'roundtrip';
  if (v.includes('am') || v.includes('morning')) return 'am_only';
  if (v.includes('pm') || v.includes('afternoon')) return 'pm_only';
  if (v.includes('mid')) return 'midday';
  return 'roundtrip';
}

function parseDays(val: string): string[] {
  if (!val.trim()) return [];
  return val.split(/[,;/]/).map(s => {
    const t = s.trim();
    if (!t) return '';
    return DAY_MAP[t.toLowerCase().slice(0, 3)] ?? t;
  }).filter(Boolean);
}

function parseRate(val: string): string {
  const n = parseFloat(val.replace(/[$,\s]/g, ''));
  return isNaN(n) ? '' : String(n);
}

// ─── Row parser ───────────────────────────────────────────────────────────────

function parseRow(cells: string[], map: ColMap | null): {
  parent: ParentForm;
  students: StudentImport[];
  booking: BookingForm;
} {
  // When map is null (single data row pasted), fall back to canonical positions.
  const f = (key: string) =>
    (cells[(map ?? POS)[key] ?? -1] ?? '').trim();

  const primaryStudent: StudentImport = {
    name: f('studentName'), dob: f('studentDob'), age: f('studentAge'),
    phone: f('studentPhone'), schoolName: f('schoolName'),
    schoolContact: f('schoolContact'), grade: f('gradeLevel'),
    allergies: f('allergies'), specialRequirements: f('specialReqs'),
  };

  // Handle comma- or newline-separated student names in one cell
  const primaryNames = primaryStudent.name.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  let students: StudentImport[] = primaryNames.length > 1
    ? [{ ...primaryStudent, name: primaryNames[0] },
       ...primaryNames.slice(1).map(n => ({ ...BLANK_STUDENT, name: n }))]
    : [primaryStudent];
  students = students.filter(s => s.name);
  if (!students.length) students = [{ ...BLANK_STUDENT }];

  const parent: ParentForm = {
    name: f('parentName'), email: f('email'),
    phone: f('parentPhone'), address: f('parentAddress'),
  };

  const notesParts = [
    f('purpose')   ? `Purpose: ${f('purpose')}`         : '',
    f('dryRun')    ? `Dry Run: ${f('dryRun')}`           : '',
    f('meetGreet') ? `Meet & Greet: ${f('meetGreet')}` : '',
    f('notes'),
  ].filter(Boolean);

  return {
    parent, students,
    booking: {
      transportationType: parseTransportType(f('transportType')),
      daysOfWeek: parseDays(f('days')),
      pickupAddress: f('pickup'), dropoffAddress: f('dropoff'),
      schoolStartTime: f('schoolStart'), schoolEndTime: f('schoolEnd'),
      serviceStartDate: f('startDate'),
      weeklyRate: parseRate(f('weeklyRate')), dailyRate: parseRate(f('dailyRate')),
      emergencyContact: f('emergencyContact'), emergencyPhone: f('emergencyPhone'),
      applicationFeePaid: /yes|paid/i.test(f('appFee')),
      notes: notesParts.join('\n'),
    },
  };
}
// ─── Small UI helpers ──────────────────────────────────────────────────────

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{title}</h4>
    {children}
  </div>
);

const TwoCol: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
);

const Field: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  type?: string; multiline?: boolean;
}> = ({ label, value, onChange, type = 'text', multiline }) => (
  <div>
    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
      {label}
    </label>
    {multiline ? (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
      />
    ) : (
      <input
        type={type} value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    )}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const DAYS_ALL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const Import: React.FC = () => {
  const navigate = useNavigate();

  const [raw, setRaw] = useState('');
  const [parent, setParent] = useState<ParentForm>({ name: '', email: '', phone: '', address: '' });
  const [students, setStudents] = useState<StudentImport[]>([{ ...BLANK_STUDENT }]);
  const [booking, setBooking] = useState<BookingForm>(BLANK_BOOKING);
  const [importStatus, setImportStatus] = useState<BookingStatus>('new');
  const [parsed, setParsed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [importedName, setImportedName] = useState('');

  const handleParse = () => {
    const { dataRow, colMap } = parseInput(raw);
    if (!dataRow || dataRow.length < 5) {
      toast.error('Could not read data — paste the header row + data row together for best results.');
      return;
    }
    const result = parseRow(dataRow, colMap);
    setParent(result.parent);
    setStudents(result.students);
    setBooking(result.booking);
    setParsed(true);
    setTimeout(() => {
      document.getElementById('review-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleImport = async () => {
    if (!parent.name.trim()) { toast.error('Parent name is required'); return; }
    if (students.every(s => !s.name.trim())) { toast.error('At least one student name is required'); return; }

    setImporting(true);
    try {
      const batch = writeBatch(db);

      const clientRef = doc(collection(db, 'clients'));
      batch.set(clientRef, {
        name: parent.name,
        email: parent.email.trim().toLowerCase(),
        phone: parent.phone,
        address: parent.address,
        createdAt: serverTimestamp(),
      });

      const studentRefs = students
        .filter(s => s.name.trim())
        .map(s => {
          const ref = doc(collection(db, 'students'));
          batch.set(ref, {
            clientId: clientRef.id,
            name: s.name,
            dob: s.dob,
            age: parseInt(s.age) || 0,
            phone: s.phone,
            grade: s.grade,
            schoolName: s.schoolName,
            schoolContact: s.schoolContact,
            allergies: s.allergies,
            medicalNotes: '',
            specialRequirements: s.specialRequirements,
          });
          return ref;
        });

      const bookingRef = doc(collection(db, 'bookings'));
      batch.set(bookingRef, {
        clientId: clientRef.id,
        studentIds: studentRefs.map(r => r.id),
        pickupAddress: booking.pickupAddress,
        dropoffAddress: booking.dropoffAddress,
        transportationType: booking.transportationType,
        daysOfWeek: booking.daysOfWeek,
        schoolStartTime: booking.schoolStartTime,
        schoolEndTime: booking.schoolEndTime,
        serviceStartDate: booking.serviceStartDate,
        weeklyRate: parseFloat(booking.weeklyRate) || 0,
        dailyRate: parseFloat(booking.dailyRate) || 0,
        status: importStatus,
        applicationFeePaid: booking.applicationFeePaid,
        emergencyContact: booking.emergencyContact,
        emergencyPhone: booking.emergencyPhone,
        notes: booking.notes,
        mileage: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      setImportedName(parent.name);
      setDone(true);
      toast.success(`${parent.name} imported!`);
    } catch (err) {
      console.error(err);
      toast.error('Import failed — check the console for details.');
    }
    setImporting(false);
  };

  const resetForm = () => {
    setRaw('');
    setParent({ name: '', email: '', phone: '', address: '' });
    setStudents([{ ...BLANK_STUDENT }]);
    setBooking({ ...BLANK_BOOKING });
    setImportStatus('new');
    setParsed(false);
    setDone(false);
  };

  const setStudentField = (i: number, field: keyof StudentImport, val: string) =>
    setStudents(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

  const toggleDay = (day: string) =>
    setBooking(b => ({
      ...b,
      daysOfWeek: b.daysOfWeek.includes(day)
        ? b.daysOfWeek.filter(d => d !== day)
        : [...b.daysOfWeek, day],
    }));

  // ── Success screen ──
  if (done) {
    return (
      <div className="p-12 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
          <CheckCircle size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-1">{importedName} imported!</h2>
        <p className="text-slate-500 text-sm mb-6">
          Client, {students.filter(s => s.name).length} student(s), and booking created in Firestore.
        </p>
        <div className="flex gap-3">
          <button
            onClick={resetForm}
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-6 py-2.5 text-sm font-semibold"
          >
            Import Another
          </button>
          <button
            onClick={() => navigate('/admin/clients')}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl px-6 py-2.5 text-sm font-semibold"
          >
            View Clients
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-cyan-600 px-8 py-6">
        <h1 className="text-2xl font-bold text-white">Import from Google Sheets</h1>
        <p className="text-emerald-100 text-sm mt-0.5">
          Paste one client row — review &amp; edit, then save to Firestore
        </p>
      </div>

      <div className="p-8 max-w-3xl mx-auto space-y-8">

        {/* ── Step 1: Paste ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-1">
            <span className="w-6 h-6 bg-emerald-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">
              1
            </span>
            <h3 className="font-semibold text-slate-800">Paste a row from Google Sheets</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3 ml-9">
            Select the <strong>header row + the client row</strong> together (click the first row number,
            shift-click the data row number), then{' '}
            <kbd className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">Ctrl+C</kbd> and paste below.
            Including the header row lets the parser match columns by name regardless of order.
          </p>

          {/* Status selector */}
          <div className="ml-9 mb-4">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Pipeline Status
            </label>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'new',           label: 'New Application', color: 'bg-blue-100 text-blue-700 border-blue-200',       active: 'bg-blue-600 text-white border-blue-600'       },
                { value: 'under_review',  label: 'Under Review',    color: 'bg-amber-100 text-amber-700 border-amber-200',     active: 'bg-amber-500 text-white border-amber-500'     },
                { value: 'contract_sent', label: 'Contract Sent',   color: 'bg-purple-100 text-purple-700 border-purple-200', active: 'bg-purple-600 text-white border-purple-600'   },
                { value: 'active',        label: 'Active',          color: 'bg-emerald-100 text-emerald-700 border-emerald-200', active: 'bg-emerald-600 text-white border-emerald-600' },
                { value: 'paused',        label: 'Paused / Complete', color: 'bg-slate-100 text-slate-600 border-slate-200', active: 'bg-slate-500 text-white border-slate-500'     },
              ] as { value: BookingStatus; label: string; color: string; active: string }[]).map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setImportStatus(s.value)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                    importStatus === s.value ? s.active : s.color
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={raw}
            onChange={e => { setRaw(e.target.value); if (parsed) setParsed(false); }}
            rows={4}
            placeholder="Paste tab-separated row here…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-mono text-slate-600 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
          <button
            onClick={handleParse}
            disabled={!raw.trim()}
            className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-5 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <Upload size={15} />
            Parse Row
          </button>
        </div>

        {/* ── Step 2: Review ── */}
        {parsed && (
          <div id="review-section" className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 bg-emerald-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                2
              </span>
              <h3 className="font-semibold text-slate-800">Review &amp; edit before importing</h3>
            </div>

            {/* Parent */}
            <Section title="Parent / Guardian">
              <TwoCol>
                <Field label="Full Name *" value={parent.name} onChange={v => setParent(p => ({ ...p, name: v }))} />
                <Field label="Email" type="email" value={parent.email} onChange={v => setParent(p => ({ ...p, email: v }))} />
              </TwoCol>
              <TwoCol>
                <Field label="Phone" type="tel" value={parent.phone} onChange={v => setParent(p => ({ ...p, phone: v }))} />
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Home Address</label>
                  <AddressAutocomplete value={parent.address} onChange={v => setParent(p => ({ ...p, address: v }))} placeholder="Start typing an address…" />
                </div>
              </TwoCol>
            </Section>

            {/* Students */}
            <Section title="Students">
              {students.map((s, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-4 mb-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Student {i + 1}
                    </span>
                    {students.length > 1 && (
                      <button
                        onClick={() => setStudents(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Remove student"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <TwoCol>
                    <Field label="Full Name *" value={s.name} onChange={v => setStudentField(i, 'name', v)} />
                    <Field label="Date of Birth" value={s.dob} onChange={v => setStudentField(i, 'dob', v)} />
                  </TwoCol>
                  <TwoCol>
                    <Field label="Age" value={s.age} onChange={v => setStudentField(i, 'age', v)} />
                    <Field label="Grade" value={s.grade} onChange={v => setStudentField(i, 'grade', v)} />
                  </TwoCol>
                  <TwoCol>
                    <Field label="School / Program" value={s.schoolName} onChange={v => setStudentField(i, 'schoolName', v)} />
                    <Field label="School Contact" value={s.schoolContact} onChange={v => setStudentField(i, 'schoolContact', v)} />
                  </TwoCol>
                  <Field label="Allergies / Medical Conditions" value={s.allergies} onChange={v => setStudentField(i, 'allergies', v)} />
                  <Field label="Special Requirements" value={s.specialRequirements} onChange={v => setStudentField(i, 'specialRequirements', v)} />
                </div>
              ))}
              <button
                onClick={() => setStudents(prev => [...prev, { ...BLANK_STUDENT }])}
                className="text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-3 py-1.5 flex items-center gap-1.5 font-medium transition-colors"
              >
                <Plus size={13} /> Add Student
              </button>
            </Section>

            {/* Booking */}
            <Section title="Booking Details">
              <TwoCol>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Transport Type
                  </label>
                  <select
                    value={booking.transportationType}
                    onChange={e => setBooking(b => ({ ...b, transportationType: e.target.value as TransportationType }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="roundtrip">Roundtrip</option>
                    <option value="am_only">AM Only</option>
                    <option value="pm_only">PM Only</option>
                    <option value="midday">Midday</option>
                  </select>
                </div>
                <Field
                  label="Start Date"
                  value={booking.serviceStartDate}
                  onChange={v => setBooking(b => ({ ...b, serviceStartDate: v }))}
                />
              </TwoCol>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Days of Service
                </label>
                <div className="flex gap-2 flex-wrap">
                  {DAYS_ALL.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                        booking.daysOfWeek.includes(day)
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>

              <TwoCol>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Pickup Address</label>
                  <AddressAutocomplete value={booking.pickupAddress} onChange={v => setBooking(b => ({ ...b, pickupAddress: v }))} placeholder="Start typing a pickup address…" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Drop-off Address</label>
                  <AddressAutocomplete value={booking.dropoffAddress} onChange={v => setBooking(b => ({ ...b, dropoffAddress: v }))} placeholder="Start typing a drop-off address…" />
                </div>
              </TwoCol>
              <TwoCol>
                <Field label="School Start Time" value={booking.schoolStartTime} onChange={v => setBooking(b => ({ ...b, schoolStartTime: v }))} />
                <Field label="School End Time" value={booking.schoolEndTime} onChange={v => setBooking(b => ({ ...b, schoolEndTime: v }))} />
              </TwoCol>
              <TwoCol>
                <Field label="Weekly Rate ($)" type="number" value={booking.weeklyRate} onChange={v => setBooking(b => ({ ...b, weeklyRate: v }))} />
                <Field label="Daily Rate ($)" type="number" value={booking.dailyRate} onChange={v => setBooking(b => ({ ...b, dailyRate: v }))} />
              </TwoCol>
              <TwoCol>
                <Field label="Emergency Contact" value={booking.emergencyContact} onChange={v => setBooking(b => ({ ...b, emergencyContact: v }))} />
                <Field label="Emergency Phone" value={booking.emergencyPhone} onChange={v => setBooking(b => ({ ...b, emergencyPhone: v }))} />
              </TwoCol>
              <Field label="Notes" value={booking.notes} onChange={v => setBooking(b => ({ ...b, notes: v }))} multiline />
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={booking.applicationFeePaid}
                  onChange={e => setBooking(b => ({ ...b, applicationFeePaid: e.target.checked }))}
                  className="rounded accent-emerald-600"
                />
                Application fee paid
              </label>
            </Section>

            {/* Import button */}
            <div className="flex justify-end gap-3 pb-6">
              <button
                onClick={resetForm}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition-colors"
              >
                Start Over
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-6 py-2.5 text-sm font-bold disabled:opacity-60 transition-colors"
              >
                {importing
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Upload size={16} />}
                {importing ? 'Importing…' : 'Import to Firestore'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Import;
