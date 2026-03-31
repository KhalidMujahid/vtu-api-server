function toDate(value, fallbackTime = 'start') {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  // If date has no explicit time, normalize to day bounds
  const hasTime = raw.includes('T') || raw.includes(':');
  if (!hasTime) {
    if (fallbackTime === 'end') {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
  }

  return date;
}

function buildDateRangeFilter(startDate, endDate, field = 'createdAt') {
  const start = toDate(startDate, 'start');
  const end = toDate(endDate, 'end');

  if (!start && !end) return {};

  const filter = {};
  filter[field] = {};
  if (start) filter[field].$gte = start;
  if (end) filter[field].$lte = end;
  return filter;
}

module.exports = {
  toDate,
  buildDateRangeFilter,
};
