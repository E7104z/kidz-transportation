// contractService.ts
// PDF generation, Firebase Storage upload, and email queuing for KIDZ Transportation.
// Uses @react-pdf/renderer for blob creation; firebase/storage for upload.
// ALL Firestore writes go through the saveContractRecord Cloud Function so the
// contract doc, booking status update, and audit log are committed atomically.

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
import type { Contract, Booking, Client, Student } from '../types';
import ContractPDF from '../components/contracts/ContractPDF';

// ─────────────────────────────────────────────────────────────────────────────
// generateAndSaveContract
// 1. Renders the PDF in the browser (React PDF, browser-only)
// 2. Uploads the blob to Firebase Storage (browser)
// 3. Calls the saveContractRecord Cloud Function which atomically:
//    - writes the contracts doc
//    - updates bookings.status → contract_sent
//    - writes an auditLog entry
// ─────────────────────────────────────────────────────────────────────────────
export async function generateAndSaveContract(
  booking: Booking,
  client: Client,
  students: Student[]
): Promise<{ contractId: string; pdfUrl: string; signingToken: string }> {
  const generatedDate = format(new Date(), 'MMMM d, yyyy');

  // 1. Render PDF to blob (must stay in browser — react-pdf is browser-only)
  const element = createElement(ContractPDF, {
    data: {
      client,
      students,
      booking,
      generatedDate,
      applicationFeePaid: booking.applicationFeePaid,
    },
  });
  const blob = await pdf(element as any).toBlob();

  // 2. Upload to Firebase Storage
  const fileName   = `contracts/${booking.id}_${Date.now()}.pdf`;
  const storageRef = ref(storage, fileName);
  await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
  const pdfUrl = await getDownloadURL(storageRef);

  // 3. Normalise serviceStartDate to a plain string
  let serviceStartDate = '';
  const raw = booking.serviceStartDate as any;
  if (raw instanceof Date) {
    serviceStartDate = raw.toISOString().split('T')[0];
  } else if (typeof raw?.toDate === 'function') {
    serviceStartDate = raw.toDate().toISOString().split('T')[0];
  } else {
    serviceStartDate = String(raw ?? '');
  }

  // 4. Call Cloud Function — Firestore writes happen server-side, atomically
  const fns             = getFunctions();
  const saveContractFn  = httpsCallable<
    { bookingId: string; pdfUrl: string; contractData: Record<string, unknown> },
    { contractId: string; signingToken: string }
  >(fns, 'saveContractRecord');

  const result = await saveContractFn({
    bookingId: booking.id,
    pdfUrl,
    contractData: {
      clientId:           booking.clientId,
      studentNames:       students.map(s => s.name),
      emailedTo:          client.email,
      weeklyRate:         booking.weeklyRate,
      dailyRate:          booking.dailyRate,
      transportationType: booking.transportationType,
      daysOfWeek:         booking.daysOfWeek,
      pickupAddress:      booking.pickupAddress,
      dropoffAddress:     booking.dropoffAddress,
      serviceStartDate,
      schoolName:         students.map(s => s.schoolName).filter(Boolean).join(', '),
      applicationFeePaid: booking.applicationFeePaid,
    },
  });

  return {
    contractId: result.data.contractId,
    pdfUrl,
    signingToken: result.data.signingToken,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// queueContractEmail
// Writes an email job to the emailQueue collection (processed by a Firebase
// Function or SendGrid webhook) and stamps sentAt on the contract document.
// ─────────────────────────────────────────────────────────────────────────────
export async function queueContractEmail(
  contract: Contract,
  toEmail: string,
  toName: string
): Promise<void> {
  const signUrl = contract.signingToken && !contract.signedAt
    ? `${window.location.origin}/sign/${contract.id}?t=${encodeURIComponent(contract.signingToken)}`
    : '';

  const signBlock = signUrl
    ? `
    <div style="text-align:center;margin:8px 0 28px;">
      <a href="${signUrl}"
         style="background:#16a34a;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        ✍ Sign Agreement Online
      </a>
      <p style="color:#6b7280;font-size:12px;margin:8px 0 0;">Fastest way to get your child started — takes less than a minute.</p>
    </div>`
    : '';

  // Write email job
  const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#6d28d9;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;">KIDZ Transportation</h1>
    <p style="color:#ddd6fe;margin:6px 0 0;font-size:14px;">Transportation Service Agreement</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:32px;">
    <p style="font-size:16px;font-weight:600;margin:0 0 12px;">Hello ${toName},</p>
    <p style="color:#4b5563;line-height:1.7;margin:0 0 24px;">
      Your KIDZ Transportation service agreement for <strong>${contract.studentNames.join(', ')}</strong> is ready for your review.
      Please read the agreement carefully and keep a copy for your records.
    </p>
    ${signBlock}
    <div style="text-align:center;margin:16px 0;">
      <a href="${contract.pdfUrl}"
         style="background:#6d28d9;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">
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
    to: toEmail,
    subject: `Your KIDZ Transportation Agreement — ${contract.studentNames.join(', ')}`,
    body: htmlBody,
    pdfUrl: contract.pdfUrl,
    contractId: contract.id,
    status: 'pending',
    createdAt: serverTimestamp(),
  });

  // Stamp sentAt on the contract
  await updateDoc(doc(db, 'contracts', contract.id), {
    sentAt: serverTimestamp(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchContract
// Convenience: load a single contract by its Firestore document id.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchContract(contractId: string): Promise<Contract | null> {
  const snap = await getDoc(doc(db, 'contracts', contractId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Contract;
}
