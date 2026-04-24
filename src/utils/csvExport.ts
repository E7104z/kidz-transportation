/**
 * csvExport — converts an array of flat objects to a CSV file and triggers
 * a browser download. Only public-facing utility; no server side needed.
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if the value contains commas, quotes, or newlines
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCSV(
  rows:     Record<string, unknown>[],
  filename: string,
  columns?: { key: string; header: string }[],
): void {
  if (rows.length === 0) return;

  const cols = columns ?? Object.keys(rows[0]).map(k => ({ key: k, header: k }));
  const header = cols.map(c => escapeCell(c.header)).join(',');
  const body   = rows.map(row => cols.map(c => escapeCell(row[c.key])).join(',')).join('\n');

  const csv  = `${header}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  const a       = document.createElement('a');
  a.href        = url;
  a.download    = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
