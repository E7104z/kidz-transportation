// w2PayStubService.ts
// CRUD operations for W-2 Employee Pay Stubs in Firestore.
// YTD amounts are ALWAYS derived dynamically from actual prior-period amounts
// so adding or deleting any stub automatically corrects all YTD figures.

import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  updateDoc,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import type { W2PayStub } from '../types';

const COLLECTION = 'w2PayStubs';

/** Fields the caller supplies — computed totals are derived server-side. */
export type CreateW2PayStubInput = Omit<
  W2PayStub,
  'id' | 'createdAt' | 'createdBy' | 'totalWithholdings' | 'netPay' | 'ytdTotalWithholdings' | 'ytdNetPay'
>;

/** Re-derive YTD fields for every stub based on actual prior-period amounts.
 * Stubs must be sorted ascending by checkDate before calling this.
 */
function applyDynamicYTD(stubs: W2PayStub[]): W2PayStub[] {
  // Group by employeeId so multi-employee support works in future
  const byEmployee: Record<string, W2PayStub[]> = {};
  stubs.forEach(s => {
    (byEmployee[s.employeeId] ??= []).push(s);
  });

  const result: W2PayStub[] = [];
  for (const empStubs of Object.values(byEmployee)) {
    // Already sorted asc by checkDate at this point
    const runningYear: Record<string, {
      grossSalary: number; socialSecurity: number; medicare: number;
      federalIncomeTax: number; moIncomeTax: number; moStlouIncomeTax: number;
    }> = {};

    for (const stub of empStubs) {
      const year = stub.checkDate.slice(0, 4);
      const running = runningYear[year] ?? {
        grossSalary: 0, socialSecurity: 0, medicare: 0,
        federalIncomeTax: 0, moIncomeTax: 0, moStlouIncomeTax: 0,
      };

      // YTD = running total (prior stubs) + this stub's period amounts
      const ytdGrossSalary      = running.grossSalary      + stub.grossSalary;
      const ytdSocialSecurity   = running.socialSecurity   + stub.socialSecurity;
      const ytdMedicare         = running.medicare         + stub.medicare;
      const ytdFederalIncomeTax = running.federalIncomeTax + stub.federalIncomeTax;
      const ytdMoIncomeTax      = running.moIncomeTax      + stub.moIncomeTax;
      const ytdMoStlouIncomeTax = running.moStlouIncomeTax + stub.moStlouIncomeTax;
      const ytdTotalWithholdings = ytdSocialSecurity + ytdMedicare + ytdFederalIncomeTax + ytdMoIncomeTax + ytdMoStlouIncomeTax;
      const ytdNetPay = ytdGrossSalary - ytdTotalWithholdings;

      result.push({
        ...stub,
        ytdGrossSalary,
        ytdSocialSecurity,
        ytdMedicare,
        ytdFederalIncomeTax,
        ytdMoIncomeTax,
        ytdMoStlouIncomeTax,
        ytdTotalWithholdings,
        ytdNetPay,
      });

      // Advance the running total for the next stub in the same year
      runningYear[year] = {
        grossSalary:      ytdGrossSalary,
        socialSecurity:   ytdSocialSecurity,
        medicare:         ytdMedicare,
        federalIncomeTax: ytdFederalIncomeTax,
        moIncomeTax:      ytdMoIncomeTax,
        moStlouIncomeTax: ytdMoStlouIncomeTax,
      };
    }
  }
  return result;
}

function computeTotals(
  data: CreateW2PayStubInput
): Pick<W2PayStub, 'totalWithholdings' | 'netPay' | 'ytdTotalWithholdings' | 'ytdNetPay'> {
  const totalWithholdings =
    data.socialSecurity +
    data.medicare +
    data.federalIncomeTax +
    data.moIncomeTax +
    data.moStlouIncomeTax;

  const netPay = data.grossSalary - totalWithholdings;

  const ytdTotalWithholdings =
    data.ytdSocialSecurity +
    data.ytdMedicare +
    data.ytdFederalIncomeTax +
    data.ytdMoIncomeTax +
    data.ytdMoStlouIncomeTax;

  const ytdNetPay = data.ytdGrossSalary - ytdTotalWithholdings;

  return {
    totalWithholdings,
    netPay,
    ytdTotalWithholdings,
    ytdNetPay,
  };
}

