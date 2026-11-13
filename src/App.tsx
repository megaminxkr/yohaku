import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Block, Data, Event, EventDetail, Task } from "./model.ts";
import { initialData, uid } from "./model.ts";
import {
  addDays,
  clock,
  dateOf,
  dayDiff,
  duration,
  endMinute,
  localDay,
  minutes,
  nowMinute,
  timeLabel,
  weekDays,
} from "./time.ts";
import {
  activeWindow,
  conflicts,
  deadlineWarnings,
  freeTime,
  occurrences,
  overlaps,
  propose,
  subtract,
  total,
} from "./planner.ts";
import type { Occurrence, Proposal } from "./planner.ts";
import {
  loadData,
  parseBackup,
  saveData,
  serialize,
  validateData,
} from "./storage.ts";
import { applyPlan, deleteTask, finishWork } from "./actions.ts";
import { Empty, Field, Icon, Modal, SectionTitle } from "./components.tsx";
type Page = "today" | "tasks" | "calendar" | "review" | "settings";
type Editor =
  | { type: "task"; task?: Task }
  | { type: "event"; event?: Event; occurrence?: Occurrence }
  | { type: "check" }
  | { type: "work"; task: Task; block?: Block }
  | { type: "manual"; task: Task }
  | null;
const tabs: [Page, string][] = [
  ["today", "今日"],
  ["tasks", "タスク"],
  ["calendar", "予定"],
  ["review", "振り返り"],
  ["settings", "設定"],
];
const levels = ["低", "中", "高"];
const moods = ["休みたい", "控えめに", "いつも通り", "元気", "とても元気"];
const err = (e: unknown) =>
  e instanceof Error ? e.message : "処理できませんでした。";
