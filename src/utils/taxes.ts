// Tax withholding calculator for W-2 employees
// Based on St. Louis County, Missouri resident rates for 2025.
//
// All rates are applied to the gross salary to compute period withholdings.
// The user can override any computed value in the form.

/**
 * 2025 tax rates and thresholds for a person living in St. Louis County, Missouri.
 * St. Louis County residents do NOT pay the 1% St. Louis City earnings tax.
 */

// Social Security = 6.2% (employee share)
const SS_RATE = 0.062;
// 2025 Social Security wage base cap
const SS_WAGE_BASE = 176_100;

// Medicare = 1.45% (employee share) — no cap below $200k
const MEDICARE_RATE = 0.0145;
// Additional Medicare Tax 0.9% on wages over $200,000 (single)
const MEDICARE_SURTAX_THRESHOLD_SINGLE = 200_000;
const MEDICARE_SURTAX_RATE = 0.009;

// 2025 Federal income tax brackets — Single filer
// Uses the IRS Percentage Method for automated payroll systems (Pub 15-T)
const FED_BRACKETS_SINGLE = [
  { rate: 0.10, threshold: 0,     baseTax: 0 },
  { rate: 0.12, threshold: 11_925,   baseTax: 1_192.50 },
  { rate: 0.22, threshold: 48_475,   baseTax: 5_416.50 },
  { rate: 0.24, threshold: 103_350,  baseTax: 17_489.00 },
  { rate: 0.32, threshold: 197_300,  baseTax: 40_037.00 },
  { rate: 0.35, threshold: 250_525,  baseTax: 57_069.00 },
  { rate: 0.37, threshold: 626_350,  baseTax: 188_607.75 },
];

const FED_STANDARD_DEDUCTION_SINGLE = 15_000;

// 2025 Federal income tax brackets — Married filing jointly
const FED_BRACKETS_MARRIED = [
  { rate: 0.10, threshold: 0,       baseTax: 0 },
  { rate: 0.12, threshold: 23_850,    baseTax: 2_385.00 },
  { rate: 0.22, threshold: 96_950,    baseTax: 10_833.00 },
  { rate: 0.24, threshold: 206_700,   baseTax: 34_978.00 },
  { rate: 0.32, threshold: 394_600,   baseTax: 80_074.00 },
  { rate: 0.35, threshold: 501_050,   baseTax: 114_138.00 },
  { rate: 0.37, threshold: 751_600,   baseTax: 201_830.50 },
];

const FED_STANDARD_DEDUCTION_MARRIED = 30_000;

// 2025 Missouri income tax — progressive rates up to 4.7%
// Missouri allows deductions for federal tax paid and standard deduction.
// For simplified payroll withholding, MO DOR provides percentage tables
// that approximate ~4.1-4.7% effective after deductions.
const MO_BRACKETS = [
  { rate: 0.0200, threshold: 0,       baseTax: 0 },
  { rate: 0.0250, threshold: 1_273,    baseTax: 25.46 },
  { rate: 0.0300, threshold: 2_546,    baseTax: 63.61 },
  { rate: 0.0350, threshold: 3_819,    baseTax: 114.57 },
  { rate: 0.0400, threshold: 5_092,    baseTax: 178.79 },
  { rate: 0.0450, threshold: 6_365,    baseTax: 255.36 },
  { rate: 0.0470, threshold: 7_638,    baseTax: 345.09 },
  { rate: 0.0495, threshold: 8_911,    baseTax: 408.06 },
];

const MO_STANDARD_DEDUCTION_SINGLE = 14_600;
const MO_STANDARD_DEDUCTION_MARRIED = 29_200;

export interface TaxInput {
  grossSalary: number;
  ytdGrossSalary: number;
  filingStatus: 'single' | 'married';
  payPeriodsPerYear: number; // e.g., 52 for weekly, 26 for biweekly, 12 for monthly
}

export interface TaxResult {
  socialSecurity: number;
  medicare: number;
  federalIncomeTax: number;
  moIncomeTax: number;
  moStlouIncomeTax: number;

  ytdSocialSecurity: number;
  ytdMedicare: number;
  ytdFederalIncomeTax: number;
  ytdMoIncomeTax: number;
  ytdMoStlouIncomeTax: number;
}

/** Round to 2 decimal places */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute federal income tax for a single pay period using the percentage method */
function computeFederalWithholding(
  grossPerPeriod: number,
  filingStatus: 'single' | 'married',
  payPeriodsPerYear: number,
): number {
  const brackets = filingStatus === 'married' ? FED_BRACKETS_MARRIED : FED_BRACKETS_SINGLE;
  const standardDeduction = filingStatus === 'married'
    ? FED_STANDARD_DEDUCTION_MARRIED
    : FED_STANDARD_DEDUCTION_SINGLE;

  // Annualize
  const annualWages = grossPerPeriod * payPeriodsPerYear;
  // Subtract standard deduction (simplified — no other adjustments)
  const taxableAnnual = Math.max(0, annualWages - standardDeduction);

  // Find bracket
  let annualTax = 0;
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (taxableAnnual > brackets[i].threshold) {
      annualTax = brackets[i].baseTax + (taxableAnnual - brackets[i].threshold) * brackets[i].rate;
      break;
    }
  }

  // Divide back to per-period
  return r(annualTax / payPeriodsPerYear);
}

