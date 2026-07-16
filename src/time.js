const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toVnDate(now) {
  return new Date(now.getTime() + VN_OFFSET_MS);
}

export function startOfDayVN(now = new Date()) {
  const vnDate = toVnDate(now);
  const startVnMs = Date.UTC(vnDate.getUTCFullYear(), vnDate.getUTCMonth(), vnDate.getUTCDate()) - VN_OFFSET_MS;
  return Math.floor(startVnMs / 1000);
}

export function vnDateKey(now = new Date()) {
  const vnDate = toVnDate(now);
  return `${vnDate.getUTCFullYear()}-${pad2(vnDate.getUTCMonth() + 1)}-${pad2(vnDate.getUTCDate())}`;
}

export function isFirstDayOfMonthVN(now = new Date()) {
  return toVnDate(now).getUTCDate() === 1;
}

export function previousMonthKey(now = new Date()) {
  const vnDate = toVnDate(now);
  const prevMonthDate = new Date(Date.UTC(vnDate.getUTCFullYear(), vnDate.getUTCMonth() - 1, 1));
  return `${prevMonthDate.getUTCFullYear()}-${pad2(prevMonthDate.getUTCMonth() + 1)}`;
}
