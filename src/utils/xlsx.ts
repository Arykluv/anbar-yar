/**
 * تولید فایل اکسل (.xlsx) به‌صورت کاملاً آفلاین و بدون وابستگی.
 * فایل اکسل در واقع یک ZIP است که چند فایل XML را نگه می‌دارد؛
 * این‌جا ZIP را با روش Store (بدون فشرده‌سازی) می‌سازیم و مقادیر
 * سلول‌ها را با inline string می‌نویسیم تا هم ساده باشد هم بدون کد ملی.
 */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** CRC-32 (پلی‌نومیال استاندارد بدون جدول) برای ورودی‌های کوچک */
function crc32(bytes: number[]): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      const mask = -(crc & 1) & 0xffffffff;
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sheetXml(rows: (string | number | null)[][]): string {
  const names = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const cellRef = (col: number, row: number): string => `${names[col]}${row}`;

  const body = rows
    .map((cells, rowIndex) => {
      const rowNum = rowIndex + 1;
      const cellsXml = cells
        .map((value, col) => {
          const ref = cellRef(col, rowNum);
          if (typeof value === "number") {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          const text = value == null ? "" : String(value);
          if (text === "") return "";
          const inline = xmlEscape(text);
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${inline}</t></is></c>`;
        })
        .filter(Boolean)
        .join("");
      return `<row r="${rowNum}">${cellsXml}</row>`;
    })
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

/** ساخت فایل ZIP Store از روی چند قطعه (نام داخل zip + محتوای متنی) */
function zipStore(entries: { name: string; data: string }[]): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8Bytes(entry.name);
    const dataBytes = Array.from(encoder.encode(entry.data));
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); // signature local file
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // flags: UTF-8
    header.setUint16(8, 0, true); // store
    header.setUint16(10, 0, true); // mod time
    header.setUint16(12, 0xd401, true); // mod date
    header.setUint32(14, crc, true);
    header.setUint32(18, size, true); // compressed size
    header.setUint32(22, size, true); // uncompressed size
    header.setUint16(26, nameBytes.length, true); // name length
    header.setUint16(28, 0, true); // extra length

    parts.push(new Uint8Array(header.buffer));
    parts.push(new Uint8Array(nameBytes));
    parts.push(new Uint8Array(dataBytes));

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true); // central signature
    centralHeader.setUint16(4, 20, true);
    centralHeader.setUint16(6, 20, true);
    centralHeader.setUint16(8, 0x0800, true);
    centralHeader.setUint16(10, 0, true);
    centralHeader.setUint16(12, 0, true);
    centralHeader.setUint16(14, 0xd401, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, size, true);
    centralHeader.setUint32(24, size, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true); // extra length
    centralHeader.setUint16(32, 0, true); // comment length
    centralHeader.setUint16(34, 0, true); // disk number
    centralHeader.setUint16(36, 0, true); // internal attrs
    centralHeader.setUint32(38, 0, true); // external attrs
    centralHeader.setUint32(42, offset, true); // local header offset

    central.push(...Array.from(new Uint8Array(centralHeader.buffer)));
    central.push(...nameBytes);
    offset += 30 + nameBytes.length + size;
  }

  const centralSize = central.length;
  const count = entries.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // end of central directory
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, count, true);
  eocd.setUint16(10, count, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true); // comment length

  parts.push(new Uint8Array(central));
  parts.push(new Uint8Array(eocd.buffer));

  const length = parts.reduce((sum, p) => sum + p.length, 0);
  const merged = new Uint8Array(length);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.length;
  }

  return new Blob([merged], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const XL_CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  "</Types>";

const XL_ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

const XL_WORKBOOK =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="محصولات" sheetId="1" r:id="rId1"/></sheets></workbook>';

const XL_WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  "</Relationships>";

/** ساخت فایل اکسل از روی جدولی از سلول‌ها (رشته یا عدد یا خالی) */
export function buildXlsx(rows: (string | number | null)[][]): Blob {
  return zipStore([
    { name: "[Content_Types].xml", data: XL_CONTENT_TYPES },
    { name: "_rels/.rels", data: XL_ROOT_RELS },
    { name: "xl/workbook.xml", data: XL_WORKBOOK },
    { name: "xl/_rels/workbook.xml.rels", data: XL_WORKBOOK_RELS },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml(rows) },
  ]);
}

/** دانلود یک Blob */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}