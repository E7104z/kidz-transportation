import { describe, it, expect } from 'vitest';
import { exportToCSV } from '../utils/csvExport';

describe('exportToCSV', () => {
  it('does not throw for empty rows', () => {
    expect(() => exportToCSV([], 'test')).not.toThrow();
  });

  it('includes headers in output', () => {
    // Monkey-patch document.createElement so we can inspect the blob
    const blobs: Blob[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => { blobs.push(b); return 'blob:test'; };
    URL.revokeObjectURL = () => {};

    // Minimal DOM shim for the download link
    const appendedElements: HTMLElement[] = [];
    if (!global.document) {
      (global as any).document = {
        body: {
          appendChild: (el: HTMLElement) => appendedElements.push(el),
          removeChild: () => {},
        },
        createElement: (_tag: string) => ({
          href: '',
          download: '',
          style: {},
          click: () => {},
        }),
      };
    }

    exportToCSV(
      [{ name: 'Alice', age: 30 }],
      'test',
      [{ key: 'name', header: 'Name' }, { key: 'age', header: 'Age' }],
    );

    URL.createObjectURL = origCreate;
    expect(blobs.length).toBe(1);
    blobs[0].text().then(text => {
      expect(text).toContain('Name,Age');
      expect(text).toContain('Alice');
    });
  });
});
