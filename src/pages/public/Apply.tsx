import React, { useReducer } from 'react';
import StudentSection from '../../components/forms/StudentSection';
import type { StudentForm } from '../../components/forms/StudentSection';
import { computeWeeklyCharge } from '../../utils/pricing';
import { getMileage } from '../../services/mileageService';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { db } from '../../services/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Bus } from 'lucide-react';

type Purpose = 'School' | 'Childcare' | 'Medical' | 'Other' | '';
type TransportationType = 'roundtrip' | 'am_only' | 'pm_only' | 'midday' | '';

interface ParentInfo {
	fullName: string;
	phone: string;
	email: string;
	address: string;
}

interface MedicalInfo {
	allergies: string;
	specialRequirements: string;
	emergencyContactName: string;
	emergencyContactPhone: string;
	emergencyContactRelationship: string;
}

interface ApplyFormState {
	step: number;
	purpose: Purpose;
	numStudents: number;
	students: StudentForm[];
	pickupAddress: string;
	dropoffAddress: string;
	mileage: number | null;
	mileageEditable: boolean;
	mileageLoading: boolean;
	transportationType: TransportationType;
	daysOfWeek: string[];
	schoolStartTime: string;
	schoolEndTime: string;
	serviceStartDate: string;
	parent: ParentInfo;
	medical: MedicalInfo;
	errors: Record<string, string>;
	submitError: string | null;
	submitting: boolean;
	submitted: boolean;
}

const initialStudent: StudentForm = {
	fullName: '',
	dob: '',
	age: 0,
	grade: '',
	schoolName: '',
	schoolContact: '',
	phone: '',
};

const initialState: ApplyFormState = {
	step: 1,
	purpose: '',
	numStudents: 1,
	students: [initialStudent],
	pickupAddress: '',
	dropoffAddress: '',
	mileage: null,
	mileageEditable: false,
	mileageLoading: false,
	transportationType: '',
	daysOfWeek: [],
	schoolStartTime: '',
	schoolEndTime: '',
	serviceStartDate: '',
	parent: { fullName: '', phone: '', email: '', address: '' },
	medical: { allergies: '', specialRequirements: '', emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '' },
	errors: {},
	submitError: null,
	submitting: false,
	submitted: false,
};

type Action =
	| { type: 'NEXT_STEP' }
	| { type: 'PREV_STEP' }
	| { type: 'SET_PURPOSE'; value: Purpose }
	| { type: 'SET_NUM_STUDENTS'; value: number }
	| { type: 'UPDATE_STUDENT'; index: number; value: StudentForm }
	| { type: 'SET_PICKUP'; value: string }
	| { type: 'SET_DROPOFF'; value: string }
	| { type: 'SET_MILEAGE_LOADING'; value: boolean }
	| { type: 'SET_MILEAGE'; value: number | null }
	| { type: 'SET_MILEAGE_EDITABLE'; value: boolean }
	| { type: 'SET_TRANSPORT_TYPE'; value: TransportationType }
	| { type: 'TOGGLE_DAY'; value: string }
	| { type: 'SET_SCHOOL_START'; value: string }
	| { type: 'SET_SCHOOL_END'; value: string }
	| { type: 'SET_SERVICE_DATE'; value: string }
	| { type: 'SET_PARENT'; value: Partial<ParentInfo> }
	| { type: 'SET_MEDICAL'; value: Partial<MedicalInfo> }
	| { type: 'SET_ERRORS'; value: Record<string, string> }
	| { type: 'SET_SUBMIT_ERROR'; value: string | null }
	| { type: 'SET_SUBMITTING'; value: boolean }
	| { type: 'SET_SUBMITTED'; value: boolean }
	| { type: 'RESET' };

