const prefix = (bytes, signature) => signature.every((byte, index) => byte === bytes[index]);
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
export function cardImageType(bytes) {
  if (prefix(bytes, [0xff, 0xd8, 0xff])) return { extension: 'jpg', mime: 'image/jpeg' };
  if (prefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return { extension: 'png', mime: 'image/png' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  if (ascii(bytes, 4, 8) === 'ftyp' && bytes.length >= 16) {
    const end = Math.min(new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0), bytes.length, 128);
    const brands = [ascii(bytes, 8, 12)];
    for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(ascii(bytes, offset, offset + 4));
    if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) return { extension: 'heic', mime: 'image/heic' };
    if (brands.includes('mif1') && !brands.some(brand => ['avif', 'avis'].includes(brand))) return { extension: 'heif', mime: 'image/heif' };
  }
  return null;
}