const get = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const number = (f: FormData, k: string) => Number(f.get(k));
function download(data: Data) {
  const url = URL.createObjectURL(
    new Blob([serialize(data)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `yohaku-${localDay()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function clearTaskPlans(d: Data, id: string) {
  for (const p of Object.values(d.plans)) {
    p.blocks = p.blocks.filter((b) => b.taskId !== id || b.done);
    p.normalBackup = p.normalBackup?.filter((b) => b.taskId !== id || b.done);
  }
}
export default function App() {
  const [data, setData] = useState<Data | null>(null),
    [loadError, setLoadError] = useState(""),
    [page, setPage] = useState<Page>("today"),
    [day, setDay] = useState(localDay()),
    [now, setNow] = useState(new Date()),
    [editor, setEditor] = useState<Editor>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<Data | null>(null),
    [draft, setDraft] = useState<{
      mode: "normal" | "short";
      result: Proposal;
      restore?: boolean;
      revision: number;
      minute: number;
    } | null>(null),
    [imported, setImported] = useState<Data | null>(null),
    [filter, setFilter] = useState("active");
  const current = useRef<Data | null>(null),
    writing = useRef(false);
  useEffect(() => {
    loadData()
      .then((d) => {
        setData(d);
        current.current = d;
      })
      .catch((e) => setLoadError(err(e)));
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setDraft(null);
  }, [day]);
  async function commit(next: Data) {
    if (writing.current || !current.current) return false;
    try {
      validateData(next);
    } catch (e) {
      setError(err(e));
      return false;
    }
    writing.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const saved = await saveData(next, current.current.revision);
      current.current = saved;
      setData(saved);
      setPending(null);
      setNotice("このブラウザに保存しました");
      setDraft(null);
      return true;
    } catch (e) {
      setError(err(e));
      setPending(next);
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function mutate(fn: (d: Data) => void) {
    if (!current.current) return false;
    const d = structuredClone(current.current);
    fn(d);
    return commit(d);
  }
  function notify(message: string) {
    setNotice(message);
  }
  function preview(mode: "normal" | "short") {
    if (!data) return;
    const time = new Date();
    setNow(time);
    setDraft({
      mode,
      result: propose(data, day, time, mode),
      revision: data.revision,
      minute: nowMinute(day, time),
    });
  }
  function restoreNormal() {
    if (!data) return;
    const blocks = data.plans[day]?.normalBackup;
    if (!blocks) return;
    if (
      data.plans[day].blocks.some(
        (b) => b.manual && !b.done && !blocks.some((old) => old.id === b.id),
      )
    ) {
      notify("追加した手動の時刻を保持して、通常プランを提案し直しました。");
      preview("normal");
      return;
    }
    const time = new Date();
    const valid = blocks.filter(
      (b) =>
        b.done ||
        data.tasks.some((t) => t.id === b.taskId && t.status !== "done"),
    );
    const futureAuto = valid.some(
      (b) => !b.done && !b.manual && b.start < nowMinute(day, time),
    );
    if (futureAuto) {
      notify("元の時刻が過ぎたため、通常プランを現在時刻で提案し直しました。");
      preview("normal");
      return;
    }
    const free = freeTime(data, day, time);
    setDraft({
      mode: "normal",
      restore: true,
      revision: data.revision,
      minute: nowMinute(day, time),
      result: {
        blocks: valid,
        freeBefore: total(free),
        freeAfter: total(
          free.flatMap((s) =>
            subtract(
              s,
              valid.filter((b) => !b.done),
            ),
          ),
        ),
        work: total(valid.filter((b) => !b.done)),
        normalWork: total(valid.filter((b) => !b.done)),
        warnings: conflicts(data, day, valid, time),
        unplaced: [],
      },
    });
  }
  if (loadError)
    return (
      <main className="fatal">
        <h1>保存データを読み込めませんでした</h1>
        <p role="alert">{loadError}</p>
        <p>
          保存済みの内容は上書きしていません。ブラウザの保存機能を確認し、別のタブを閉じて再読み込みしてください。
        </p>
        <button onClick={() => location.reload()}>再読み込み</button>
      </main>
    );
  if (!data)
    return (
      <main className="fatal" role="status">
        Yohakuを開いています…
      </main>
    );
  const plan = data.plans[day];
  const blocks = plan?.blocks ?? [];
  const future = blocks.filter((b) => !b.done && b.end > nowMinute(day, now));
  const slots = freeTime(data, day, now);
  const before = total(slots),
    after = total(
      slots.flatMap((s) =>
        subtract(
          s,
          blocks.filter((b) => !b.done),
        ),
      ),
    );
  const next = future.find((b) =>
    data.tasks.some((t) => t.id === b.taskId && t.status !== "done"),
  );
  const fixed = occurrences(data, day).filter((e) =>
    overlaps(e, {
      start: 0,
      end: endMinute(data.settings.start, data.settings.end),
    }),
  );
  const warnings = [
    ...conflicts(data, day, blocks, now),
    ...deadlineWarnings(data, day, now),
  ];
  const activeTasks = data.tasks.filter((t) => t.status !== "done");
  async function submitEditor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor || !data) return;
    const f = new FormData(e.currentTarget);
    let ok = false;
    try {
      if (editor.type === "task") {
        const status = get(f, "status") as Task["status"];
        const remaining = number(f, "remaining");
        if (status !== "done" && remaining < 1)
          throw new Error("未完了タスクの残り時間は1分以上にしてください。");
        const t: Task = {
          id: editor.task?.id ?? uid(),
          title: get(f, "title"),
          remaining: status === "done" ? 0 : remaining,
          category: get(f, "category"),
          deadline: get(f, "deadline"),
          importance: number(f, "importance") as Task["importance"],
          focus: number(f, "focus") as Task["focus"],
          split: f.get("split") === "on",
          status,
          ...(status === "done"
            ? { completedOn: editor.task?.completedOn ?? day }
            : {}),
        };
        ok = await mutate((d) => {
          if (editor.task) {
            d.tasks = d.tasks.map((x) => (x.id === t.id ? t : x));
            clearTaskPlans(d, t.id);
          } else d.tasks.push(t);
        });
      }
      if (editor.type === "event") {
        const detail: EventDetail = {
          title: get(f, "title"),
          start: minutes(get(f, "start")),
          end: minutes(get(f, "end")),
          kind: get(f, "kind") as EventDetail["kind"],
        };
        if (detail.start === detail.end)
          throw new Error("開始と終了は異なる時刻にしてください。");
        ok = await mutate((d) => {
          const old = editor.event
            ? d.events.find((x) => x.id === editor.event!.id)
            : undefined;
          if (old && get(f, "scope") === "occurrence" && editor.occurrence) {
            old.exceptions[editor.occurrence.sourceDate] = detail;
          } else {
            const event: Event = {
              ...detail,
              id: old?.id ?? uid(),
              date: get(f, "date"),
              weekly: f.get("weekly") === "on",
              exceptions: old?.exceptions ?? {},
            };
            d.events = old
              ? d.events.map((x) => (x.id === old.id ? event : x))
              : [...d.events, event];
          }
        });
      }
      if (editor.type === "check") {
        ok = await mutate((d) => {
          d.checkins[day] = {
            energy: number(f, "energy"),
            sleep: get(f, "sleep") === "" ? null : number(f, "sleep"),
            note: get(f, "note"),
          };
        });
      }
      if (editor.type === "work") {
        ok = await commit(
          finishWork(
            data,
            editor.task.id,
            day,
            number(f, "progress"),
            number(f, "actual"),
            editor.block?.id,
          ),
        );
      }
      if (editor.type === "manual") {
        const start =
          minutes(get(f, "start")) + (f.get("nextday") === "on" ? 1440 : 0);
        const length = number(f, "length");
        if (start < nowMinute(day, new Date()))
          throw new Error("過去の時刻には配置できません。");
        const already = Object.values(data.plans)
          .flatMap((p) => p.blocks)
          .filter((b) => b.taskId === editor.task.id && !b.done);
        if (length + total(already) > editor.task.remaining)
          throw new Error(
            "すでに計画した分と合わせて残り時間を超えています。再計画または配置の解除をしてください。",
          );
        if (!editor.task.split && length !== editor.task.remaining)
          throw new Error(
            "分割しないタスクは残り時間すべてを配置してください。",
          );
        ok = await mutate((d) => {
          const p = d.plans[day] ?? { mode: "normal", blocks: [] };
          p.blocks.push({
            id: uid(),
            taskId: editor.task.id,
            title: editor.task.title,
            category: editor.task.category,
            start,
            end: start + length,
            manual: true,
            done: false,
          });
          p.blocks.sort((a, b) => a.start - b.start);
          d.plans[day] = p;
        });
      }
      if (ok) setEditor(null);
    } catch (e) {
      setError(err(e));
    }
  }
  async function removeEvent(event: Event, occurrence?: Occurrence) {
    const scope =
      occurrence && event.weekly
        ? window.confirm(
            "この日だけ取り消しますか？\nOK：当日だけ取り消し\nキャンセル：全体削除の確認へ",
          )
        : false;
    if (scope) {
      await mutate((d) => {
        d.events.find((x) => x.id === event.id)!.exceptions[
          occurrence!.sourceDate
        ] = null;
      });
      return;
    }
    if (
      window.confirm(
        `「${event.title}」${event.weekly ? "の繰り返し全体" : ""}を削除しますか？`,
      )
    )
      await mutate((d) => {
        d.events = d.events.filter((x) => x.id !== event.id);
      });
  }
  function taskEditor(t?: Task) {
    setError("");
    setEditor({ type: "task", task: t });
  }
  function eventEditor(event?: Event, occurrence?: Occurrence) {
    setError("");
    setEditor({ type: "event", event, occurrence });
  }
  const dateLabel = new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(dateOf(day));
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("today");
          }}
        >
          <span className="brand-mark">
            <span />
            <span />
          </span>
          <span>
            yohaku<small>暮らしに、余白を。</small>
          </span>
        </a>
        <nav aria-label="メインメニュー">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              aria-label={label}
              aria-current={page === key ? "page" : undefined}
              className={page === key ? "nav active" : "nav"}
              onClick={() => {
                setPage(key);
                setDraft(null);
              }}
            >
              <Icon name={key} />
              <span>{label}</span>
              {key === "tasks" && activeTasks.length > 0 && (
                <small>{activeTasks.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Icon name="leaf" />
          <p>
            詰め込まない日も、
            <br />
            いい一日。
          </p>
          <small>あなたのペースで。</small>
        </div>
        <div className="local-label">
          <span className="dot" /> このブラウザに保存
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <header className="topbar">
          <span className="eyebrow">YOUR DAY, WITH ROOM TO BREATHE</span>
          <span className="top-status">
            {busy ? "保存中…" : "Yohaku / 余白"}
          </span>
        </header>
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {page === "today"
                ? "TODAY"
                : page === "tasks"
                  ? "YOUR TASKS"
                  : page === "calendar"
                    ? "SCHEDULE"
                    : page === "review"
                      ? "WEEKLY REFLECTION"
                      : "PREFERENCES"}
            </p>
            <h1>
              {page === "today"
                ? "今日に、余白を。"
                : page === "tasks"
                  ? "取り組みたいこと"
                  : page === "calendar"
                    ? "先に、時間を確保する。"
                    : page === "review"
                      ? "一週間を、ゆっくり振り返る。"
                      : "自分に合うペースで。"}
            </h1>
            <p className="subtitle">
              {page === "today"
                ? "できることから、ひとつずつ。休む時間も、大切な予定です。"
                : page === "tasks"
                  ? "残りは、いつでも計画し直せます。"
                  : page === "calendar"
                    ? "学校も、食事も、ひと休みも。まずは固定の予定から。"
                    : page === "review"
                      ? "比べるためではなく、次の一週間を考えるために。"
                      : "活動時間と余白の取り方を調整できます。"}
            </p>
          </div>
          {page !== "settings" && (
            <div className="date-control">
              <button
                aria-label="前の日"
                onClick={() => setDay(addDays(day, -1))}
              >
                ‹
              </button>
              <label>
                <span className="sr-only">選択日</span>
                <input
                  type="date"
                  min="2000-01-02"
                  max="2199-12-30"
                  value={day}
                  onChange={(e) => {
                    if (e.target.value) setDay(e.target.value);
                  }}
                />
              </label>
              <button
                aria-label="次の日"
                onClick={() => setDay(addDays(day, 1))}
              >
                ›
              </button>
              <button
                className="text-button"
                onClick={() => setDay(localDay())}
              >
                今日
              </button>
            </div>
          )}
        </div>
        <div role="status" className="status-line">
          {notice}
        </div>
        {error && (
          <div className="alert" role="alert">
            <strong>{pending ? "保存できていません。" : ""}</strong>
            {error}
            {pending && (
              <div className="actions">
                <button onClick={() => download(pending)}>
                  未保存の入力をバックアップ
                </button>
                <button onClick={() => void commit(pending)} disabled={busy}>
                  保存を再試行
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        "未保存の入力は失われます。バックアップ済みですか？",
                      )
                    )
                      location.reload();
                  }}
                >
                  再読み込み
                </button>
              </div>
            )}
          </div>
        )}
        <fieldset className="workspace" disabled={busy || !!pending}>
          {page === "today" && (
            <>
              <div className="day-caption">
                <span>{dateLabel}</span>
                <span className="tag">
                  {plan
                    ? (plan.mode === "short" ? "短縮プラン" : "通常プラン") +
                      "を適用中"
                    : "まだプランはありません"}
                </span>
              </div>
              <div className="overview">
                <section className="space-card">
                  <div>
                    <p className="metric-label">{plan ? "タスク配置後の余白" : "現在の余白（プラン未適用）"}</p>
                    <div className="big-number">
                      {Math.floor(after / 60)}
                      <span>時間</span>
                      {after % 60}
                      <span>分</span>
                    </div>
                    <p>
                      今日の残りの活動時間に、
                      <br />
                      まだ残してある時間。
                    </p>
                  </div>
                  <div
                    className="space-ring"
                    style={
                      {
                        "--ratio": `${before ? (after / before) * 100 : 100}%`,
                      } as React.CSSProperties
                    }
                  >
                    <Icon name="leaf" size={32} />
                    <small>余白</small>
                  </div>
                  <div className="card-footer">
                    予備時間の設定 <strong>{data.settings.reserve}%</strong>
                    <span>自分で変えられる目安です</span>
                  </div>
                </section>
                <section className="metric-card">
                  <span className="metric-icon">
                    <Icon name="clock" />
                  </span>
                  <p className="metric-label">タスク配置前の空き時間</p>
                  <h2>{duration(before)}</h2>
                  <p>
                    固定予定・休息を除いた時間。
                    <br />
                    隣の日から続くタスクも除きます。
                  </p>
                  <div className="metric-bottom">
                    活動時間 {clock(data.settings.start)} –{" "}
                    {timeLabel(
                      endMinute(data.settings.start, data.settings.end),
                    )}
                  </div>
                </section>
                <section className="metric-card check-card">
                  <span className="metric-icon">☼</span>
                  <p className="metric-label">今日の元気</p>
                  <h2>
                    {data.checkins[day]
                      ? moods[data.checkins[day].energy - 1]
                      : "今、どんな感じ？"}
                  </h2>
                  <p>
                    {data.checkins[day]
                      ? "記録はいつでも変更できます。"
                      : "数秒のチェックで、今日のペースを。"}
                    <br />
                    無理のない量を考えるヒントに。
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setError("");
                      setEditor({ type: "check" });
                    }}
                  >
                    {data.checkins[day] ? "チェックを見直す" : "生活チェック"}{" "}
                    <Icon name="arrow" size={16} />
                  </button>
                </section>
              </div>
              <div className="today-columns">
                <div>
                  <SectionTitle
                    title="次のひとつ"
                    sub="全部ではなく、まずはここから。"
                  />
                  {next ? (
                    <section className="next-card">
                      <div className="next-overline">
                        <span className="tag">{next.category}</span>
                        <span>
                          {timeLabel(next.start)} – {timeLabel(next.end)}
                        </span>
                      </div>
                      <h2>{next.title}</h2>
                      <p>
                        {duration(next.end - next.start)} の予定
                        {next.manual ? " · 手動で指定" : ""}
                      </p>
                      <button
                        className="primary"
                        onClick={() => {
                          setError("");
                          setEditor({
                            type: "work",
                            task: data.tasks.find((t) => t.id === next.taskId)!,
                            block: next,
                          });
                        }}
                      >
                        <Icon name="check" />
                        進めた分を記録する
                      </button>
                    </section>
                  ) : (
                    <section className="next-card quiet">
                      <Icon name="leaf" size={30} />
                      <h2>
                        {activeTasks.length
                          ? "今日できる量を、考えてみよう。"
                          : data.tasks.length === 0
                            ? "まずは、取り組みたいことをひとつ。"
                            : "今日は、ここまででも大丈夫。"}
                      </h2>
                      <p>
                        {activeTasks.length
                          ? "下の「プランを提案」で候補を確認できます。"
                          : "取り組みたいことがあれば、タスクに置いておけます。"}
                      </p>
                      <button onClick={() => taskEditor()}>
                        <Icon name="plus" />
                        タスクを追加
                      </button>
                    </section>
                  )}
                  <section className="plan-controls">
                    <SectionTitle title="今日のペース" />
                    <div className="segmented">
                      <button
                        className={plan?.mode === "normal" ? "selected" : ""}
                        onClick={() => preview("normal")}
                      >
                        通常プランを提案
                      </button>
                      <button
                        className={plan?.mode === "short" ? "selected" : ""}
                        onClick={() => preview("short")}
                      >
                        <Icon name="leaf" size={16} />
                        短縮プランを提案
                      </button>
                    </div>
                    <p className="muted">
                      提案を確認してから適用します。短縮は通常の作業量の約半分が目安です。
                    </p>
                    {plan?.normalBackup && (
                      <button className="text-button" onClick={restoreNormal}>
                        元の通常プランへ戻す
                      </button>
                    )}
                  </section>
                  {draft && (
                    <section
                      className="preview-panel"
                      aria-label="プランのプレビュー"
                    >
                      <span className="eyebrow">PLAN PREVIEW</span>
                      <h2>
                        {draft.restore
                          ? "元の通常プラン"
                          : draft.mode === "short"
                            ? "短縮プラン"
                            : "通常プラン"}
                        のプレビュー
                      </h2>
                      <div className="comparison">
                        <span>
                          現在の作業量<strong>{duration(total(future))}</strong>
                        </span>
                        <Icon name="arrow" />
                        <span>
                          変更後<strong>{duration(draft.result.work)}</strong>
                        </span>
                      </div>
                      {draft.mode === "short" && (
                        <p>
                          通常 {duration(draft.result.normalWork)} → 目安{" "}
                          {duration(Math.floor(draft.result.normalWork / 2))} /
                          実際 {duration(draft.result.work)}
                        </p>
                      )}
                      <p>
                        配置後の余白：
                        <strong>{duration(draft.result.freeAfter)}</strong>
                      </p>
                      {draft.result.blocks
                        .filter((b) => !b.done)
                        .map((b) => (
                          <div className="preview-row" key={b.id}>
                            <span>
                              {timeLabel(b.start)} – {timeLabel(b.end)}
                            </span>
                            <strong>{b.title}</strong>
                            {b.manual && <span className="tag">手動保持</span>}
                          </div>
                        ))}
                      {!draft.result.blocks.length && (
                        <p>配置できるタスクはありません。</p>
                      )}
                      {draft.result.warnings.map((w, i) => (
                        <p className="warning" key={i}>
                          {w}
                        </p>
                      ))}
                      {draft.result.unplaced.length > 0 && (
                        <div className="unplaced">
                          <h3>今回は配置しない分</h3>
                          {draft.result.unplaced.map((u) => (
                            <p key={u.taskId}>
                              <strong>
                                {u.title} · 残り{duration(u.minutes)}
                              </strong>
                              <br />
                              {u.reason}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="actions">
                        <button
                          className="primary"
                          onClick={() => {
                            const t = new Date();
                            if (
                              draft.revision !== data.revision ||
                              draft.minute !== nowMinute(day, t)
                            ) {
                              preview(draft.mode);
                              notify(
                                "時刻またはデータが変わったため提案を更新しました。もう一度確認してください。",
                              );
                              return;
                            }
                            void commit(
                              applyPlan(
                                data,
                                day,
                                draft.mode,
                                draft.result.blocks,
                              ),
                            );
                          }}
                        >
                          このプランを適用
                        </button>
                        <button onClick={() => setDraft(null)}>
                          キャンセル
                        </button>
                      </div>
                    </section>
                  )}
                  {warnings.length > 0 && (
                    <details className="warning-box" open>
                      <summary>
                        予定・締切の確認事項（{warnings.length}）
                      </summary>
                      {warnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                      <p className="muted">
                        締切の確認は90日先までの空き時間を使う概算です。他のタスクとの競合を含む完了保証ではありません。
                      </p>
                    </details>
                  )}
                </div>
                <section className="timeline-panel">
                  <SectionTitle title="今日の時間割" sub={dateLabel}>
                    <button
                      className="icon-button"
                      aria-label="予定を追加"
                      onClick={() => eventEditor()}
                    >
                      <Icon name="plus" />
                    </button>
                  </SectionTitle>
                  <div className="timeline">
                    {[
                      ...fixed.map((e) => ({
                        start: e.start,
                        end: e.end,
                        title: e.title,
                        id: e.id,
                        event: e,
                      })),
                      ...blocks.map((b) => ({
                        start: b.start,
                        end: b.end,
                        title: b.title,
                        id: b.id,
                        block: b,
                      })),
                    ]
                      .sort((a, b) => a.start - b.start)
                      .map((item) => {
                        const b = "block" in item ? item.block : undefined;
                        const ev = "event" in item ? item.event : undefined;
                        return (
                          <div
                            key={item.id}
                            className={`timeline-item ${b ? "task-item" : ""} ${ev?.kind === "rest" ? "rest-item" : ""} ${b?.done ? "done-item" : ""}`}
                          >
                            <div className="time-label">
                              {timeLabel(item.start)}
                              <small>{timeLabel(item.end)}</small>
                            </div>
                            <div className="timeline-content">
                              <span className="tiny-label">
                                {b
                                  ? b.done
                                    ? "完了"
                                    : b.manual
                                      ? "タスク · 手動"
                                      : "タスク · 未完了"
                                  : ev?.kind === "rest"
                                    ? "休息"
                                    : "固定予定"}
                              </span>
                              <h3>{item.title}</h3>
                              {b && !b.done && (
                                <div className="inline-actions">
                                  <button
                                    onClick={() => {
                                      const t = data.tasks.find(
                                        (t) => t.id === b.taskId,
                                      );
                                      if (t) {
                                        setError("");
                                        setEditor({
                                          type: "work",
                                          task: t,
                                          block: b,
                                        });
                                      }
                                    }}
                                  >
                                    実績を記録
                                  </button>
                                  <button
                                    aria-label={`${b.title}の配置を解除`}
                                    onClick={() =>
                                      void mutate((d) => {
                                        d.plans[day].blocks = d.plans[
                                          day
                                        ].blocks.filter((x) => x.id !== b.id);
                                        if (d.plans[day].normalBackup)
                                          d.plans[day].normalBackup = d.plans[
                                            day
                                          ].normalBackup!.filter(
                                            (x) => x.id !== b.id,
                                          );
                                      })
                                    }
                                  >
                                    配置解除
                                  </button>
                                </div>
                              )}
                              {ev && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    eventEditor(
                                      data.events.find(
                                        (e) => e.id === ev.eventId,
                                      ),
                                      ev,
                                    )
                                  }
                                >
                                  編集
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    {!fixed.length && !blocks.length && (
                      <Empty title="まだ予定はありません">
                        <p>
                          休憩や食事の時間から
                          <br />
                          入れてみても大丈夫。
                        </p>
                      </Empty>
                    )}
                    <div className="timeline-end">
                      <span />{" "}
                      {timeLabel(
                        endMinute(data.settings.start, data.settings.end),
                      )}
                      　活動時間のおわり
                    </div>
                  </div>
                  <p className="gentle-note">
                    <Icon name="leaf" size={16} />
                    余白は、埋めなくても大丈夫。
                  </p>
                </section>
              </div>
            </>
          )}
          {page === "tasks" && (
            <>
              <SectionTitle
                title={`タスク ${activeTasks.length}件`}
                sub="タイトルと所要時間だけで、ひとまず登録。"
              >
                <button className="primary" onClick={() => taskEditor()}>
                  <Icon name="plus" />
                  タスクを追加
                </button>
              </SectionTitle>
              <div className="filter-row">
                <button
                  aria-pressed={filter === "active"}
                  onClick={() => setFilter("active")}
                >
                  未完了
                </button>
                <button
                  aria-pressed={filter === "done"}
                  onClick={() => setFilter("done")}
                >
                  完了
                </button>
                <button
                  aria-pressed={filter === "all"}
                  onClick={() => setFilter("all")}
                >
                  すべて
                </button>
              </div>
              <div className="task-grid">
                {data.tasks
                  .filter(
                    (t) =>
                      filter === "all" ||
                      (filter === "done"
                        ? t.status === "done"
                        : t.status !== "done"),
                  )
                  .map((t) => (
                    <article className="task-card" key={t.id}>
                      <div className="task-top">
                        <span className="tag">{t.category}</span>
                        <span className="tiny-label">
                          {t.status === "done"
                            ? "完了"
                            : t.status === "doing"
                              ? "進行中"
                              : "未着手"}
                        </span>
                      </div>
                      <h2>{t.title}</h2>
                      <strong className="task-duration">
                        残り {duration(t.remaining)}
                      </strong>
                      <p>
                        重要度 {levels[t.importance - 1]} · 集中力{" "}
                        {levels[t.focus - 1]} ·{" "}
                        {t.split ? "分割できる" : "まとめて取り組む"}
                      </p>
                      <p
                        className={
                          t.deadline && t.deadline < day && t.status !== "done"
                            ? "warning"
                            : ""
                        }
                      >
                        {t.deadline
                          ? `締切 ${t.deadline}${t.deadline < day && t.status !== "done" ? " · 超過" : ""}`
                          : "締切はありません"}
                      </p>
                      <div className="actions">
                        {t.status !== "done" && (
                          <>
                            <button
                              onClick={() => {
                                setError("");
                                setEditor({ type: "work", task: t });
                              }}
                            >
                              進めた分を記録
                            </button>
                            <button
                              onClick={() => {
                                setError("");
                                setEditor({ type: "manual", task: t });
                              }}
                            >
                              時刻を指定
                            </button>
                          </>
                        )}
                        <button onClick={() => taskEditor(t)}>編集</button>
                        <button
                          className="danger-text"
                          onClick={() => {
                            if (
                              confirm(
                                `「${t.title}」を削除しますか？実績記録は残ります。`,
                              )
                            )
                              void commit(deleteTask(data, t.id));
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!data.tasks.length && (
                <Empty title="やりたいことを、ひとつ置いてみる。">
                  <p>すべてを今日やる必要はありません。</p>
                  <button onClick={() => taskEditor()}>
                    最初のタスクを追加
                  </button>
                </Empty>
              )}
            </>
          )}
          {page === "calendar" && (
            <>
              <SectionTitle
                title="この日の予定"
                sub="終了が開始より早い場合は、翌日までの予定になります。"
              >
                <button className="primary" onClick={() => eventEditor()}>
                  <Icon name="plus" />
                  予定を追加
                </button>
              </SectionTitle>
              {conflicts(data, day, blocks, now)
                .filter((w) => w.startsWith("固定予定"))
                .map((w, i) => (
                  <p key={i} className="warning-box">
                    {w}
                  </p>
                ))}
              <div className="event-list">
                {fixed.map((o) => {
                  const event = data.events.find((e) => e.id === o.eventId)!;
                  return (
                    <article key={o.id} className="event-row">
                      <div className="event-time">
                        {timeLabel(o.start)}
                        <span>– {timeLabel(o.end)}</span>
                      </div>
                      <div>
                        <span className="tag">
                          {o.kind === "rest" ? "休息" : "固定予定"}
                          {o.weekly ? " · 毎週" : ""}
                        </span>
                        <h3>{o.title}</h3>
                        {o.sourceDate !== day && (
                          <small>{o.sourceDate}からの予定</small>
                        )}
                      </div>
                      <div className="actions">
                        <button onClick={() => eventEditor(event, o)}>
                          編集
                        </button>
                        <button
                          className="danger-text"
                          onClick={() => void removeEvent(event, o)}
                        >
                          削除
                        </button>
                      </div>
                    </article>
                  );
                })}
                {!fixed.length && (
                  <Empty title="この日の固定予定はありません">
                    <p>休息の時間も予定として確保できます。</p>
                  </Empty>
                )}
              </div>
              <SectionTitle
                title="登録済みの予定"
                sub="繰り返し全体や、ほかの日の予定はこちらから。"
              />
              <div className="event-list">
                {data.events.map((e) => (
                  <article className="event-row" key={e.id}>
                    <div className="event-time">
                      {e.weekly
                        ? `毎週${"日月火水木金土"[dateOf(e.date).getDay()]}曜`
                        : e.date}
                      <span>
                        {clock(e.start)} –{" "}
                        {timeLabel(endMinute(e.start, e.end))}
                      </span>
                    </div>
                    <div>
                      <h3>{e.title}</h3>
                      <small>
                        {e.weekly
                          ? `${e.date}から / 当日変更 ${Object.keys(e.exceptions).length}件`
                          : e.kind === "rest"
                            ? "休息"
                            : "固定予定"}
                      </small>
                    </div>
                    <div className="actions">
                      <button onClick={() => eventEditor(e)}>全体を編集</button>
                      <button
                        className="danger-text"
                        onClick={() => void removeEvent(e)}
                      >
                        削除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          {page === "review" && (
            <Review
              data={data}
              day={day}
              onZero={() =>
                void mutate((d) => {
                  if (!d.recordedDays.includes(day)) d.recordedDays.push(day);
                })
              }
              onRemoveLog={(id) => {
                if (
                  confirm(
                    "この実績記録を削除しますか？タスクの残り時間は自動では戻りません。必要ならタスクを編集してください。",
                  )
                )
                  void mutate((d) => {
                    d.logs = d.logs.filter((l) => l.id !== id);
                  });
              }}
            />
          )}
          {page === "settings" && (
            <div className="settings-grid">
              <section className="panel">
                <SectionTitle
                  title="時間のつかい方"
                  sub="変更した設定は、次のプラン提案に反映されます。"
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void mutate((d) => {
                      d.settings.start = minutes(get(f, "start"));
                      d.settings.end = minutes(get(f, "end"));
                      d.settings.reserve = number(f, "reserve");
                    });
                  }}
                >
                  <div className="form-row">
                    <Field label="活動開始">
                      <input
                        name="start"
                        type="time"
                        defaultValue={clock(data.settings.start)}
                        required
                      />
                    </Field>
                    <Field label="活動終了">
                      <input
                        name="end"
                        type="time"
                        defaultValue={clock(data.settings.end)}
                        required
                      />
                    </Field>
                  </div>
                  <p className="muted">
                    終了が開始より早い場合は翌日まで。睡眠など活動しない時間を除き、食事や休憩は「予定」で確保してください。
                  </p>
                  <Field
                    label="予備時間の割合（%）"
                    hint="初期値20%。健康上の推奨値ではなく、変更できる計画上の設定です。"
                  >
                    <input
                      name="reserve"
                      type="number"
                      min="0"
                      max="80"
                      step="1"
                      defaultValue={data.settings.reserve}
                      required
                    />
                  </Field>
                  <button className="primary">設定を保存</button>
                </form>
              </section>
              <section className="panel">
                <SectionTitle
                  title="カテゴリ"
                  sub="名前を変えると、タスクのカテゴリも更新されます。"
                />
                {data.settings.categories.map((c, i) => (
                  <form
                    key={c}
                    className="category-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const value = get(new FormData(e.currentTarget), "name");
                      void mutate((d) => {
                        d.settings.categories[i] = value;
                        d.tasks.forEach((t) => {
                          if (t.category === c) t.category = value;
                        });
                        Object.values(d.plans).forEach((p) =>
                          [...p.blocks, ...(p.normalBackup ?? [])].forEach(
                            (b) => {
                              if (b.category === c) b.category = value;
                            },
                          ),
                        );
                      });
                    }}
                  >
                    <label>
                      <span className="sr-only">カテゴリ名 {c}</span>
                      <input
                        name="name"
                        maxLength={40}
                        defaultValue={c}
                        required
                      />
                    </label>
                    <button>変更</button>
                    <button
                      type="button"
                      aria-label={`${c}カテゴリを削除`}
                      disabled={
                        data.settings.categories.length <= 1 ||
                        data.tasks.some((t) => t.category === c)
                      }
                      onClick={() =>
                        void mutate((d) => {
                          d.settings.categories = d.settings.categories.filter(
                            (x) => x !== c,
                          );
                        })
                      }
                    >
                      削除
                    </button>
                  </form>
                ))}
                <form
                  className="category-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      value = get(new FormData(form), "name");
                    void mutate((d) => {
                      d.settings.categories.push(value);
                    }).then((ok) => {
                      if (ok) form.reset();
                    });
                  }}
                >
                  <label>
                    <span className="sr-only">新しいカテゴリ名</span>
                    <input
                      name="name"
                      maxLength={40}
                      placeholder="新しいカテゴリ"
                      required
                    />
                  </label>
                  <button disabled={data.settings.categories.length >= 30}>
                    追加
                  </button>
                </form>
                <small>
                  使用中のカテゴリは削除できません。過去の実績は記録時の名前で残ります。
                </small>
              </section>
              <section className="panel">
                <SectionTitle title="保存とバックアップ" />
                <p>
                  データは<strong>現在の端末・ブラウザ内</strong>
                  に保存されます。別の端末への自動同期はありません。ブラウザの保存データを削除すると、記録が失われる可能性があります。
                </p>
                <p>
                  大切な記録は定期的にJSONで書き出してください。予定や生活記録を外部へ送信する機能はありません。
                </p>
                <div className="actions">
                  <button onClick={() => download(data)}>
                    バックアップを書き出す
                  </button>
                  <button
                    onClick={() =>
                      void navigator.storage
                        ?.persist?.()
                        .then((granted) =>
                          notify(
                            granted
                              ? "ブラウザに保存の保持を許可されました。バックアップも続けてください。"
                              : "保存の保持はブラウザが判断します。JSONバックアップをご利用ください。",
                          ),
                        )
                        .catch(() =>
                          notify(
                            "保持を要求できませんでした。JSONバックアップをご利用ください。",
                          ),
                        )
                    }
                  >
                    保存の保持を要求
                  </button>
                </div>
                <Field
                  label="JSONバックアップを選択"
                  hint="形式を検証し、内容を確認してから置き換えます。"
                >
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      try {
                        if (file.size > 10_000_000)
                          throw new Error("ファイルは10MB以下にしてください。");
                        setImported(parseBackup(await file.text()));
                        setError("");
                      } catch (e) {
                        setError(err(e));
                      }
                    }}
                  />
                </Field>
                <hr />
                <button
                  className="danger-text"
                  onClick={() => {
                    if (
                      confirm(
                        "すべての予定・タスク・生活記録をこのブラウザから削除します。必要なバックアップを書き出しましたか？",
                      ) &&
                      prompt("確認のため「削除」と入力してください。") ===
                        "削除"
                    ) {
                      void commit(initialData()).then((ok) => {
                        if (ok) {
                          setPage("today");
                          setNotice("すべてのデータを削除しました。");
                        }
                      });
                    }
                  }}
                >
                  全データを削除
                </button>
              </section>
              <section className="panel">
                <SectionTitle title="Yohakuの使い方" />
                <ol className="help-list">
                  <li>活動時間と、休息を含む固定予定を入れます。</li>
                  <li>取り組みたいタスクと残り時間を入れます。</li>
                  <li>
                    今日の元気を記録し、プランの提案を確認して適用します。
                  </li>
                  <li>進めた分と実績時間を別々に記録します。</li>
                </ol>
                <p>
                  提案は締切・重要度・必要な集中力を使うルールで計算します。低い元気度では集中力の低いタスクを優先。元気度から健康状態を判断しません。
                </p>
                <p>
                  未完了のタスクは候補に残り、翌日に自動では積み上がりません。
                </p>
                <p className="muted">v1.0 · 保存形式 v1 · アカウント登録不要</p>
              </section>
            </div>
          )}
        </fieldset>
        <footer className="page-footer">
          <span>yohaku</span> 今日の自分に、ちょうどいい量を。
        </footer>
      </main>
      {!data.settings.onboarded && (
        <Modal
          title="ようこそ、Yohakuへ。"
          focusHeading
          onClose={() => {
            if (busy || pending) return;
            void mutate((d) => {
              d.settings.onboarded = true;
            });
          }}
        >
          <p className="intro-copy">
            予定を詰める前に、
            <br />
            <strong>自分のための余白を。</strong>
          </p>
          <p>
            固定予定を入れる → タスクを置く →
            プランを確認。まずは、ふだんの活動時間だけ教えてください。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate((d) => {
                d.settings.start = minutes(get(f, "start"));
                d.settings.end = minutes(get(f, "end"));
                d.settings.onboarded = true;
                if (f.get("sample") === "on") {
                  d.tasks.push(
                    {
                      id: uid(),
                      title: "気になっていた本を読む",
                      category: d.settings.categories[0],
                      remaining: 30,
                      deadline: "",
                      importance: 2,
                      focus: 1,
                      split: true,
                      status: "todo",
                    },
                    {
                      id: uid(),
                      title: "部屋を少し整える",
                      category:
                        d.settings.categories[3] ?? d.settings.categories[0],
                      remaining: 15,
                      deadline: "",
                      importance: 1,
                      focus: 1,
                      split: false,
                      status: "todo",
                    },
                  );
                  d.events.push({
                    id: uid(),
                    title: "夕食とひと休み",
                    date: day,
                    start: 19 * 60,
                    end: 20 * 60,
                    kind: "rest",
                    weekly: false,
                    exceptions: {},
                  });
                }
              });
            }}
          >
            <p className="muted">終了が開始より早い場合は翌日の時刻として扱います。あとで設定から変更できます。</p>
            <div className="form-row">
              <Field label="活動開始">
                <input type="time" name="start" defaultValue="07:00" required />
              </Field>
              <Field label="活動終了">
                <input type="time" name="end" defaultValue="23:00" required />
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" name="sample" />
              サンプルのタスクと休息予定を読み込む
            </label>
            <p className="privacy-note">
              記録はこの端末・ブラウザだけに保存され、自動同期されません。設定からJSONバックアップを作れます。
            </p>
            {error && (
              <div role="alert" className="warning-box">
                <p>{pending ? "保存できていません。" : ""}{error}</p>
                {pending && <div className="actions">
                  <button type="button" onClick={() => download(pending)}>未保存の入力をバックアップ</button>
                  <button type="button" disabled={busy} onClick={() => void commit(pending)}>保存を再試行</button>
                </div>}
              </div>
            )}
            <button className="primary full" disabled={busy || !!pending}>
              余白をつくりはじめる <Icon name="arrow" />
            </button>
          </form>
        </Modal>
      )}
      {editor && (
        <Modal
          title={
            editor.type === "task"
              ? editor.task
                ? "タスクを編集"
                : "タスクを追加"
              : editor.type === "event"
                ? editor.event
                  ? "予定を編集"
                  : "予定を追加"
                : editor.type === "check"
                  ? "今日の生活チェック"
                  : editor.type === "work"
                    ? "進めた分を記録"
                    : "タスクの時刻を指定"
          }
          onClose={() => {
            setEditor(null);
            if (!pending) setError("");
          }}
        >
          <form onSubmit={submitEditor}>
            <fieldset className="workspace" disabled={busy || !!pending}>
              {editor.type === "task" && (
                <>
                  <Field label="タイトル">
                    <input
                      name="title"
                      placeholder="例：数学の問題を解く"
                      maxLength={200}
                      defaultValue={editor.task?.title}
                      required
                    />
                  </Field>
                  <Field label="残りの所要時間（分）">
                    <input
                      type="number"
                      name="remaining"
                      min="0"
                      max="525600"
                      step="1"
                      defaultValue={editor.task?.remaining ?? 30}
                      required
                    />
                  </Field>
                  <details open={!!editor.task}>
                    <summary>カテゴリ・締切などを設定</summary>
                    <div className="form-row">
                      <Field label="カテゴリ">
                        <select
                          name="category"
                          defaultValue={
                            editor.task?.category ?? data.settings.categories[0]
                          }
                        >
                          {data.settings.categories.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="締切（任意）">
                        <input
                          type="date"
                          name="deadline"
                          min="2000-01-01"
                          max="2199-12-31"
                          defaultValue={editor.task?.deadline}
                        />
                      </Field>
                    </div>
                    <div className="form-row">
                      <Field label="重要度">
                        <select
                          name="importance"
                          defaultValue={editor.task?.importance ?? 2}
                        >
                          {levels.map((l, i) => (
                            <option value={i + 1} key={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="必要な集中力">
                        <select
                          name="focus"
                          defaultValue={editor.task?.focus ?? 2}
                        >
                          {levels.map((l, i) => (
                            <option value={i + 1} key={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        name="split"
                        defaultChecked={editor.task?.split ?? true}
                      />
                      分割して取り組める
                    </label>
                    <Field label="状態">
                      <select
                        name="status"
                        defaultValue={editor.task?.status ?? "todo"}
                      >
                        <option value="todo">未着手</option>
                        <option value="doing">進行中</option>
                        <option value="done">完了</option>
                      </select>
                    </Field>
                  </details>
                  {editor.task && (
                    <p className="muted">
                      編集すると、このタスクの未完了の配置を解除します。完了にすると残り0分になります。再開時は残り時間を入力してください。実績時間は別途記録します。
                    </p>
                  )}
                </>
              )}
              {editor.type === "event" && (
                <>
                  {editor.event?.weekly && editor.occurrence && (
                    <Field label="変更する範囲">
                      <select name="scope" defaultValue="occurrence">
                        <option value="occurrence">
                          当日だけ（{editor.occurrence.sourceDate}）
                        </option>
                        <option value="all">繰り返し全体</option>
                      </select>
                    </Field>
                  )}
                  <Field label="予定の名称">
                    <input
                      name="title"
                      maxLength={200}
                      defaultValue={
                        editor.occurrence?.title ?? editor.event?.title
                      }
                      required
                    />
                  </Field>
                  <Field label="日付・繰り返し開始日">
                    <input
                      type="date"
                      name="date"
                      min="2000-01-01"
                      max="2199-12-31"
                      defaultValue={editor.event?.date ?? day}
                      required
                    />
                  </Field>
                  <div className="form-row">
                    <Field label="開始時刻">
                      <input
                        type="time"
                        name="start"
                        defaultValue={clock(
                          editor.occurrence
                            ? ((editor.occurrence.start % 1440) + 1440) % 1440
                            : (editor.event?.start ?? 9 * 60),
                        )}
                        required
                      />
                    </Field>
                    <Field label="終了時刻">
                      <input
                        type="time"
                        name="end"
                        defaultValue={clock(
                          editor.occurrence
                            ? editor.occurrence.end
                            : (editor.event?.end ?? 10 * 60),
                        )}
                        required
                      />
                    </Field>
                  </div>
                  <Field label="予定の種類">
                    <select
                      name="kind"
                      defaultValue={
                        editor.occurrence?.kind ?? editor.event?.kind ?? "event"
                      }
                    >
                      <option value="event">固定予定</option>
                      <option value="rest">休息・食事</option>
                    </select>
                  </Field>
                  <label className="checkbox">
                    <input
                      name="weekly"
                      type="checkbox"
                      defaultChecked={editor.event?.weekly}
                    />
                    毎週同じ曜日に繰り返す
                  </label>
                  <p className="muted">
                    当日だけの変更では、日付・繰り返し設定は変わりません。日付を動かすときは当日を取り消し、単発予定を追加してください。全体の変更後も当日だけの例外は残ります。
                  </p>
                </>
              )}
              {editor.type === "check" && (
                <>
                  <p>{dateLabel}の記録。元気度は計画の参考にだけ使います。</p>
                  <Field label="今の元気度">
                    <select
                      name="energy"
                      defaultValue={data.checkins[day]?.energy ?? 3}
                    >
                      {moods.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {i + 1} — {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="昨夜の睡眠時間（任意・時間）">
                    <input
                      name="sleep"
                      type="number"
                      min="0"
                      max="24"
                      step="0.1"
                      placeholder="例：7.5"
                      defaultValue={data.checkins[day]?.sleep ?? ""}
                    />
                  </Field>
                  <Field label="ひとことメモ（任意）">
                    <textarea
                      name="note"
                      maxLength={1000}
                      rows={3}
                      defaultValue={data.checkins[day]?.note}
                    />
                  </Field>
                </>
              )}
              {editor.type === "work" && (
                <>
                  <h3>{editor.task.title}</h3>
                  <p>{day} の実績として記録します。</p>
                  <Field
                    label="進めた分（見積もりの分数）"
                    hint={`残り${editor.task.remaining}分から差し引きます。`}
                  >
                    <input
                      type="number"
                      name="progress"
                      min="0"
                      max={editor.task.remaining}
                      step="1"
                      defaultValue={Math.min(
                        editor.task.remaining,
                        editor.block
                          ? editor.block.end - editor.block.start
                          : editor.task.remaining,
                      )}
                      required
                    />
                  </Field>
                  <Field
                    label="実際に使った時間（分）"
                    hint="振り返りに使います。見積もりと違っても大丈夫。"
                  >
                    <input
                      type="number"
                      name="actual"
                      min="0"
                      max="1440"
                      step="1"
                      defaultValue={
                        editor.block
                          ? editor.block.end - editor.block.start
                          : editor.task.remaining > 1440
                            ? 30
                            : editor.task.remaining
                      }
                      required
                    />
                  </Field>
                  <p className="muted">
                    この記録後、同じタスクのほかの未完了の配置は解除します。残り時間で再計画できます。0分の実績も記録できます。
                  </p>
                </>
              )}
              {editor.type === "manual" && (
                <>
                  <h3>{editor.task.title}</h3>
                  <p>
                    {day}{" "}
                    の時間割に配置します。再計画でも手動の時刻は保持します。
                  </p>
                  <Field label="開始時刻">
                    <input
                      type="time"
                      name="start"
                      defaultValue={clock(
                        Math.max(
                          data.settings.start,
                          Math.min(1439, nowMinute(day, now)),
                        ),
                      )}
                      required
                    />
                  </Field>
                  {data.settings.end < data.settings.start && (
                    <label className="checkbox">
                      <input type="checkbox" name="nextday" />
                      翌日の時刻
                    </label>
                  )}
                  <Field label="配置する時間（分）">
                    <input
                      type="number"
                      name="length"
                      min="1"
                      max={Math.min(1440, editor.task.remaining)}
                      defaultValue={Math.min(1440, editor.task.remaining)}
                      required
                    />
                  </Field>
                  <p className="muted">
                    衝突や活動時間外の配置は、今日の確認事項に表示します。
                  </p>
                </>
              )}
              {error && (
                <p role="alert" className="warning">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button type="button" onClick={() => setEditor(null)}>
                  キャンセル
                </button>
                <button className="primary">
                  {editor.type === "work" ? "記録を保存" : "保存する"}
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
      {imported && (
        <Modal
          title="バックアップの内容を確認"
          onClose={() => setImported(null)}
        >
          <p>
            以下のデータで、現在の記録を<strong>すべて置き換えます</strong>
            。復元前に現在のバックアップを書き出すことをおすすめします。
          </p>
          <dl className="import-summary">
            <dt>タスク</dt>
            <dd>{imported.tasks.length}件</dd>
            <dt>固定予定</dt>
            <dd>{imported.events.length}件</dd>
            <dt>生活チェック</dt>
            <dd>{Object.keys(imported.checkins).length}日</dd>
            <dt>実績</dt>
            <dd>{imported.logs.length}件</dd>
            <dt>保存形式</dt>
            <dd>バージョン {imported.version}</dd>
          </dl>
          <button onClick={() => download(data)}>現在の記録を書き出す</button>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button onClick={() => setImported(null)}>キャンセル</button>
            <button
              className="primary"
              disabled={busy || !!pending}
              onClick={() =>
                void commit({
                  ...imported,
                  settings: { ...imported.settings, onboarded: true },
                }).then((ok) => {
                  if (ok) {
                    setImported(null);
                    notify("バックアップを復元しました。");
                  }
                })
              }
            >
              既存データを置き換えて復元
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Review({
  data,
  day,
  onZero,
  onRemoveLog,
}: {
  data: Data;
  day: string;
  onZero: () => void;
  onRemoveLog: (id: string) => void;
}) {
  const days = weekDays(day);
  const logs = data.logs.filter((l) => days.includes(l.date));
  const planned = days.reduce(
    (s, d) => s + total(data.plans[d]?.blocks ?? []),
    0,
  );
  const actual = logs.reduce((s, l) => s + l.actual, 0);
  const done = new Set([
    ...logs.filter((l) => l.finished).map((l) => l.taskId),
    ...data.tasks
      .filter(
        (t) =>
          t.completedOn && days.includes(t.completedOn) && t.status === "done",
      )
      .map((t) => t.id),
  ]).size;
  const recorded = days.filter((d) => data.recordedDays.includes(d)).length;
  const cats = [...new Set(logs.map((l) => l.category))];
  return (
    <>
      <div className="day-caption">
        <span>
          {days[0]} — {days[6]}
        </span>
        <span>月曜はじまり</span>
      </div>
      <div className="review-metrics">
        <div className="panel">
          <span className="metric-label">計画した作業時間</span>
          <h2>{duration(planned)}</h2>
          <small>現在保存されている計画の合計</small>
        </div>
        <div className="panel">
          <span className="metric-label">記録した実績時間</span>
          <h2>{recorded ? duration(actual) : "未入力"}</h2>
          <small>実績の入力 {recorded} / 7日</small>
        </div>
        <div className="panel">
          <span className="metric-label">完了したタスク</span>
          <h2>
            {done}
            <span className="unit"> 件</span>
          </h2>
          <small>この週に完了を記録したタスク</small>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <SectionTitle title="カテゴリごとの実績" />
          {cats.length ? (
            cats.map((c) => {
              const n = logs
                .filter((l) => l.category === c)
                .reduce((s, l) => s + l.actual, 0);
              return (
                <div className="category-stat" key={c}>
                  <div>
                    <span>{c}</span>
                    <strong>{duration(n)}</strong>
                  </div>
                  <div className="bar-track">
                    <div
                      style={{ width: `${actual ? (n / actual) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="muted">実績を記録すると、ここに表示します。</p>
          )}
          <p className="gentle-note">
            {recorded < 3
              ? "記録のある日がまだ少ないため、来週の量は決めつけず、余裕のある計画から始めましょう。"
              : planned > actual
                ? "計画より記録した時間が少なめでした。未入力や予定変更もあるので、来週は必要に応じて量を見直せます。"
                : "記録した時間を参考に、来週も休息を先に確保しましょう。"}
          </p>
        </section>
        <section className="panel">
          <SectionTitle title="日ごとの記録" />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>計画</th>
                  <th>実績</th>
                  <th>睡眠</th>
                  <th>元気</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d}>
                    <th>{d.slice(5)}</th>
                    <td>
                      {data.plans[d]
                        ? `${total(data.plans[d].blocks)}分`
                        : "未設定"}
                    </td>
                    <td>
                      {data.recordedDays.includes(d)
                        ? `${data.logs.filter((l) => l.date === d).reduce((s, l) => s + l.actual, 0)}分`
                        : "未入力"}
                    </td>
                    <td>
                      {data.checkins[d]?.sleep != null
                        ? `${data.checkins[d].sleep}h`
                        : "未入力"}
                    </td>
                    <td>
                      {data.checkins[d]
                        ? `${data.checkins[d].energy}/5`
                        : "未入力"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={onZero}>
            選択日を実績
            {data.logs.some((l) => l.date === day) ? "入力済み" : "0分"}
            として記録
          </button>
          <p className="muted">
            入力がない日を0分として扱いません。睡眠・元気と実績の因果関係は判断しません。
          </p>
        </section>
      </div>
      <section className="panel">
        <SectionTitle title="メモと実績の明細" />
        {days
          .filter((d) => data.checkins[d]?.note)
          .map((d) => (
            <p key={d}>
              <strong>{d.slice(5)}　</strong>
              {data.checkins[d].note}
            </p>
          ))}
        {logs.map((l) => (
          <div className="log-row" key={l.id}>
            <div>
              <strong>{l.title}</strong>
              <p>
                {l.date} · 見積もりを{l.progress}分進めた / 実績{l.actual}分
                {l.finished ? " · 完了" : ""}
              </p>
            </div>
            <button onClick={() => onRemoveLog(l.id)}>記録を削除</button>
          </div>
        ))}
        {!logs.length && <p className="muted">まだ実績の記録はありません。</p>}
      </section>
    </>
  );
}
