function flattenObject(input, prefix = '', result = {}) {
  if (input === null || input === undefined) {
    result[prefix] = '';
    return result;
  }

  const normalizeValue = (value) => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return value.toString();
    if (Buffer.isBuffer(value)) return value.toString('base64');
    if (typeof value === 'object') {
      if (typeof value.toHexString === 'function') return value.toHexString();
      if (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID') {
        return typeof value.toString === 'function' ? value.toString() : String(value);
      }
    }
    return value;
  };

  if (Array.isArray(input)) {
    result[prefix] = input
      .map(item => {
        const normalized = normalizeValue(item);
        if (normalized && typeof normalized === 'object') {
          return JSON.stringify(normalized);
        }
        return String(normalized);
      })
      .join(' | ');
    return result;
  }

  if (typeof input !== 'object') {
    result[prefix] = input;
    return result;
  }

  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const normalized = normalizeValue(value);
    if (normalized && typeof normalized === 'object') {
      flattenObject(normalized, path, result);
    } else {
      result[path] = normalized;
    }
  }

  return result;
}

function escapeCsvValue(value) {
  const stringValue = value === null || value === undefined ? '' : String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function toCsv(rows = []) {
  if (!rows.length) return '';

  const flattened = rows.map(row => flattenObject(row));
  const headers = Array.from(
    flattened.reduce((set, row) => {
      Object.keys(row).forEach(key => set.add(key));
      return set;
    }, new Set())
  );

  const headerLine = headers.map(escapeCsvValue).join(',');
  const dataLines = flattened.map(row =>
    headers.map(header => escapeCsvValue(row[header])).join(',')
  );

  return [headerLine, ...dataLines].join('\n');
}

// Minimal PDF generator for simple text exports.
function buildSimplePdf(lines = []) {
  const safeLines = (Array.isArray(lines) ? lines : [])
    .map(line => String(line).replace(/[()\\]/g, '\\$&'));
  const content = ['BT', '/F1 10 Tf', '40 800 Td'];
  safeLines.forEach((line, index) => {
    if (index > 0) content.push('0 -14 Td');
    content.push(`(${line}) Tj`);
  });
  content.push('ET');

  const stream = content.join('\n');
  const objects = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n');
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push(`5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

module.exports = {
  toCsv,
  buildSimplePdf,
};
