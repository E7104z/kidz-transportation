// W2PayStubForm.tsx
// Modal form for creating a W-2 employee pay stub.
// All withholding amounts are auto-calculated from the gross salary
// using St. Louis County, Missouri resident tax rates.
// Fields remain editable so the user can override any computed value.

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createW2PayStub } from '../../services/w2PayStubService';
import { formatDollar } from '../../utils/pricing';
import { computeTaxWithholdings } from '../../utils/taxes';
import type { TaxInput } from '../../utils/taxes';
import toast from 'react-hot-toast';

interface W2PayStubFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const W2PayStubForm: React.FC<W2PayStubFormProps> = ({ open, onClose, onSaved }) => {
  const { user } = useAuth();

  // Personal & Check Information
  const [employeeName, setEmployeeName] = useState('Kara Noland');
  const [employeeAddress, setEmployeeAddress] = useState('1326 Mount Olive Ave');
  const [employeeCity, setEmployeeCity] = useState('Saint Louis');
  const [employeeState, setEmployeeState] = useState('MO');
  const [employeeZip, setEmployeeZip] = useState('63130-1519');
  const [companyName, setCompanyName] = useState('KIDZ Transportation Services LLC');
  const [companyAddress, setCompanyAddress] = useState('929 North Spring Avenue');
  const [companyCity, setCompanyCity] = useState('Saint Louis');
  const [companyState, setCompanyState] = useState('MO');
  const [companyZip, setCompanyZip] = useState('63108');
  const [companyPhone, setCompanyPhone] = useState('(314) 425-9668');
  const [payPeriodStart, setPayPeriodStart] = useState('');
  const [payPeriodEnd, setPayPeriodEnd] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [checkNumber, setCheckNumber] = useState('');

  // Tax calculation config
  const [filingStatus, setFilingStatus] = useState<'single' | 'married'>('single');
  const [payPeriodsPerYear, setPayPeriodsPerYear] = useState<number>(26); // biweekly default

  // Earnings
  const [grossSalary, setGrossSalary] = useState<number>(0);
  const [ytdGrossSalary, setYtdGrossSalary] = useState<number>(0);

  // Withholdings — initialized by auto-calculation, editable by user
  const [socialSecurity, setSocialSecurity] = useState<number>(0);
  const [medicare, setMedicare] = useState<number>(0);
  const [federalIncomeTax, setFederalIncomeTax] = useState<number>(0);
  const [moIncomeTax, setMoIncomeTax] = useState<number>(0);
  const [moStlouIncomeTax, setMoStlouIncomeTax] = useState<number>(0);

  // YTD Withholdings
  const [ytdSocialSecurity, setYtdSocialSecurity] = useState<number>(0);
  const [ytdMedicare, setYtdMedicare] = useState<number>(0);
  const [ytdFederalIncomeTax, setYtdFederalIncomeTax] = useState<number>(0);
  const [ytdMoIncomeTax, setYtdMoIncomeTax] = useState<number>(0);
  const [ytdMoStlouIncomeTax, setYtdMoStlouIncomeTax] = useState<number>(0);

  // Tracks whether the user has manually edited any withholding field.
  // When true, auto-calculation is disabled for that field.
  const [manualOverride, setManualOverride] = useState(false);
  const overrideRef = useRef(false);

  const [saving, setSaving] = useState(false);

  // ── Auto-calculate withholdings from gross salary ────────────────────────

  const taxInput: TaxInput = useMemo(
    () => ({
      grossSalary,
      ytdGrossSalary: ytdGrossSalary || grossSalary,
      filingStatus,
      payPeriodsPerYear,
    }),
    [grossSalary, ytdGrossSalary, filingStatus, payPeriodsPerYear],
  );

  const computedTaxes = useMemo(
    () => computeTaxWithholdings(taxInput),
    [taxInput],
  );

  // Apply computed taxes to state whenever gross changes AND user hasn't
  // manually overridden.
  useEffect(() => {
    if (grossSalary <= 0) {
      if (!overrideRef.current) {
        setSocialSecurity(0);
        setMedicare(0);
        setFederalIncomeTax(0);
        setMoIncomeTax(0);
        setMoStlouIncomeTax(0);
        setYtdSocialSecurity(0);
        setYtdMedicare(0);
        setYtdFederalIncomeTax(0);
        setYtdMoIncomeTax(0);
        setYtdMoStlouIncomeTax(0);
      }
      return;
    }
    if (overrideRef.current) return;

    setSocialSecurity(computedTaxes.socialSecurity);
    setMedicare(computedTaxes.medicare);
    setFederalIncomeTax(computedTaxes.federalIncomeTax);
    setMoIncomeTax(computedTaxes.moIncomeTax);
    setMoStlouIncomeTax(computedTaxes.moStlouIncomeTax);
    setYtdSocialSecurity(computedTaxes.ytdSocialSecurity);
    setYtdMedicare(computedTaxes.ytdMedicare);
    setYtdFederalIncomeTax(computedTaxes.ytdFederalIncomeTax);
    setYtdMoIncomeTax(computedTaxes.ytdMoIncomeTax);
    setYtdMoStlouIncomeTax(computedTaxes.ytdMoStlouIncomeTax);
  }, [grossSalary, ytdGrossSalary, computedTaxes]);

