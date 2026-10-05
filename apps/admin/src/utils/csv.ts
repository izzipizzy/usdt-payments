const escapeCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows: Record<string, unknown>[], columns: { key: string; title: string }[]): string => {
  const head = columns.map((c) => escapeCell(c.title)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCell(r[c.key])).join(','));
  return [head, ...body].join('\r\n');
};

export const downloadCsv = (filename: string, csv: string): void => {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
