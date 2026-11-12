export type Day = string;
export type Level = 1 | 2 | 3;
export interface Task {
  id: string;
  title: string;
  category: string;
  remaining: number;
  deadline: Day | "";
  importance: Level;
  focus: Level;
  split: boolean;
  status: "todo" | "doing" | "done";
  completedOn?: Day;
}
export interface EventDetail {
  title: string;
  start: number;
  end: number;
  kind: "event" | "rest";
}
export interface Event extends EventDetail {
  id: string;
  date: Day;
  weekly: boolean;
  exceptions: Record<Day, EventDetail | null>;
}
export interface Block {
  id: string;
  taskId: string;
  title: string;
  category: string;
  start: number;
  end: number;
  manual: boolean;
  done: boolean;
}
export interface Plan {
  mode: "normal" | "short";
  blocks: Block[];
  normalBackup?: Block[];
}
export interface Checkin {
  energy: number;
  sleep: number | null;
  note: string;
}
export interface Log {
  id: string;
  taskId: string;
  title: string;
  category: string;
  date: Day;
  actual: number;
  progress: number;
  finished: boolean;
}
export interface Data {
  version: 1;
  revision: number;
  settings: {
    start: number;
    end: number;
    reserve: number;
    categories: string[];
    onboarded: boolean;
  };
  tasks: Task[];
  events: Event[];
  plans: Record<Day, Plan>;
  checkins: Record<Day, Checkin>;
  logs: Log[];
  recordedDays: Day[];
}
export const initialData = (): Data => ({
  version: 1,
  revision: 0,
  settings: {
    start: 7 * 60,
    end: 23 * 60,
    reserve: 20,
    categories: ["勉強", "運動", "創作", "生活", "その他"],
    onboarded: false,
  },
  tasks: [],
  events: [],
  plans: {},
  checkins: {},
  logs: [],
  recordedDays: [],
});
export const uid = () => crypto.randomUUID();
