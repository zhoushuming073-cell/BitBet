export function currentWeekStart(now = Date.now()): number {
  const start = new Date(now);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysSinceMonday);
  return start.getTime();
}
