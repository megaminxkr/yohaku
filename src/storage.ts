import type { Data } from "./model.ts";
import { initialData } from "./model.ts";
import { validDay } from "./time.ts";
const bad = (message = "バックアップの形式が正しくありません。") => {
  throw new Error(message);
};
function obj(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return bad();
  return x as Record<string, unknown>;
}
function arr(x: unknown, max = 20000): unknown[] {
  if (!Array.isArray(x) || x.length > max) return bad();
  return x;
}
function str(x: unknown, max = 200, empty = false): void {
  if (typeof x !== "string" || x.length > max || (!empty && !x.trim())) bad();
}
function num(x: unknown, min: number, max: number, integer = true): void {
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    x < min ||
    x > max ||
    (integer && !Number.isInteger(x))
  )
    bad();
}
function bool(x: unknown): void {
  if (typeof x !== "boolean") bad();
}
function day(x: unknown): void {
  if (!validDay(x)) bad();
}
function one(x: unknown, values: unknown[]) {
  if (!values.includes(x)) bad();
}
function keyed(x: unknown, visit: (v: unknown) => void) {
  for (const [k, v] of Object.entries(obj(x))) {
    day(k);
    visit(v);
  }
}
function unique(xs: unknown[]) {
  const ids = xs.map((x) => obj(x).id);
  if (new Set(ids).size !== ids.length) bad("重複したIDが含まれています。");
}
function detail(v: unknown) {
  const x = obj(v);
  str(x.title);
  num(x.start, 0, 1439);
  num(x.end, 0, 1439);
  if (x.start === x.end) bad("開始と終了は異なる時刻にしてください。");
  one(x.kind, ["event", "rest"]);
}
function blocks(v: unknown, taskIds: Set<unknown>) {
  const xs = arr(v);
  unique(xs);
  for (const b of xs) {
    const x = obj(b);
    str(x.id);
    str(x.taskId);
    str(x.title);
    str(x.category, 40);
    num(x.start, 0, 2879);
    num(x.end, 1, 2880);
    if ((x.end as number) <= (x.start as number)) bad();
    bool(x.manual);
    bool(x.done);
    if (!x.done && !taskIds.has(x.taskId))
      bad("存在しないタスクを参照する計画です。");
  }
}
export function validateData(input: unknown): Data {
  const d = obj(input);
  if (d.version !== 1)
    bad(
      "この保存バージョンには対応していません。対応する版のYohakuで開いてください。",
    );
  num(d.revision, 0, Number.MAX_SAFE_INTEGER);
  const s = obj(d.settings);
  num(s.start, 0, 1439);
  num(s.end, 0, 1439);
  if (s.start === s.end)
    bad("活動時間の開始と終了は異なる時刻にしてください。");
  num(s.reserve, 0, 80);
  bool(s.onboarded);
  const categories = arr(s.categories, 30);
  if (!categories.length) bad();
  categories.forEach((c) => str(c, 40));
  if (new Set(categories).size !== categories.length)
    bad("カテゴリが重複しています。");
  const tasks = arr(d.tasks);
  unique(tasks);
  for (const t of tasks) {
    const x = obj(t);
    str(x.id);
    str(x.title);
    str(x.category, 40);
    if (!categories.includes(x.category)) bad("未登録のカテゴリです。");
    num(x.remaining, 0, 525600);
    if (x.deadline !== "") day(x.deadline);
    one(x.importance, [1, 2, 3]);
    one(x.focus, [1, 2, 3]);
    bool(x.split);
    one(x.status, ["todo", "doing", "done"]);
    if (x.status === "done" && x.remaining !== 0)
      bad("完了タスクの残り時間は0分にしてください。");
    if (x.status !== "done" && x.remaining === 0)
      bad("未完了タスクには残り時間が必要です。");
    if (x.completedOn !== undefined) day(x.completedOn);
  }
  const events = arr(d.events);
  unique(events);
  for (const e of events) {
    const x = obj(e);
    str(x.id);
    detail(x);
    day(x.date);
    bool(x.weekly);
    keyed(x.exceptions, (v) => {
      if (v !== null) detail(v);
    });
  }
  const taskIds = new Set(tasks.map((t) => obj(t).id));
  keyed(d.plans, (v) => {
    const x = obj(v);
    one(x.mode, ["normal", "short"]);
    blocks(x.blocks, taskIds);
    if (x.normalBackup !== undefined) blocks(x.normalBackup, taskIds);
  });
  keyed(d.checkins, (v) => {
    const x = obj(v);
    num(x.energy, 1, 5);
    if (x.sleep !== null) num(x.sleep, 0, 24, false);
    str(x.note, 1000, true);
  });
  const logs = arr(d.logs, 100000);
  unique(logs);
  for (const l of logs) {
    const x = obj(l);
    str(x.id);
    str(x.taskId);
    str(x.title);
    str(x.category, 40);
    day(x.date);
    num(x.actual, 0, 1440);
    num(x.progress, 0, 525600);
    bool(x.finished);
  }
  arr(d.recordedDays).forEach(day);
  return structuredClone(d) as unknown as Data;
}
// Migration dispatch is explicit: future versions add pure vN -> vN+1 steps here.
export function migrate(input: unknown): Data {
  return validateData(input);
}
export function parseBackup(text: string): Data {
  if (text.length > 10_000_000) bad("ファイルが大きすぎます（上限10MB）。");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    bad("JSONファイルとして読み取れません。");
  }
  return migrate(value);
}
export const serialize = (data: Data) =>
  JSON.stringify(validateData(data), null, 2);
export function openDatabase(
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open("yohaku", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onerror = () =>
      reject(request.error ?? new Error("保存領域を開けません。"));
    request.onblocked = () =>
      reject(new Error("別のタブを閉じてから再試行してください。"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
export async function loadData(factory?: IDBFactory): Promise<Data> {
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readonly");
      const req = tx.objectStore("state").get("data");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        try {
          resolve(
            req.result === undefined ? initialData() : migrate(req.result),
          );
        } catch (e) {
          reject(e);
        }
      };
    });
  } finally {
    db.close();
  }
}
// Compare-and-swap within one IndexedDB transaction prevents silent cross-tab overwrites.
export async function saveData(
  data: Data,
  expectedRevision: number,
  factory?: IDBFactory,
): Promise<Data> {
  const next = validateData({ ...data, revision: expectedRevision + 1 });
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      let problem: Error | null = null;
      const store = tx.objectStore("state");
      const get = store.get("data");
      get.onsuccess = () => {
        if ((get.result?.revision ?? 0) !== expectedRevision) {
          problem = new Error(
            "別のタブでデータが更新されています。入力をバックアップしてから再読み込みしてください。",
          );
          tx.abort();
          return;
        }
        store.put(next, "data");
      };
      tx.oncomplete = () => resolve(next);
      tx.onerror = () =>
        reject(problem ?? tx.error ?? new Error("保存できませんでした。"));
      tx.onabort = () =>
        reject(problem ?? tx.error ?? new Error("保存が中断されました。"));
    });
  } finally {
    db.close();
  }
}
