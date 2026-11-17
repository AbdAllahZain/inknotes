export type JpegInfo = { orientation: number; width: number; height: number };

/** Reads EXIF orientation and the stored (pre-rotation) pixel size from the start of a JPEG file. */
export function jpegInfo(b: Uint8Array): JpegInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let orientation = 1;
  let width = 0;
  let height = 0;
  let off = 2;
  while (off + 4 < b.length) {
    if (b[off] !== 0xff) break;
    const marker = b[off + 1];
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    const len = (b[off + 2] << 8) | b[off + 3];
    if (marker === 0xe1 && b[off + 4] === 0x45 && b[off + 5] === 0x78 && b[off + 6] === 0x69 && b[off + 7] === 0x66) {
      const t = off + 10; // TIFF header
      const little = b[t] === 0x49;
      const r16 = (p: number) => (little ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
      const r32 = (p: number) =>
        little
          ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
          : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
      const ifd = t + r32(t + 4);
      if (ifd + 2 < b.length) {
        const n = r16(ifd);
        for (let i = 0; i < n && ifd + 2 + i * 12 + 10 < b.length; i++) {
          const e = ifd + 2 + i * 12;
          if (r16(e) === 0x0112) {
            orientation = r16(e + 8);
            break;
          }
        }
      }
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      height = (b[off + 5] << 8) | b[off + 6];
      width = (b[off + 7] << 8) | b[off + 8];
      break;
    }
    if (marker === 0xda) break;
    off += 2 + len;
  }
  if (!width || !height) return null;
  return { orientation, width, height };
}
