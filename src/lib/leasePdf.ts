import type { LeaseSection } from './leaseTemplate';

export interface RenderableDocument {
  title: string;
  sections: LeaseSection[];
}

const PAGE_WIDTH = 612; // 8.5in letter, in points
const PAGE_HEIGHT = 792; // 11in
const MARGIN = 54; // 0.75in
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;

// jsPDF is dynamically imported (not a top-level import) so it — and the
// html2canvas dependency chain it drags in even though we never use
// pdf.html() — only loads when someone actually generates a PDF, instead
// of bloating the initial app bundle every user downloads on first visit.
// Works for both the residential lease and the garage/parking agreement —
// each caller passes its own document and its own mandatory review notice.
export async function buildDocumentPdf(doc: RenderableDocument, reviewNotice: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = MARGIN;

  function ensureSpace(lines: number, lineHeight: number) {
    if (y + lines * lineHeight > PAGE_HEIGHT - MARGIN) {
      pdf.addPage();
      y = MARGIN;
    }
  }

  pdf.setFont('times', 'bold');
  pdf.setFontSize(15);
  const titleLines = pdf.splitTextToSize(doc.title, USABLE_WIDTH);
  ensureSpace(titleLines.length, 18);
  pdf.text(titleLines, MARGIN, y);
  y += titleLines.length * 18 + 12;

  for (const section of doc.sections) {
    pdf.setFont('times', 'bold');
    pdf.setFontSize(11.5);
    ensureSpace(1, 16);
    pdf.text(section.heading, MARGIN, y);
    y += 16;

    pdf.setFont('times', 'normal');
    pdf.setFontSize(10.5);
    for (const paragraph of section.body) {
      const lines = pdf.splitTextToSize(paragraph, USABLE_WIDTH);
      ensureSpace(lines.length, 13);
      pdf.text(lines, MARGIN, y);
      y += lines.length * 13 + 8;
    }
    y += 4;
  }

  // Mandatory legal-review notice, always last, visually set off.
  pdf.setFont('times', 'italic');
  pdf.setFontSize(8.5);
  const noticeLines = pdf.splitTextToSize(reviewNotice, USABLE_WIDTH);
  ensureSpace(noticeLines.length + 2, 11);
  y += 10;
  pdf.text(noticeLines, MARGIN, y);

  return pdf.output('blob');
}

export function documentPdfFileName(prefix: string, propertyAddress: string, unitName: string): string {
  const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '');
  return `${prefix}_${safe(propertyAddress)}_${safe(unitName)}_${new Date().toISOString().slice(0, 10)}.pdf`;
}
