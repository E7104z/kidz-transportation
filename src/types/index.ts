// Firestore Data Model Types for KIDZ Transportation

import { Timestamp } from 'firebase/firestore';

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: Date;
  // Billing (populated by Stripe Cloud Functions)
  stripeCustomerId?: string;
  autoPay?: boolean;
  paymentMethodLast4?: string;
  paymentMethodBrand?: string;
}

export interface Student {
  id: string;
  clientId: string;
  name: string;
  dob: string;
  age: number;
  grade: string;
  phone: string;
  schoolName: string;
  schoolContact: string;
  allergies: string;
  medicalNotes: string;
  specialRequirements: string;
}

export type TransportationType = 'roundtrip' | 'am_only' | 'pm_only' | 'midday';
export type BookingStatus = 'new' | 'under_review' | 'contract_sent' | 'active' | 'paused' | 'completed';
export type TransportationPurpose = 'School' | 'Daycare' | 'Afterschool' | 'Summer Program' | 'Other';

export interface Booking {
  id: string;
  clientId: string;
  studentIds: string[];
  pickupAddress: string;
  dropoffAddress: string;
  transportationType: TransportationType;
  transportationPurpose: TransportationPurpose;
  daysOfWeek: string[];
  schoolStartTime: string;
  schoolEndTime: string;
  serviceStartDate: Date;
  mileage: number;
  weeklyRate: number;
  dailyRate: number;
  status: BookingStatus;
  applicationFeePaid: boolean;
  emergencyContact: string;
  emergencyPhone: string;
  emergencyContactRelationship: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DriverDocument {
  name: string;       // original filename
  size: number;       // bytes
  url: string;        // Firebase Storage download URL
  path: string;       // storage path (for reference)
  uploadedAt: number; // epoch ms
  uploadedBy?: 'driver' | 'admin';
}

export interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  uid: string;
  photoURL?: string;
  // Required onboarding documents
  documents?: {
    driversLicense?: DriverDocument;
    insurance?: DriverDocument;
    registration?: DriverDocument;
    w9?: DriverDocument;
  };
  // Flexible bucket for any future document types (background checks, etc.)
  additionalDocuments?: DriverDocument[];
}

export type RouteAssignmentStatus = 'pending' | 'paid';

export interface RouteAssignment {
  id: string;
  driverId: string;
  bookingId: string;
  weekStart: Date;
  daysWorked: string[];
  weeklyPayout: number;
  status: RouteAssignmentStatus;
  paidDate: Date | null;
}

export interface Contract {
  id: string;
  bookingId: string;
  clientId: string;
  studentNames: string[];
  generatedAt: Timestamp;
  sentAt: Timestamp | null;
  pdfUrl: string;
  emailedTo: string;
  weeklyRate: number;
  dailyRate: number;
  transportationType: string;
  daysOfWeek: string[];
  pickupAddress: string;
  dropoffAddress: string;
  serviceStartDate: string;
  schoolName: string;
  applicationFeePaid: boolean;
  // ── Online signature ──────────────────────────────────────────────
  signingToken?: string;          // opaque URL token issued when the contract is created
  signedAt?: Timestamp | null;    // when the parent submitted the signature
  signedByName?: string;          // typed legal name entered at signing
  signedByEmail?: string;         // email we sent the contract to (audit)
  signerIp?: string;              // request IP captured server-side
  signedPdfUrl?: string;          // PDF with signature baked in
}

export interface EmailQueueItem {
  id: string;
  to: string;
  subject: string;
  body: string;
  pdfUrl: string;
  contractId: string;
  status: 'pending' | 'sent' | 'failed';
  createdAt: Timestamp;
}

export type UserRole = 'admin' | 'driver' | 'parent';

export interface RouteLog {
  id: string;
  bookingId: string;
  driverId: string;
  date: string;        // "YYYY-MM-DD"
  ran: boolean;
  confirmedBy: string; // uid
  confirmedAt: Timestamp;
  notes: string;
  // Per-student pickup/dropoff events (P1 / P5)
  studentEvents?: Record<string, StudentEvent>;  // studentId → event
}

export type StudentEventType = 'picked_up' | 'dropped_off' | 'absent' | 'no_show';

export interface StudentEvent {
  status: StudentEventType;
  timestamp: Timestamp;
  lat?: number;
  lng?: number;
}

// Live driver GPS location (P4)
export interface DriverLocation {
  driverId: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;      // km/h
  updatedAt: Timestamp;
  // Derived: which route/booking is active right now
  activeBookingId?: string;
}

// SMS notification queue — written by app, consumed by Cloud Function → Twilio (P2)
export interface SmsQueueItem {
  id: string;
  to: string;          // E.164 phone number e.g. +13145550000
  body: string;
  bookingId?: string;
  studentId?: string;
  event?: StudentEventType | 'driver_nearby' | 'run_missed';
  status: 'pending' | 'sent' | 'failed';
  createdAt: Timestamp;
  sentAt?: Timestamp;
  error?: string;
}

// Invoice (P6)
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'waived';

export interface Invoice {
  id: string;
  clientId: string;
  bookingIds: string[];         // combined: all active bookings for this parent
  weekOf: string;               // "YYYY-MM-DD" — Monday of the service week
  periodStart: string;          // YYYY-MM-DD
  periodEnd: string;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  status: InvoiceStatus;
  dueDate: string;              // Saturday before the service week
  sentAt: Timestamp | null;
  paidAt: Timestamp | null;
  createdAt: Timestamp;
  notes: string;
  // Stripe
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  // Admin override
  adminOverride?: boolean;
  overrideNote?: string;
  overrideBy?: string;          // admin uid
}

export interface InvoiceLineItem {
  description: string;
  bookingId?: string;
  date?: string;
  quantity: number;  // days
  unitPrice: number;
  total: number;
}

// Client billing extensions
export interface ClientBilling {
  stripeCustomerId?: string;
  autoPay?: boolean;
  paymentMethodLast4?: string;
  paymentMethodBrand?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Access / Multi-contact system
// ─────────────────────────────────────────────────────────────────────────────

export type ContactRole = 'primary' | 'secondary' | 'coordinator';

export interface ContactPermissions {
  canSeeBilling: boolean;
  canSeeInvoices: boolean;
  canEdit: boolean;
}

export const DEFAULT_PERMISSIONS: Record<ContactRole, ContactPermissions> = {
  primary:     { canSeeBilling: true,  canSeeInvoices: true,  canEdit: true  },
  secondary:   { canSeeBilling: false, canSeeInvoices: false, canEdit: true  },
  coordinator: { canSeeBilling: false, canSeeInvoices: false, canEdit: false },
};

export type InviteStatus = 'pending' | 'accepted' | 'expired';

export interface ClientAccess {
  id: string;
  clientId: string;
  uid: string | null;           // null until the invite is accepted
  email: string;
  name: string;
  role: ContactRole;
  permissions: ContactPermissions;
  inviteToken: string | null;   // null after accepted
  inviteStatus: InviteStatus;
  inviteExpiresAt: Timestamp | null;
  invitedAt: Timestamp;
  acceptedAt: Timestamp | null;
  createdAt: Timestamp;
}
