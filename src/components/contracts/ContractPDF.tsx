import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import type { Client, Student, Booking } from '../../types';
import { calculateAge } from '../../utils/calculateAge';
import logoSrc from '../../assets/KIDZ logo4 site.png';

// ── Owner / company representative (pre-filled on every contract) ──────
// Update these values to change the printed company signature.
const OWNER_NAME  = 'Kara Noland';
const OWNER_TITLE = 'Owner, KIDZ Transportation Services, LLC';

// Cursive handwriting font for typed signatures. @react-pdf/renderer embeds
// the TTF into the PDF at render time, so the final document is self-contained.
Font.register({
  family: 'Caveat',
  src: 'https://cdn.jsdelivr.net/fontsource/fonts/caveat@latest/latin-400-normal.ttf',
});

interface ContractPDFProps {
  data: {
    client: Client;
    students: Student[];
    booking: Booking;
    generatedDate: string;
    applicationFeePaid: boolean;
    signature?: {
      dataUrl: string;        // PNG data URL drawn by the parent
      signedName: string;     // typed legal name
      signedDate: string;     // "April 23, 2026"
    };
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
  studentBoxCell25: {
    width: '25%',
    marginBottom: 4,
    paddingRight: 6,
  },
  studentBoxCell50: {
    width: '50%',
    marginBottom: 4,
    paddingRight: 6,
  },
  // ── Medical / Emergency ─────────────────────────────────
  fullCell: {
    width: '100%',
    marginBottom: 6,
  },
  warningBanner: {
    backgroundColor: '#fef3c7',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 8,
    paddingRight: 8,
    marginBottom: 8,
  },
  warningText: {
    fontSize: 8.5,
    color: '#92400e',
    fontFamily: 'Helvetica-Bold',
  },
  medicalAlertBox: {
    backgroundColor: '#fffbeb',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 8,
    paddingRight: 8,
    marginBottom: 6,
    width: '100%',
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
  signatureImage: {
    position: 'absolute',
    left: 0,
    bottom: 6,
    height: 28,
    width: 180,
    objectFit: 'contain',
  },
  signatureTypedName: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    marginTop: 2,
  },
  ownerSignatureScript: {
    position: 'absolute',
    left: 4,
    bottom: 10,
    fontSize: 20,
    fontFamily: 'Caveat',
    color: NAVY,
  },
  ownerSignatureTitle: {
    fontSize: 7.5,
    color: GRAY_TEXT,
    marginTop: 1,
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
  const { client, students, booking, generatedDate, applicationFeePaid, signature } = data;

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

        {students.map((student, idx) => {
          const computedAge = calculateAge(student.dob);
          const ageDisplay = !isNaN(computedAge) ? String(computedAge) : (student.age ? String(student.age) : '—');
          return (
            <View key={idx} style={s.studentBox}>
              <View style={s.studentBoxGrid}>
                <View style={s.studentBoxCell25}>
                  <Text style={s.cellLabel}>Student Name</Text>
                  <Text style={s.cellValue}>{student.name || '—'}</Text>
                </View>
                <View style={s.studentBoxCell25}>
                  <Text style={s.cellLabel}>Date of Birth</Text>
                  <Text style={s.cellValue}>{student.dob || '—'}</Text>
                </View>
                <View style={s.studentBoxCell25}>
                  <Text style={s.cellLabel}>Age</Text>
                  <Text style={s.cellValue}>{ageDisplay}</Text>
                </View>
                <View style={s.studentBoxCell25}>
                  <Text style={s.cellLabel}>Grade</Text>
                  <Text style={s.cellValue}>{student.grade || '—'}</Text>
                </View>
                <View style={s.studentBoxCell50}>
                  <Text style={s.cellLabel}>School Name</Text>
                  <Text style={s.cellValue}>{student.schoolName || '—'}</Text>
                </View>
                <View style={s.studentBoxCell50}>
                  <Text style={s.cellLabel}>School Contact</Text>
                  <Text style={s.cellValue}>{student.schoolContact || '—'}</Text>
                </View>
              </View>
            </View>
          );
        })}

        {/* ────────────────────────────────────────────────
            Section 2 — SERVICE DETAILS
        ──────────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>SERVICE DETAILS</Text>
        <View style={s.grid2}>
          <View style={s.gridCell50}>
            <Text style={s.cellLabel}>Purpose of Transportation</Text>
            <Text style={s.cellValue}>{booking.transportationPurpose || 'School'}</Text>
          </View>
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
            Section 2.5 — MEDICAL & EMERGENCY INFORMATION
        ──────────────────────────────────────────────── */}
        {(() => {
          // Aggregate medical info across all students for the contract.
          const medicalLines = students
            .map(st => {
              const parts: string[] = [];
              if (st.allergies?.trim()) parts.push(st.allergies.trim());
              if (st.medicalNotes?.trim()) parts.push(st.medicalNotes.trim());
              return parts.length ? `${st.name || 'Student'}: ${parts.join('; ')}` : '';
            })
            .filter(Boolean);
          const specialLines = students
            .map(st => (st.specialRequirements?.trim() ? `${st.name || 'Student'}: ${st.specialRequirements.trim()}` : ''))
            .filter(Boolean);
          const hasMedical = medicalLines.length > 0;
          const hasSpecial = specialLines.length > 0;
          const ecName = booking.emergencyContact?.trim();
          const ecPhone = booking.emergencyPhone?.trim();
          const ecRel = booking.emergencyContactRelationship?.trim();
          const ecMissing = !ecName && !ecPhone;

          return (
            <>
              <Text style={s.sectionLabel}>MEDICAL &amp; EMERGENCY INFORMATION</Text>
              {ecMissing && (
                <View style={s.warningBanner}>
                  <Text style={s.warningText}>
                    ⚠ Emergency contact information not on file. Please update this record.
                  </Text>
                </View>
              )}
              {hasMedical ? (
                <View style={s.medicalAlertBox}>
                  <Text style={s.cellLabel}>Medical Conditions / Allergies</Text>
                  <Text style={s.cellValue}>{medicalLines.join('  •  ')}</Text>
                </View>
              ) : (
                <View style={s.fullCell}>
                  <Text style={s.cellLabel}>Medical Conditions / Allergies</Text>
                  <Text style={s.cellValue}>None reported</Text>
                </View>
              )}
              <View style={s.fullCell}>
                <Text style={s.cellLabel}>Special Instructions / Requirements</Text>
                <Text style={s.cellValue}>{hasSpecial ? specialLines.join('  •  ') : 'None'}</Text>
              </View>
              <View style={s.grid2}>
                <View style={[s.gridCell50, { width: '34%' }]}>
                  <Text style={s.cellLabel}>Emergency Contact Name</Text>
                  <Text style={s.cellValue}>{ecName || 'Not on file'}</Text>
                </View>
                <View style={[s.gridCell50, { width: '34%' }]}>
                  <Text style={s.cellLabel}>Emergency Contact Phone</Text>
                  <Text style={s.cellValue}>{ecPhone || 'Not on file'}</Text>
                </View>
                <View style={[s.gridCell50, { width: '32%' }]}>
                  <Text style={s.cellLabel}>Relationship</Text>
                  <Text style={s.cellValue}>{ecRel || 'Not on file'}</Text>
                </View>
              </View>
            </>
          );
        })()}

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
            '8. Parent/Guardian is responsible for providing accurate medical information and emergency contacts. KIDZ Transportation must be notified in writing of any changes.',
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
            <View style={s.signatureLine}>
              {signature?.dataUrl && (
                <Image src={signature.dataUrl} style={s.signatureImage} />
              )}
            </View>
            <Text style={s.signatureLabel}>Parent/Guardian Signature</Text>
            {signature?.signedName && (
              <Text style={s.signatureTypedName}>{signature.signedName}</Text>
            )}
            <Text style={s.signatureDate}>Date: {signature?.signedDate || '________'}</Text>
          </View>
          <View style={s.signatureBox}>
            <View style={s.signatureLine}>
              <Text style={s.ownerSignatureScript}>{OWNER_NAME}</Text>
            </View>
            <Text style={s.signatureLabel}>KIDZ Transportation Representative</Text>
            <Text style={s.ownerSignatureTitle}>{OWNER_TITLE}</Text>
            <Text style={s.signatureDate}>Date: {generatedDate}</Text>
          </View>
        </View>

      </Page>
    </Document>
  );
};

export default ContractPDF;
