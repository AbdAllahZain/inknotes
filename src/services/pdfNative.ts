import { NativeModules } from 'react-native';

/**
 * Thin wrapper around the (patched) PdfThumbnail native module.
 * The patch (patches/react-native-pdf-thumbnail+1.3.1.patch) adds
 * getPageInfo() and renderPage() with an arbitrary render scale, which is
 * what makes PDF pages stay sharp when zooming.
 */
const M = NativeModules.PdfThumbnail as
  | {
      getPageInfo(path: string): Promise<{ width: number; height: number }[]>;
      renderPage(
        path: string,
        page: number,
        scale: number,
        quality: number,
        outPath: string
      ): Promise<{ uri: string; width: number; height: number; pixelWidth: number; pixelHeight: number }>;
    }
  | undefined;

function strip(p: string): string {
  return p.startsWith('file://') ? decodeURI(p.slice(7)) : p;
}

function mod() {
  if (!M || !M.getPageInfo || !M.renderPage) {
    throw new Error('PdfThumbnail native module is not available (use a development/release build, not Expo Go).');
  }
  return M;
}

export async function getPdfPageSizes(pdfPath: string): Promise<{ width: number; height: number }[]> {
  return mod().getPageInfo(strip(pdfPath));
}

export async function renderPdfPage(
  pdfPath: string,
  pageIndex: number,
  scale: number,
  outPath: string,
  quality = 88
): Promise<{ uri: string; pixelWidth: number; pixelHeight: number }> {
  const r = await mod().renderPage(strip(pdfPath), pageIndex, scale, quality, strip(outPath));
  return { uri: r.uri, pixelWidth: r.pixelWidth, pixelHeight: r.pixelHeight };
}