export async function createW2PayStub(
  data: CreateW2PayStubInput,
  createdBy: string
): Promise<string> {
  // Fetch all existing stubs for this employee so we can compute the correct YTD
  // (no orderBy here — avoids requiring a composite Firestore index; we sort in JS)
  const existingSnap = await getDocs(
    query(collection(db, COLLECTION), where('employeeId', '==', data.employeeId))
  );
  const existingRaw = existingSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as W2PayStub))
    .sort((a, b) => a.checkDate.localeCompare(b.checkDate));

  // Build the stub-to-save as a pseudo-stub so applyDynamicYTD can compute its YTD
  const tempId = '__new__';
  const pseudoStub: W2PayStub = {
    id: tempId,
    ...data,
    ytdGrossSalary: 0, ytdSocialSecurity: 0, ytdMedicare: 0,
    ytdFederalIncomeTax: 0, ytdMoIncomeTax: 0, ytdMoStlouIncomeTax: 0,
    totalWithholdings: 0, netPay: 0, ytdTotalWithholdings: 0, ytdNetPay: 0,
    createdAt: '', createdBy,
  };

  // Merge existing + new, sort by checkDate asc, compute dynamic YTD
  const allSorted = [...existingRaw, pseudoStub].sort((a, b) =>
    a.checkDate.localeCompare(b.checkDate)
  );
  const withYTD = applyDynamicYTD(allSorted);
  const computed = withYTD.find(s => s.id === tempId)!;

  const computed_totals = computeTotals({
    ...data,
    ytdGrossSalary:      computed.ytdGrossSalary,
    ytdSocialSecurity:   computed.ytdSocialSecurity,
    ytdMedicare:         computed.ytdMedicare,
    ytdFederalIncomeTax: computed.ytdFederalIncomeTax,
    ytdMoIncomeTax:      computed.ytdMoIncomeTax,
    ytdMoStlouIncomeTax: computed.ytdMoStlouIncomeTax,
  });

  const createdAt = new Date().toISOString();
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...data,
    ytdGrossSalary:      computed.ytdGrossSalary,
    ytdSocialSecurity:   computed.ytdSocialSecurity,
    ytdMedicare:         computed.ytdMedicare,
    ytdFederalIncomeTax: computed.ytdFederalIncomeTax,
    ytdMoIncomeTax:      computed.ytdMoIncomeTax,
    ytdMoStlouIncomeTax: computed.ytdMoStlouIncomeTax,
    ...computed_totals,
    createdAt,
    createdBy,
  });

  return docRef.id;
}

export async function getW2PayStubs(): Promise<W2PayStub[]> {
  // Fetch ascending so applyDynamicYTD can build running totals correctly
  const q = query(collection(db, COLLECTION), orderBy('checkDate', 'asc'));
  const snapshot = await getDocs(q);
  const raw: W2PayStub[] = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    raw.push({
      id: docSnap.id,
      employeeId: data.employeeId ?? '',
      employeeName: data.employeeName ?? '',
      employeeAddress: data.employeeAddress ?? '',
      employeeCity: data.employeeCity ?? '',
      employeeState: data.employeeState ?? '',
      employeeZip: data.employeeZip ?? '',
      companyName: data.companyName ?? '',
      companyAddress: data.companyAddress ?? '',
      companyCity: data.companyCity ?? '',
      companyState: data.companyState ?? '',
      companyZip: data.companyZip ?? '',
      companyPhone: data.companyPhone ?? '',
      payPeriodStart: data.payPeriodStart ?? '',
      payPeriodEnd: data.payPeriodEnd ?? '',
      checkDate: data.checkDate ?? '',
      checkNumber: data.checkNumber ?? '',
      grossSalary: data.grossSalary ?? 0,
      ytdGrossSalary: 0,  // will be overwritten by applyDynamicYTD
      socialSecurity: data.socialSecurity ?? 0,
      medicare: data.medicare ?? 0,
      federalIncomeTax: data.federalIncomeTax ?? 0,
      moIncomeTax: data.moIncomeTax ?? 0,
      moStlouIncomeTax: data.moStlouIncomeTax ?? 0,
      ytdSocialSecurity: 0,
      ytdMedicare: 0,
      ytdFederalIncomeTax: 0,
      ytdMoIncomeTax: 0,
      ytdMoStlouIncomeTax: 0,
      totalWithholdings: data.totalWithholdings ?? 0,
      netPay: data.netPay ?? 0,
      ytdTotalWithholdings: 0,
      ytdNetPay: 0,
      createdAt: data.createdAt ?? '',
      createdBy: data.createdBy ?? '',
    });
  });

  // Recompute YTD dynamically from actual period amounts (ascending order already)
  const withYTD = applyDynamicYTD(raw);

  // Return descending (most recent first) for display
  return withYTD.sort((a, b) => b.checkDate.localeCompare(a.checkDate));
}

