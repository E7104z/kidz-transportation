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
import type { Driver } from '../../types';
import logoSrc from '../../assets/KIDZ logo4 site.png';

const OWNER_NAME  = 'Kara Noland';
const OWNER_TITLE = 'Owner, KIDZ Transportation Services, LLC';

Font.register({
  family: 'Caveat',
  src: 'https://cdn.jsdelivr.net/fontsource/fonts/caveat@latest/latin-400-normal.ttf',
});

export interface DriverContractPDFProps {
  data: {
    driver: Driver;
    payoutSplit: number;
    agreementDate: string;
    generatedDate: string;
    signature?: {
      dataUrl: string;
      signedName: string;
      signedDate: string;
    };
  };
}

function splitToWords(n: number): string {
  const map: Record<number, string> = {
    50: 'fifty', 55: 'fifty-five', 60: 'sixty', 65: 'sixty-five',
    70: 'seventy', 75: 'seventy-five', 80: 'eighty', 85: 'eighty-five', 90: 'ninety',
  };
  return map[n] ?? String(n);
}

const NAVY      = '#1a2e4a';
const AMBER     = '#f59e0b';
const GRAY_BG   = '#f3f4f6';
const GRAY_TEXT = '#6b7280';

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingLeft: 40,
    paddingRight: 40,
    paddingBottom: 56,
    fontSize: 8.5,
    fontFamily: 'Helvetica',
    color: '#111827',
    lineHeight: 1.45,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  logoContainer: { width: 130, marginRight: 16 },
  logo: { width: 126, height: 70, objectFit: 'contain' },
  companyInfo: { flex: 1, alignItems: 'flex-end' },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 2 },
  contractTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: AMBER, marginBottom: 3 },
  companyContact: { fontSize: 8, color: GRAY_TEXT, marginBottom: 1 },
  generatedDate: { fontSize: 8, color: GRAY_TEXT, marginTop: 4 },
  rule: { borderBottomWidth: 2, borderBottomColor: NAVY, marginTop: 8, marginBottom: 12 },

  partiesBox: { backgroundColor: GRAY_BG, borderRadius: 4, padding: 10, marginBottom: 12 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell50: { width: '50%', marginBottom: 6, paddingRight: 8 },
  gridCell100: { width: '100%', marginBottom: 6 },
  cellLabel: { fontSize: 7.5, color: GRAY_TEXT, marginBottom: 1 },
  cellValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#111827' },

  articleTitle: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 4,
  },
  sectionNum: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginTop: 5,
    marginBottom: 2,
  },
  para: {
    fontSize: 8.5,
    color: '#374151',
    marginBottom: 3,
    lineHeight: 1.5,
  },
  bulletRow: { flexDirection: 'row', marginBottom: 2.5, paddingLeft: 10 },
  bulletDot: { fontSize: 8.5, color: '#374151', width: 12 },
  bulletText: { fontSize: 8.5, color: '#374151', flex: 1, lineHeight: 1.45 },

  compBox: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    padding: 10,
    marginBottom: 6,
    marginTop: 4,
  },
  compBoxRow: { flexDirection: 'row', marginBottom: 3 },
  compLabel: { fontSize: 8.5, color: GRAY_TEXT, width: 130 },
  compValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: NAVY, flex: 1 },

  signaturesRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  signatureBox: { width: '44%' },
  signatureLine: { borderBottomWidth: 1, borderBottomColor: '#9ca3af', marginBottom: 4, height: 30 },
  signatureLabel: { fontSize: 8, color: '#374151' },
  signatureDate: { fontSize: 8, color: GRAY_TEXT, marginTop: 6 },
  signatureImage: { position: 'absolute', left: 0, bottom: 6, height: 28, width: 180, objectFit: 'contain' },
  signatureTypedName: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 2 },
  ownerSignatureScript: { position: 'absolute', left: 4, bottom: 10, fontSize: 20, fontFamily: 'Caveat', color: NAVY },
  ownerSignatureTitle: { fontSize: 7.5, color: GRAY_TEXT, marginTop: 1 },

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
  footerLeft: { fontSize: 7, color: GRAY_TEXT },
  footerRight: { fontSize: 7, color: GRAY_TEXT },
});

