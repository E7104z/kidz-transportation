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
): Promise<{ contractId: string; pdfUrl: string }> {
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
    { contractId: string }
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

  return { contractId: result.data.contractId, pdfUrl };
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
  // Write email job
  await addDoc(collection(db, 'emailQueue'), {
    to: toEmail,
    subject: `KIDZ Transportation Agreement — ${contract.studentNames.join(', ')}`,
    body: `Hello ${toName}, please find attached your transportation service agreement. Review and contact us with questions. (314) 425-9668`,
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