export async function getW2PayStub(id: string): Promise<W2PayStub | null> {
  const docSnap = await getDoc(doc(db, COLLECTION, id));
  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  return {
    id: docSnap.id,
    employeeId: data.employeeId ?? '',
    employeeName: data.employeeName ?? '',
    employeeAddress: data.employeeAddress ?? '',
    employeeCity: data.employeeCity ?? '',
    employeeState: data.employeeState ?? '',
    employeeZip: data.employeeZip ?? '',
    companyName: data.companyName ?? '',
    companyAddress: data.companyAddress ?? '',
    companyCity: data.companyCity ?? '',
    companyState: data.companyState ?? '',
    companyZip: data.companyZip ?? '',
    companyPhone: data.companyPhone ?? '',
    payPeriodStart: data.payPeriodStart ?? '',
    payPeriodEnd: data.payPeriodEnd ?? '',
    checkDate: data.checkDate ?? '',
    checkNumber: data.checkNumber ?? '',
    grossSalary: data.grossSalary ?? 0,
    ytdGrossSalary: data.ytdGrossSalary ?? 0,
    socialSecurity: data.socialSecurity ?? 0,
    medicare: data.medicare ?? 0,
    federalIncomeTax: data.federalIncomeTax ?? 0,
    moIncomeTax: data.moIncomeTax ?? 0,
    moStlouIncomeTax: data.moStlouIncomeTax ?? 0,
    ytdSocialSecurity: data.ytdSocialSecurity ?? 0,
    ytdMedicare: data.ytdMedicare ?? 0,
    ytdFederalIncomeTax: data.ytdFederalIncomeTax ?? 0,
    ytdMoIncomeTax: data.ytdMoIncomeTax ?? 0,
    ytdMoStlouIncomeTax: data.ytdMoStlouIncomeTax ?? 0,
    totalWithholdings: data.totalWithholdings ?? 0,
    netPay: data.netPay ?? 0,
    ytdTotalWithholdings: data.ytdTotalWithholdings ?? 0,
    ytdNetPay: data.ytdNetPay ?? 0,
    createdAt: data.createdAt ?? '',
    createdBy: data.createdBy ?? '',
  };
}

export async function updateW2PayStub(
  id: string,
  data: CreateW2PayStubInput,
): Promise<void> {
  // Fetch all stubs for this employee EXCEPT the one being updated
  // (no orderBy — avoids composite index requirement; sorted in JS below)
  const existingSnap = await getDocs(
    query(collection(db, COLLECTION), where('employeeId', '==', data.employeeId))
  );
  const existingRaw = existingSnap.docs
    .filter(d => d.id !== id)
    .map(d => ({ id: d.id, ...d.data() } as W2PayStub))
    .sort((a, b) => a.checkDate.localeCompare(b.checkDate));

  const tempId = '__updated__';
  const pseudoStub: W2PayStub = {
    id: tempId, ...data,
    ytdGrossSalary: 0, ytdSocialSecurity: 0, ytdMedicare: 0,
    ytdFederalIncomeTax: 0, ytdMoIncomeTax: 0, ytdMoStlouIncomeTax: 0,
    totalWithholdings: 0, netPay: 0, ytdTotalWithholdings: 0, ytdNetPay: 0,
    createdAt: '', createdBy: '',
  };
  const allSorted = [...existingRaw, pseudoStub].sort((a, b) =>
    a.checkDate.localeCompare(b.checkDate)
  );
  const withYTD  = applyDynamicYTD(allSorted);
  const computed = withYTD.find(s => s.id === tempId)!;

  const totals = computeTotals({
    ...data,
    ytdGrossSalary:      computed.ytdGrossSalary,
    ytdSocialSecurity:   computed.ytdSocialSecurity,
    ytdMedicare:         computed.ytdMedicare,
    ytdFederalIncomeTax: computed.ytdFederalIncomeTax,
    ytdMoIncomeTax:      computed.ytdMoIncomeTax,
    ytdMoStlouIncomeTax: computed.ytdMoStlouIncomeTax,
  });

  await updateDoc(doc(db, COLLECTION, id), {
    ...data,
    ytdGrossSalary:      computed.ytdGrossSalary,
    ytdSocialSecurity:   computed.ytdSocialSecurity,
    ytdMedicare:         computed.ytdMedicare,
    ytdFederalIncomeTax: computed.ytdFederalIncomeTax,
    ytdMoIncomeTax:      computed.ytdMoIncomeTax,
    ytdMoStlouIncomeTax: computed.ytdMoStlouIncomeTax,
    ...totals,
  });
}

export async function deleteW2PayStub(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}