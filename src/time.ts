import type { Day } from "./model.ts";
export function localDay(d = new Date()): Day {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function dateOf(day: Day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
export function addDays(day: Day, n: number): Day {
  const d = dateOf(day);
  d.setDate(d.getDate() + n);
  return localDay(d);
}
export function dayDiff(a: Day, b: Day) {
  const x = a.split("-").map(Number),
    y = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(x[0], x[1] - 1, x[2]) - Date.UTC(y[0], y[1] - 1, y[2])) /
      86400000,
  );
}
export function validDay(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    s >= "2000-01-01" &&
    s <= "2199-12-31" &&
    localDay(dateOf(s)) === s
  );
}
export const minutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
export const clock = (n: number) =>
  `${String(Math.floor((((n % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((n % 60) + 60) % 60).padStart(2, "0")}`;
export const timeLabel = (n: number) =>
  `${n >= 1440 ? "翌日 " : n < 0 ? "前日 " : ""}${clock(n)}`;
export const duration = (n: number) =>
  n >= 60
    ? `${Math.floor(n / 60)}時間${n % 60 ? `${n % 60}分` : ""}`
    : `${n}分`;
export const endMinute = (start: number, end: number) =>
  end <= start ? end + 1440 : end;
export function nowMinute(day: Day, now: Date) {
  return (
    dayDiff(localDay(now), day) * 1440 +
    now.getHours() * 60 +
    now.getMinutes() +
    (now.getSeconds() > 0 ? 1 : 0)
  );
}
export function weekDays(day: Day) {
  const monday = addDays(day, -((dateOf(day).getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
