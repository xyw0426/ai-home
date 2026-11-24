import type { TaskSpec, TriggerSpec } from './llm';
import { ROOM_NAME } from './map';
import { PERSONAS } from './personas';
import type { AgentId, Pt, RoomId } from './types';
import { ROOM_IDS, hm } from './types';

export type TaskStatus = 'pending' | 'due' | 'active' | 'waiting' | 'done' | 'cancelled';

export interface SearchCandidate {
  room: RoomId;
  pos?: Pt;
  why: string;
}

export interface Task {
  id: number;
  spec: TaskSpec;
  title: string;
  source: 'preset' | 'dialogue' | 'observation';
  requester?: AgentId;
  recurring?: 'daily';
  status: TaskStatus;
  /** 2 = 有时间要求的提醒；1 = 普通家务 */
  priority: number;
  createdAt: number;
  dueAt?: number;
  retryAt?: number;
  doneAt?: number;
  doneDay?: number;
  log: { t: number; text: string }[];
  // 运行时
  search?: { candidates: SearchCandidate[]; idx: number; since: number; rounds: number; atPos: boolean };
  attemptStart?: number;
  lookIdx?: number;
}

export function priorityOf(spec: TaskSpec): number {
  return spec.action === 'remind' ? 2 : 1;
}

export function triggerText(tr: TriggerSpec): string {
  if (tr.type === 'now') return '立即';
  if (tr.type === 'event') return '午饭结束后';
  return `${tr.time} 到点`;
}

export function taskTitle(spec: TaskSpec): string {
  const room = spec.room ? ROOM_NAME[spec.room] : '';
  const cond = spec.condition === 'room_empty' ? '（无人时）' : '';
  switch (spec.action) {
    case 'light_off':
      return `关${room}的灯${cond}`;
    case 'light_on':
      return `开${room}的灯`;
    case 'tv_off':
      return `关客厅电视${cond}`;
    case 'washer_start':
      return '启动洗衣机';
    case 'water_plants':
      return '给阳台的花浇水';
    case 'remind':
      return `提醒${spec.target ? PERSONAS[spec.target].name : ''}：${spec.message ?? ''}`;
  }
}

export function confirmText(spec: TaskSpec, speaker: AgentId): string {
  const when = spec.trigger.type === 'now' ? '我现在就' : spec.trigger.type === 'event' ? '等午饭结束后我' : `到${spec.trigger.time}我`;
  const room = spec.room ? ROOM_NAME[spec.room] : '';
  switch (spec.action) {
    case 'light_off':
      return spec.condition === 'room_empty'
        ? `好的，${when}去${room}看看灯，确认没人就关掉。`
        : `好的，${when}去把${room}的灯关掉。`;
    case 'light_on':
      return `好的，${when}去把${room}的灯打开。`;
    case 'tv_off':
      return spec.condition === 'room_empty' ? `好的，${when}去客厅看看，没人看就关电视。` : `好的，${when}去关电视。`;
    case 'washer_start':
      return `好的，${when}去卫生间把洗衣机启动。`;
    case 'water_plants':
      return `好的，${when}去阳台给花浇水。`;
    case 'remind': {
      const who = spec.target === speaker ? '您' : spec.target ? PERSONAS[spec.target].name : '';
      return `好的，${when}提醒${who}${spec.message ?? ''}。`;
    }
  }
}

export type Validation = { ok: true; spec: TaskSpec; note?: string } | { ok: false; question: string };

const ACTIONS = ['light_off', 'light_on', 'tv_off', 'washer_start', 'water_plants', 'remind'];
const ROOMS: RoomId[] = ROOM_IDS;
const PEOPLE: AgentId[] = ['dad', 'mom', 'grandma', 'kid'];

/**
 * 校验模型（或规则）解析出的任务能否执行。
 * 模拟器负责事实：房间是否存在、有没有灯、目标是谁、时间格式是否正确。
 */
export function validateSpec(raw: TaskSpec, speaker: AgentId, lunchDone: boolean): Validation {
  if (!raw || !ACTIONS.includes(raw.action)) return { ok: false, question: '这个我还不会做，可以换个说法吗？' };
  const spec: TaskSpec = {
    action: raw.action,
    room: raw.room,
    target: raw.target,
    message: raw.message?.trim(),
    trigger: raw.trigger ?? { type: 'now' },
    condition: raw.condition === 'room_empty' ? 'room_empty' : 'none',
  };
  if (spec.action === 'tv_off') spec.room = 'living';
  if (spec.action === 'washer_start') spec.room = 'bathroom';
  if (spec.action === 'water_plants') spec.room = 'balcony';
  if (spec.action === 'light_off' || spec.action === 'light_on') {
    if (!spec.room) return { ok: false, question: `要${spec.action === 'light_off' ? '关' : '开'}哪个房间的灯呢？` };
    if (!ROOMS.includes(spec.room)) return { ok: false, question: '家里好像没有这个房间，你说的是哪一间？' };
  }
  if (spec.action === 'remind') {
    if (!spec.target || !PEOPLE.includes(spec.target)) return { ok: false, question: '要我提醒谁呢？' };
    if (!spec.message) return { ok: false, question: '要提醒什么事呢？' };
  }
  const tr = spec.trigger;
  let note: string | undefined;
  if (tr.type === 'time') {
    if (!/^\d{1,2}:\d{2}$/.test(tr.time)) return { ok: false, question: '具体是几点呢？' };
    const [h, m] = tr.time.split(':').map(Number);
    if (h > 23 || m > 59) return { ok: false, question: '具体是几点呢？' };
    spec.trigger = { type: 'time', time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
  } else if (tr.type === 'event') {
    if (tr.event !== 'lunch_end') return { ok: false, question: '是在什么时候做呢？' };
    if (lunchDone) {
      spec.trigger = { type: 'now' };
      note = '午饭已经结束，改为立即执行';
    }
  } else if (tr.type !== 'now') {
    spec.trigger = { type: 'now' };
  }
  return { ok: true, spec, note };
}

export function timeTriggerSec(tr: TriggerSpec): number | null {
  if (tr.type !== 'time') return null;
  const [h, m] = tr.time.split(':').map(Number);
  return h * 3600 + m * 60;
}

export function logTask(task: Task, t: number, text: string) {
  task.log.push({ t, text: `${hm(t)} ${text}` });
  if (task.log.length > 20) task.log.shift();
}