const Bullet: React.FC<{ children: string }> = ({ children }) => (
  <View style={s.bulletRow}>
    <Text style={s.bulletDot}>•</Text>
    <Text style={s.bulletText}>{children}</Text>
  </View>
);

const DriverContractPDF: React.FC<DriverContractPDFProps> = ({ data }) => {
  const { driver, payoutSplit, agreementDate, generatedDate, signature } = data;
  const companyRetains = 100 - payoutSplit;
  const splitWord   = splitToWords(payoutSplit);
  const retainsWord = splitToWords(companyRetains);

  return (
    <Document title="KIDZ Transportation Independent Contractor Agreement" author="KIDZ Transportation Services, LLC">
      <Page size="A4" style={s.page}>

        {/* Fixed Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerLeft}>
            KIDZ Transportation Services, LLC | (314) 425-9668 | kidztransportation227@gmail.com
          </Text>
          <Text
            style={s.footerRight}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>

        {/* Header */}
        <View style={s.header}>
          <View style={s.logoContainer}>
            <Image src={logoSrc} style={s.logo} />
          </View>
          <View style={s.companyInfo}>
            <Text style={s.companyName}>KIDZ Transportation Services, LLC</Text>
            <Text style={s.contractTitle}>Independent Contractor Agreement</Text>
            <Text style={s.companyContact}>
              St. Louis, MO 63121 | (314) 425-9668 | kidztransportation227@gmail.com
            </Text>
            <Text style={s.generatedDate}>Generated: {generatedDate}</Text>
          </View>
        </View>
        <View style={s.rule} />

        {/* Parties block */}
        <View style={s.partiesBox}>
          <View style={s.grid2}>
            <View style={s.gridCell50}>
              <Text style={s.cellLabel}>Agreement Date</Text>
              <Text style={s.cellValue}>{agreementDate}</Text>
            </View>
            <View style={s.gridCell50}>
              <Text style={s.cellLabel}>Contractor Name</Text>
              <Text style={s.cellValue}>{driver.name || '—'}</Text>
            </View>
            <View style={s.gridCell50}>
              <Text style={s.cellLabel}>Contractor Address</Text>
              <Text style={s.cellValue}>{driver.address || '—'}</Text>
            </View>
            <View style={s.gridCell50}>
              <Text style={s.cellLabel}>Contractor Phone</Text>
              <Text style={s.cellValue}>{driver.phone || '—'}</Text>
            </View>
            <View style={s.gridCell100}>
              <Text style={s.cellLabel}>Contractor Email</Text>
              <Text style={s.cellValue}>{driver.email || '—'}</Text>
            </View>
          </View>
        </View>

        {/* RECITALS */}
        <Text style={s.articleTitle}>RECITALS</Text>
        <Text style={s.para}>
          This Independent Contractor Agreement ("Agreement") is entered into between KIDZ Transportation
          Services, LLC, a Missouri limited liability company ("Company"), and the individual identified
          above ("Contractor"). The parties agree that Contractor will provide transportation services to
          clients of the Company on the terms set forth below.
        </Text>

        {/* Article 1 */}
        <Text style={s.articleTitle}>ARTICLE 1 — INDEPENDENT CONTRACTOR RELATIONSHIP</Text>
        <Text style={s.sectionNum}>1.1 Contractor Status.</Text>
        <Text style={s.para}>
          Contractor is an independent contractor and not an employee, agent, partner, or joint venturer
          of the Company. Nothing in this Agreement shall be construed to create an employment relationship.
          Contractor has no authority to bind the Company to any contract, obligation, or liability.
        </Text>
        <Text style={s.sectionNum}>1.2 Control.</Text>
        <Text style={s.para}>
          Contractor retains full control over the manner and means by which transportation services are
          performed, including routes taken, driving habits, and scheduling within the parameters agreed
          upon with individual clients. The Company's interest is in the result of the service — safe,
          on-time transportation — not in dictating how Contractor achieves it.
        </Text>
        <Text style={s.sectionNum}>1.3 No Benefits.</Text>
        <Text style={s.para}>
          Contractor is not entitled to and shall not receive any employee benefits from the Company,
          including but not limited to: health insurance, paid vacation, paid sick leave, retirement
          benefits, workers' compensation coverage, or unemployment insurance. Contractor is solely
          responsible for obtaining any such benefits independently.
        </Text>
        <Text style={s.sectionNum}>1.4 Tools and Equipment.</Text>
        <Text style={s.para}>
          Contractor shall supply their own vehicle, fuel, insurance, and all other equipment necessary
          to perform services under this Agreement. The Company shall not reimburse Contractor for vehicle
          expenses, fuel, maintenance, tolls, parking, or any other operating cost unless explicitly agreed
          to in writing on a case-by-case basis.
        </Text>

        {/* Article 2 */}
        <Text style={s.articleTitle}>ARTICLE 2 — SERVICES</Text>
        <Text style={s.sectionNum}>2.1 Scope of Services.</Text>
        <Text style={s.para}>
          Contractor agrees to provide safe, reliable, and professional transportation services for children
          ("Students") assigned to Contractor by the Company. Services include, but are not limited to:
          pickup of Students from designated locations, transport to school, daycare, afterschool programs,
          or other destinations as assigned, and dropoff at designated locations.
        </Text>
        <Text style={s.sectionNum}>2.2 Route Assignments.</Text>
        <Text style={s.para}>
          The Company will assign routes to Contractor through the KIDZ Transportation driver application
          ("App"). Contractor agrees to accept or decline assignments within the App and to honor all
          accepted assignments. Once a route is accepted, Contractor is responsible for running that route
          every scheduled day unless excused pursuant to Section 2.4.
        </Text>
        <Text style={s.sectionNum}>2.3 Standards of Service.</Text>
        <Text style={s.para}>Contractor agrees to at all times:</Text>
        <Bullet>Arrive at pickup locations on or before the scheduled pickup time;</Bullet>
        <Bullet>Ensure every Student is properly secured in an age-appropriate seat before moving the vehicle;</Bullet>
        <Bullet>Never leave a Student unattended in the vehicle;</Bullet>
        <Bullet>Release Students only to persons on the approved release list provided by the Company;</Bullet>
        <Bullet>Maintain a clean, safe, and mechanically sound vehicle at all times;</Bullet>
        <Bullet>Behave professionally and respectfully toward Students, parents, guardians, and school staff;</Bullet>
        <Bullet>Refrain from using a handheld mobile device while the vehicle is in motion;</Bullet>
        <Bullet>Never transport a Student while under the influence of alcohol, cannabis, prescription medication that impairs driving ability, or any controlled substance;</Bullet>
        <Bullet>Log all Student pickup and dropoff events in the App in real time;</Bullet>
        <Bullet>Report any incident, injury, accident, or concern to the Company immediately.</Bullet>
        <Text style={s.sectionNum}>2.4 Absences and Cancellations.</Text>
        <Text style={s.para}>
          Contractor must notify the Company of any inability to run an assigned route as early as possible
          and no later than two (2) hours before the scheduled route start time. Repeated or last-minute
          cancellations without adequate notice may result in termination of this Agreement at the Company's
          discretion.
        </Text>
        <Text style={s.sectionNum}>2.5 Substitute Drivers.</Text>
        <Text style={s.para}>
          Contractor may not send a substitute driver in their place without the Company's prior written
          approval. Any substitute must be independently approved and contracted by the Company before
          providing services.
        </Text>

        {/* Article 3 — Compensation (dynamic split) */}
        <Text style={s.articleTitle}>ARTICLE 3 — COMPENSATION</Text>
        <View style={s.compBox}>
          <View style={s.compBoxRow}>
            <Text style={s.compLabel}>Contractor Payout Rate:</Text>
            <Text style={s.compValue}>{splitWord} percent ({payoutSplit}%) of gross weekly route fee</Text>
          </View>
          <View style={s.compBoxRow}>
            <Text style={s.compLabel}>Company Administrative Fee:</Text>
            <Text style={s.compValue}>{retainsWord} percent ({companyRetains}%) of gross weekly route fee</Text>
          </View>
        </View>
        <Text style={s.sectionNum}>3.1 Rate Structure.</Text>
        <Text style={s.para}>
          Contractor shall be compensated at a rate of {splitWord} percent ({payoutSplit}%) of the gross
          weekly route fee charged to the client for each route assigned to and completed by Contractor.
          The Company retains the remaining {retainsWord} percent ({companyRetains}%) as an administrative
          and operations fee.
        </Text>
        <Text style={s.sectionNum}>3.2 Payment Timing.</Text>
        <Text style={s.para}>
          Compensation is calculated weekly based on completed routes as logged in the App. Payment will
          be issued within seven (7) business days following the close of each weekly service period.
          The weekly service period runs Monday through Sunday.
        </Text>
        <Text style={s.sectionNum}>3.3 Incomplete Routes.</Text>
        <Text style={s.para}>
          Compensation is earned only for routes that are actually completed. A route that is partially
          completed, skipped, or cancelled by Contractor without approval will not be compensated for
          that day's service. Routes marked missed in the App are not eligible for payout.
        </Text>
        <Text style={s.sectionNum}>3.4 Payment Method.</Text>
        <Text style={s.para}>
          The Company will pay Contractor via the method on file (Zelle, direct deposit, or check as
          elected by Contractor). Contractor is responsible for keeping payment information current in the App.
        </Text>
        <Text style={s.sectionNum}>3.5 No Guaranteed Minimum.</Text>
        <Text style={s.para}>
          This Agreement does not guarantee any minimum number of routes, minimum hours, or minimum
          compensation. Route availability depends on client demand and Company operations.
        </Text>
        <Text style={s.sectionNum}>3.6 Taxes.</Text>
        <Text style={s.para}>
          Contractor is solely responsible for all federal, state, and local taxes on compensation received
          under this Agreement, including self-employment tax. The Company will issue an IRS Form 1099-NEC
          for any calendar year in which Contractor earns $600 or more. Contractor must provide a completed
          and accurate IRS Form W-9 before any compensation is issued.
        </Text>

        {/* Article 4 */}
        <Text style={s.articleTitle}>ARTICLE 4 — VEHICLE AND INSURANCE REQUIREMENTS</Text>
        <Text style={s.sectionNum}>4.1 Vehicle Requirements.</Text>
        <Text style={s.para}>Contractor's vehicle must at all times:</Text>
        <Bullet>Be properly registered in the state of Missouri (or Contractor's state of residence);</Bullet>
        <Bullet>Have current, valid license plates;</Bullet>
        <Bullet>Be maintained in safe, clean, and mechanically sound condition;</Bullet>
        <Bullet>Have functioning seat belts for every seat used to transport Students;</Bullet>
        <Bullet>Have functional heat and air conditioning;</Bullet>
        <Bullet>Pass a visual safety inspection upon the Company's request at any time.</Bullet>
        <Text style={s.sectionNum}>4.2 Insurance Requirements.</Text>
        <Text style={s.para}>
          Contractor must maintain, at their own expense, a personal or commercial auto insurance policy
          that meets or exceeds Missouri state minimum liability requirements. Contractor must be listed
          as a covered driver on any policy covering the vehicle used for services. Contractor must provide
          proof of current insurance to the Company before beginning services and must provide updated proof
          upon any policy change or renewal.
        </Text>
        <Text style={s.sectionNum}>4.3 Lapse of Coverage.</Text>
        <Text style={s.para}>
          Any lapse in required insurance coverage immediately suspends Contractor's right to provide
          services under this Agreement until valid coverage is reinstated and proof is provided to the Company.
        </Text>
        <Text style={s.sectionNum}>4.4 Accidents and Incidents.</Text>
        <Text style={s.para}>
          Contractor is solely responsible for their vehicle and any accidents, damage, citations, or
          liability arising from their operation of it. The Company carries no liability for Contractor's
          vehicle or driving. Contractor must notify the Company immediately of any accident occurring
          during the performance of services, regardless of fault or severity.
        </Text>

        {/* Article 5 */}
        <Text style={s.articleTitle}>ARTICLE 5 — BACKGROUND CHECKS AND ELIGIBILITY</Text>
        <Text style={s.sectionNum}>5.1 Background Check Consent.</Text>
        <Text style={s.para}>
          Contractor consents to a criminal background check and motor vehicle record (MVR) check as a
          condition of this Agreement. Continued engagement under this Agreement is contingent on the
          results of these checks meeting the Company's standards.
        </Text>
        <Text style={s.sectionNum}>5.2 Ongoing Eligibility.</Text>
        <Text style={s.para}>
          Contractor agrees to notify the Company immediately if, at any time during the term of this
          Agreement, Contractor:
        </Text>
        <Bullet>Is arrested for, charged with, or convicted of any criminal offense;</Bullet>
        <Bullet>Receives any traffic citation involving alcohol, drugs, reckless driving, or a moving violation;</Bullet>
        <Bullet>Has their driver's license suspended, revoked, or restricted in any way;</Bullet>
        <Bullet>Is involved in an at-fault accident.</Bullet>
        <Text style={s.para}>
          Failure to disclose any of the above is grounds for immediate termination of this Agreement.
        </Text>
        <Text style={s.sectionNum}>5.3 Minimum Qualifications.</Text>
        <Text style={s.para}>
          Contractor represents and warrants that they are at least 21 years of age, hold a valid driver's
          license, and have no disqualifying criminal history involving violence, theft, drugs, or offenses
          against children.
        </Text>

        {/* Article 6 */}
        <Text style={s.articleTitle}>ARTICLE 6 — CONFIDENTIALITY</Text>
        <Text style={s.sectionNum}>6.1 Student and Client Information.</Text>
        <Text style={s.para}>
          In the course of providing services, Contractor will have access to personally identifiable
          information about Students and their families, including names, addresses, school information,
          medical notes, and contact information. Contractor agrees to treat all such information as
          strictly confidential, to use it solely for the purpose of performing assigned routes, and to
          never share it with any third party for any reason.
        </Text>
        <Text style={s.sectionNum}>6.2 Company Information.</Text>
        <Text style={s.para}>
          Contractor agrees to keep confidential any non-public information about the Company's clients,
          pricing, operations, or business relationships, both during and after the term of this Agreement.
        </Text>
        <Text style={s.sectionNum}>6.3 Survival.</Text>
        <Text style={s.para}>This Article survives termination of the Agreement indefinitely.</Text>

        {/* Article 7 */}
        <Text style={s.articleTitle}>ARTICLE 7 — TERM AND TERMINATION</Text>
        <Text style={s.sectionNum}>7.1 Term.</Text>
        <Text style={s.para}>
          This Agreement begins on the date signed and continues on an at-will basis until terminated
          by either party.
        </Text>
        <Text style={s.sectionNum}>7.2 Termination by Either Party.</Text>
        <Text style={s.para}>
          Either party may terminate this Agreement at any time by providing written notice. Notice may
          be delivered via email, text message, or through the App. Termination does not affect any
          compensation already earned for completed routes.
        </Text>
        <Text style={s.sectionNum}>7.3 Immediate Termination.</Text>
        <Text style={s.para}>
          The Company may terminate this Agreement immediately and without notice if Contractor:
        </Text>
        <Bullet>Violates any provision of Section 2.3 (Standards of Service);</Bullet>
        <Bullet>Fails to disclose a disqualifying event under Section 5.2;</Bullet>
        <Bullet>Is found to have misrepresented any information in their application or onboarding;</Bullet>
        <Bullet>Engages in any conduct that, in the Company's reasonable judgment, poses a safety risk to any Student;</Bullet>
        <Bullet>Fails to run assigned routes on three (3) or more occasions within any 30-day period without adequate notice.</Bullet>
        <Text style={s.sectionNum}>7.4 Effect of Termination.</Text>
        <Text style={s.para}>
          Upon termination, Contractor must immediately cease representing themselves as affiliated with
          KIDZ Transportation Services and must remove any KIDZ branding or materials from their vehicle,
          if applicable. All confidentiality obligations remain in effect.
        </Text>

        {/* Article 8 */}
        <Text style={s.articleTitle}>ARTICLE 8 — INDEMNIFICATION AND LIABILITY</Text>
        <Text style={s.sectionNum}>8.1 Indemnification by Contractor.</Text>
        <Text style={s.para}>
          Contractor agrees to indemnify, defend, and hold harmless the Company, its members, managers,
          officers, employees, and agents from and against any claims, damages, losses, costs, or expenses
          (including reasonable attorneys' fees) arising out of or related to: (a) Contractor's operation
          of their vehicle; (b) any act or omission of Contractor while performing services; or
          (c) Contractor's breach of any provision of this Agreement.
        </Text>
        <Text style={s.sectionNum}>8.2 Limitation of Company Liability.</Text>
        <Text style={s.para}>
          The Company's total liability to Contractor under this Agreement, for any reason and any cause
          of action, shall not exceed the total compensation paid to Contractor in the sixty (60) days
          preceding the event giving rise to the claim.
        </Text>
        <Text style={s.sectionNum}>8.3 No Liability for Route Availability.</Text>
        <Text style={s.para}>
          The Company is not liable to Contractor for any loss of income resulting from a reduction in
          routes, loss of a client, or termination of this Agreement.
        </Text>

        {/* Article 9 */}
        <Text style={s.articleTitle}>ARTICLE 9 — GENERAL PROVISIONS</Text>
        <Text style={s.sectionNum}>9.1 Governing Law.</Text>
        <Text style={s.para}>
          This Agreement is governed by the laws of the State of Missouri without regard to conflicts
          of law principles.
        </Text>
        <Text style={s.sectionNum}>9.2 Dispute Resolution.</Text>
        <Text style={s.para}>
          The parties agree to attempt to resolve any dispute informally before pursuing formal legal
          action. Any litigation arising from this Agreement shall be filed exclusively in the state or
          federal courts located in St. Louis County, Missouri.
        </Text>
        <Text style={s.sectionNum}>9.3 Entire Agreement.</Text>
        <Text style={s.para}>
          This Agreement constitutes the entire agreement between the parties regarding the subject matter
          herein and supersedes all prior discussions, representations, or agreements, whether written or oral.
        </Text>
        <Text style={s.sectionNum}>9.4 Amendments.</Text>
        <Text style={s.para}>
          This Agreement may be amended only by a written instrument signed by both parties, or by an
          updated version acknowledged by Contractor through the App.
        </Text>
        <Text style={s.sectionNum}>9.5 Severability.</Text>
        <Text style={s.para}>
          If any provision of this Agreement is found to be unenforceable, the remaining provisions shall
          remain in full force and effect.
        </Text>
        <Text style={s.sectionNum}>9.6 Waiver.</Text>
        <Text style={s.para}>
          The failure of either party to enforce any provision of this Agreement shall not constitute a
          waiver of that party's right to enforce it in the future.
        </Text>
        <Text style={s.sectionNum}>9.7 Counterparts / Electronic Signature.</Text>
        <Text style={s.para}>
          This Agreement may be executed electronically. An electronic signature made through the KIDZ
          Transportation App has the same legal force and effect as a handwritten signature under Missouri
          law and the federal Electronic Signatures in Global and National Commerce Act (E-SIGN).
        </Text>

        {/* Signatures */}
        <Text style={{ ...s.articleTitle, marginTop: 16 }}>SIGNATURES</Text>
        <Text style={s.para}>
          By signing below, both parties agree to be bound by the terms of this Agreement. This agreement
          is delivered and executed through the KIDZ Transportation driver portal. The Contractor's digital
          acknowledgment recorded in the system, including timestamp and IP address, constitutes a valid
          and binding electronic signature.
        </Text>
        <View style={s.signaturesRow}>
          <View style={s.signatureBox}>
            <View style={s.signatureLine}>
              {signature?.dataUrl && (
                <Image src={signature.dataUrl} style={s.signatureImage} />
              )}
            </View>
            <Text style={s.signatureLabel}>Contractor Signature</Text>
            {signature?.signedName && (
              <Text style={s.signatureTypedName}>{signature.signedName}</Text>
            )}
            <Text style={s.signatureDate}>Date: {signature?.signedDate || '________'}</Text>
          </View>
          <View style={s.signatureBox}>
            <View style={s.signatureLine}>
              <Text style={s.ownerSignatureScript}>{OWNER_NAME}</Text>
            </View>
            <Text style={s.signatureLabel}>KIDZ Transportation Services, LLC</Text>
            <Text style={s.ownerSignatureTitle}>{OWNER_TITLE}</Text>
            <Text style={s.signatureDate}>Date: {generatedDate}</Text>
          </View>
        </View>

      </Page>
    </Document>
  );
};

export default DriverContractPDF;