function reducer(state: ApplyFormState, action: Action): ApplyFormState {
	switch (action.type) {
		case 'NEXT_STEP':
			return { ...state, step: state.step + 1, errors: {} };
		case 'PREV_STEP':
			return { ...state, step: state.step - 1, errors: {} };
		case 'SET_PURPOSE':
			return { ...state, purpose: action.value };
		case 'SET_NUM_STUDENTS': {
			let students = state.students.slice(0, action.value);
			while (students.length < action.value) students.push({ ...initialStudent });
			return { ...state, numStudents: action.value, students };
		}
		case 'UPDATE_STUDENT': {
			const students = [...state.students];
			students[action.index] = action.value;
			return { ...state, students };
		}
		case 'SET_PICKUP':
			return { ...state, pickupAddress: action.value };
		case 'SET_DROPOFF':
			return { ...state, dropoffAddress: action.value };
		case 'SET_MILEAGE_LOADING':
			return { ...state, mileageLoading: action.value };
		case 'SET_MILEAGE':
			return { ...state, mileage: action.value };
		case 'SET_MILEAGE_EDITABLE':
			return { ...state, mileageEditable: action.value };
		case 'SET_TRANSPORT_TYPE':
			return { ...state, transportationType: action.value };
		case 'TOGGLE_DAY': {
			const found = state.daysOfWeek.includes(action.value);
			const days = found ? state.daysOfWeek.filter(d => d !== action.value) : [...state.daysOfWeek, action.value];
			return { ...state, daysOfWeek: days };
		}
		case 'SET_SCHOOL_START':
			return { ...state, schoolStartTime: action.value };
		case 'SET_SCHOOL_END':
			return { ...state, schoolEndTime: action.value };
		case 'SET_SERVICE_DATE':
			return { ...state, serviceStartDate: action.value };
		case 'SET_PARENT':
			return { ...state, parent: { ...state.parent, ...action.value } };
		case 'SET_MEDICAL':
			return { ...state, medical: { ...state.medical, ...action.value } };
		case 'SET_ERRORS':
			return { ...state, errors: action.value };
		case 'SET_SUBMIT_ERROR':
			return { ...state, submitError: action.value };
		case 'SET_SUBMITTING':
			return { ...state, submitting: action.value };
		case 'SET_SUBMITTED':
			return { ...state, submitted: action.value };
		case 'RESET':
			return { ...initialState };
		default:
			return state;
	}
}

function stripDigits(input: string) {
	return input.replace(/\D/g, '');
}

function isValidEmail(email: string) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const StepTitles = [
	'Purpose & Passengers',
	'Student Info',
	'Route Details',
	'Schedule',
	'Parent / Guardian',
	'Medical & Emergency',
	'Review & Submit',
];

const daysList = ['monday','tuesday','wednesday','thursday','friday'];

