import type { Block, Data, Day, Log, Plan } from "./model.ts";
import { uid } from "./model.ts";
export function finishWork(
  data: Data,
  taskId: string,
  date: Day,
  progress: number,
  actual: number,
  blockId?: string,
): Data {
  const d = structuredClone(data);
  const task = d.tasks.find((t) => t.id === taskId);
  if (
    !task ||
    progress < 0 ||
    progress > task.remaining ||
    actual < 0 ||
    actual > 1440 ||
    !Number.isInteger(progress) ||
    !Number.isInteger(actual)
  )
    throw new Error("進めた分と実績時間を確認してください。");
  task.remaining -= progress;
  task.status = task.remaining === 0 ? "done" : "doing";
  if (task.status === "done") task.completedOn = date;
  const log: Log = {
    id: uid(),
    taskId,
    title: task.title,
    category: task.category,
    date,
    progress,
    actual,
    finished: task.status === "done",
  };
  d.logs.push(log);
  if (!d.recordedDays.includes(date)) d.recordedDays.push(date);
  for (const p of Object.values(d.plans)) {
    p.blocks = p.blocks.filter(
      (b) => b.taskId !== taskId || b.done || b.id === blockId,
    );
    if (blockId) {
      const b = p.blocks.find((b) => b.id === blockId);
      if (b) b.done = true;
    }
    if (p.normalBackup)
      p.normalBackup = p.normalBackup.filter(
        (b) => b.taskId !== taskId || b.done,
      );
  }
  return d;
}
export function deleteTask(data: Data, id: string): Data {
  const d = structuredClone(data);
  d.tasks = d.tasks.filter((t) => t.id !== id);
  for (const p of Object.values(d.plans)) {
    p.blocks = p.blocks.filter((b) => b.taskId !== id || b.done);
    p.normalBackup = p.normalBackup?.filter((b) => b.taskId !== id || b.done);
  }
  return d;
}
export function applyPlan(
  data: Data,
  day: Day,
  mode: Plan["mode"],
  blocks: Block[],
): Data {
  const d = structuredClone(data),
    prev = d.plans[day];
  d.plans[day] = {
    mode,
    blocks,
    normalBackup:
      mode === "short"
        ? prev?.mode === "normal"
          ? prev.blocks
          : prev?.normalBackup
        : undefined,
  };
  return d;
}
