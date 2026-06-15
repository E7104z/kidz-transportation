// w2PayStubService.ts
// CRUD operations for W-2 Employee Pay Stubs in Firestore.
// All computed fields (totalWithholdings, netPay, ytdTotalWithholdings, ytdNetPay)
// are calculated before saving to ensure data integrity.

import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import type { W2PayStub } from '../types';

const COLLECTION = 'w2PayStubs';

/** Fields the caller supplies — computed totals are derived server-side. */
export type CreateW2PayStubInput = Omit<
  W2PayStub,
  'id' | 'createdAt' | 'createdBy' | 'totalWithholdings' | 'netPay' | 'ytdTotalWithholdings' | 'ytdNetPay'
>;

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
  const computed = computeTotals(data);
  const createdAt = new Date().toISOString();

  const docRef = await addDoc(collection(db, COLLECTION), {
    ...data,
    ...computed,
    createdAt,
    createdBy,
  });

  return docRef.id;
}

export async function getW2PayStubs(): Promise<W2PayStub[]> {
  const q = query(collection(db, COLLECTION), orderBy('checkDate', 'desc'));
  const snapshot = await getDocs(q);
  const stubs: W2PayStub[] = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    stubs.push({
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
    });
  });

  return stubs;
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

export async function deleteW2PayStub(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}