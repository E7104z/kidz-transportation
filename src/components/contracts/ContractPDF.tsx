import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';
import type { Client, Student, Booking } from '../../types';
import logoSrc from '../../assets/KIDZ logo4 site.png';

interface ContractPDFProps {
  data: {
    client: Client;
    students: Student[];
    booking: Booking;
    generatedDate: string;
    applicationFeePaid: boolean;
  };
}

const NAVY = '#1a2e4a';
const AMBER = '#f59e0b';
const GRAY_BG = '#f3f4f6';
const GRAY_TEXT = '#6b7280';
const LOGO_URL = logoSrc;
const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingLeft: 40,
    paddingRight: 40,
    paddingBottom: 60,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111827',
    lineHeight: 1.4,
  },
  // ── Header ──────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  logoContainer: {
    width: 130,
    marginRight: 16,
  },
  logo: {
    width: 126,
    height: 70,
    objectFit: 'contain',
  },
  companyInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  companyName: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    marginBottom: 2,
  },
  contractTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: AMBER,
    marginBottom: 3,
  },
  companyContact: {
    fontSize: 8,
    color: GRAY_TEXT,
    marginBottom: 1,
  },
  generatedDate: {
    fontSize: 8,
    color: GRAY_TEXT,
    marginTop: 4,
  },
  rule: {
    borderBottomWidth: 2,
    borderBottomColor: NAVY,
    marginTop: 8,
    marginBottom: 14,
  },
  // ── Section Labels ───────────────────────────────────────
  sectionLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 14,
  },
  // ── 2-Column Grid ─────────────────────────────────────
  grid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  gridCell50: {
    width: '50%',
    marginBottom: 6,
    paddingRight: 8,
  },
  cellLabel: {
    fontSize: 7.5,
    color: GRAY_TEXT,
    marginBottom: 1,
  },
  cellValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  // ── Student Box ─────────────────────────────────────────
  studentBox: {
    backgroundColor: GRAY_BG,
    borderRadius: 4,
    padding: 8,
    marginBottom: 6,
  },
  studentBoxGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  studentBoxCell: {
    width: '33%',
    marginBottom: 4,
    paddingRight: 6,
  },
  // ── Rate Summary ─────────────────────────────────────────
  rateBox: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    padding: 12,
    marginTop: 4,
  },
  weeklyRate: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
  },
  dailyRateText: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    marginTop: 4,
  },
  rateNote: {
    fontSize: 8,
    color: GRAY_TEXT,
    marginTop: 6,
  },
  feeRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  feeLabel: {
    fontSize: 9,
    color: '#111827',
    marginRight: 4,
  },
  feePaid: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#16a34a',
  },
  feeDue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#dc2626',
  },
  // ── Terms ─────────────────────────────────────────────
  termsContainer: {
    marginTop: 4,
  },
  termItem: {
    fontSize: 8,
    color: '#374151',
    marginBottom: 3,
  },
  // ── Signatures ───────────────────────────────────────────
  signaturesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  signatureBox: {
    width: '44%',
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#9ca3af',
    marginBottom: 4,
    height: 30,
  },
  signatureLabel: {
    fontSize: 8,
    color: '#374151',
  },
  signatureDate: {
    fontSize: 8,
    color: GRAY_TEXT,
    marginTop: 6,
  },
  // ── Footer (fixed every page) ───────────────────────────
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: '#d1d5db',
    paddingTop: 5,
  },
  footerLeft: {
    fontSize: 7,
    color: GRAY_TEXT,
  },
  footerRight: {
    fontSize: 7,
    color: GRAY_TEXT,
  },
});

