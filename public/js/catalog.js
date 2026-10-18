/* Tool catalog: suites, tools, their options, and which file types they accept.
 * `id` is the server tool name (src/lib/jobRegistry.js) unless `custom` marks a browser-side tool. */

export const SUITES = [
  { id: 'pdf', name: 'PDF essentials', blurb: 'Organize, edit and secure PDF files.' },
  { id: 'convert', name: 'Convert', blurb: 'Move between PDF, Word, Excel, PowerPoint and images.' },
  { id: 'image', name: 'Photos & images', blurb: 'Exam photos, ID pictures and everyday image fixes.' },
  { id: 'tamil', name: 'Tamil', blurb: 'Read scanned Tamil and fix old Tamil fonts.' },
  { id: 'business', name: 'Business & data', blurb: 'GST invoices and spreadsheet clean-up.' },
];

export const TOOLS = [
  /* ---- PDF essentials ---- */
  { id: 'merge', suite: 'pdf', name: 'Merge PDF', formats: 'PDF + PDF', desc: 'Combine PDFs into one file, in the order you add them.', accept: '.pdf', multiple: true, minFiles: 2, popular: true },
  {
    id: 'split', suite: 'pdf', name: 'Split PDF', formats: 'PDF ÷', desc: 'Split by page ranges, or every few pages.', accept: '.pdf',
    fields: [
      { name: 'mode', label: 'Split by', type: 'select', options: [['ranges', 'Page ranges'], ['everyN', 'Every N pages']], default: 'ranges' },
      { name: 'ranges', label: 'One range per line — each becomes a file', type: 'textarea', showIf: { mode: 'ranges' }, placeholder: '1-3\n4-6', required: true },
      { name: 'everyN', label: 'Pages per file', type: 'number', showIf: { mode: 'everyN' }, default: 1, min: 1 },
    ],
    buildOptions: (f) => (f.mode === 'everyN'
      ? { everyN: Number(f.everyN) || 1 }
      : { ranges: String(f.ranges || '').split('\n').map((s) => s.trim()).filter(Boolean) }),
  },
  { id: 'organize', suite: 'pdf', name: 'Organize pages', formats: 'PDF ⇅', desc: 'Drag pages into a new order, or remove them.', accept: '.pdf', custom: 'organize' },
  { id: 'compress', suite: 'pdf', name: 'Compress PDF', formats: 'PDF ↓', desc: 'Shrink scanned and photo-heavy PDFs.', accept: '.pdf', popular: true,
    fields: [{ name: 'quality', label: 'Compression', type: 'select', options: [['screen', 'Smallest file'], ['ebook', 'Balanced'], ['printer', 'Best quality']], default: 'ebook' }] },
  { id: 'remove-pages', suite: 'pdf', name: 'Remove pages', formats: 'PDF −', desc: 'Delete specific pages.', accept: '.pdf',
    fields: [{ name: 'pages', label: 'Pages to remove', type: 'text', placeholder: '2, 4-6', required: true }] },
  { id: 'extract-pages', suite: 'pdf', name: 'Extract pages', formats: 'PDF ⊂', desc: 'Save selected pages as a new PDF.', accept: '.pdf',
    fields: [{ name: 'pages', label: 'Pages to keep', type: 'text', placeholder: '1-3, 7', required: true }] },
  { id: 'rotate', suite: 'pdf', name: 'Rotate PDF', formats: 'PDF ↻', desc: 'Turn all or some pages.', accept: '.pdf',
    fields: [
      { name: 'angle', label: 'Rotate', type: 'select', options: [['90', '90° clockwise'], ['180', '180°'], ['270', '90° anticlockwise']], default: '90' },
      { name: 'pages', label: 'Pages', type: 'text', placeholder: 'all', default: 'all' },
    ] },
  { id: 'watermark', suite: 'pdf', name: 'Watermark', formats: 'PDF ✎', desc: 'Stamp text across every page — Tamil works too.', accept: '.pdf',
    fields: [
      { name: 'text', label: 'Watermark text', type: 'text', required: true, placeholder: 'CONFIDENTIAL / ரகசியம்' },
      { name: 'position', label: 'Position', type: 'select', options: [['center', 'Diagonal, centred'], ['top', 'Top'], ['bottom', 'Bottom'], ['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']], default: 'center' },
      { name: 'color', label: 'Colour', type: 'color', default: '#c0392b' },
      { name: 'opacity', label: 'Opacity', type: 'number', default: 0.3, min: 0.05, max: 1, step: 0.05 },
      { name: 'fontSize', label: 'Size', type: 'number', default: 48, min: 6, max: 200 },
      { name: 'rotation', label: 'Angle', type: 'number', default: -45, min: -180, max: 180 },
    ] },
  { id: 'page-numbers', suite: 'pdf', name: 'Page numbers', formats: 'PDF #', desc: 'Number every page.', accept: '.pdf',
    fields: [
      { name: 'position', label: 'Position', type: 'select', options: [['bottom', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top', 'Top centre'], ['top-right', 'Top right'], ['top-left', 'Top left']], default: 'bottom' },
      { name: 'format', label: 'Format', type: 'text', default: 'Page {n} of {total}', hint: '{n} is the page, {total} the page count' },
      { name: 'startAt', label: 'Start at', type: 'number', default: 1, min: 1 },
    ] },
  { id: 'protect', suite: 'pdf', name: 'Protect PDF', formats: 'PDF + PASSWORD', desc: 'Add a password.', accept: '.pdf',
    fields: [{ name: 'password', label: 'Password', type: 'password', required: true }] },
  { id: 'unlock', suite: 'pdf', name: 'Unlock PDF', formats: 'PDF − PASSWORD', desc: 'Remove a password you know.', accept: '.pdf',
    fields: [{ name: 'password', label: 'Current password', type: 'password', required: true }] },

  /* ---- Convert ---- */
  { id: 'office-to-pdf', suite: 'convert', name: 'Office to PDF', formats: 'DOC XLS PPT → PDF', desc: 'Word, Excel, PowerPoint and more to PDF.', accept: '.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp', multiple: true, popular: true },
  { id: 'pdf-to-word', suite: 'convert', name: 'PDF to Word', formats: 'PDF → DOCX', desc: 'Editable Word file with the layout kept.', accept: '.pdf', popular: true },
  { id: 'pdf-to-powerpoint', suite: 'convert', name: 'PDF to PowerPoint', formats: 'PDF → PPTX', desc: 'Each page becomes a slide.', accept: '.pdf' },
  { id: 'images-to-pdf', suite: 'convert', name: 'Images to PDF', formats: 'JPG PNG HEIC → PDF', desc: 'Photos and scans into one PDF.', accept: 'image/*,.heic', multiple: true, popular: true,
    fields: [{ name: 'pageSize', label: 'Page size', type: 'select', options: [['a4', 'A4'], ['fit', 'Same as each image']], default: 'a4' }] },
  { id: 'pdf-to-images', suite: 'convert', name: 'PDF to images', formats: 'PDF → JPG PNG', desc: 'Every page as a picture.', accept: '.pdf',
    fields: [
      { name: 'format', label: 'Format', type: 'select', options: [['jpg', 'JPG'], ['png', 'PNG']], default: 'jpg' },
      { name: 'scale', label: 'Sharpness', type: 'select', options: [['1.5', 'Standard'], ['2', 'High'], ['3', 'Print']], default: '2' },
    ] },
  { id: 'pdf-to-text', suite: 'convert', name: 'PDF to text', formats: 'PDF → TXT', desc: 'Copy out all the text.', accept: '.pdf' },

  /* ---- Photos & images ---- */
  { id: 'exam-photo', suite: 'image', name: 'Exam photo & signature', formats: 'JPG ▭ KB', desc: 'Exact size and KB for TNPSC, SSC, IBPS, UPSC, passport.', accept: 'image/*', custom: 'exam-photo', popular: true, browserOnly: true, submitLabel: 'Get resized photo' },
  { id: 'remove-background', suite: 'image', name: 'Remove background', formats: 'IMG → PNG', desc: 'Cut out the subject; white background for ID photos.', accept: 'image/*,.heic', multiple: true,
    fields: [{ name: 'background', label: 'Background', type: 'select', options: [['', 'Transparent'], ['#ffffff', 'White'], ['#dbe9ff', 'Light blue']], default: '' }] },
  { id: 'convert-image', suite: 'image', name: 'Convert & compress images', formats: 'HEIC WEBP → JPG', desc: 'Change format, resize and shrink, in bulk.', accept: 'image/*,.heic', multiple: true,
    fields: [
      { name: 'format', label: 'Save as', type: 'select', options: [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF']], default: 'jpg' },
      { name: 'quality', label: 'Quality', type: 'number', default: 80, min: 1, max: 100 },
      { name: 'width', label: 'Max width (px)', type: 'number', min: 1, placeholder: 'Keep' },
      { name: 'height', label: 'Max height (px)', type: 'number', min: 1, placeholder: 'Keep' },
    ] },

  /* ---- Tamil ---- */
  { id: 'ocr', suite: 'tamil', name: 'Tamil OCR', formats: 'SCAN → TEXT', desc: 'Scanned Tamil and English to editable text and a searchable PDF.', accept: '.pdf,image/*', multiple: true, popular: true,
    fields: [
      { name: 'lang', label: 'Language', type: 'select', options: [['tam+eng', 'Tamil and English'], ['tam', 'Tamil only'], ['eng', 'English only']], default: 'tam+eng' },
      { name: 'output', label: 'Get', type: 'select', options: [['both', 'Searchable PDF and text'], ['pdf', 'Searchable PDF'], ['text', 'Text file']], default: 'both' },
    ] },
  { id: 'tamil-font', suite: 'tamil', name: 'Tamil font converter', formats: 'BAMINI ⇄ UNICODE', desc: 'Fix old Tamil text that shows as English letters.', custom: 'tamil-font', noUpload: true, noSubmit: true, browserOnly: true },

  /* ---- Business & data ---- */
  { id: 'gst-invoice', suite: 'business', name: 'GST invoice', formats: '₹ → PDF', desc: 'CGST/SGST or IGST, HSN, amount in words.', custom: 'gst-invoice', noUpload: true, popular: true, submitLabel: 'Create invoice PDF' },
  { id: 'sheet-clean', suite: 'business', name: 'Clean Excel / CSV', formats: 'XLSX ✓', desc: 'Trim spaces, drop empty rows, remove duplicates.', accept: '.xlsx,.csv,.json',
    fields: [
      { name: 'trim', label: 'Trim extra spaces', type: 'checkbox', default: true },
      { name: 'removeEmpty', label: 'Remove empty rows and columns', type: 'checkbox', default: true },
      { name: 'dedupe', label: 'Remove duplicate rows', type: 'checkbox', default: true },
      { name: 'dedupeColumns', label: 'Match duplicates on these columns (optional)', type: 'text', placeholder: 'Name, Phone', showIf: { dedupe: true } },
    ] },
  { id: 'sheet-convert', suite: 'business', name: 'Excel ⇄ CSV ⇄ JSON', formats: 'XLSX ⇄ CSV', desc: 'Convert spreadsheets, Tamil text intact.', accept: '.xlsx,.csv,.json',
    fields: [{ name: 'format', label: 'Convert to', type: 'select', options: [['xlsx', 'Excel (XLSX)'], ['csv', 'CSV'], ['json', 'JSON']], default: 'xlsx' }] },
  { id: 'sheet-merge', suite: 'business', name: 'Merge spreadsheets', formats: 'XLSX + CSV', desc: 'Stack files into one sheet, matched by column.', accept: '.xlsx,.csv,.json', multiple: true, minFiles: 2,
    fields: [{ name: 'mode', label: 'Combine into', type: 'select', options: [['rows', 'One sheet'], ['sheets', 'One workbook, a sheet per file']], default: 'rows' }] },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id);
export const suiteById = (id) => SUITES.find((s) => s.id === id);

/** Tools to suggest for a dropped file, best first. */
export function toolsForFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = file.type || '';
  const pick = (ids) => ids.map(toolById).filter(Boolean);
  if (ext === 'pdf') return pick(['compress', 'merge', 'pdf-to-word', 'split', 'ocr', 'organize', 'watermark', 'pdf-to-images']);
  if (['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'odp'].includes(ext)) return pick(['office-to-pdf']);
  if (['xls', 'xlsx', 'ods'].includes(ext)) return pick(['sheet-clean', 'sheet-convert', 'office-to-pdf', 'sheet-merge']);
  if (['csv', 'json'].includes(ext)) return pick(['sheet-convert', 'sheet-clean', 'sheet-merge']);
  if (type.startsWith('image/') || ['heic', 'heif', 'webp', 'jpg', 'jpeg', 'png'].includes(ext)) return pick(['exam-photo', 'images-to-pdf', 'remove-background', 'convert-image', 'ocr']);
  if (ext === 'txt') return pick(['tamil-font', 'office-to-pdf']);
  return [];
}

/** Matches "word", "compress pdf", "jpg to pdf", Tamil keywords etc. */
const ALIASES = {
  'office-to-pdf': 'word to pdf excel to pdf ppt to pdf docx xlsx pptx convert',
  'images-to-pdf': 'jpg to pdf png to pdf photo to pdf scan heic',
  'exam-photo': 'tnpsc ssc ibps upsc passport photo signature resize kb resizer',
  'gst-invoice': 'bill invoice gst billing tax receipt',
  ocr: 'scan scanned image to text tamil text extract',
  'tamil-font': 'bamini suntommy unicode font tamil typing',
  compress: 'reduce size shrink smaller kb mb',
  'remove-background': 'bg cut out transparent white background',
  'convert-image': 'heic jpg png webp avif resize photo',
  'sheet-clean': 'duplicate dedupe excel csv clean',
  merge: 'combine join',
  protect: 'password encrypt lock',
  unlock: 'remove password decrypt',
};
export function searchTools(q) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return TOOLS
    .map((t) => {
      const hay = `${t.name} ${t.desc} ${t.formats} ${ALIASES[t.id] || ''}`.toLowerCase();
      const name = t.name.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (name.startsWith(term)) score += 5;
        else if (name.includes(term)) score += 3;
        else if (hay.includes(term)) score += 1;
        else return null;
      }
      return { t, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.t);
}