  // ── Computed totals ──────────────────────────────────────────────────────

  const totalWithholdings =
    socialSecurity + medicare + federalIncomeTax + moIncomeTax + moStlouIncomeTax;
  const netPay = grossSalary - totalWithholdings;

  const ytdTotalWithholdings =
    ytdSocialSecurity + ytdMedicare + ytdFederalIncomeTax + ytdMoIncomeTax + ytdMoStlouIncomeTax;
  const ytdNetPay = (ytdGrossSalary || grossSalary) - ytdTotalWithholdings;

  // ── Handler to mark manual override ──────────────────────────────────────

  const markManual = useCallback(() => {
    overrideRef.current = true;
    setManualOverride(true);
  }, []);

  // ── Save handler ─────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!user) {
      toast.error('You must be logged in to create a pay stub.');
      return;
    }
    if (!payPeriodStart || !payPeriodEnd || !checkDate) {
      toast.error('Please fill in Pay Period Start, Pay Period End, and Check Date.');
      return;
    }
    setSaving(true);
    try {
      await createW2PayStub(
        {
          employeeId: 'kara-noland',
          employeeName,
          employeeAddress,
          employeeCity,
          employeeState,
          employeeZip,
          companyName,
          companyAddress,
          companyCity,
          companyState,
          companyZip,
          companyPhone,
          payPeriodStart,
          payPeriodEnd,
          checkDate,
          checkNumber,
          grossSalary,
          ytdGrossSalary: ytdGrossSalary || grossSalary,
          socialSecurity,
          medicare,
          federalIncomeTax,
          moIncomeTax,
          moStlouIncomeTax,
          ytdSocialSecurity,
          ytdMedicare,
          ytdFederalIncomeTax,
          ytdMoIncomeTax,
          ytdMoStlouIncomeTax,
        },
        user.uid
      );
      toast.success('W-2 Pay Stub saved successfully.');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save pay stub.');
    } finally {
      setSaving(false);
    }
  }, [
    user,
    employeeName,
    employeeAddress,
    employeeCity,
    employeeState,
    employeeZip,
    companyName,
    companyAddress,
    companyCity,
    companyState,
    companyZip,
    companyPhone,
    payPeriodStart,
    payPeriodEnd,
    checkDate,
    checkNumber,
    grossSalary,
    ytdGrossSalary,
    socialSecurity,
    medicare,
    federalIncomeTax,
    moIncomeTax,
    moStlouIncomeTax,
    ytdSocialSecurity,
    ytdMedicare,
    ytdFederalIncomeTax,
    ytdMoIncomeTax,
    ytdMoStlouIncomeTax,
    onSaved,
    onClose,
  ]);

  if (!open) return null;

  const inputClass =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
  const readOnlyClass =
    'w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 font-semibold';
  const autoFieldClass =
    'w-full rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-12 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 mb-12">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Create W-2 Pay Stub</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Tax withholdings are auto-calculated from gross salary for St. Louis County, MO.
              {manualOverride && (
                <span className="text-amber-600 ml-1">
                  — Manual override active
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Form body — two columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 px-6 py-5">
          {/* Left Column — Personal & Check Information */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Personal & Check Information
            </h3>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Employee Name</label>
                <input
                  className={inputClass}
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Employee Address</label>
                <input
                  className={inputClass}
                  value={employeeAddress}
                  onChange={(e) => setEmployeeAddress(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className={labelClass}>City</label>
                  <input
                    className={inputClass}
                    value={employeeCity}
                    onChange={(e) => setEmployeeCity(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <input
                    className={inputClass}
                    value={employeeState}
                    onChange={(e) => setEmployeeState(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>ZIP</label>
                  <input
                    className={inputClass}
                    value={employeeZip}
                    onChange={(e) => setEmployeeZip(e.target.value)}
                  />
                </div>
              </div>
              <div className="border-t pt-3 mt-3">
                <div>
                  <label className={labelClass}>Company Name</label>
                  <input
                    className={inputClass}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
                <div className="mt-2">
                  <label className={labelClass}>Company Address</label>
                  <input
                    className={inputClass}
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="col-span-1">
                    <label className={labelClass}>City</label>
                    <input
                      className={inputClass}
                      value={companyCity}
                      onChange={(e) => setCompanyCity(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>State</label>
                    <input
                      className={inputClass}
                      value={companyState}
                      onChange={(e) => setCompanyState(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>ZIP</label>
                    <input
                      className={inputClass}
                      value={companyZip}
                      onChange={(e) => setCompanyZip(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <label className={labelClass}>Company Phone</label>
                  <input
                    className={inputClass}
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="border-t pt-3 mt-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Pay Period Start</label>
                    <input
                      type="date"
                      className={inputClass}
                      value={payPeriodStart}
                      onChange={(e) => setPayPeriodStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Pay Period End</label>
                    <input
                      type="date"
                      className={inputClass}
                      value={payPeriodEnd}
                      onChange={(e) => setPayPeriodEnd(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className={labelClass}>Check Date</label>
                    <input
                      type="date"
                      className={inputClass}
                      value={checkDate}
                      onChange={(e) => setCheckDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Check Number</label>
                    <input
                      className={inputClass}
                      value={checkNumber}
                      onChange={(e) => setCheckNumber(e.target.value)}
                      placeholder="e.g. 1001"
                    />
                  </div>
                </div>
              </div>

              {/* Tax config */}
              <div className="border-t pt-3 mt-3">
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Tax Settings
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Filing Status</label>
                    <select
                      className={inputClass}
                      value={filingStatus}
                      onChange={(e) => {
                        setFilingStatus(e.target.value as 'single' | 'married');
                        // Reset override so taxes recalculate with new status
                        overrideRef.current = false;
                        setManualOverride(false);
                      }}
                    >
                      <option value="single">Single</option>
                      <option value="married">Married Filing Jointly</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Pay Periods / Year</label>
                    <select
                      className={inputClass}
                      value={payPeriodsPerYear}
                      onChange={(e) => {
                        setPayPeriodsPerYear(Number(e.target.value));
                        overrideRef.current = false;
                        setManualOverride(false);
                      }}
                    >
                      <option value={52}>52 — Weekly</option>
                      <option value={26}>26 — Biweekly</option>
                      <option value={24}>24 — Semimonthly</option>
                      <option value={12}>12 — Monthly</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column — Earnings & Withholdings */}
          <div>
            {/* Earnings */}
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Earnings
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className={labelClass}>Gross Salary (This Period)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputClass}
                  value={grossSalary || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setGrossSalary(val);
                    // Reset override when gross changes so taxes recalculate
                    overrideRef.current = false;
                    setManualOverride(false);
                  }}
                />
              </div>
              <div>
                <label className={labelClass}>YTD Gross Salary</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputClass}
                  value={ytdGrossSalary || ''}
                  onChange={(e) => setYtdGrossSalary(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            {/* Withholdings — auto-calculated but editable */}
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              Withholdings
              <span className="text-xs font-normal text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                Auto-calculated
              </span>
              {manualOverride && (
                <button
                  type="button"
                  onClick={() => {
                    overrideRef.current = false;
                    setManualOverride(false);
                  }}
                  className="text-xs font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full hover:bg-amber-100"
                >
                  Reset to auto
                </button>
              )}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Social Security</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={socialSecurity || ''}
                    onChange={(e) => {
                      markManual();
                      setSocialSecurity(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
                <div>
                  <label className={labelClass}>YTD Social Security</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={ytdSocialSecurity || ''}
                    onChange={(e) => {
                      markManual();
                      setYtdSocialSecurity(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Medicare</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={medicare || ''}
                    onChange={(e) => {
                      markManual();
                      setMedicare(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
                <div>
                  <label className={labelClass}>YTD Medicare</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={ytdMedicare || ''}
                    onChange={(e) => {
                      markManual();
                      setYtdMedicare(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Federal Income Tax</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={federalIncomeTax || ''}
                    onChange={(e) => {
                      markManual();
                      setFederalIncomeTax(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
                <div>
                  <label className={labelClass}>YTD Federal Income Tax</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={ytdFederalIncomeTax || ''}
                    onChange={(e) => {
                      markManual();
                      setYtdFederalIncomeTax(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>MO Income Tax</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={moIncomeTax || ''}
                    onChange={(e) => {
                      markManual();
                      setMoIncomeTax(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
                <div>
                  <label className={labelClass}>YTD MO Income Tax</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={ytdMoIncomeTax || ''}
                    onChange={(e) => {
                      markManual();
                      setYtdMoIncomeTax(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>MO STLOU Income Tax (0% for County)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={moStlouIncomeTax || ''}
                    onChange={(e) => {
                      markManual();
                      setMoStlouIncomeTax(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
                <div>
                  <label className={labelClass}>YTD MO STLOU Income Tax</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={manualOverride ? inputClass : autoFieldClass}
                    value={ytdMoStlouIncomeTax || ''}
                    onChange={(e) => {
                      markManual();
                      setYtdMoStlouIncomeTax(parseFloat(e.target.value) || 0);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Computed Display */}
            <div className="mt-6 rounded-lg border-2 border-indigo-200 bg-indigo-50 p-4">
              <h3 className="text-sm font-semibold text-indigo-800 uppercase tracking-wide mb-3">
                Computed Totals (Read-Only)
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-indigo-700">Total Withholdings</label>
                  <div className={readOnlyClass}>{formatDollar(totalWithholdings)}</div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-indigo-700">Net Pay</label>
                  <div className={readOnlyClass}>{formatDollar(netPay)}</div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-indigo-700">YTD Total Withholdings</label>
                  <div className={readOnlyClass}>{formatDollar(ytdTotalWithholdings)}</div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-indigo-700">YTD Net Pay</label>
                  <div className={readOnlyClass}>{formatDollar(ytdNetPay)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Pay Stub'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default W2PayStubForm;