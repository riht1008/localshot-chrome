import { exportEditablePptx as exportBasePptx } from './pptx-export.js';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MIN_SLIDE_LAYOUT_ID = 2147483648;

export async function exportEditablePptx(options) {
  const base = await exportBasePptx(options);
  const entries = readStoredZip(new Uint8Array(await base.arrayBuffer()));
  let repaired = false;

  for (const entry of entries) {
    if (entry.name !== 'ppt/slideMasters/slideMaster1.xml') continue;
    const original = new TextDecoder().decode(entry.data);
    const fixed = repairSlideLayoutIds(original);
    if (fixed !== original) {
      entry.data = new TextEncoder().encode(fixed);
      repaired = true;
    }
  }

  validatePptxEntries(entries);
  return repaired ? zipStore(entries, PPTX_MIME) : base;
}

function repairSlideLayoutIds(xml) {
  let nextId = MIN_SLIDE_LAYOUT_ID + 1;
  return xml.replace(/<p:sldLayoutId\b([^>]*?)\bid="(\d+)"([^>]*)\/>/g, (match, before, value, after) => {
    const id = Number(value);
    if (Number.isFinite(id) && id >= MIN_SLIDE_LAYOUT_ID) {
      nextId = Math.max(nextId, id + 1);
      return match;
    }
    const replacement = nextId;
    nextId += 1;
    return `<p:sldLayoutId${before}id="${replacement}"${after}/>`;
  });
}

function validatePptxEntries(entries) {
  const names = new Set(entries.map((entry) => entry.name));
  const required = [
    '[Content_Types].xml',
    '_rels/.rels',
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
    'ppt/slideMasters/slideMaster1.xml',
    'ppt/slideLayouts/slideLayout1.xml',
    'ppt/slides/slide1.xml',
    'ppt/slides/_rels/slide1.xml.rels',
  ];
  for (const name of required) {
    if (!names.has(name)) throw new Error(`PPTX package is missing ${name}`);
  }

  const master = entries.find((entry) => entry.name === 'ppt/slideMasters/slideMaster1.xml');
  const xml = new TextDecoder().decode(master.data);
  const ids = [...xml.matchAll(/<p:sldLayoutId\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]));
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id < MIN_SLIDE_LAYOUT_ID)) {
    throw new Error('PPTX slide layout ID is outside the OOXML valid range');
  }
}

function readStoredZip(bytes) {
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error('PPTX ZIP structure is invalid');

    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags & 0x0008) throw new Error('PPTX ZIP data descriptors are not supported');
    if (method !== 0) throw new Error('PPTX ZIP compression method is not supported');

    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('PPTX ZIP entry is truncated');

    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength)),
      data: bytes.slice(dataStart, dataEnd),
    });
    offset = dataEnd;
  }

  if (!entries.length) throw new Error('PPTX ZIP has no entries');
  return entries;
}

function zipStore(entries, mimeType) {
  const encoder = new TextEncoder();
  const files = entries.map((entry) => ({
    nameBytes: encoder.encode(entry.name),
    data: entry.data instanceof Uint8Array ? entry.data : encoder.encode(entry.data),
  }));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const file of files) {
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + file.nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, file.nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(file.nameBytes, 30);
    localParts.push(local, file.data);

    const central = new Uint8Array(46 + file.nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, file.nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(file.nameBytes, 46);
    centralParts.push(central);
    offset += local.length + file.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: mimeType });
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
