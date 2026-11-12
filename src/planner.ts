import type { Block, Data, Day, Event, EventDetail, Task } from "./model.ts";
import { addDays, dateOf, dayDiff, endMinute, nowMinute } from "./time.ts";
export interface Interval {
  start: number;
  end: number;
}
export interface Occurrence extends Interval {
  id: string;
  sourceDate: Day;
  title: string;
  kind: "event" | "rest";
  eventId: string;
  weekly: boolean;
}
export const total = (xs: Interval[]) =>
  xs.reduce((s, x) => s + Math.max(0, x.end - x.start), 0);
export function merge(xs: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of xs
    .filter((x) => x.end > x.start)
    .map((x) => ({ ...x }))
    .sort((a, b) => a.start - b.start || a.end - b.end)) {
    const p = out.at(-1);
    if (p && x.start <= p.end) p.end = Math.max(p.end, x.end);
    else out.push(x);
  }
  return out;
}
export const overlaps = (a: Interval, b: Interval) =>
  a.start < b.end && b.start < a.end;
export function subtract(window: Interval, busy: Interval[]): Interval[] {
  let cursor = window.start;
  const out: Interval[] = [];
  for (const x of merge(busy)) {
    if (x.end <= cursor || x.start >= window.end) continue;
    if (x.start > cursor)
      out.push({ start: cursor, end: Math.min(x.start, window.end) });
    cursor = Math.max(cursor, x.end);
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out;
}
export function eventOn(e: Event, day: Day): EventDetail | null {
  if (Object.hasOwn(e.exceptions, day)) return e.exceptions[day];
  return day === e.date ||
    (e.weekly &&
      day >= e.date &&
      dateOf(day).getDay() === dateOf(e.date).getDay())
    ? e
    : null;
}
export function occurrences(data: Data, day: Day): Occurrence[] {
  const out: Occurrence[] = [];
  for (let shift = -1; shift <= 1; shift++) {
    const d = addDays(day, shift);
    for (const e of data.events) {
      const x = eventOn(e, d);
      if (x)
        out.push({
          ...x,
          start: x.start + shift * 1440,
          end: endMinute(x.start, x.end) + shift * 1440,
          id: `${e.id}:${d}`,
          eventId: e.id,
          weekly: e.weekly,
          sourceDate: d,
        });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
export function activeWindow(data: Data, day: Day, now: Date): Interval {
  const end = endMinute(data.settings.start, data.settings.end);
  return {
    start: Math.min(end, Math.max(data.settings.start, nowMinute(day, now))),
    end,
  };
}
// Plans may cross midnight: neighboring plans reserve time in this day's coordinates.
export function neighboringBlocks(data: Data, day: Day): Block[] {
  return [-1, 1].flatMap((shift) =>
    (data.plans[addDays(day, shift)]?.blocks ?? [])
      .filter((b) => !b.done)
      .map((b) => ({
        ...b,
        start: b.start + shift * 1440,
        end: b.end + shift * 1440,
      })),
  );
}
export function freeTime(data: Data, day: Day, now: Date) {
  return subtract(activeWindow(data, day, now), [
    ...occurrences(data, day),
    ...neighboringBlocks(data, day),
  ]);
}
export function priority(task: Task, day: Day, energy: number) {
  const days = task.deadline ? dayDiff(task.deadline, day) : 9999;
  return (
    (days < 0
      ? 1200
      : days === 0
        ? 1000
        : days === 1
          ? 800
          : days <= 3
            ? 550
            : days <= 7
              ? 300
              : 0) +
    task.importance * 80 +
    (energy <= 2 ? (4 - task.focus) * 100 : 0)
  );
}
export interface Proposal {
  blocks: Block[];
  freeBefore: number;
  freeAfter: number;
  work: number;
  normalWork: number;
  warnings: string[];
  unplaced: {
    taskId: string;
    title: string;
    minutes: number;
    reason: string;
  }[];
}
function taskReason(
  t: Task,
  day: Day,
  slots: Interval[],
  left: number,
  budget: number,
) {
  if (t.deadline && t.deadline < day)
    return "締切超過。締切を見直してから再計画できます。";
  if (!slots.length) return "活動時間内に空きがありません。";
  if (!t.split && Math.max(0, ...slots.map((s) => s.end - s.start)) < left)
    return "必要な連続した空き時間がありません。";
  if (budget < left)
    return "予備時間・プランの作業量を確保するため、残りは候補に残します。";
  return "締切前の時間に収まりません。";
}
export function conflicts(
  data: Data,
  day: Day,
  blocks: Block[],
  now: Date,
): string[] {
  const warnings: string[] = [];
  const events = occurrences(data, day);
  const win = {
    start: data.settings.start,
    end: endMinute(data.settings.start, data.settings.end),
  };
  const relevant = events.filter((e) => overlaps(win, e));
  for (let i = 0; i < relevant.length; i++)
    for (let j = i + 1; j < relevant.length; j++)
      if (overlaps(relevant[i], relevant[j]))
        warnings.push(
          `固定予定「${relevant[i].title}」と「${relevant[j].title}」が重複しています（空き時間は二重に差し引きません）。`,
        );
  const busy = blocks.filter((b) => !b.done);
  for (const b of busy) {
    const task = data.tasks.find((t) => t.id === b.taskId);
    if (
      events.some((e) => overlaps(b, e)) ||
      neighboringBlocks(data, day).some((x) => overlaps(b, x)) ||
      busy.some((x) => x.id !== b.id && overlaps(b, x))
    )
      warnings.push(`「${b.title}」の時刻が別の予定と衝突しています。`);
    if (b.start < win.start || b.end > win.end)
      warnings.push(`「${b.title}」は活動時間外です。`);
    if (b.end <= nowMinute(day, now))
      warnings.push(
        `「${b.title}」の予定時刻は過ぎています。実績を記録するか、再計画できます。`,
      );
    if (task?.deadline && b.end > (dayDiff(task.deadline, day) + 1) * 1440)
      warnings.push(`「${b.title}」の配置は締切後です。`);
  }
  return [...new Set(warnings)];
}
function build(data: Data, day: Day, now: Date, limit?: number): Proposal {
  const old = data.plans[day]?.blocks ?? [];
  const cutoff = nowMinute(day, now);
  const blocks = old.filter(
    (b) =>
      b.done ||
      (b.manual &&
        data.tasks.some((t) => t.id === b.taskId && t.status !== "done")) ||
      (!b.done && b.start < cutoff),
  );
  const free = freeTime(data, day, now);
  let slots = free.flatMap((s) =>
    subtract(
      s,
      blocks.filter((b) => !b.done),
    ),
  );
  const available = total(free);
  const capacity = Math.floor(available * (1 - data.settings.reserve / 100));
  const retainedWork = total(
    blocks
      .filter((b) => !b.done)
      .map((b) => ({
        start: Math.max(b.start, activeWindow(data, day, now).start),
        end: b.end,
      })),
  );
  let budget = Math.max(0, (limit ?? capacity) - retainedWork);
  const tasks = data.tasks
    .filter((t) => t.status !== "done" && t.remaining > 0)
    .sort(
      (a, b) =>
        priority(b, day, data.checkins[day]?.energy ?? 3) -
          priority(a, day, data.checkins[day]?.energy ?? 3) ||
        a.id.localeCompare(b.id),
    );
  const unplaced: Proposal["unplaced"] = [];
  for (const t of tasks) {
    const elsewhere = Object.entries(data.plans)
      .filter(([d]) => d !== day)
      .flatMap(([d, p]) => p.blocks.filter((b) => b.end > nowMinute(d, now)))
      .filter((b) => b.taskId === t.id && !b.done)
      .reduce((s, b) => s + b.end - b.start, 0);
    let left = Math.max(
      0,
      t.remaining -
        total(
          blocks.filter((b) => b.taskId === t.id && !b.done && b.end > cutoff),
        ) -
        elsewhere,
    );
    if (!left) continue;
    const due = t.deadline ? (dayDiff(t.deadline, day) + 1) * 1440 : Infinity;
    const allowed = slots
      .map((s) => ({ ...s, end: Math.min(s.end, due) }))
      .filter((s) => s.end > s.start);
    const before = left;
    for (const slot of allowed) {
      const room = Math.min(slot.end - slot.start, budget, left);
      if (room <= 0 || (!t.split && room < left)) continue;
      const block: Block = {
        id: `auto:${day}:${t.id}:${slot.start}`,
        taskId: t.id,
        title: t.title,
        category: t.category,
        start: slot.start,
        end: slot.start + room,
        manual: false,
        done: false,
      };
      blocks.push(block);
      left -= room;
      budget -= room;
      slots = slots.flatMap((s) => subtract(s, [block]));
      if (!left) break;
    }
    if (left)
      unplaced.push({
        taskId: t.id,
        title: t.title,
        minutes: left,
        reason:
          taskReason(t, day, allowed, before, budget) +
          (t.deadline && t.deadline <= day
            ? " 締切までに完了できない見込みです。"
            : ""),
      });
  }
  const remaining = free.flatMap((s) =>
    subtract(
      s,
      blocks.filter((b) => !b.done),
    ),
  );
  const work = total(blocks.filter((b) => !b.done && b.end > cutoff));
  const warnings = conflicts(data, day, blocks, now);
  if (retainedWork > (limit ?? capacity))
    warnings.push(
      "手動指定・開始済みのタスクが作業量の目安を超えています。時刻を保持したため、実際の時間を確認してください。",
    );
  return {
    blocks: blocks.sort(
      (a, b) => a.start - b.start || a.id.localeCompare(b.id),
    ),
    freeBefore: available,
    freeAfter: total(remaining),
    work,
    normalWork: work,
    warnings,
    unplaced,
  };
}
export function propose(
  data: Data,
  day: Day,
  now: Date,
  mode: "normal" | "short",
): Proposal {
  const normal = build(data, day, now);
  if (mode === "normal") return normal;
  const saved = data.plans[day];
  const baseline =
    saved?.mode === "normal"
      ? total(
          saved.blocks.filter((b) => !b.done && b.end > nowMinute(day, now)),
        )
      : saved?.normalBackup
        ? total(
            saved.normalBackup.filter(
              (b) => !b.done && b.end > nowMinute(day, now),
            ),
          )
        : normal.work;
  const short = build(data, day, now, Math.floor(baseline / 2));
  return { ...short, normalWork: baseline };
}
// Optimistic per-task bound, never a promise: competing tasks and manual allocations can only reduce it.
export function deadlineWarnings(data: Data, day: Day, now: Date): string[] {
  const out: string[] = [];
  for (const t of data.tasks.filter((t) => t.status !== "done" && t.deadline)) {
    const days = dayDiff(t.deadline, day);
    if (days < 0) {
      out.push(
        `「${t.title}」は締切を過ぎています。残り${t.remaining}分です。`,
      );
      continue;
    }
    if (days > 90) {
      out.push(
        `「${t.title}」の締切は90日より先です。長期の実行可能性は未確認です。`,
      );
      continue;
    }
    let cap = 0,
      longest = 0;
    for (let i = 0; i <= days; i++) {
      const d = addDays(day, i);
      const slots = freeTime(data, d, now)
        .map((s) => ({
          ...s,
          end: Math.min(s.end, (dayDiff(t.deadline, d) + 1) * 1440),
        }))
        .filter((s) => s.end > s.start);
      const daily = Math.floor(
        total(slots) * (1 - data.settings.reserve / 100),
      );
      cap += daily;
      longest = Math.max(
        longest,
        Math.min(daily, Math.max(0, ...slots.map((s) => s.end - s.start))),
      );
    }
    if (t.remaining > (t.split ? cap : longest))
      out.push(
        `「${t.title}」は、現在の固定予定と予備時間では締切までに収まりません（残り${t.remaining}分）。`,
      );
  }
  return out;
}
