import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function setup(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-12T09:00:00+09:00"));
  await page.goto("./");
  await page.getByRole("button", { name: "余白をつくりはじめる" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function task(page: Page, title = "数学の演習", mins = 60) {
  await nav(page, "タスク");
  await page.getByRole("button", { name: "タスクを追加", exact: true }).click();
  await page.getByLabel("タイトル", { exact: true }).fill(title);
  await page
    .getByLabel("残りの所要時間（分）", { exact: true })
    .fill(String(mins));
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function event(
  page: Page,
  title: string,
  start: string,
  end: string,
  weekly = false,
) {
  await nav(page, "予定");
  await page.getByRole("button", { name: "予定を追加", exact: true }).click();
  await page.getByLabel("予定の名称").fill(title);
  await page.getByLabel("開始時刻", { exact: true }).fill(start);
  await page.getByLabel("終了時刻", { exact: true }).fill(end);
  if (weekly) await page.getByLabel("毎週同じ曜日に繰り返す").check();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("task CRUD, actual vs estimate, completion, reopen and persistence", async ({
  page,
}) => {
  await setup(page);
  await task(page);
  await page.reload();
  await nav(page, "タスク");
  await expect(
    page.getByRole("heading", { name: "数学の演習", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByLabel("タイトル", { exact: true }).fill("数学を復習");
  await page.getByRole("button", { name: "保存する" }).click();
  await page
    .getByRole("button", { name: "進めた分を記録", exact: true })
    .click();
  await page
    .getByLabel("進めた分（見積もりの分数）", { exact: false })
    .fill("20");
  await page.getByLabel("実際に使った時間（分）", { exact: false }).fill("35");
  await page.getByRole("button", { name: "記録を保存" }).click();
  await expect(page.getByText("残り 40分", { exact: true })).toBeVisible();
  await nav(page, "振り返り");
  await expect(
    page.getByText("見積もりを20分進めた / 実績35分", { exact: false }),
  ).toBeVisible();
  await nav(page, "タスク");
  await page
    .getByRole("button", { name: "進めた分を記録", exact: true })
    .click();
  await page.getByRole("button", { name: "記録を保存" }).click();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "数学を復習", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByLabel("状態", { exact: true }).selectOption("todo");
  await page.getByLabel("残りの所要時間（分）", { exact: true }).fill("15");
  await page.getByRole("button", { name: "保存する" }).click();
  await page.getByRole("button", { name: "未完了", exact: true }).click();
  await expect(page.getByText("残り 15分", { exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "数学を復習", exact: true }),
  ).toHaveCount(0);
});
test("plan previews do not apply until accepted; short plan and restore work", async ({
  page,
}) => {
  await setup(page);
  await task(page, "制作", 120);
  await nav(page, "今日");
  await page.getByRole("button", { name: "通常プランを提案" }).click();
  await expect(
    page.getByText("まだプランはありません", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "このプランを適用" }).click();
  await expect(
    page.getByText("通常プランを適用中", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "短縮プランを提案" }).click();
  await expect(
    page.getByText("通常 2時間 → 目安 1時間 / 実際 1時間", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "このプランを適用" }).click();
  await expect(
    page.getByText("短縮プランを適用中", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "元の通常プランへ戻す" }).click();
  await page.getByRole("button", { name: "このプランを適用" }).click();
  await expect(
    page.getByText("通常プランを適用中", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("通常プランを適用中", { exact: true }),
  ).toBeVisible();
});
test("weekly occurrence edit differs from whole-series edit; overlap and delete", async ({
  page,
}) => {
  await setup(page);
  await event(page, "部活", "15:00", "17:00", true);
  await event(page, "移動", "16:00", "18:00");
  await expect(
    page.getByText(/固定予定「部活」と「移動」が重複/),
  ).toBeVisible();
  await page
    .locator(".event-row")
    .filter({ hasText: "部活" })
    .first()
    .getByRole("button", { name: "編集", exact: true })
    .click();
  await page.getByLabel("予定の名称").fill("今日は短い部活");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(
    page.getByRole("heading", { name: "今日は短い部活", exact: true }),
  ).toBeVisible();
  await page.getByLabel("選択日").fill("2026-11-19");
  await expect(
    page.getByRole("heading", { name: "今日は短い部活", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "部活", exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".event-row")
    .filter({ hasText: "部活" })
    .first()
    .getByRole("button", { name: "編集", exact: true })
    .click();
  await page.getByLabel("変更する範囲").selectOption("all");
  await page.getByLabel("予定の名称").fill("毎週の部活");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(
    page.getByRole("heading", { name: "毎週の部活", exact: true }).first(),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".event-row")
    .filter({ hasText: "毎週の部活" })
    .first()
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "この日の固定予定はありません" }),
  ).toBeVisible();
  await page.getByLabel("選択日").fill("2026-11-12");
  await expect(
    page.getByRole("heading", { name: "今日は短い部活", exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".event-row")
    .filter({ hasText: "移動" })
    .first()
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "移動", exact: true }),
  ).toHaveCount(0);
});
test("check-in can be edited; missing and zero days differ", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "生活チェック", exact: true }).click();
  await page.getByLabel("今の元気度").selectOption("2");
  await page.getByLabel("昨夜の睡眠時間").fill("7.5");
  await page.getByLabel("ひとことメモ").fill("ゆっくり取り組む");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(
    page.getByRole("heading", { name: "控えめに", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "チェックを見直す" }).click();
  await page.getByLabel("今の元気度").selectOption("3");
  await page.getByRole("button", { name: "保存する" }).click();
  await nav(page, "振り返り");
  await page.getByRole("button", { name: "選択日を実績0分として記録" }).click();
  const row = page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: "11-12", exact: true }),
  });
  await expect(row).toContainText("0分");
  await expect(row).toContainText("7.5h");
  await expect(row).toContainText("3/5");
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: "11-11", exact: true }),
    }),
  ).toContainText("未入力");
  await page.reload();
  await nav(page, "振り返り");
  await expect(
    page.getByText("ゆっくり取り組む", { exact: false }),
  ).toBeVisible();
});
test("JSON download, restore preview, cancel, replace and invalid input rejection", async ({
  page,
}) => {
  await setup(page);
  await task(page, "バックアップ対象", 40);
  await nav(page, "設定");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "バックアップを書き出す", exact: true })
    .click();
  const download = await downloading;
  const path = await download.path();
  const body = await readFile(path!);
  expect(JSON.parse(body.toString()).tasks[0].title).toBe("バックアップ対象");
  await task(page, "復元で置き換わる", 20);
  await nav(page, "設定");
  await page.getByLabel("JSONバックアップを選択").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: body,
  });
  await expect(page.getByRole("dialog")).toContainText("1件");
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await nav(page, "タスク");
  await expect(
    page.getByRole("heading", { name: "復元で置き換わる", exact: true }),
  ).toBeVisible();
  await nav(page, "設定");
  await page.getByLabel("JSONバックアップを選択").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: body,
  });
  await page
    .getByRole("button", { name: "既存データを置き換えて復元" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "タスク");
  await expect(
    page.getByRole("heading", { name: "復元で置き換わる", exact: true }),
  ).toHaveCount(0);
  await nav(page, "設定");
  await page.getByLabel("JSONバックアップを選択").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });
  await expect(page.getByRole("alert")).toContainText("対応していません");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("manual timing is retained and conflicting rest is disclosed", async ({
  page,
}) => {
  await setup(page);
  await task(page, "手動タスク", 60);
  await page.getByRole("button", { name: "時刻を指定" }).click();
  await page.getByLabel("開始時刻", { exact: true }).fill("15:00");
  await page.getByRole("button", { name: "保存する" }).click();
  await event(page, "休憩", "15:00", "15:30");
  await nav(page, "今日");
  await page.getByRole("button", { name: "通常プランを提案" }).click();
  await expect(page.getByLabel("プランのプレビュー")).toContainText("手動保持");
  await expect(page.getByLabel("プランのプレビュー")).toContainText("衝突");
  await page.getByRole("button", { name: "このプランを適用" }).click();
  await expect(page.locator(".timeline")).toContainText("タスク · 手動");
});
test("keyboard navigation, safe text rendering and viewport overflow", async ({
  page,
}, info) => {
  await setup(page);
  await task(page, "<img src=x onerror=alert(1)>", 25);
  await expect(page.locator(".task-card img")).toHaveCount(0);
  await page.getByRole("button", { name: "編集", exact: true }).press("Enter");
  await expect(page.getByLabel("タイトル", { exact: true })).toBeFocused();
  await page.getByLabel("タイトル", { exact: true }).press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeFocused();
  for (const label of ["今日", "タスク", "予定", "振り返り", "設定"]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: label, exact: true })
      .press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await nav(page, "今日");
  await page.screenshot({
    path: `test-results/${info.project.name}-today.png`,
    fullPage: true,
  });
});
test("storage transaction failure reports unsaved state and supports retry", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await taskStart(page);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByRole("dialog")).toContainText(/保存|Quota/);
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(page.getByRole("alert")).toContainText("保存できていません");
  await expect(
    page.getByRole("button", { name: "未保存の入力をバックアップ" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__restorePut());
  await page.getByRole("button", { name: "保存を再試行" }).click();
  await expect(
    page.getByRole("heading", { name: "保存失敗テスト", exact: true }),
  ).toBeVisible();
  await page.reload();
  await nav(page, "タスク");
  await expect(
    page.getByRole("heading", { name: "保存失敗テスト", exact: true }),
  ).toBeVisible();
});
async function taskStart(page: Page) {
  await nav(page, "タスク");
  await page.getByRole("button", { name: "タスクを追加", exact: true }).click();
  await page.getByLabel("タイトル", { exact: true }).fill("保存失敗テスト");
}
test("stale preview is refreshed before apply", async ({ page }) => {
  await setup(page);
  await task(page, "時刻確認", 30);
  await nav(page, "今日");
  await page.getByRole("button", { name: "通常プランを提案" }).click();
  await page.clock.setFixedTime(new Date("2026-11-12T10:00:00+09:00"));
  await page.getByRole("button", { name: "このプランを適用" }).click();
  await expect(page.getByRole("status")).toContainText("提案を更新しました");
  await expect(
    page.getByText("まだプランはありません", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("プランのプレビュー")).toContainText("10:00");
  await page.getByRole("button", { name: "このプランを適用" }).click();
  await expect(
    page.getByText("通常プランを適用中", { exact: true }),
  ).toBeVisible();
});
test("invalid settings remain editable; category rename propagates", async ({
  page,
}) => {
  await setup(page);
  await task(page, "カテゴリ確認", 30);
  await nav(page, "設定");
  await page.getByLabel("活動開始", { exact: true }).fill("07:00");
  await page.getByLabel("活動終了", { exact: true }).fill("07:00");
  await page.getByRole("button", { name: "設定を保存" }).click();
  await expect(page.getByRole("alert")).toContainText("異なる時刻");
  await expect(page.getByLabel("活動終了", { exact: true })).toBeEnabled();
  await page.getByLabel("活動終了", { exact: true }).fill("22:00");
  await page.getByRole("button", { name: "設定を保存" }).click();
  const row = page
    .locator(".category-row")
    .filter({ has: page.getByLabel("カテゴリ名 勉強", { exact: true }) });
  await row.getByRole("textbox").fill("学び");
  await row.getByRole("button", { name: "変更", exact: true }).click();
  await nav(page, "タスク");
  await expect(page.locator(".task-card")).toContainText("学び");
});
test("dashboard with rest and tasks has no horizontal overflow", async ({
  page,
}, info) => {
  await setup(page);
  await event(page, "学校", "09:00", "15:30", true);
  await event(page, "夕食とひと休み", "18:30", "19:30");
  await task(page, "数学の演習を進める", 45);
  await task(page, "読みかけの本を読む", 25);
  await nav(page, "今日");
  await page.getByRole("button", { name: "通常プランを提案" }).click();
  await page.getByRole("button", { name: "このプランを適用" }).click();
  await expect(
    page.getByText("通常プランを適用中", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/${info.project.name}-dashboard.png`,
    fullPage: true,
  });
});
