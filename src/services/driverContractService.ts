// driverContractService.ts
// PDF generation, Firebase Storage upload, and email queuing for Driver IC Agreements.
// Mirrors contractService.ts — all Firestore writes go through Cloud Functions atomically.

import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import {
  doc,
  addDoc,
  collection,
  updateDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { db, storage } from './firebase';
import type { DriverContract, Driver } from '../types';
import DriverContractPDF from '../components/contracts/DriverContractPDF';

// ─────────────────────────────────────────────────────────────────────────────
// generateAndSaveDriverContract
// ─────────────────────────────────────────────────────────────────────────────
export async function generateAndSaveDriverContract(
  driver: Driver
): Promise<{ contractId: string; pdfUrl: string; signingToken: string }> {
  const generatedDate = format(new Date(), 'MMMM d, yyyy');
  const payoutSplit   = driver.payoutSplit ?? 70;

  // 1. Render PDF to blob
  const element = createElement(DriverContractPDF, {
    data: { driver, payoutSplit, agreementDate: generatedDate, generatedDate },
  });
  const blob = await pdf(element as any).toBlob();

  // 2. Upload to Firebase Storage
  const fileName   = `driverContracts/${driver.id}_${Date.now()}.pdf`;
  const storageRef = ref(storage, fileName);
  await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
  const pdfUrl = await getDownloadURL(storageRef);

  // 3. Call Cloud Function — atomic Firestore writes
  const fns = getFunctions();
  const saveFn = httpsCallable<
    { driverId: string; pdfUrl: string; contractData: Record<string, unknown> },
    { contractId: string; signingToken: string }
  >(fns, 'saveDriverContractRecord');

  const result = await saveFn({
    driverId: driver.id,
    pdfUrl,
    contractData: {
      driverName:    driver.name,
      driverEmail:   driver.email,
      driverPhone:   driver.phone   || '',
      driverAddress: driver.address || '',
      payoutSplit,
      emailedTo:     driver.email,
    },
  });

  return { contractId: result.data.contractId, pdfUrl, signingToken: result.data.signingToken };
}

// ─────────────────────────────────────────────────────────────────────────────
// queueDriverContractEmail
// ─────────────────────────────────────────────────────────────────────────────
export async function queueDriverContractEmail(
  contract: DriverContract,
  toEmail: string,
  toName: string
): Promise<void> {
  const signUrl = contract.signingToken && !contract.signedAt
    ? `${window.location.origin}/driver-sign/${contract.id}?t=${encodeURIComponent(contract.signingToken)}`
    : '';

  const signBlock = signUrl
    ? `<div style="text-align:center;margin:8px 0 28px;">
        <a href="${signUrl}"
           style="background:#16a34a;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          ✍ Sign Agreement Online
        </a>
        <p style="color:#6b7280;font-size:12px;margin:8px 0 0;">
          Fastest way to get started — takes less than a minute.
        </p>
      </div>`
    : '';

  const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0d9488;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;">KIDZ Transportation</h1>
    <p style="color:#ccfbf1;margin:6px 0 0;font-size:14px;">Independent Contractor Agreement</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:32px;">
    <p style="font-size:16px;font-weight:600;margin:0 0 12px;">Hello ${toName},</p>
    <p style="color:#4b5563;line-height:1.7;margin:0 0 24px;">
      Your KIDZ Transportation Independent Contractor Agreement is ready for your review.
      Please read the agreement carefully — it outlines your compensation rate of
      <strong>${contract.payoutSplit}%</strong> and the terms of your engagement as a contractor.
    </p>
    ${signBlock}
    <div style="text-align:center;margin:16px 0;">
      <a href="${contract.pdfUrl}"
         style="background:#0d9488;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">
        View &amp; Download Agreement
      </a>
    </div>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:16px 0 8px;">
      If the buttons above don't work, copy and paste these links into your browser:
    </p>
    ${signUrl ? `<p style="word-break:break-all;font-size:12px;color:#9ca3af;margin:0 0 6px;"><strong>Sign:</strong> ${signUrl}</p>` : ''}
    <p style="word-break:break-all;font-size:12px;color:#9ca3af;margin:0 0 24px;"><strong>PDF:</strong> ${contract.pdfUrl}</p>
    <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0;">
    <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">
      Questions? Call or text us: <strong>(314) 425-9668</strong>
    </p>
    <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center;">
      KIDZ Transportation &bull; Safe Rides for Little Ones
    </p>
  </div>
</body></html>`;

  await addDoc(collection(db, 'emailQueue'), {
    to:         toEmail,
    subject:    'Your KIDZ Transportation Contractor Agreement — Action Required',
    body:       htmlBody,
    pdfUrl:     contract.pdfUrl,
    contractId: contract.id,
    status:     'pending',
    createdAt:  serverTimestamp(),
  });

  await updateDoc(doc(db, 'driverContracts', contract.id), {
    sentAt: serverTimestamp(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchDriverContract
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchDriverContract(contractId: string): Promise<DriverContract | null> {
  const snap = await getDoc(doc(db, 'driverContracts', contractId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as DriverContract;
}
