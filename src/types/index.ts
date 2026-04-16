// Firestore Data Model Types for KIDZ Transportation

import { Timestamp } from 'firebase/firestore';

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: Date;
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

export interface Booking {
  id: string;
  clientId: string;
  studentIds: string[];
  pickupAddress: string;
  dropoffAddress: string;
  transportationType: TransportationType;
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
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  uid: string;
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
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

export interface Invoice {
  id: string;
  clientId: string;
  bookingId: string;
  periodStart: string;  // YYYY-MM-DD
  periodEnd: string;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  status: InvoiceStatus;
  dueDate: string;
  sentAt: Timestamp | null;
  paidAt: Timestamp | null;
  createdAt: Timestamp;
  notes: string;
}

export interface InvoiceLineItem {
  description: string;
  date?: string;
  quantity: number;  // days
  unitPrice: number;
  total: number;
}