const Apply: React.FC = () => {
	const [state, dispatch] = useReducer(reducer, initialState);

	// Compute pricing when mileage / schedule changes
	const pricing = (() => {
		if (!state.mileage || state.mileage <= 0) return null;
		const daysPerWeek = state.daysOfWeek.length;
		const isRoundTrip = state.transportationType === 'roundtrip';
		if (!state.transportationType || daysPerWeek === 0) return { weekly: null, daily: null };
		const result = computeWeeklyCharge(state.mileage, daysPerWeek, isRoundTrip, state.numStudents);
		return result;
	})();

	// Helpers: validation per step
	const validateStep = (step: number) => {
		const errors: Record<string,string> = {};
		if (step === 1) {
			if (!state.purpose) errors['purpose'] = 'Please select a purpose';
			if (!state.numStudents || state.numStudents < 1) errors['numStudents'] = 'Select number of students';
		}
		if (step === 2) {
			state.students.forEach((s, idx) => {
				const base = `student_${idx}_`;
				if (!s.fullName || s.fullName.trim() === '') errors[base + 'fullName'] = 'Required';
				if (!s.dob) errors[base + 'dob'] = 'DOB required';
				else {
					const birth = new Date(s.dob);
					if (isNaN(birth.getTime())) errors[base + 'dob'] = 'Invalid date';
					const age = s.age;
					if (age < 3 || age > 18) errors[base + 'dob'] = 'Student must be between 3 and 18 years old';
				}
				if (!s.grade) errors[base + 'grade'] = 'Required';
				if (!s.schoolName) errors[base + 'schoolName'] = 'Required';
				if (!s.schoolContact) errors[base + 'schoolContact'] = 'Required';
				if (s.phone) {
					const digits = stripDigits(s.phone);
					if (digits.length < 10) errors[base + 'phone'] = 'Phone must have at least 10 digits';
				}
			});
		}
		if (step === 3) {
			if (!state.pickupAddress) errors['pickupAddress'] = 'Required';
			if (!state.dropoffAddress) errors['dropoffAddress'] = 'Required';
			if (state.mileage === null) errors['mileage'] = 'Distance required';
		}
		if (step === 4) {
			if (!state.transportationType) errors['transportationType'] = 'Select transportation type';
			if (state.daysOfWeek.length === 0) errors['daysOfWeek'] = 'Select at least one day';
			if (!state.schoolStartTime) errors['schoolStartTime'] = 'Required';
			if (!state.schoolEndTime) errors['schoolEndTime'] = 'Required';
			if (!state.serviceStartDate) errors['serviceStartDate'] = 'Required';
		}
		if (step === 5) {
			if (!state.parent.fullName) errors['parent_fullName'] = 'Required';
			if (!state.parent.email || !isValidEmail(state.parent.email)) errors['parent_email'] = 'Valid email required';
			const digits = stripDigits(state.parent.phone || '');
			if (!digits || digits.length < 10) errors['parent_phone'] = 'Phone must have at least 10 digits';
			if (!state.parent.address) errors['parent_address'] = 'Required';
		}
		if (step === 6) {
			if (!state.medical.allergies) errors['allergies'] = 'Required';
			if (!state.medical.emergencyContactName) errors['emergencyContactName'] = 'Required';
			const edigits = stripDigits(state.medical.emergencyContactPhone || '');
			if (!edigits || edigits.length < 10) errors['emergencyContactPhone'] = 'Phone must have at least 10 digits';
			if (!state.medical.emergencyContactRelationship) errors['emergencyContactRelationship'] = 'Required';
		}
		return errors;
	};

	const resetForm = () => dispatch({ type: 'RESET' });
	const updateStudent = (index: number, value: StudentForm) => dispatch({ type: 'UPDATE_STUDENT', index, value });



	const tryFetchMileage = async (pickup?: string | null, dropoff?: string | null) => {
		if (!pickup || !dropoff) return;
		dispatch({ type: 'SET_MILEAGE_LOADING', value: true });
		try {
			const miles = await getMileage(pickup, dropoff);
			dispatch({ type: 'SET_MILEAGE', value: miles });
		} catch {
			dispatch({ type: 'SET_MILEAGE', value: null });
		} finally {
			dispatch({ type: 'SET_MILEAGE_LOADING', value: false });
		}
	};

	const onPickupChange = (val: string) => {
		dispatch({ type: 'SET_PICKUP', value: val });
	};
	const onPickupSelect = (val: string) => {
		if (state.dropoffAddress) tryFetchMileage(val, state.dropoffAddress);
	};
	const onDropoffChange = (val: string) => {
		dispatch({ type: 'SET_DROPOFF', value: val });
	};
	const onDropoffSelect = (val: string) => {
		if (state.pickupAddress) tryFetchMileage(state.pickupAddress, val);
	};

	const goNext = async () => {
		const errs = validateStep(state.step);
		if (Object.keys(errs).length) { dispatch({ type: 'SET_ERRORS', value: errs }); return; }
		if (state.step === 3) await tryFetchMileage(state.pickupAddress, state.dropoffAddress);
		dispatch({ type: 'NEXT_STEP' });
	};
	const goPrev = () => dispatch({ type: 'PREV_STEP' });

	const handleSubmit = async () => {
		const errs = validateStep(state.step);
		if (Object.keys(errs).length) { dispatch({ type: 'SET_ERRORS', value: errs }); return; }
		dispatch({ type: 'SET_SUBMITTING', value: true });
		try {
			const trimmedEmail = state.parent.email.trim().toLowerCase();
			// Always create a new client doc from public form (no auth = no read access to check dupes).
			// Admin can merge duplicates later from the Clients page.
			const clientRef = await addDoc(collection(db, 'clients'), {
				name: state.parent.fullName, phone: state.parent.phone, email: trimmedEmail,
				address: state.parent.address, createdAt: serverTimestamp(),
			});
			const clientId = clientRef.id;
			const studentIds = await Promise.all(state.students.map(async (s) => {
				const ref = await addDoc(collection(db, 'students'), {
					name: s.fullName, dob: s.dob, age: s.age, grade: s.grade,
					schoolName: s.schoolName, schoolContact: s.schoolContact, phone: s.phone || '',
					allergies: state.medical.allergies, medicalNotes: state.medical.specialRequirements,
					clientId, createdAt: serverTimestamp(),
				});
				return ref.id;
			}));
			await addDoc(collection(db, 'bookings'), {
				clientId, studentIds,
				pickupAddress: state.pickupAddress, dropoffAddress: state.dropoffAddress,
				mileage: state.mileage ?? 0, transportationType: state.transportationType,
				daysOfWeek: state.daysOfWeek, schoolStartTime: state.schoolStartTime,
				schoolEndTime: state.schoolEndTime, serviceStartDate: state.serviceStartDate,
				emergencyContact: state.medical.emergencyContactName,
				emergencyPhone: state.medical.emergencyContactPhone,
				emergencyContactRelationship: state.medical.emergencyContactRelationship,
				transportationPurpose: state.purpose === 'Childcare' ? 'Daycare' : state.purpose === 'Medical' ? 'Other' : (state.purpose || 'School'),
				purpose: state.purpose,
				status: 'new', weeklyRate: pricing?.weekly ?? 0, dailyRate: pricing?.daily ?? 0,
				applicationFeePaid: false, notes: '', createdAt: serverTimestamp(),
			});
			dispatch({ type: 'SET_SUBMITTED', value: true });
		} catch {
			dispatch({ type: 'SET_SUBMIT_ERROR', value: 'Submission failed. Please try again.' });
		} finally {
			dispatch({ type: 'SET_SUBMITTING', value: false });
		}
	};

	// â”€â”€ field class helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
	const inputCls = 'w-full rounded-lg border border-kidz-border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-kidz-blue focus:border-transparent transition';
	const labelCls = 'text-sm font-medium text-kidz-textPrimary mb-1 block';
	const errCls = 'text-red-500 text-xs mt-1';

	// â”€â”€ step renderers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
	const renderStep1 = () => (
		<div className="flex flex-col gap-5">
			<div>
				<label className={labelCls}>Transportation Purpose</label>
				<select className={inputCls} value={state.purpose} onChange={e => dispatch({ type: 'SET_PURPOSE', value: e.target.value as Purpose })}>
					<option value="">Select purpose</option>
					<option value="School">School</option>
					<option value="Childcare">Childcare</option>
					<option value="Medical">Medical</option>
					<option value="Other">Other</option>
				</select>
				{state.errors['purpose'] && <div className={errCls}>{state.errors['purpose']}</div>}
			</div>
			<div>
				<label className={labelCls}>Number of Students</label>
				<div className="flex gap-2">
					{[1, 2, 3, 4].map(n => (
						<button key={n} type="button"
							className={`px-5 py-2.5 rounded-lg border text-sm font-medium transition ${state.numStudents === n ? 'bg-kidz-blue text-white border-kidz-blue' : 'bg-white text-kidz-textPrimary border-kidz-border hover:border-kidz-blue'}`}
							onClick={() => dispatch({ type: 'SET_NUM_STUDENTS', value: n })}>
							{n}
						</button>
					))}
				</div>
				{state.errors['numStudents'] && <div className={errCls}>{state.errors['numStudents']}</div>}
			</div>
		</div>
	);

	const renderStep2 = () => (
		<div className="flex flex-col gap-5">
			{state.students.map((student, idx) => (
				<StudentSection key={idx} index={idx} value={student} onChange={updateStudent}
					errors={{
						fullName: state.errors[`student_${idx}_fullName`],
						dob: state.errors[`student_${idx}_dob`],
						age: state.errors[`student_${idx}_dob`],
						grade: state.errors[`student_${idx}_grade`],
						schoolName: state.errors[`student_${idx}_schoolName`],
						schoolContact: state.errors[`student_${idx}_schoolContact`],
						phone: state.errors[`student_${idx}_phone`],
					}}
				/>
			))}
		</div>
	);

	const renderStep3 = () => (
		<div className="flex flex-col gap-5">
			<div>
				<label className={labelCls}>Pickup Address</label>
				<AddressAutocomplete value={state.pickupAddress} onChange={onPickupChange} onSelect={onPickupSelect}
					placeholder="Start typing an address…" className={inputCls} />
				{state.errors['pickupAddress'] && <div className={errCls}>{state.errors['pickupAddress']}</div>}
			</div>
			<div>
				<label className={labelCls}>Dropoff Address</label>
				<AddressAutocomplete value={state.dropoffAddress} onChange={onDropoffChange} onSelect={onDropoffSelect}
					placeholder="Start typing an address…" className={inputCls} />
				{state.errors['dropoffAddress'] && <div className={errCls}>{state.errors['dropoffAddress']}</div>}
			</div>
			<div>
				<label className={labelCls}>Estimated Distance (miles)</label>
				{state.mileageLoading ? (
					<div className="flex items-center gap-2 text-sm text-kidz-textMuted">
						<svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
						Fetching distanceâ€¦
					</div>
				) : (
					<input type="number" step="0.1"
						className={`${inputCls} ${state.mileageEditable ? '' : 'bg-slate-50 text-kidz-textMuted'}`}
						value={state.mileage ?? ''}
						onChange={e => dispatch({ type: 'SET_MILEAGE', value: e.target.value ? Number(e.target.value) : null })}
						readOnly={!state.mileageEditable} />
				)}
				{state.errors['mileage'] && <div className={errCls}>{state.errors['mileage']}</div>}
			</div>
			{state.pickupAddress && state.dropoffAddress && (
				<div className="bg-kidz-amberLight border-l-4 border-kidz-amber rounded-r-xl p-4">
					<div className="text-xs font-semibold text-kidz-amber uppercase mb-2">Estimated Pricing</div>
					{pricing ? (
						<>
							<div className="text-2xl font-bold text-kidz-navy">${pricing.weekly?.toFixed(2)}<span className="text-sm font-normal text-kidz-textMuted">/week</span></div>
							<div className="text-sm text-kidz-textSecondary mt-0.5">${pricing.daily?.toFixed(2)} / day</div>
						</>
					) : (
						<div className="text-sm text-kidz-textMuted">Complete schedule (step 4) to see rate estimate.</div>
					)}
					<div className="text-xs text-kidz-textMuted mt-2">Final rate confirmed by KIDZ admin.</div>
				</div>
			)}
		</div>
	);

	const renderStep4 = () => (
		<div className="flex flex-col gap-5">
			<div>
				<label className={labelCls}>Transportation Type</label>
				<div className="grid grid-cols-2 gap-2">
					{(['roundtrip', 'am_only', 'pm_only', 'midday'] as TransportationType[]).map(t => (
						<label key={t} className={`flex items-center gap-2 px-4 py-3 border rounded-lg cursor-pointer text-sm transition ${state.transportationType === t ? 'bg-kidz-blueLight border-kidz-blue text-kidz-blue font-medium' : 'border-kidz-border hover:border-kidz-blue'}`}>
							<input type="radio" name="type" className="hidden" checked={state.transportationType === t} onChange={() => dispatch({ type: 'SET_TRANSPORT_TYPE', value: t })} />
							{t === 'roundtrip' ? 'Roundtrip' : t === 'am_only' ? 'AM Only' : t === 'pm_only' ? 'PM Only' : 'Midday'}
						</label>
					))}
				</div>
				{state.errors['transportationType'] && <div className={errCls}>{state.errors['transportationType']}</div>}
			</div>
			<div>
				<label className={labelCls}>Days of Week</label>
				<div className="flex gap-2 flex-wrap">
					{daysList.map(d => (
						<label key={d} className={`px-3 py-2 border rounded-lg cursor-pointer text-sm font-medium transition ${state.daysOfWeek.includes(d) ? 'bg-kidz-blue text-white border-kidz-blue' : 'border-kidz-border hover:border-kidz-blue'}`}>
							<input type="checkbox" className="hidden" checked={state.daysOfWeek.includes(d)} onChange={() => dispatch({ type: 'TOGGLE_DAY', value: d })} />
							{d[0].toUpperCase() + d.slice(1, 3)}
						</label>
					))}
				</div>
				{state.errors['daysOfWeek'] && <div className={errCls}>{state.errors['daysOfWeek']}</div>}
			</div>
			<div>
				<label className={labelCls}>School Start Time</label>
				<input type="time" className={inputCls} value={state.schoolStartTime} onChange={e => dispatch({ type: 'SET_SCHOOL_START', value: e.target.value })} />
				{state.errors['schoolStartTime'] && <div className={errCls}>{state.errors['schoolStartTime']}</div>}
			</div>
			<div>
				<label className={labelCls}>School End Time</label>
				<input type="time" className={inputCls} value={state.schoolEndTime} onChange={e => dispatch({ type: 'SET_SCHOOL_END', value: e.target.value })} />
				{state.errors['schoolEndTime'] && <div className={errCls}>{state.errors['schoolEndTime']}</div>}
			</div>
			<div>
				<label className={labelCls}>Requested Service Start Date</label>
				<input type="date" className={inputCls} value={state.serviceStartDate} onChange={e => dispatch({ type: 'SET_SERVICE_DATE', value: e.target.value })} />
				{state.errors['serviceStartDate'] && <div className={errCls}>{state.errors['serviceStartDate']}</div>}
			</div>
		</div>
	);

	const renderStep5 = () => (
		<div className="flex flex-col gap-5">
			<div><label className={labelCls}>Full Name</label>
				<input className={inputCls} value={state.parent.fullName} onChange={e => dispatch({ type: 'SET_PARENT', value: { fullName: e.target.value } })} />
				{state.errors['parent_fullName'] && <div className={errCls}>{state.errors['parent_fullName']}</div>}
			</div>
			<div><label className={labelCls}>Phone</label>
				<input className={inputCls} value={state.parent.phone} onChange={e => dispatch({ type: 'SET_PARENT', value: { phone: e.target.value } })} />
				{state.errors['parent_phone'] && <div className={errCls}>{state.errors['parent_phone']}</div>}
			</div>
			<div><label className={labelCls}>Email</label>
				<input type="email" className={inputCls} value={state.parent.email} onChange={e => dispatch({ type: 'SET_PARENT', value: { email: e.target.value } })} />
				{state.errors['parent_email'] && <div className={errCls}>{state.errors['parent_email']}</div>}
			</div>
			<div><label className={labelCls}>Home Address</label>
				<AddressAutocomplete value={state.parent.address} onChange={v => dispatch({ type: 'SET_PARENT', value: { address: v } })}
					placeholder="Start typing an address…" className={inputCls} />
				{state.errors['parent_address'] && <div className={errCls}>{state.errors['parent_address']}</div>}
			</div>
		</div>
	);

	const renderStep6 = () => (
		<div className="flex flex-col gap-5">
			<div><label className={labelCls}>Allergies / Medical Conditions</label>
				<textarea rows={3} className={inputCls} value={state.medical.allergies} onChange={e => dispatch({ type: 'SET_MEDICAL', value: { allergies: e.target.value } })} />
				{state.errors['allergies'] && <div className={errCls}>{state.errors['allergies']}</div>}
			</div>
			<div><label className={labelCls}>Special Requirements <span className="text-kidz-textMuted font-normal">(optional)</span></label>
				<textarea rows={3} className={inputCls} value={state.medical.specialRequirements} onChange={e => dispatch({ type: 'SET_MEDICAL', value: { specialRequirements: e.target.value } })} />
			</div>
			<div><label className={labelCls}>Emergency Contact Name</label>
				<input className={inputCls} value={state.medical.emergencyContactName} onChange={e => dispatch({ type: 'SET_MEDICAL', value: { emergencyContactName: e.target.value } })} />
				{state.errors['emergencyContactName'] && <div className={errCls}>{state.errors['emergencyContactName']}</div>}
			</div>
			<div><label className={labelCls}>Emergency Contact Phone</label>
				<input className={inputCls} value={state.medical.emergencyContactPhone} onChange={e => dispatch({ type: 'SET_MEDICAL', value: { emergencyContactPhone: e.target.value } })} />
				{state.errors['emergencyContactPhone'] && <div className={errCls}>{state.errors['emergencyContactPhone']}</div>}
			</div>
			<div><label className={labelCls}>Relationship to Student</label>
				<input className={inputCls} value={state.medical.emergencyContactRelationship} onChange={e => dispatch({ type: 'SET_MEDICAL', value: { emergencyContactRelationship: e.target.value } })} placeholder="e.g. Aunt, Grandparent, Family Friend" />
				{state.errors['emergencyContactRelationship'] && <div className={errCls}>{state.errors['emergencyContactRelationship']}</div>}
			</div>
		</div>
	);

	const renderStep7 = () => (
		<div className="flex flex-col gap-5">
			<div className="bg-kidz-gray rounded-xl p-4">
				<div className="text-xs font-semibold text-kidz-textMuted uppercase mb-2">Parent / Guardian</div>
				<div className="text-sm font-medium text-kidz-textPrimary">{state.parent.fullName}</div>
				<div className="text-sm text-kidz-textSecondary">{state.parent.phone} Â· {state.parent.email}</div>
				<div className="text-sm text-kidz-textSecondary">{state.parent.address}</div>
			</div>
			<div className="bg-kidz-gray rounded-xl p-4">
				<div className="text-xs font-semibold text-kidz-textMuted uppercase mb-2">Students</div>
				{state.students.map((s, i) => (
					<div key={i} className="mb-2">
						<div className="text-sm font-medium text-kidz-textPrimary">{s.fullName}</div>
						<div className="text-xs text-kidz-textSecondary">Grade {s.grade} Â· {s.schoolName}</div>
					</div>
				))}
			</div>
			<div className="bg-kidz-gray rounded-xl p-4">
				<div className="text-xs font-semibold text-kidz-textMuted uppercase mb-2">Route &amp; Schedule</div>
				<div className="text-sm text-kidz-textSecondary">{state.pickupAddress} â†’ {state.dropoffAddress}</div>
				<div className="text-sm text-kidz-textSecondary">{state.transportationType} Â· {state.daysOfWeek.join(', ')}</div>
				{pricing && <div className="text-sm font-semibold text-kidz-navy mt-1">${pricing.weekly?.toFixed(2)}/week</div>}
			</div>
			<div className="text-sm text-kidz-textMuted bg-kidz-amberLight border-l-4 border-kidz-amber rounded-r-lg p-3">
				$40 non-refundable application fee required to begin processing.
			</div>
			{state.submitError && <div className="text-red-500 text-sm">{state.submitError}</div>}
		</div>
	);

	const stepRenderers = [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6, renderStep7];
	const stepSubtitles = [
		'Start by telling us your purpose and passengers.',
		'Provide details about the student(s).',
		'Tell us the pickup and dropoff locations.',
		'Set the schedule and days of service.',
		'Parent or guardian contact information.',
		'Medical info and emergency contact.',
		'Review your application before submitting.',
	];

	if (state.submitted) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-kidz-navy to-blue-800 flex items-center justify-center px-4">
				<div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-10 text-center">
					<svg xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-4 text-green-500" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
					<h2 className="text-2xl font-bold text-kidz-navy mb-2">Application Received!</h2>
					<p className="text-kidz-textSecondary mb-4">KIDZ Transportation will contact you within 2 business days.</p>
					<div className="mb-6">{state.students.map((s, i) => <div key={i} className="text-kidz-amber font-bold">{s.fullName}</div>)}</div>
					<button className="w-full bg-kidz-blue text-white rounded-xl py-3 font-semibold text-sm hover:bg-blue-700 transition" onClick={resetForm}>Submit Another Application</button>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-kidz-navy to-blue-800 flex flex-col">
			<div className="bg-kidz-navy px-6 py-4 flex items-center gap-3">
				<div className="w-10 h-10 bg-kidz-amber flex items-center justify-center rounded">
					<Bus className="text-white" size={24} />
				</div>
				<div>
					<div className="text-white font-bold">KIDZ Transportation Services</div>
					<div className="text-amber-300 text-sm">Your Child Is Precious Cargo</div>
				</div>
			</div>
			<div className="max-w-2xl mx-auto w-full px-4 py-8">
				<div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
					{/* Step Indicator */}
					<div className="flex items-center px-8 pt-6 pb-4">
						{StepTitles.map((_t, index) => (
							<React.Fragment key={index}>
								<div className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full text-xs font-semibold ${
									state.step > index + 1 ? 'bg-kidz-amber text-white'
									: state.step === index + 1 ? 'bg-kidz-blue text-white ring-4 ring-blue-100'
									: 'bg-slate-200 text-slate-500'
								}`}>{index + 1}</div>
								{index < StepTitles.length - 1 && (
									<div className={`flex-1 h-0.5 ${state.step > index + 1 ? 'bg-kidz-amber' : 'bg-slate-200'}`} />
								)}
							</React.Fragment>
						))}
					</div>
					{/* Step title */}
					<div className="text-center px-8 pb-4">
						<h2 className="text-xl font-bold text-kidz-textPrimary">{StepTitles[state.step - 1]}</h2>
						<p className="text-sm text-kidz-textSecondary mt-1">{stepSubtitles[state.step - 1]}</p>
					</div>
					{/* Form body */}
					<div className="px-8 pb-6">
						{stepRenderers[state.step - 1]?.()}
					</div>
					{/* Navigation */}
					<div className="flex gap-3 px-8 pb-8">
						{state.step > 1 && (
							<button className="flex-1 bg-transparent text-kidz-textSecondary border border-kidz-border rounded-xl py-3 text-sm hover:bg-slate-50 transition"
								onClick={goPrev} disabled={state.submitting}>Back</button>
						)}
						{state.step < StepTitles.length ? (
							<button className="flex-1 bg-kidz-blue text-white rounded-xl py-3.5 font-semibold text-sm hover:bg-blue-700 active:scale-[0.98] transition-all"
								onClick={goNext}>Next</button>
						) : (
							<button className="flex-1 bg-kidz-blue text-white rounded-xl py-3.5 font-semibold text-sm hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-60"
								onClick={handleSubmit} disabled={state.submitting}>
								{state.submitting ? 'Submittingâ€¦' : 'Submit Application'}
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};

export default Apply;
