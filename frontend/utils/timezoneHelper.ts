/**
 * Timezone utilities to enforce Asia/Singapore (SGT, UTC+8) timezone in the frontend.
 */

export function getSingaporeDateString(date: Date = new Date()): string {
  // Returns "YYYY-MM-DD" in Asia/Singapore (SGT)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function formatToSingaporeDate(
  dateInput: Date | string | number,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    ...options
  }).format(date);
}

export function formatToSingaporeTime(
  dateInput: Date | string | number,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: true }
): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    ...options
  }).format(date);
}

export function formatToSingaporeDateTime(dateInput: Date | string | number): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  const dateStr = formatToSingaporeDate(date, { day: 'numeric', month: 'short' });
  const timeStr = formatToSingaporeTime(date, { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateStr} • ${timeStr}`;
}

export function getSingaporeDate(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const year = parseInt(parts.find(p => p.type === 'year')?.value || '2026', 10);
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10) - 1;
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
  let hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);

  return new Date(year, month, day, hour, minute, second);
}

export function getSingaporeTimeTodayRange(): { from: Date; to: Date } {
  const nowSgt = getSingaporeDate();
  const from = new Date(nowSgt);
  from.setHours(0, 0, 0, 0);
  const to = new Date(nowSgt);
  return { from, to };
}

export function parseDatabaseDate(dateInput: Date | string | number): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;
  if (typeof dateInput === 'number') return new Date(dateInput);

  let str = String(dateInput).trim();
  if (str.endsWith('Z')) {
    str = str.slice(0, -1) + '+08:00';
  } else if (str.endsWith('+00:00')) {
    str = str.slice(0, -6) + '+08:00';
  } else if (!str.includes('+') && !str.includes('-') && str.includes('T')) {
    str = str + '+08:00';
  } else if (!str.includes('T') && str.includes(' ')) {
    str = str.replace(' ', 'T') + '+08:00';
  }

  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) {
    return new Date(dateInput);
  }
  return parsed;
}

