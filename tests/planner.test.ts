import test from "node:test";
import assert from "node:assert/strict";
import { initialData } from "../src/model.ts";
import type { Block, Data, Event, Task } from "../src/model.ts";
import {
  activeWindow,
  conflicts,
  deadlineWarnings,
  eventOn,
  freeTime,
  merge,
  occurrences,
  overlaps,
  propose,
  subtract,
  total,
} from "../src/planner.ts";
import { addDays, localDay, nowMinute, weekDays } from "../src/time.ts";
import { applyPlan, finishWork } from "../src/actions.ts";
const day = "2026-11-12",
  now = new Date(2026, 10, 12, 9, 0, 0);
function data(): Data {
  const d = initialData();
  d.settings.start = 540;
  d.settings.end = 720;
  d.settings.reserve = 20;
  return d;
}
function task(id = "t", extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    category: "勉強",
    remaining: 60,
    deadline: "",
    importance: 2,
    focus: 2,
    split: true,
    status: "todo",
    ...extra,
  };
}
function event(start: number, end: number, extra: Partial<Event> = {}): Event {
  return {
    id: `${start}`,
    title: `予定${start}`,
    date: day,
    start,
    end,
    weekly: false,
    kind: "event",
    exceptions: {},
    ...extra,
  };
}
function block(extra: Partial<Block> = {}): Block {
  return {
    id: "b",
    taskId: "t",
    title: "t",
    category: "勉強",
    start: 550,
    end: 580,
    done: false,
    manual: true,
    ...extra,
  };
}
test("overlap union avoids double subtraction, and inputs are unchanged", () => {
  const xs = [
    { start: 5, end: 15 },
    { start: 10, end: 20 },
    { start: 20, end: 25 },
  ];
  assert.deepEqual(merge(xs), [{ start: 5, end: 25 }]);
  assert.equal(xs[0].end, 15);
  assert.deepEqual(subtract({ start: 0, end: 30 }, xs), [
    { start: 0, end: 5 },
    { start: 25, end: 30 },
  ]);
});
test("overlapping events count once", () => {
  const d = data();
  d.events = [event(540, 600), event(570, 630)];
  assert.equal(total(freeTime(d, day, now)), 90);
  assert.match(conflicts(d, day, [], now)[0], /重複/);
});
test("midnight event carries into next local date", () => {
  const d = data();
  d.settings.start = 0;
  d.settings.end = 180;
  d.events = [event(1380, 60, { date: addDays(day, -1) })];
  assert.equal(total(freeTime(d, day, new Date(2026, 10, 12, 0))), 120);
  assert.equal(occurrences(d, day)[0].start, -60);
});
test("overnight active window includes tomorrow events", () => {
  const d = data();
  d.settings.start = 1320;
  d.settings.end = 120;
  d.events = [event(0, 60, { date: addDays(day, 1) })];
  assert.equal(total(freeTime(d, day, now)), 180);
});
test("weekly series begins on start date and exceptions are independent", () => {
  const e = event(540, 600, { weekly: true });
  assert.equal(eventOn(e, addDays(day, -7)), null);
  assert.ok(eventOn(e, addDays(day, 7)));
  e.exceptions[day] = null;
  assert.equal(eventOn(e, day), null);
  assert.ok(eventOn(e, addDays(day, 7)));
  e.exceptions[addDays(day, 7)] = {
    title: "変更",
    start: 600,
    end: 660,
    kind: "rest",
  };
  assert.equal(eventOn(e, addDays(day, 7))?.title, "変更");
});
test("past dates have no space, current minute rounds up", () => {
  const d = data();
  d.tasks = [task()];
  assert.equal(propose(d, addDays(day, -1), now, "normal").work, 0);
  assert.equal(nowMinute(day, new Date(2026, 10, 12, 9, 0, 1)), 541);
  assert.equal(activeWindow(d, day, new Date(2026, 10, 12, 10, 10)).start, 610);
});
test("reserve defaults to 20%, can change", () => {
  const d = data();
  d.settings.end = 660;
  d.tasks = [task("t", { remaining: 120 })];
  const p = propose(d, day, now, "normal");
  assert.equal(p.work, 96);
  assert.equal(p.freeAfter, 24);
  d.settings.reserve = 50;
  assert.equal(propose(d, day, now, "normal").work, 60);
});
test("nondivisible tasks need continuous time", () => {
  const d = data();
  d.settings.reserve = 0;
  d.events = [event(580, 600), event(640, 660)];
  d.tasks = [task("t", { remaining: 60, split: false })];
  const p = propose(d, day, now, "normal");
  assert.equal(p.work, 60);
  assert.equal(p.blocks[0].start, 660);
  d.tasks[0].remaining = 70;
  assert.equal(propose(d, day, now, "normal").work, 0);
  assert.match(propose(d, day, now, "normal").unplaced[0].reason, /連続/);
});
test("divisible tasks fill separate gaps and leave exact remainder", () => {
  const d = data();
  d.settings.reserve = 0;
  d.events = [event(580, 600), event(640, 660)];
  d.tasks = [task("t", { remaining: 150 })];
  const p = propose(d, day, now, "normal");
  assert.equal(p.work, 140);
  assert.equal(p.unplaced[0].minutes, 10);
  assert.equal(p.blocks.length, 3);
});
test("no free time does not schedule", () => {
  const d = data();
  d.events = [event(530, 800)];
  d.tasks = [task()];
  const p = propose(d, day, now, "normal");
  assert.equal(p.work, 0);
  assert.equal(p.freeAfter, 0);
  assert.match(p.unplaced[0].reason, /空きがありません/);
});
test("done tasks are never proposed", () => {
  const d = data();
  d.tasks = [task("t", { remaining: 0, status: "done" })];
  assert.equal(propose(d, day, now, "normal").blocks.length, 0);
});
test("deadline, importance and low-energy focus influence priority", () => {
  const d = data();
  d.tasks = [task("a", { importance: 1 }), task("b", { importance: 3 })];
  assert.equal(propose(d, day, now, "normal").blocks[0].taskId, "b");
  d.tasks[0].deadline = day;
  assert.equal(propose(d, day, now, "normal").blocks[0].taskId, "a");
  d.tasks = [task("a", { focus: 3 }), task("b", { focus: 1 })];
  d.checkins[day] = { energy: 1, sleep: null, note: "" };
  assert.equal(propose(d, day, now, "normal").blocks[0].taskId, "b");
});
test("overdue task is unplaced with explicit reason", () => {
  const d = data();
  d.tasks = [task("t", { deadline: addDays(day, -1) })];
  const p = propose(d, day, now, "normal");
  assert.equal(p.work, 0);
  assert.match(p.unplaced[0].reason, /締切超過/);
});
test("deadline truncates an overnight slot at midnight", () => {
  const d = data();
  d.settings.start = 1380;
  d.settings.end = 120;
  d.settings.reserve = 0;
  d.tasks = [task("t", { deadline: day, remaining: 90 })];
  const p = propose(d, day, now, "normal");
  assert.equal(p.work, 60);
  assert.equal(p.blocks[0].end, 1440);
  assert.match(p.unplaced[0].reason, /締切までに完了できない/);
});
test("impossible future deadlines warn without claiming feasibility", () => {
  const d = data();
  d.tasks = [task("t", { deadline: addDays(day, 1), remaining: 300 })];
  assert.match(deadlineWarnings(d, day, now)[0], /締切までに収まりません/);
});
test("manual allocations retained and collisions reported", () => {
  const d = data();
  d.tasks = [task()];
  d.events = [event(560, 590)];
  d.plans[day] = { mode: "normal", blocks: [block()] };
  const p = propose(d, day, now, "normal");
  assert.deepEqual(
    p.blocks.find((b) => b.manual),
    block(),
  );
  assert.ok(p.warnings.some((w) => w.includes("衝突")));
  assert.equal(total(p.blocks.filter((b) => b.taskId === "t")), 60);
});
test("short plan is about half and keeps original snapshot", () => {
  let d = data();
  d.settings.end = 660;
  d.tasks = [task("t", { remaining: 120 })];
  const normal = propose(d, day, now, "normal");
  d = applyPlan(d, day, "normal", normal.blocks);
  const short = propose(d, day, now, "short");
  assert.equal(short.work, 48);
  d = applyPlan(d, day, "short", short.blocks);
  assert.deepEqual(d.plans[day].normalBackup, normal.blocks);
  assert.equal(propose(d, day, now, "short").work, 48);
});
test("short indivisible task can be below target; manual task can exceed it", () => {
  let d = data();
  d.tasks = [task("t", { remaining: 60, split: false })];
  d = applyPlan(d, day, "normal", propose(d, day, now, "normal").blocks);
  assert.equal(propose(d, day, now, "short").work, 0);
  d.plans[day].blocks = [block({ end: 610 })];
  const p = propose(d, day, now, "short");
  assert.equal(p.work, 60);
  assert.ok(p.warnings.some((w) => w.includes("目安を超え")));
});
test("previous expired unfinished plans remain candidates tomorrow", () => {
  const d = data();
  d.tasks = [task()];
  d.plans[addDays(day, -1)] = {
    mode: "normal",
    blocks: [block({ start: 550, end: 610 })],
  };
  assert.equal(propose(d, day, now, "normal").work, 60);
});
test("neighbors spanning midnight reserve time and task budget", () => {
  const d = data();
  d.settings.start = 0;
  d.settings.end = 180;
  d.tasks = [task("t", { remaining: 90 })];
  d.plans[addDays(day, -1)] = {
    mode: "normal",
    blocks: [block({ start: 1430, end: 1470 })],
  };
  const p = propose(d, day, new Date(2026, 10, 12, 0), "normal");
  assert.equal(p.freeBefore, 150);
  assert.equal(p.work, 50);
  assert.ok(p.blocks.every((b) => b.start >= 30));
});
test("completion reduces estimate separately from actual, clears stale allocations", () => {
  const d = data();
  d.tasks = [task()];
  d.plans[day] = { mode: "normal", blocks: [block()] };
  const result = finishWork(d, "t", day, 30, 45, "b");
  assert.equal(result.tasks[0].remaining, 30);
  assert.equal(result.tasks[0].status, "doing");
  assert.equal(result.logs[0].actual, 45);
  assert.equal(result.logs[0].progress, 30);
  assert.equal(result.plans[day].blocks[0].done, true);
  assert.equal(propose(result, day, now, "normal").work, 30);
  assert.equal(d.tasks[0].remaining, 60);
});
test("planner is pure and deterministic, with randomized overlap invariant", () => {
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let run = 0; run < 150; run++) {
    const d = data();
    d.settings.end = 1200;
    d.events = Array.from({ length: 8 }, (_, i) => {
      const start = 540 + Math.floor(rand() * 500);
      return event(start, start + Math.floor(rand() * 50) + 1, { id: `e${i}` });
    });
    d.tasks = Array.from({ length: 8 }, (_, i) =>
      task(`t${i}`, {
        remaining: Math.floor(rand() * 100) + 1,
        split: rand() > 0.5,
      }),
    );
    const snapshot = JSON.stringify(d);
    const p = propose(d, day, now, "normal");
    assert.deepEqual(p, propose(d, day, now, "normal"));
    assert.equal(JSON.stringify(d), snapshot);
    assert.ok(p.work <= Math.floor(p.freeBefore * 0.8));
    for (const b of p.blocks) {
      assert.ok(b.start >= 540);
      assert.ok(b.end <= 1200);
      assert.ok(!occurrences(d, day).some((e) => overlaps(e, b)));
      assert.ok(!p.blocks.some((x) => x.id !== b.id && overlaps(b, x)));
    }
    assert.ok(p.freeAfter >= Math.ceil(p.freeBefore * 0.2));
  }
});
test("date-only values use local calendar, including leap days", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(localDay(new Date(2026, 0, 1, 0, 1)), "2026-01-01");
  assert.equal(weekDays(day)[0], "2026-11-09");
});
test("collectively impossible deadlines are warned even if each task fits", () => {
  const d = data();
  d.tasks = [
    task("a", { deadline: addDays(day, 1), remaining: 150 }),
    task("b", { deadline: addDays(day, 1), remaining: 150 }),
  ];
  assert.ok(
    deadlineWarnings(d, day, now).some((w) =>
      w.includes("すべてを締切までに終えることはできません"),
    ),
  );
});
