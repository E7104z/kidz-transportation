// W2PayStubPDF.tsx
// PDF document for a W-2 employee pay stub matching the Paychex layout.
// Two-column: left column = Personal & Check Information + Net Pay Allocations,
// right column = Earnings (top) + Withholding (bottom).

import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer';
import type { W2PayStub } from '../../types';

interface W2PayStubPDFProps {
  stub: W2PayStub;
}

// ── helpers ────────────────────────────────────────────────────────────────

function fmtDollar(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(yyyymmdd: string): string {
  if (!yyyymmdd) return '';
  const [y, m, d] = yyyymmdd.split('-');
  return `${m}/${d}/${y.slice(2)}`; // MM/DD/YY
}

// ── styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    padding: 24,
    color: '#000000',
  },
  // ── Header ──
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerLeft: {
    flex: 1,
  },
  companyName: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  headerRight: {
    alignItems: 'flex-end',
    flex: 1,
  },
  nonNegotiable: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#d0d0d0',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  accountInfo: {
    fontSize: 7,
    textAlign: 'right',
  },
  eeId: {
    fontSize: 7,
    textAlign: 'right',
  },
  // ── Employee block ──
  employeeBlock: {
    marginBottom: 8,
  },
  employeeName: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  // ── Net Pay box ──
  netPayBox: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 10,
    gap: 20,
  },
  netPayItem: {
    alignItems: 'flex-end',
  },
  netPayLabel: {
    fontSize: 7,
    textTransform: 'uppercase',
  },
  netPayAmount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  // ── Two-column body ──
  bodyRow: {
    flexDirection: 'row',
    flex: 1,
    gap: 12,
  },
  leftCol: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#e0e0e0',
    paddingRight: 6,
  },
  rightCol: {
    flex: 1,
    paddingLeft: 6,
  },
  // ── Section titles ──
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    marginBottom: 4,
    paddingBottom: 2,
  },
  // ── Personal & Check Information ──
  infoRow: {
    marginBottom: 2,
  },
  infoLabel: {
    fontSize: 7,
    fontWeight: 'bold',
    marginBottom: 1,
  },
  infoText: {
    fontSize: 8,
  },
  // ── Table styles ──
  table: {
    width: '100%',
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    marginBottom: 2,
    paddingBottom: 2,
  },
  tableHeaderCell: {
    fontSize: 6,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
  },
  tableCell: {
    fontSize: 7,
  },
  // ── Footer ──
  footer: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#000',
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    textAlign: 'center',
    marginBottom: 2,
  },
  footerCompany: {
    fontSize: 7,
    textAlign: 'center',
    color: '#666',
  },
});

// ── component ──────────────────────────────────────────────────────────────

