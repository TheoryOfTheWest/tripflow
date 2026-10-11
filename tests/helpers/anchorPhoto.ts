// Synthetic EXIF only; no private image or location is stored in the test suite.
export function anchorJpeg(jpeg: Buffer, date?: string, offset?: string, gps?: [number, number]) {
  const tiff = Buffer.alloc(512);
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  let dataOffset = 256;
  type Tag = [number, number, number, Buffer | number];
  const ascii = (tag: number, value: string): Tag => [
    tag,
    2,
    Buffer.byteLength(value) + 1,
    Buffer.from(value + '\0'),
  ];
  const rational = (tag: number, values: number[]): Tag => {
    const data = Buffer.alloc(values.length * 8);
    values.forEach((v, i) => {
      data.writeUInt32LE(Math.round(v * 1000000), i * 8);
      data.writeUInt32LE(1000000, i * 8 + 4);
    });
    return [tag, 5, values.length, data];
  };
  const ifd = (at: number, tags: Tag[]) => {
    tiff.writeUInt16LE(tags.length, at);
    tags.forEach(([tag, type, count, value], i) => {
      const p = at + 2 + i * 12;
      tiff.writeUInt16LE(tag, p);
      tiff.writeUInt16LE(type, p + 2);
      tiff.writeUInt32LE(count, p + 4);
      if (typeof value === 'number') tiff.writeUInt32LE(value, p + 8);
      else if (value.length <= 4) value.copy(tiff, p + 8);
      else {
        tiff.writeUInt32LE(dataOffset, p + 8);
        value.copy(tiff, dataOffset);
        dataOffset += value.length;
      }
    });
  };
  ifd(8, [[0x8769, 4, 1, 64], ...(gps ? [[0x8825, 4, 1, 128] as Tag] : [])]);
  ifd(64, [...(date ? [ascii(0x9003, date)] : []), ...(offset ? [ascii(0x9011, offset)] : [])]);
  if (gps) {
    const dms = (v: number) => {
      const units = Math.round(Math.abs(v) * 3600 * 1000000);
      const degrees = Math.floor(units / 3600000000);
      const remainder = units - degrees * 3600000000;
      const minutes = Math.floor(remainder / 60000000);
      return [degrees, minutes, (remainder - minutes * 60000000) / 1000000];
    };
    ifd(128, [
      ascii(1, gps[0] < 0 ? 'S' : 'N'),
      rational(2, dms(gps[0])),
      ascii(3, gps[1] < 0 ? 'W' : 'E'),
      rational(4, dms(gps[1])),
    ]);
  }
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff.subarray(0, dataOffset)]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1);
  marker.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]);
}
