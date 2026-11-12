import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { initialData } from "../src/model.ts";
import {
  loadData,
  openDatabase,
  parseBackup,
  saveData,
  serialize,
  validateData,
} from "../src/storage.ts";
test("backup round trip preserves unicode, notes, zero values and recurring exceptions", () => {
  const d = initialData();
  d.checkins["2026-11-12"] = {
    energy: 1,
    sleep: 0,
    note: "<script>alert(1)</script> 日本語",
  };
  d.recordedDays = ["2026-11-12"];
  d.events = [
    {
      id: "e",
      title: "休息",
      start: 1380,
      end: 60,
      date: "2026-11-12",
      weekly: true,
      kind: "rest",
      exceptions: { "2026-11-19": null },
    },
  ];
  assert.deepEqual(parseBackup(serialize(d)), d);
});
test("bad JSON, unsupported versions and oversized files are rejected", () => {
  assert.throws(() => parseBackup("{oops"));
  assert.throws(
    () => parseBackup(JSON.stringify({ ...initialData(), version: 2 })),
    /バージョン/,
  );
  assert.throws(() => parseBackup(" ".repeat(10_000_001)), /大きすぎ/);
});
test("invalid nested fields are rejected before any restore", () => {
  const cases = [
    (d: any) => (d.settings.reserve = -1),
    (d: any) => (d.settings.start = d.settings.end),
    (d: any) => (d.checkins["2026-02-30"] = { energy: 3, sleep: 7, note: "" }),
    (d: any) => (d.checkins["2026-11-12"] = { energy: 99, sleep: 7, note: "" }),
    (d: any) => (d.settings.categories = ["勉強", "勉強"]),
    (d: any) =>
      (d.logs = [
        {
          id: "x",
          taskId: "x",
          title: "x",
          category: "勉強",
          date: "2026-11-12",
          actual: -3,
          progress: 1,
          finished: false,
        },
      ]),
    (d: any) => (d.settings.categories = []),
  ];
  for (const change of cases) {
    const d = initialData();
    change(d);
    assert.throws(() => validateData(d));
  }
});
test("duplicate ids and dangling task references rejected", () => {
  const d = initialData();
  d.plans["2026-11-12"] = {
    mode: "normal",
    blocks: [
      {
        id: "b",
        taskId: "missing",
        title: "t",
        category: "勉強",
        start: 10,
        end: 20,
        manual: true,
        done: false,
      },
    ],
  };
  assert.throws(() => validateData(d));
  d.plans["2026-11-12"].blocks[0].done = true;
  validateData(d);
  d.plans["2026-11-12"].blocks.push(d.plans["2026-11-12"].blocks[0]);
  assert.throws(() => validateData(d), /重複/);
});
test("IndexedDB loads empty defaults, saves atomically and survives reopen", async () => {
  const f = new IDBFactory();
  const d = await loadData(f);
  assert.equal(d.revision, 0);
  d.settings.reserve = 35;
  const saved = await saveData(d, 0, f);
  assert.equal(saved.revision, 1);
  assert.deepEqual(await loadData(f), saved);
});
test("cross-tab stale writes are rejected without replacing saved data", async () => {
  const f = new IDBFactory();
  const a = initialData(),
    b = initialData();
  a.settings.reserve = 30;
  b.settings.reserve = 50;
  await saveData(a, 0, f);
  await assert.rejects(() => saveData(b, 0, f), /別のタブ/);
  assert.equal((await loadData(f)).settings.reserve, 30);
});
test("two simultaneous writes cannot both succeed with the same revision", async () => {
  const f = new IDBFactory();
  const results = await Promise.allSettled([
    saveData(initialData(), 0, f),
    saveData(initialData(), 0, f),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("restoration uses current revision rather than backup revision", async () => {
  const f = new IDBFactory();
  let d = await saveData(initialData(), 0, f);
  const backup = { ...initialData(), revision: 150 };
  d = await saveData(backup, d.revision, f);
  assert.equal(d.revision, 2);
});
test("validation failure cannot overwrite IndexedDB", async () => {
  const f = new IDBFactory();
  await saveData(initialData(), 0, f);
  const invalid = initialData();
  invalid.settings.reserve = 500;
  await assert.rejects(() => saveData(invalid, 1, f));
  assert.equal((await loadData(f)).revision, 1);
});
test("transaction write errors propagate and retain prior record", async () => {
  const f = new IDBFactory();
  await saveData(initialData(), 0, f);
  const db = await openDatabase(f);
  const original = db.transaction.bind(db);
  db.transaction = ((...args: Parameters<IDBDatabase["transaction"]>) => {
    const tx = original(...args);
    if (args[1] === "readwrite") queueMicrotask(() => tx.abort());
    return tx;
  }) as IDBDatabase["transaction"];
  db.close();
  const denying = {
    open() {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        Object.defineProperty(request, "error", {
          value: new DOMException("Quota exceeded", "QuotaExceededError"),
        });
        request.onerror?.(new Event("error"));
      });
      return request;
    },
  } as unknown as IDBFactory;
  await assert.rejects(() => saveData(initialData(), 1, denying), /Quota/);
  assert.equal((await loadData(f)).revision, 1);
});
test("corrupt stored data raises an error, not a fresh empty overwrite", async () => {
  const f = new IDBFactory();
  const db = await openDatabase(f);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put({ version: 900 }, "data");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await assert.rejects(() => loadData(f), /バージョン/);
});