const W2PayStubPDF: React.FC<W2PayStubPDFProps> = ({ stub }) => {
  const companyFullAddr = `${stub.companyAddress}, ${stub.companyCity} ${stub.companyState} ${stub.companyZip}`;
  const empFullAddr = `${stub.employeeAddress}, ${stub.employeeCity} ${stub.employeeState} ${stub.employeeZip}`;

  // Column widths for allocation / earnings / withholding tables
  const col1 = '40%';
  const col2 = '30%';
  const col3 = '30%';

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* ── HEADER ── */}
        <View style={s.headerRow}>
          {/* Left: company info */}
          <View style={s.headerLeft}>
            <Text style={s.companyName}>{stub.companyName}</Text>
            <Text style={{ fontSize: 7 }}>{companyFullAddr}</Text>
          </View>

          {/* Right: NON-NEGOTIABLE watermark + account info */}
          <View style={s.headerRight}>
            <Text style={s.nonNegotiable}>NON-NEGOTIABLE</Text>
            <Text style={s.accountInfo}>Account #: {stub.companyPhone}</Text>
            <Text style={s.eeId}>EE ID: 1</Text>
          </View>
        </View>

        {/* ── Employee block ── */}
        <View style={s.employeeBlock}>
          <Text style={s.employeeName}>{stub.employeeName}</Text>
          <Text style={{ fontSize: 8 }}>{empFullAddr}</Text>
        </View>

        {/* ── Net Pay THIS PERIOD / YTD ── */}
        <View style={s.netPayBox}>
          <View style={s.netPayItem}>
            <Text style={s.netPayLabel}>NET PAY THIS PERIOD ($)</Text>
            <Text style={s.netPayAmount}>{fmtDollar(stub.netPay)}</Text>
          </View>
          <View style={s.netPayItem}>
            <Text style={s.netPayLabel}>YTD ($)</Text>
            <Text style={s.netPayAmount}>{fmtDollar(stub.ytdNetPay)}</Text>
          </View>
        </View>

        {/* ── TWO-COLUMN BODY ── */}
        <View style={s.bodyRow}>
          {/* ── LEFT COLUMN ── */}
          <View style={s.leftCol}>
            <Text style={s.sectionTitle}>PERSONAL AND CHECK INFORMATION</Text>

            <Text style={s.infoLabel}>Employee:</Text>
            <Text style={s.infoText}>{stub.employeeName}</Text>
            <Text style={s.infoText}>{stub.employeeAddress}</Text>
            <Text style={s.infoText}>
              {stub.employeeCity}, {stub.employeeState} {stub.employeeZip}
            </Text>

            <View style={{ marginTop: 4 }}>
              <Text style={s.infoLabel}>Employee ID: 1</Text>
            </View>

            <View style={{ marginTop: 4 }}>
              <Text style={s.infoLabel}>Pay Period:</Text>
              <Text style={s.infoText}>
                {fmtDate(stub.payPeriodStart)} to {fmtDate(stub.payPeriodEnd)}
              </Text>
            </View>

            <View style={{ marginTop: 4 }}>
              <Text style={s.infoLabel}>Check Date:</Text>
              <Text style={s.infoText}>
                {fmtDate(stub.checkDate)}{'  '}Check #: {stub.checkNumber}
              </Text>
            </View>

            {/* Net Pay Allocations sub-section */}
            <View style={{ marginTop: 8 }}>
              <Text style={[s.sectionTitle, { marginBottom: 4 }]}>
                NET PAY ALLOCATIONS
              </Text>

              {/* Table header */}
              <View style={s.tableHeader}>
                <Text style={[s.tableHeaderCell, { width: col1 }]}>
                  Description
                </Text>
                <Text style={[s.tableHeaderCell, { width: col2, textAlign: 'right' }]}>
                  This Period ($)
                </Text>
                <Text style={[s.tableHeaderCell, { width: col3, textAlign: 'right' }]}>
                  YTD ($)
                </Text>
              </View>

              <View style={s.tableRow}>
                <Text style={[s.tableCell, { width: col1 }]}>Check Amount</Text>
                <Text style={[s.tableCell, { width: col2, textAlign: 'right' }]}>
                  {fmtDollar(stub.netPay)}
                </Text>
                <Text style={[s.tableCell, { width: col3, textAlign: 'right' }]}>
                  {fmtDollar(stub.ytdNetPay)}
                </Text>
              </View>

              <View
                style={[
                  s.tableRow,
                  { borderBottomColor: '#000', borderBottomWidth: 1 },
                ]}
              >
                <Text style={[s.tableCell, { width: col1, fontWeight: 'bold' }]}>
                  NET PAY
                </Text>
                <Text
                  style={[
                    s.tableCell,
                    { width: col2, textAlign: 'right', fontWeight: 'bold' },
                  ]}
                >
                  {fmtDollar(stub.netPay)}
                </Text>
                <Text
                  style={[
                    s.tableCell,
                    { width: col3, textAlign: 'right', fontWeight: 'bold' },
                  ]}
                >
                  {fmtDollar(stub.ytdNetPay)}
                </Text>
              </View>
            </View>
          </View>

          {/* ── RIGHT COLUMN ── */}
          <View style={s.rightCol}>
            {/* EARNINGS */}
            <Text style={s.sectionTitle}>EARNINGS</Text>

            <View style={s.tableHeader}>
              <Text style={[s.tableHeaderCell, { width: '25%' }]}>
                BASIS OF PAY
              </Text>
              <Text style={[s.tableHeaderCell, { width: '25%' }]}>
                DESCRIPTION
              </Text>
              <Text style={[s.tableHeaderCell, { width: '25%', textAlign: 'right' }]}>
                CURRENT ($)
              </Text>
              <Text style={[s.tableHeaderCell, { width: '25%', textAlign: 'right' }]}>
                YTD ($)
              </Text>
            </View>

            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '25%' }]}>Salary</Text>
              <Text style={[s.tableCell, { width: '25%' }]}></Text>
              <Text style={[s.tableCell, { width: '25%', textAlign: 'right' }]}>
                {fmtDollar(stub.grossSalary)}
              </Text>
              <Text style={[s.tableCell, { width: '25%', textAlign: 'right' }]}>
                {fmtDollar(stub.ytdGrossSalary)}
              </Text>
            </View>

            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '50%' }]}>Total Hours</Text>
              <Text style={[s.tableCell, { width: '25%', textAlign: 'right' }]}></Text>
              <Text style={[s.tableCell, { width: '25%', textAlign: 'right' }]}></Text>
            </View>

            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '50%' }]}>
                Total Hrs Worked
              </Text>
              <Text style={[s.tableCell, { width: '25%', textAlign: 'right' }]}></Text>
              <Text style={[s.tableCell, { width: '25%', textAlign: 'right' }]}></Text>
            </View>

            <View
              style={[
                s.tableRow,
                { borderBottomColor: '#000', borderBottomWidth: 1 },
              ]}
            >
              <Text
                style={[
                  s.tableCell,
                  { width: '50%', fontWeight: 'bold' },
                ]}
              >
                Gross Earnings
              </Text>
              <Text
                style={[
                  s.tableCell,
                  { width: '25%', textAlign: 'right', fontWeight: 'bold' },
                ]}
              >
                {fmtDollar(stub.grossSalary)}
              </Text>
              <Text
                style={[
                  s.tableCell,
                  { width: '25%', textAlign: 'right', fontWeight: 'bold' },
                ]}
              >
                {fmtDollar(stub.ytdGrossSalary)}
              </Text>
            </View>

            {/* WITHHOLDING */}
            <Text style={[s.sectionTitle, { marginTop: 12 }]}>WITHHOLDING</Text>

            <View style={s.tableHeader}>
              <Text style={[s.tableHeaderCell, { width: '32%' }]}>
                DESCRIPTION
              </Text>
              <Text style={[s.tableHeaderCell, { width: '8%' }]}>S</Text>
              <Text style={[s.tableHeaderCell, { width: '30%', textAlign: 'right' }]}>
                CURRENT ($)
              </Text>
              <Text style={[s.tableHeaderCell, { width: '30%', textAlign: 'right' }]}>
                YTD ($)
              </Text>
            </View>

            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '32%' }]}>Social Security</Text>
              <Text style={[s.tableCell, { width: '8%' }]}>S</Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.socialSecurity)}
              </Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.ytdSocialSecurity)}
              </Text>
            </View>

            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '32%' }]}>Medicare</Text>
              <Text style={[s.tableCell, { width: '8%' }]}>S</Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.medicare)}
              </Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.ytdMedicare)}
              </Text>
            </View>

            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '32%' }]}>Fed Income Tax</Text>
              <Text style={[s.tableCell, { width: '8%' }]}>S</Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.federalIncomeTax)}
              </Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.ytdFederalIncomeTax)}
              </Text>
            </View>

            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '32%' }]}>MO Income Tax</Text>
              <Text style={[s.tableCell, { width: '8%' }]}>S</Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.moIncomeTax)}
              </Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.ytdMoIncomeTax)}
              </Text>
            </View>

            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '32%' }]}>MO STLOU Inc</Text>
              <Text style={[s.tableCell, { width: '8%' }]}>S</Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.moStlouIncomeTax)}
              </Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right' }]}>
                {fmtDollar(stub.ytdMoStlouIncomeTax)}
              </Text>
            </View>

            <View
              style={[
                s.tableRow,
                { borderBottomColor: '#000', borderBottomWidth: 1 },
              ]}
            >
              <Text
                style={[
                  s.tableCell,
                  { width: '40%', fontWeight: 'bold' },
                ]}
              >
                TOTAL
              </Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right', fontWeight: 'bold' }]}>
                {fmtDollar(stub.totalWithholdings)}
              </Text>
              <Text style={[s.tableCell, { width: '30%', textAlign: 'right', fontWeight: 'bold' }]}>
                {fmtDollar(stub.ytdTotalWithholdings)}
              </Text>
            </View>
          </View>
        </View>

        {/* ── FOOTER ── */}
        <View style={s.footer}>
          <Text style={s.footerText}>KIDZ Transportation LLC · Payroll</Text>
          <Text style={s.footerCompany}>
            {stub.companyName} · {companyFullAddr} · {stub.companyPhone}
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export default W2PayStubPDF;
