export type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function daysInMonth(year: number, month: number) {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (month === 2) return leapYear ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function localDateParts(date: Date): DateParts {
  return {
    year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
    hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(),
  };
}

export function parseDateParts(value: string, withTime = false): DateParts | null {
  const pattern = withTime
    ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
    : /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = pattern.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText = '0', minuteText = '0', secondText = '0'] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

export function formatDateParts({ year, month, day, hour, minute, second }: DateParts, withTime = false) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return withTime ? `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}` : date;
}
