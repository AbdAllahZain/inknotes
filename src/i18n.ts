import { NativeModules } from 'react-native';

const ar = {
  appName: 'حبر',
  myNotes: 'ملاحظاتي',
  search: 'بحث...',
  empty: 'لا توجد ملفات بعد.\nأنشئ ملاحظة جديدة أو افتح ملف PDF.',
  newNote: 'ملاحظة جديدة',
  openPdf: 'فتح PDF',
  untitled: 'ملاحظة بدون عنوان',
  choosePaper: 'اختر نوع الورقة',
  blank: 'بيضاء',
  lined: 'مسطّرة',
  grid: 'مربعات',
  dots: 'نقاط',
  rename: 'إعادة تسمية',
  delete: 'حذف',
  cancel: 'إلغاء',
  ok: 'موافق',
  save: 'حفظ',
  confirmDelete: 'هل تريد حذف هذا الملف نهائياً؟',
  pages: 'صفحات',
  page: 'صفحة',
  note: 'ملاحظة',
  pdf: 'PDF',
  undo: 'تراجع',
  redo: 'إعادة',
  pen: 'قلم',
  fountain: 'قلم حبر',
  pencil: 'رصاص',
  highlighter: 'تمييز',
  eraser: 'ممحاة',
  shape: 'أشكال',
  text: 'نص',
  hand: 'تحريك',
  line: 'خط',
  arrow: 'سهم',
  rect: 'مستطيل',
  ellipse: 'دائرة',
  addPage: 'إضافة صفحة',
  deletePage: 'حذف الصفحة الحالية',
  paper: 'نوع الورقة',
  exportPdf: 'تصدير / مشاركة PDF',
  exporting: 'جارٍ إنشاء ملف PDF...',
  exportFailed: 'تعذّر تصدير الملف',
  stylusOnly: 'القلم فقط للكتابة (رفض راحة اليد)',
  stylusOnlyHint: 'الإصبع للتمرير والتكبير فقط',
  fitWidth: 'ملاءمة العرض',
  textHint: 'اكتب النص هنا',
  editText: 'تعديل النص',
  loading: 'جارٍ التحميل...',
  pdfFailed: 'تعذّر فتح هذا الملف. قد يكون محمياً بكلمة مرور أو تالفاً.',
  lastPage: 'لا يمكن حذف الصفحة الوحيدة',
  close: 'إغلاق',
  more: 'المزيد',
};

type Dict = typeof ar;

const en: Dict = {
  appName: 'InkNotes',
  myNotes: 'My notes',
  search: 'Search...',
  empty: 'Nothing here yet.\nCreate a note or open a PDF.',
  newNote: 'New note',
  openPdf: 'Open PDF',
  untitled: 'Untitled note',
  choosePaper: 'Choose paper type',
  blank: 'Blank',
  lined: 'Lined',
  grid: 'Grid',
  dots: 'Dots',
  rename: 'Rename',
  delete: 'Delete',
  cancel: 'Cancel',
  ok: 'OK',
  save: 'Save',
  confirmDelete: 'Delete this file permanently?',
  pages: 'pages',
  page: 'Page',
  note: 'Note',
  pdf: 'PDF',
  undo: 'Undo',
  redo: 'Redo',
  pen: 'Pen',
  fountain: 'Fountain',
  pencil: 'Pencil',
  highlighter: 'Highlight',
  eraser: 'Eraser',
  shape: 'Shapes',
  text: 'Text',
  hand: 'Move',
  line: 'Line',
  arrow: 'Arrow',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  addPage: 'Add page',
  deletePage: 'Delete current page',
  paper: 'Paper type',
  exportPdf: 'Export / share PDF',
  exporting: 'Creating PDF...',
  exportFailed: 'Export failed',
  stylusOnly: 'Pen only writes (palm rejection)',
  stylusOnlyHint: 'Fingers only scroll and zoom',
  fitWidth: 'Fit width',
  textHint: 'Type your text here',
  editText: 'Edit text',
  loading: 'Loading...',
  pdfFailed: 'Could not open this file. It may be password protected or damaged.',
  lastPage: "You can't delete the only page",
  close: 'Close',
  more: 'More',
};

function detectLocale(): string {
  try {
    const l = (NativeModules.I18nManager as any)?.localeIdentifier as string | undefined;
    if (l) return l;
  } catch {}
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {}
  return 'en';
}

export const locale = detectLocale();
export const isArabic = locale.toLowerCase().startsWith('ar');
const dict: Dict = isArabic ? ar : en;

export function t(key: keyof Dict): string {
  return dict[key];
}