/** Compute Missouri income tax for a single pay period */
function computeMOWithholding(
  grossPerPeriod: number,
  filingStatus: 'single' | 'married',
  payPeriodsPerYear: number,
): number {
  const standardDeduction = filingStatus === 'married'
    ? MO_STANDARD_DEDUCTION_MARRIED
    : MO_STANDARD_DEDUCTION_SINGLE;

  // Annualize
  const annualWages = grossPerPeriod * payPeriodsPerYear;
  // Subtract MO standard deduction (simplified — no federal deduction offset)
  const taxableAnnual = Math.max(0, annualWages - standardDeduction);

  // Find bracket
  let annualTax = 0;
  for (let i = MO_BRACKETS.length - 1; i >= 0; i--) {
    if (taxableAnnual > MO_BRACKETS[i].threshold) {
      annualTax = MO_BRACKETS[i].baseTax + (taxableAnnual - MO_BRACKETS[i].threshold) * MO_BRACKETS[i].rate;
      break;
    }
  }

  return r(annualTax / payPeriodsPerYear);
}

/** Compute Social Security for a single pay period, respecting wage cap. */
function computeSocialSecurity(grossPerPeriod: number, ytdGross: number): number {
  // YTD before this period (so current period YTD is ytdGross - grossPerPeriod)
  const priorYtd = Math.max(0, ytdGross - grossPerPeriod);
  if (priorYtd >= SS_WAGE_BASE) {
    return 0; // already capped
  }
  const remainingBase = SS_WAGE_BASE - priorYtd;
  const taxableThisPeriod = Math.min(grossPerPeriod, remainingBase);
  return r(taxableThisPeriod * SS_RATE);
}

/** Compute Medicare for a single pay period */
function computeMedicare(grossPerPeriod: number, ytdGross: number): number {
  const medicare = r(grossPerPeriod * MEDICARE_RATE);

  // Additional Medicare Tax: 0.9% on wages over $200k (single) or $250k (married)
  const priorYtd = Math.max(0, ytdGross - grossPerPeriod);
  const surtaxThreshold = MEDICARE_SURTAX_THRESHOLD_SINGLE; // simplified — use single threshold
  if (priorYtd >= surtaxThreshold) {
    return r(medicare + grossPerPeriod * MEDICARE_SURTAX_RATE);
  }
  const overThreshold = Math.max(0, ytdGross - surtaxThreshold);
  if (overThreshold > 0) {
    return r(medicare + overThreshold * MEDICARE_SURTAX_RATE);
  }
  return medicare;
}

/**
 * Computes all tax withholdings for a single pay period and YTD.
 *
 * `grossSalary` — this period's gross earnings
 * `ytdGrossSalary` — year-to-date gross including this period
 *
 * All amounts are rounded to 2 decimal places.
 */
export function computeTaxWithholdings(input: TaxInput): TaxResult {
  const { grossSalary, ytdGrossSalary, filingStatus, payPeriodsPerYear } = input;

  if (grossSalary <= 0) {
    return {
      socialSecurity: 0,
      medicare: 0,
      federalIncomeTax: 0,
      moIncomeTax: 0,
      moStlouIncomeTax: 0,
      ytdSocialSecurity: 0,
      ytdMedicare: 0,
      ytdFederalIncomeTax: 0,
      ytdMoIncomeTax: 0,
      ytdMoStlouIncomeTax: 0,
    };
  }

  // This period
  const socialSecurity = computeSocialSecurity(grossSalary, ytdGrossSalary);
  const medicare = computeMedicare(grossSalary, ytdGrossSalary);
  const federalIncomeTax = computeFederalWithholding(grossSalary, filingStatus, payPeriodsPerYear);
  const moIncomeTax = computeMOWithholding(grossSalary, filingStatus, payPeriodsPerYear);
  // St. Louis County residents do NOT pay St. Louis City 1% earnings tax
  const moStlouIncomeTax = 0;

  // YTD = same rate applied to cumulative gross (simplified — real YTD is sum of
  // prior period computations, but since we only have the current-period gross and
  // cumulative YTD gross, we re-derive from the YTD gross).
  const ytdSocialSecurity = computeSocialSecurity(ytdGrossSalary, ytdGrossSalary);
  const ytdMedicare = computeMedicare(ytdGrossSalary, ytdGrossSalary);
  const ytdFederalIncomeTax = computeFederalWithholding(ytdGrossSalary, filingStatus, payPeriodsPerYear);
  const ytdMoIncomeTax = computeMOWithholding(ytdGrossSalary, filingStatus, payPeriodsPerYear);
  const ytdMoStlouIncomeTax = 0;

  return {
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
  };
}