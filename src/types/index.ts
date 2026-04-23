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
  // Extended fields
  nickname?: string;
  requiresChildSeat?: boolean;
  childSeatType?: 'infant' | 'convertible' | 'booster';
  medicalAlerts?: string[];
}

export type TransportationType = 'roundtrip' | 'am_only' | 'pm_only' | 'midday';
export type BookingStatus = 'new' | 'under_review' | 'dry_run' | 'meet_and_greet' | 'contract_sent' | 'active' | 'paused' | 'completed';
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
  // Extended fields
  dryRunAt?: Date;
  meetAndGreetAt?: Date;
  meetAndGreetCompleted?: boolean;
  pausedAt?: Date;
  resumeDate?: Date;
  pauseReason?: string;
  billingCadence?: 'weekly' | 'biweekly';
  scheduleOverrides?: Partial<Record<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday', { start?: string; end?: string }>>;
  rateOverrideReason?: string;
  rateOverrideBy?: string;
  rateOverrideAt?: Date;
}

export interface DriverDocument {
  name: string;       // original filename
  size: number;       // bytes
  url: string;        // Firebase Storage download URL
  path: string;       // storage path (for reference)
  uploadedAt: number; // epoch ms
  uploadedBy?: 'driver' | 'admin';
  expiresAt?: number;          // epoch ms — undefined means never expires
  reminderSentAt30?: number;
  reminderSentAt14?: number;
  reminderSentAt3?: number;
}

export interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  uid: string;
  photoURL?: string;
  // Driver type / payroll model
  driverType?: 'employee' | 'contractor' | 'subcontractor_company';
  companyName?: string;
  negotiatedFlatRate?: number;
  // Stripe Connect
  stripeConnectAccountId?: string;
  stripeConnectOnboarded?: boolean;
  stripeConnectPayoutsEnabled?: boolean;
  // Required onboarding documents
  documents?: {
    driversLicense?: DriverDocument;
    insurance?: DriverDocument;
    registration?: DriverDocument;
    w9?: DriverDocument;
    backgroundCheck?: DriverDocument;
    cpr?: DriverDocument;
    childPassengerSafety?: DriverDocument;
    vehicleInspection?: DriverDocument;
  };
  // Flexible bucket for any future document types
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

// ─────────────────────────────────────────────────────────────────────────────
// In-app notifications (replacing SMS)
// ─────────────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'driver_en_route'
  | 'driver_nearby'
  | 'student_picked_up'
  | 'student_dropped_off'
  | 'route_missed'
  | 'route_delayed'
  | 'invoice_sent'
  | 'invoice_overdue'
  | 'invoice_paid'
  | 'contract_ready_to_sign'
  | 'incident_reported'
  | 'document_expiring'
  | 'admin_broadcast';

export type NotificationAudience = 'parent' | 'driver' | 'admin';

export interface AppNotification {
  id: string;
  recipientUid: string;
  audience: NotificationAudience;
  type: NotificationType;
  title: string;
  body: string;
  linkTo?: string;
  bookingId?: string;
  studentId?: string;
  driverId?: string;
  clientId?: string;
  invoiceId?: string;
  incidentId?: string;
  read: boolean;
  readAt?: Timestamp;
  createdAt: Timestamp;
  priority: 'low' | 'normal' | 'high';
}

// ─────────────────────────────────────────────────────────────────────────────
// Driver shift / break tracking
// ─────────────────────────────────────────────────────────────────────────────

export type ShiftStatus = 'clocked_in' | 'on_break' | 'clocked_out';

export interface DriverShift {
  id: string;
  driverId: string;
  clockInAt: Timestamp;
  clockOutAt?: Timestamp;
  status: ShiftStatus;
  totalBreakMinutes: number;
  totalDrivingMinutes: number;
  notes?: string;
  hoursOfServiceWarning?: 'approaching_limit' | 'at_limit' | null;
}

export interface DriverBreak {
  id: string;
  shiftId: string;
  driverId: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  durationMinutes?: number;
  reason?: 'meal' | 'rest' | 'fuel' | 'other';
}

// ─────────────────────────────────────────────────────────────────────────────
// Incident reporting
// ─────────────────────────────────────────────────────────────────────────────

export type IncidentType =
  | 'vehicle_accident'
  | 'vehicle_breakdown'
  | 'child_behavior'
  | 'medical_event'
  | 'parent_no_show'
  | 'school_issue'
  | 'traffic_delay'
  | 'other';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Incident {
  id: string;
  reportedByUid: string;
  reportedByName: string;
  reportedByRole: 'driver' | 'admin';
  driverId?: string;
  bookingId?: string;
  studentId?: string;
  clientId?: string;
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description: string;
  location?: { lat: number; lng: number; address?: string };
  photos: string[];
  witnesses?: { name: string; phone?: string }[];
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  resolutionNotes?: string;
  resolvedAt?: Timestamp;
  resolvedByUid?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client communications log
// ─────────────────────────────────────────────────────────────────────────────

export type CommunicationChannel = 'email' | 'in_app' | 'phone' | 'admin_note' | 'sms_legacy';
export type CommunicationDirection = 'inbound' | 'outbound' | 'internal';

export interface ClientCommunication {
  id: string;
  clientId: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  subject?: string;
  body: string;
  actorUid?: string;
  actorName?: string;
  relatedBookingId?: string;
  relatedInvoiceId?: string;
  relatedContractId?: string;
  attachments?: { name: string; url: string }[];
  createdAt: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook idempotency
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessedStripeEvent {
  id: string;
  type: string;
  processedAt: Timestamp;
  result: 'success' | 'skipped' | 'error' | 'pending';
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline queue for driver dashboard
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingDriverAction {
  id: string;
  driverId: string;
  type: 'student_event' | 'route_complete' | 'route_missed' | 'route_notes' | 'gps_ping';
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Driver payouts
// ─────────────────────────────────────────────────────────────────────────────

export interface DriverPayout {
  id: string;
  driverId: string;
  amountCents: number;
  transferId: string;
  description?: string;
  periodStart: string;
  periodEnd: string;
  status: 'sent' | 'failed';
  createdAt: Timestamp;
  actorUid: string;
}