const ContractPDF: React.FC<ContractPDFProps> = ({ data }) => {
  const { client, students, booking, generatedDate, applicationFeePaid } = data;

  const selectedDays = DAYS_ORDER.filter(d => booking.daysOfWeek.includes(d));

  const formatStartDate = () => {
    if (!booking.serviceStartDate) return '—';
    if (booking.serviceStartDate instanceof Date) {
      return booking.serviceStartDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
    // Firestore Timestamp duck-typed
    const raw = booking.serviceStartDate as any;
    if (typeof raw?.toDate === 'function') {
      return raw.toDate().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return String(booking.serviceStartDate);
  };

  const formatTransportType = (t: string) =>
    t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <Document title="KIDZ Transportation Service Agreement" author="KIDZ Transportation Services, LLC">
      <Page size="A4" style={s.page}>

        {/* ── Fixed Footer (every page) ────────────────── */}
        <View style={s.footer} fixed>
          <Text style={s.footerLeft}>
            KIDZ Transportation Services, LLC | (314) 425-9668 | kidztransportation227@gmail.com
          </Text>
          <Text
            style={s.footerRight}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>

        {/* ── Header ──────────────────────────────────── */}
        <View style={s.header}>
          <View style={s.logoContainer}>
            <Image src={LOGO_URL} style={s.logo} />
          </View>
          <View style={s.companyInfo}>
            <Text style={s.companyName}>KIDZ Transportation Services, LLC</Text>
            <Text style={s.contractTitle}>Transportation Service Agreement</Text>
            <Text style={s.companyContact}>
              St. Louis, MO 63121 | (314) 425-9668 | kidztransportation227@gmail.com
            </Text>
            <Text style={s.generatedDate}>Generated: {generatedDate}</Text>
          </View>
        </View>

        {/* ── Navy Rule ────────────────────────────────── */}
        <View style={s.rule} />

        {/* ────────────────────────────────────────────────
            Section 1 — CLIENT INFORMATION
        ──────────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>CLIENT INFORMATION</Text>
        <View style={s.grid2}>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Parent Name</Text>
            <Text style={s.cellValue}>{client.name}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Phone</Text>
            <Text style={s.cellValue}>{client.phone}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Email</Text>
            <Text style={s.cellValue}>{client.email}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Home Address</Text>
            <Text style={s.cellValue}>{client.address}</Text>
          </View>
        </View>

        {students.map((student, idx) => (
          <View key={idx} style={s.studentBox}>
            <View style={s.studentBoxGrid}>
              <View style={s.studentBoxCell}>
                <Text style={s.cellLabel}>Student Name</Text>
                <Text style={s.cellValue}>{student.name}</Text>
              </View>
              <View style={s.studentBoxCell}>
                <Text style={s.cellLabel}>Date of Birth</Text>
                <Text style={s.cellValue}>{student.dob}</Text>
              </View>
              <View style={s.studentBoxCell}>
                <Text style={s.cellLabel}>Grade</Text>
                <Text style={s.cellValue}>{student.grade}</Text>
              </View>
              <View style={s.studentBoxCell}>
                <Text style={s.cellLabel}>School Name</Text>
                <Text style={s.cellValue}>{student.schoolName}</Text>
              </View>
              <View style={s.studentBoxCell}>
                <Text style={s.cellLabel}>School Contact</Text>
                <Text style={s.cellValue}>{student.schoolContact || '—'}</Text>
              </View>
            </View>
          </View>
        ))}

        {/* ────────────────────────────────────────────────
            Section 2 — SERVICE DETAILS
        ──────────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>SERVICE DETAILS</Text>
        <View style={s.grid2}>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Transportation Type</Text>
            <Text style={s.cellValue}>{formatTransportType(booking.transportationType)}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Days of Service</Text>
            <Text style={s.cellValue}>{selectedDays.join(', ')}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Pickup Address</Text>
            <Text style={s.cellValue}>{booking.pickupAddress}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Dropoff Address</Text>
            <Text style={s.cellValue}>{booking.dropoffAddress}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>School Start Time</Text>
            <Text style={s.cellValue}>{booking.schoolStartTime || '—'}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>School End Time</Text>
            <Text style={s.cellValue}>{booking.schoolEndTime || '—'}</Text>
          </View>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Service Start Date</Text>
            <Text style={s.cellValue}>{formatStartDate()}</Text>
          </View>
        </View>

        {/* ────────────────────────────────────────────────
            Section 3 — RATE SUMMARY
        ──────────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>RATE SUMMARY</Text>
        <View style={s.rateBox}>
          <Text style={s.weeklyRate}>${(booking.weeklyRate || 0).toFixed(2)} / week</Text>
          <Text style={s.dailyRateText}>${(booking.dailyRate || 0).toFixed(2)} / day</Text>
          <Text style={s.rateNote}>
            Weekly service = 3 or more days per week. Fewer than 3 days billed at daily rate.
          </Text>
          <View style={s.feeRow}>
            <Text style={s.feeLabel}>Application Fee: $40.00 —</Text>
            {applicationFeePaid
              ? <Text style={s.feePaid}>Paid</Text>
              : <Text style={s.feeDue}>Due at start of service</Text>
            }
          </View>
        </View>

        {/* ────────────────────────────────────────────────
            Section 4 — TERMS & CONDITIONS
        ──────────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>TERMS &amp; CONDITIONS</Text>
        <View style={s.termsContainer}>
          {[
            '1. Service begins on the agreed start date pending receipt of the application fee.',
            '2. Weekly rates are due every Monday by 9:00 AM.',
            '3. KIDZ Transportation reserves the right to suspend service for non-payment.',
            '4. Parents must notify KIDZ Transportation of any schedule changes 24 hours in advance.',
            '5. KIDZ Transportation is not responsible for delays caused by traffic, weather, or school schedule changes.',
            '6. This agreement renews weekly unless cancelled in writing by either party.',
            '7. KIDZ Transportation maintains all required state certifications and insurance.',
          ].map((term, i) => (
            <Text key={i} style={s.termItem}>{term}</Text>
          ))}
        </View>

        {/* ────────────────────────────────────────────────
            Section 5 — SIGNATURES
        ──────────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>SIGNATURES</Text>
        <View style={s.signaturesRow}>
          <View style={s.signatureBox}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Parent/Guardian Signature</Text>
            <Text style={s.signatureDate}>Date: ________</Text>
          </View>
          <View style={s.signatureBox}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>KIDZ Transportation Representative</Text>
            <Text style={s.signatureDate}>Date: ________</Text>
          </View>
        </View>

      </Page>
    </Document>
  );
};

export default ContractPDF;
