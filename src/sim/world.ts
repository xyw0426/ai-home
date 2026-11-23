import { HouseMap, ROOM_NAME, type FurnitureDef } from './map';
import { ACTIVITIES, PERSONAS, type ActivityKind, type Persona } from './personas';
import type { DialogueRequest, LLMProvider, ParseResult } from './llm';
import { Rng } from './rng';
import { RobotBrain } from './robot';
import { AGENT_IDS, FAMILY_IDS, TICK_SEC, at, dayOf, dist, hm, tod, type AgentId, type Pt, type RoomId } from './types';

export const TALK_R = 4;
/** 每位家人至少要吃多少秒，午饭才算结束 */
export const LUNCH_EAT_SEC = 25 * 60;
export const LUNCH_START = at(12, 0);
export const LUNCH_HARD_END = at(13, 10);
export const SLEEP_AT = at(21, 30);
export const WAKE_AT = at(7, 0);
export const BUBBLE_TICKS = 30;

/** 做饭时间：只在三餐前做饭 */
export const COOK_WINDOWS: { meal: string; start: number; end: number }[] = [
  { meal: '早饭', start: at(7, 0), end: at(7, 40) },
  { meal: '午饭', start: at(11, 15), end: at(11, 58) },
  { meal: '晚饭', start: at(17, 20), end: at(18, 10) },
];

export function cookWindowAt(s: number) {
  return COOK_WINDOWS.find((c) => s >= c.start && s < c.end);
}

export interface Activity {
  kind: ActivityKind;
  label: string;
  icon: string;
  fid?: string;
  spot?: Pt;
  room?: RoomId | null;
  started: boolean;
  startedAt?: number;
  endsAt?: number;
  byUser?: boolean;
  toggle?: string;
  followId?: AgentId;
  durMin?: number;
  /** 绝对结束时间（优先于 durMin） */
  until?: number;
}

export interface Agent {
  id: AgentId;
  persona: Persona;
  name: string;
  x: number;
  y: number;
  px: number;
  py: number;
  path: Pt[];
  act: Activity | null;
  controlled: boolean;
  sleeping: boolean;
  bubble: { text: string; until: number } | null;
  blocked: number;
  convId: number | null;
  cooldownUntil: number;
  lastRoom: RoomId | null;
  afterLunchPending: boolean;
  ateSec: number;
  lastKind?: ActivityKind;
  /** 被人搭话时短暂停下（到该步数为止） */
  holdUntil: number;
  /** 本顿饭做不了时，到这个时间前不再尝试 */
  cookSkipUntil: number;
}

export type EventType = 'activity_start' | 'activity_end' | 'dialogue' | 'task' | 'robot' | 'furniture' | 'system';

export interface WorldEvent {
  id: number;
  t: number;
  type: EventType;
  text: string;
  actor?: AgentId;
  data?: Record<string, unknown>;
}

export interface FurnState {
  on: boolean;
  users: AgentId[];
  mode?: 'served' | 'dirty' | 'none' | 'running' | 'idle';
  runUntil?: number;
}

export interface Conversation {
  id: number;
  a: AgentId;
  b: AgentId;
  lines: { speaker: AgentId; text: string; t: number }[];
  max: number;
  next: AgentId;
  nextAt: number;
  pending: boolean;
  /** 发出模型请求时的步数，用于超时放弃 */
  requestedAt: number;
  done: boolean;
}

export interface SpokenLine {
  t: number;
  speaker: AgentId;
  listener?: AgentId;
  text: string;
}

type InboxItem =
  | { type: 'line'; convId: number; speaker: AgentId; text: string }
  | { type: 'parse'; from: AgentId; text: string; previous?: string; result: ParseResult };

export interface WorldOptions {
  seed?: number;
  startTime?: number;
}

export class World {
  readonly map = new HouseMap();
  t: number;
  tickCount = 0;
  rng: Rng;
  llm: LLMProvider;
  agents: Record<AgentId, Agent>;
  fs: Record<string, FurnState> = {};
  events: WorldEvent[] = [];
  lines: SpokenLine[] = [];
  convs = new Map<number, Conversation>();
  inbox: InboxItem[] = [];
  pendingLLM = 0;
  controlledId: AgentId | null = null;
  lunch: { day: number; state: 'before' | 'gathering' | 'done'; startedAt?: number; endedAt?: number };
  robot: RobotBrain;
  reserved = new Map<number, AgentId>();
  lastLaundryAt = -Infinity;
  private nextEventId = 1;
  private nextConvId = 1;
  private pairCooldown = new Map<string, number>();
  private listeners: ((e: WorldEvent) => void)[] = [];

  constructor(llm: LLMProvider, opts: WorldOptions = {}) {
    this.llm = llm;
    this.rng = new Rng(opts.seed ?? 42);
    this.t = opts.startTime ?? at(11, 30);
    this.lunch = { day: dayOf(this.t), state: tod(this.t) >= LUNCH_HARD_END ? 'done' : 'before' };
    for (const f of this.map.furniture) this.fs[f.id] = { on: false, users: [] };
    this.fs.table.mode = 'none';
    this.fs.washer.mode = 'idle';
    this.agents = {} as Record<AgentId, Agent>;
    for (const id of AGENT_IDS) {
      const p = PERSONAS[id];
      this.agents[id] = {
        id,
        persona: p,
        name: p.name,
        x: 0,
        y: 0,
        px: 0,
        py: 0,
        path: [],
        act: null,
        controlled: false,
        sleeping: false,
        bubble: null,
        blocked: 0,
        convId: null,
        cooldownUntil: 0,
        lastRoom: null,
        afterLunchPending: false,
        ateSec: 0,
        holdUntil: 0,
        cookSkipUntil: 0,
      };
    }
    this.robot = new RobotBrain(this, this.agents.robot);
  }

  /* ---------------- 基础 ---------------- */

  get list(): Agent[] {
    return AGENT_IDS.map((id) => this.agents[id]);
  }
  get family(): Agent[] {
    return FAMILY_IDS.map((id) => this.agents[id]);
  }
  get day(): number {
    return dayOf(this.t);
  }
  get timeOfDay(): number {
    return tod(this.t);
  }
  get clock(): string {
    return hm(this.t);
  }
  setLLM(llm: LLMProvider) {
    this.llm = llm;
  }
  onEvent(fn: (e: WorldEvent) => void) {
    this.listeners.push(fn);
  }

  emit(type: EventType, text: string, actor?: AgentId, data?: Record<string, unknown>): WorldEvent {
    const e: WorldEvent = { id: this.nextEventId++, t: this.t, type, text, actor, data };
    this.events.push(e);
    if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
    (this.robot as RobotBrain | undefined)?.onEvent(e);
    for (const l of this.listeners) l(e);
    return e;
  }

  place(id: AgentId, x: number, y: number) {
    const a = this.agents[id];
    a.x = a.px = x;
    a.y = a.py = y;
    a.lastRoom = this.map.roomAt(x, y);
  }

  roomOfAgent(a: Agent): RoomId | null {
    return this.map.roomAt(a.x, a.y) ?? a.lastRoom;
  }

  agentAt(x: number, y: number, except?: Agent): Agent | undefined {
    return this.list.find((a) => a !== except && a.x === x && a.y === y);
  }

  occupants(room: RoomId): Agent[] {
    return this.list.filter((a) => this.map.roomAt(a.x, a.y) === room);
  }

  phase(): 'sleep' | 'lunch' | 'free' {
    const s = this.timeOfDay;
    if (s >= SLEEP_AT || s < WAKE_AT) return 'sleep';
    if (this.lunch.state === 'gathering') return 'lunch';
    return 'free';
  }

  isDark(): boolean {
    const s = this.timeOfDay;
    return s >= at(17, 30) || s < at(6, 30);
  }

  canTalk(a: Agent, b: Agent, slack = 0): boolean {
    return (
      dist(a, b) <= TALK_R + slack && this.map.los(a.x, a.y, b.x, b.y) && this.map.los(b.x, b.y, a.x, a.y)
    );
  }

  /* ---------------- 主循环 ---------------- */

  tick() {
    this.t += TICK_SEC;
    this.tickCount++;
    this.updateSchedule();
    this.processInbox();
    for (const a of this.family) this.updateFamily(a);
    const ctl = this.controlled;
    if (ctl) this.updateFollow(ctl);
    this.robot.update();
    this.moveAgents();
    for (const a of this.list) this.afterMove(a);
    this.robot.perceive();
    this.updateConversations();
    for (const a of this.list) if (a.bubble && this.tickCount >= a.bubble.until) a.bubble = null;
  }

  private updateSchedule() {
    const day = this.day;
    const s = this.timeOfDay;
    if (this.lunch.day !== day) {
      this.lunch = { day, state: 'before' };
      for (const a of this.family) a.ateSec = 0;
      this.emit('system', `第${day}天开始了`);
    }
    if (this.lunch.state === 'before' && s >= LUNCH_START && s < LUNCH_HARD_END) {
      this.lunch.state = 'gathering';
      this.lunch.startedAt = this.t;
      this.fs.table.mode = 'served';
      this.emit('activity_start', '午饭时间到了，饭菜上桌，家人前往餐桌', undefined, { activity: 'lunch' });
    }
    if (this.lunch.state === 'gathering') {
      for (const a of this.family) if (a.act?.kind === 'eat' && a.act.started) a.ateSec += TICK_SEC;
      const pending = this.family.filter((a) => !a.controlled && a.ateSec < LUNCH_EAT_SEC);
      const anyAte = this.family.some((a) => a.ateSec >= LUNCH_EAT_SEC);
      if ((pending.length === 0 && anyAte) || s >= LUNCH_HARD_END) this.endLunch();
    }
    // 洗衣机计时
    const wsh = this.fs.washer;
    if (wsh.mode === 'running' && wsh.runUntil !== undefined && this.t >= wsh.runUntil) {
      wsh.mode = 'idle';
      wsh.on = false;
      this.emit('furniture', '洗衣机洗好了，发出“嘀嘀”声', undefined, { fid: 'washer', activity: 'washer' });
    }
  }

  private endLunch() {
    this.lunch.state = 'done';
    this.lunch.endedAt = this.t;
    this.fs.table.mode = 'dirty';
    for (const a of this.family) {
      if (a.act?.kind === 'eat' && !a.act.byUser) {
        this.endActivity(a);
        a.afterLunchPending = true;
      } else if (!a.controlled) a.afterLunchPending = true;
    }
    this.emit('activity_end', '午饭结束了（午饭结束事件）', undefined, { activity: 'lunch' });
  }

  /* ---------------- 家人自主行为 ---------------- */

  private updateFamily(a: Agent) {
    if (a.controlled) return;
    const ph = this.phase();
    if (ph === 'sleep') {
      if (a.act?.kind !== 'sleep') {
        if (!this.startActivity(a, 'sleep')) a.path = [];
      }
      return;
    }
    if (a.act?.kind === 'sleep') {
      this.endActivity(a);
    }
    if (ph === 'lunch') {
      if (a.act?.kind !== 'eat') this.startActivity(a, 'eat');
      return;
    }
    // 三餐前的做饭时间：负责做饭的家人放下手头的事去灶台
    const cw = a.persona.cooksMeals ? cookWindowAt(this.timeOfDay) : undefined;
    if (cw && a.act?.kind !== 'cook' && this.t >= a.cookSkipUntil) {
      const end = this.t - this.timeOfDay + cw.end;
      if (this.startActivity(a, 'cook', { until: end, label: `做${cw.meal}` })) return;
      a.cookSkipUntil = end; // 灶台被占用等原因做不了，这一顿就不再尝试
    }
    if (!a.act) {
      this.pickActivity(a);
      return;
    }
    const act = a.act;
    if (act.started) {
      if (act.endsAt !== undefined && this.t >= act.endsAt) {
        this.endActivity(a);
        this.pickActivity(a);
      }
      return;
    }
    // 还在路上
    if (act.followId) {
      this.updateFollow(a);
      return;
    }
    if (a.path.length === 0 && act.spot && (a.x !== act.spot.x || a.y !== act.spot.y)) {
      const p = this.map.bfs(a, act.spot);
      if (p) a.path = p;
      else {
        this.endActivity(a);
        this.pickActivity(a);
      }
    }
  }

  /** 跟随/走近某人：目标移动后重新规划 */
  private updateFollow(a: Agent) {
    const act = a.act;
    if (!act || act.started || !act.followId) return;
    const tgt = this.agents[act.followId];
    if (tgt.sleeping && !act.byUser) {
      this.endActivity(a);
      return;
    }
    if (this.canTalk(a, tgt) && dist(a, tgt) <= 2.3) {
      this.beginActivity(a);
      return;
    }
    if (!act.spot || dist(act.spot, tgt) > 2.3 || a.path.length === 0) {
      if (!this.planFollow(a, tgt)) {
        if (act.byUser) a.path = [];
        else this.endActivity(a);
      }
    }
  }

  private pickActivity(a: Agent) {
    if (a.afterLunchPending && a.persona.afterLunch) {
      a.afterLunchPending = false;
      if (this.startActivity(a, a.persona.afterLunch)) return;
    }
    a.afterLunchPending = false;
    const s = this.timeOfDay;
    let items = a.persona.prefs.map((p) => {
      let w = p.w;
      if (p.kind === a.lastKind) w *= 0.25;
      if (p.kind === 'nap' && !(s >= at(13, 0) && s < at(16, 0))) w = 0;
      if (p.kind === 'cook') w = 0; // 做饭只在三餐时间安排
      return { item: p.kind, w };
    });
    for (let tries = 0; tries < 4 && items.length; tries++) {
      const k = this.rng.weighted(items);
      if (!k) break;
      if (this.startActivity(a, k)) return;
      items = items.filter((i) => i.item !== k);
    }
    this.startActivity(a, 'wander');
  }

  private spotFree(p: Pt, a: Agent): boolean {
    const i = this.map.idx(p.x, p.y);
    const r = this.reserved.get(i);
    if (r && r !== a.id) return false;
    const o = this.agentAt(p.x, p.y, a);
    return !o;
  }

  private chooseSpot(a: Agent, f: FurnitureDef): Pt | null {
    const owned = f.spots.filter((_, i) => f.owners?.[i] === a.id);
    if (owned.length) return owned[0];
    const free = f.spots.filter((p, i) => {
      const owner = f.owners?.[i];
      if (owner && owner !== a.id && f.type !== 'armchair') return false;
      return this.spotFree(p, a);
    });
    if (!free.length) return null;
    free.sort((p, q) => dist(p, a) - dist(q, a));
    return free[0];
  }

  /**
   * 安排一项活动：选择家具和使用位置，规划路线。到达后由 beginActivity 真正开始。
   */
  startActivity(
    a: Agent,
    kind: ActivityKind,
    opts: { fid?: string; byUser?: boolean; toggle?: string; followId?: AgentId; spot?: Pt; durMin?: number; until?: number; label?: string } = {},
  ): boolean {
    if (a.act) this.endActivity(a);
    const spec = ACTIVITIES[kind];
    let fid = opts.fid;
    let spot: Pt | null = opts.spot ?? null;
    if (!fid && spec.furniture) {
      if (spec.furniture === 'bed') fid = a.persona.bed;
      else if (spec.furniture === 'seat') fid = 'table';
      else fid = spec.furniture;
    }
    if (kind === 'visit' || opts.followId) {
      const others = this.family.filter((o) => o !== a && !o.sleeping && !o.controlled);
      const tgt = opts.followId ? this.agents[opts.followId] : others.length ? this.rng.pick(others) : undefined;
      if (!tgt) return false;
      a.act = { kind, label: spec.label, icon: spec.icon, started: false, byUser: opts.byUser, followId: tgt.id };
      if (opts.byUser) a.act.label = `走到${tgt.name}身边`;
      else a.act.label = `去找${tgt.name}聊天`;
      if (!this.planFollow(a, tgt)) {
        a.act = null;
        return false;
      }
      return true;
    }
    if (!spot && fid) {
      const f = this.map.byId.get(fid);
      if (!f) return false;
      if (kind === 'do_laundry' && this.fs.washer.mode === 'running') return false;
      // 自主洗衣服：至少隔 3 小时一次（用户指挥不受限制）
      if (kind === 'do_laundry' && !opts.byUser && this.t - this.lastLaundryAt < 3 * 3600) return false;
      if (kind === 'cook' && this.fs.stove.users.length) return false;
      spot = this.chooseSpot(a, f);
    }
    if (!spot && kind === 'wander') {
      const rooms = this.map.rooms.filter((r) => r.id !== this.roomOfAgent(a) && r.id !== 'corridor');
      const r = this.rng.pick(rooms);
      const cells = this.map.roomCells[r.id].filter((i) => this.map.walk[i] === 1);
      spot = this.map.pt(this.rng.pick(cells));
    }
    if (!spot) return false;
    const path = this.map.bfs(a, spot);
    if (!path) return false;
    const room = this.map.roomAt(spot.x, spot.y);
    a.act = {
      kind,
      label: opts.label ?? spec.label,
      icon: spec.icon,
      fid,
      spot,
      room,
      started: false,
      byUser: opts.byUser,
      toggle: opts.toggle,
      durMin: opts.durMin,
      until: opts.until,
    };
    this.reserved.set(this.map.idx(spot.x, spot.y), a.id);
    a.path = path;
    a.blocked = 0;
    if (path.length === 0) this.beginActivity(a);
    return true;
  }

  private planFollow(a: Agent, tgt: Agent): boolean {
    const p = this.map.bfs(a, (x, y) => {
      if (!this.map.isWalkable(x, y)) return false;
      if (this.agentAt(x, y, a)) return false;
      const d = Math.hypot(x - tgt.x, y - tgt.y);
      return d <= 2.3 && this.map.los(x, y, tgt.x, tgt.y);
    });
    if (!p) return false;
    a.path = p;
    if (a.act) a.act.spot = p.length ? p[p.length - 1] : { x: a.x, y: a.y };
    if (p.length === 0 && a.act) this.beginActivity(a);
    return true;
  }

  private beginActivity(a: Agent) {
    const act = a.act;
    if (!act || act.started) return;
    act.started = true;
    act.startedAt = this.t;
    act.room = this.roomOfAgent(a);
    const spec = ACTIVITIES[act.kind];
    a.lastKind = act.kind;
    if (act.byUser || act.kind === 'eat' || act.kind === 'sleep' || act.kind === 'charge') act.endsAt = Infinity;
    else if (act.until !== undefined) act.endsAt = Math.max(act.until, this.t + 5 * 60);
    else act.endsAt = this.t + (act.durMin ?? this.rng.int(spec.dur[0], spec.dur[1])) * 60;
    const fs = act.fid ? this.fs[act.fid] : undefined;
    const roomName = act.room ? ROOM_NAME[act.room] : '';

    if (act.kind === 'user_move') {
      a.act = null;
      this.emit('system', `${a.name}按指令走到了${roomName}(${a.x},${a.y})`, a.id);
      return;
    }
    if (act.kind === 'user_toggle' && act.fid) {
      this.applyToggle(a, act.fid, act.toggle ?? '');
      this.releaseSpot(a);
      a.act = null;
      return;
    }
    if (fs && !fs.users.includes(a.id)) fs.users.push(a.id);
    switch (act.kind) {
      case 'use_computer':
      case 'cook':
      case 'wash_dishes':
        if (fs) fs.on = true;
        if (act.kind === 'wash_dishes' && this.fs.table.mode === 'dirty') {
          this.fs.table.mode = 'none';
          this.emit('furniture', `${a.name}把餐桌上的碗筷收进了厨房`, a.id, { fid: 'table' });
        }
        break;
      case 'do_laundry': {
        this.lastLaundryAt = this.t;
        const w = this.fs.washer;
        w.mode = 'running';
        w.on = true;
        w.runUntil = this.t + 40 * 60;
        this.emit('furniture', `${a.name}启动了洗衣机（约40分钟）`, a.id, { fid: 'washer' });
        break;
      }
      case 'watch_tv': {
        const tv = this.fs.tv;
        if (!tv.on) {
          tv.on = true;
          this.emit('furniture', `${a.name}打开了电视`, a.id, { fid: 'tv' });
        }
        if (!tv.users.includes(a.id)) tv.users.push(a.id);
        if (!this.fs.sofa.users.includes(a.id)) this.fs.sofa.users.push(a.id);
        break;
      }
      case 'sleep':
        a.sleeping = true;
        break;
    }
    if (this.isDark() && act.kind !== 'sleep' && act.kind !== 'nap' && act.room) this.setLight(act.room, true, a, '进屋开了灯');
    if (act.kind === 'sleep' && act.room) {
      const awake = this.occupants(act.room).filter((o) => !o.sleeping && o.id !== 'robot');
      if (!awake.length && this.lampOn(act.room)) this.setLight(act.room, false, a, '睡前关了灯');
    }
    const what = act.kind === 'visit' && act.followId ? `和${this.agents[act.followId].name}聊天` : act.label;
    this.emit('activity_start', `${a.name}开始${what}${roomName ? `（${roomName}）` : ''}`, a.id, {
      activity: act.kind,
      fid: act.fid,
    });
  }

  private releaseSpot(a: Agent) {
    for (const [k, v] of this.reserved) if (v === a.id) this.reserved.delete(k);
  }

  endActivity(a: Agent) {
    const act = a.act;
    if (!act) return;
    this.releaseSpot(a);
    a.act = null;
    a.path = [];
    if (!act.started) return;
    const fs = act.fid ? this.fs[act.fid] : undefined;
    if (fs) fs.users = fs.users.filter((u) => u !== a.id);
    switch (act.kind) {
      case 'use_computer':
      case 'cook':
      case 'wash_dishes':
        if (fs && fs.users.length === 0) fs.on = false;
        break;
      case 'watch_tv': {
        const tv = this.fs.tv;
        tv.users = tv.users.filter((u) => u !== a.id);
        this.fs.sofa.users = this.fs.sofa.users.filter((u) => u !== a.id);
        if (tv.users.length === 0 && tv.on) {
          tv.on = false;
          this.emit('furniture', `${a.name}看完电视，顺手关掉了`, a.id, { fid: 'tv' });
        }
        break;
      }
      case 'sleep':
        a.sleeping = false;
        break;
    }
    a.sleeping = false;
    const label = act.kind === 'visit' && act.followId ? `和${this.agents[act.followId].name}聊天` : act.label;
    const text = act.kind === 'eat' ? `${a.name}吃完了午饭` : act.kind === 'sleep' ? `${a.name}醒了` : `${a.name}结束了${label}`;
    this.emit('activity_end', text, a.id, { activity: act.kind, fid: act.fid });
  }

  /* ---------------- 家具 ---------------- */

  lampOn(room: RoomId): boolean {
    const l = this.map.lampOf[room];
    return !!l && this.fs[l.id].on;
  }

  setLight(room: RoomId, on: boolean, by?: Agent, why = '') {
    const l = this.map.lampOf[room];
    if (!l) return;
    if (this.fs[l.id].on === on) return;
    this.fs[l.id].on = on;
    this.emit('furniture', `${by ? by.name : ''}${why || (on ? '打开了' : '关掉了')}${why ? '' : ROOM_NAME[room] + '的灯'}（${ROOM_NAME[room]}灯${on ? '亮' : '灭'}）`, by?.id, {
      fid: l.id,
      on,
    });
  }

  applyToggle(a: Agent, fid: string, action: string) {
    const f = this.map.byId.get(fid);
    if (!f) return;
    if (f.type === 'lamp') {
      const on = action === 'light_on' ? true : action === 'light_off' ? false : !this.fs[fid].on;
      this.setLight(f.room, on, a);
    } else if (f.type === 'tv') {
      const tv = this.fs.tv;
      tv.on = action === 'tv_on' ? true : action === 'tv_off' ? false : !tv.on;
      this.emit('furniture', `${a.name}${tv.on ? '打开' : '关掉'}了电视`, a.id, { fid });
    } else if (f.type === 'stove') {
      this.fs.stove.on = false;
      this.emit('furniture', `${a.name}关掉了灶台的火`, a.id, { fid });
    } else if (f.type === 'washer') {
      const w = this.fs.washer;
      if (w.mode !== 'running') {
        w.mode = 'running';
        w.on = true;
        w.runUntil = this.t + 40 * 60;
        this.emit('furniture', `${a.name}启动了洗衣机（约40分钟）`, a.id, { fid });
      }
    }
  }

  /* ---------------- 移动与碰撞 ---------------- */

  private moveAgents() {
    for (const a of this.list) {
      a.px = a.x;
      a.py = a.y;
    }
    const moved = new Set<Agent>();
    for (const a of this.rng.shuffle(this.list)) {
      if (moved.has(a) || a.path.length === 0) continue;
      if (!a.controlled && a.holdUntil > this.tickCount) continue;
      const n = a.path[0];
      const occ = this.agentAt(n.x, n.y, a);
      if (!occ) {
        a.x = n.x;
        a.y = n.y;
        a.path.shift();
        a.blocked = 0;
        moved.add(a);
        continue;
      }
      // 迎面相遇：互换位置（侧身让过）
      const on = occ.path[0];
      if (on && on.x === a.x && on.y === a.y && !moved.has(occ)) {
        occ.x = a.x;
        occ.y = a.y;
        a.x = n.x;
        a.y = n.y;
        a.path.shift();
        occ.path.shift();
        a.blocked = occ.blocked = 0;
        moved.add(a);
        moved.add(occ);
        continue;
      }
      a.blocked++;
      const goal = a.path[a.path.length - 1];
      if (a.blocked >= 3 && a.blocked % 3 === 0) {
        const p = this.map.bfs(a, goal, (x, y) => !!this.agentAt(x, y, a));
        if (p && p.length) a.path = p;
      }
      if (a.blocked >= 6 && occ.path.length === 0 && goal.x === n.x && goal.y === n.y && a.path.length === 1) {
        // 目的地被别人站着：就近停下
        a.path = [];
        if (a.act && !a.act.started) this.beginActivity(a);
        continue;
      }
      if (a.blocked >= 8) {
        const opts = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
          .map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy }))
          .filter((p) => this.map.isWalkable(p.x, p.y) && !this.agentAt(p.x, p.y, a));
        if (opts.length) {
          const s = this.rng.pick(opts);
          a.x = s.x;
          a.y = s.y;
          moved.add(a);
          const p = this.map.bfs(a, goal);
          a.path = p ?? [];
          a.blocked = 0;
        }
      }
    }
  }

  private afterMove(a: Agent) {
    const room = this.map.roomAt(a.x, a.y);
    if (room && room !== a.lastRoom) {
      const prev = a.lastRoom;
      a.lastRoom = room;
      if (prev && a.id !== 'robot' && !a.controlled && a.persona.turnsOffLights && this.lampOn(prev)) {
        if (this.occupants(prev).length === 0) this.setLight(prev, false, a, `离开${ROOM_NAME[prev]}时顺手关了灯`);
      }
    }
    if (a.act && !a.act.started && a.path.length === 0) {
      if (a.act.followId) {
        const tgt = this.agents[a.act.followId];
        if (this.canTalk(a, tgt) && dist(a, tgt) <= 2.3) this.beginActivity(a);
      } else if (a.act.spot && a.x === a.act.spot.x && a.y === a.act.spot.y) this.beginActivity(a);
    }
  }

  /* ---------------- 对话 ---------------- */

  private updateConversations() {
    for (const c of this.convs.values()) {
      if (c.pending && this.tickCount - c.requestedAt > 90) {
        this.finishConv(c, `${this.agents[c.next].name}想了太久，这段对话作罢了`);
        continue;
      }
      if (c.done || c.pending || this.tickCount < c.nextAt) continue;
      const a0 = this.agents[c.a];
      const b0 = this.agents[c.b];
      if (a0.sleeping || b0.sleeping) {
        this.finishConv(c);
        continue;
      }
      const sp = this.agents[c.next];
      const li = this.agents[c.next === c.a ? c.b : c.a];
      if (sp.sleeping || li.sleeping || !this.canTalk(sp, li, 1) || sp.controlled) {
        this.finishConv(c, sp.controlled ? undefined : `${sp.name}和${li.name}的对话中断了（走远或被墙隔开）`);
        continue;
      }
      this.requestLine(c);
    }
    for (const [id, c] of this.convs) if (c.done) this.convs.delete(id);
    if (this.tickCount % 6 !== 0) return;
    if (this.pendingLLM >= 2 || this.convs.size >= 2) return;
    const cands = this.list.filter(
      (a) => !a.sleeping && !a.controlled && a.convId === null && a.cooldownUntil <= this.t,
    );
    for (let i = 0; i < cands.length; i++)
      for (let j = i + 1; j < cands.length; j++) {
        const a = cands[i];
        const b = cands[j];
        if (a.convId !== null || b.convId !== null) continue;
        const key = [a.id, b.id].sort().join('-');
        if ((this.pairCooldown.get(key) ?? -1) > this.t) continue;
        if (!this.canTalk(a, b)) continue;
        const robotPair = a.id === 'robot' || b.id === 'robot';
        if (robotPair && this.robot.busy) continue;
        let p = 0.08;
        if (a.act?.followId === b.id || b.act?.followId === a.id) p = 0.9;
        else if (a.act?.kind === 'eat' && b.act?.kind === 'eat') p = 0.3;
        if (robotPair) p = 0.05;
        if (!this.rng.chance(p)) continue;
        let first = this.rng.chance(0.5) ? a : b;
        if (a.act?.followId === b.id) first = a;
        if (b.act?.followId === a.id) first = b;
        if (robotPair) first = a.id === 'robot' ? b : a; // 家人先开口
        const second = first === a ? b : a;
        this.startConversation(first, second, this.rng.int(2, 4));
        return;
      }
  }

  startConversation(first: Agent, second: Agent, max: number, openingLine?: string): Conversation {
    const c: Conversation = {
      id: this.nextConvId++,
      a: first.id,
      b: second.id,
      lines: [],
      max,
      next: first.id,
      nextAt: this.tickCount,
      pending: false,
      requestedAt: 0,
      done: false,
    };
    this.convs.set(c.id, c);
    first.convId = c.id;
    second.convId = c.id;
    if (openingLine) {
      c.lines.push({ speaker: first.id, text: openingLine, t: this.t });
      c.next = second.id;
      c.nextAt = this.tickCount + 1;
    } else this.requestLine(c);
    return c;
  }

  private finishConv(c: Conversation, note?: string) {
    if (c.done) return;
    c.done = true;
    for (const id of [c.a, c.b]) {
      const ag = this.agents[id];
      if (ag.convId === c.id) {
        ag.convId = null;
        ag.cooldownUntil = this.t + 15 * 60;
      }
    }
    this.pairCooldown.set([c.a, c.b].sort().join('-'), this.t + 45 * 60);
    if (note) this.emit('system', note);
  }

  sceneText(): string {
    const ph = this.phase();
    if (ph === 'lunch') return '午饭时间，一家人围坐在餐桌旁';
    if (ph === 'sleep') return '夜深了';
    const s = this.timeOfDay;
    if (s < at(12, 0)) return '周末上午，午饭前';
    if (s < at(14, 0)) return '刚吃过午饭';
    if (s < at(18, 0)) return '周末下午';
    return '晚上';
  }

  activityText(a: Agent): string {
    if (a.controlled) return a.act ? a.act.label : '站着';
    if (a.id === 'robot') return this.robot.doing;
    if (a.sleeping) return '睡觉';
    if (!a.act) return '发呆';
    return a.act.started ? a.act.label : `正走去${a.act.label}`;
  }

  buildDialogueRequest(sp: Agent, li: Agent, recent: { speaker: AgentId; text: string }[], intent: 'open' | 'reply'): DialogueRequest {
    const room = this.roomOfAgent(sp);
    return {
      speaker: { id: sp.id, name: sp.name, desc: sp.persona.desc, activity: this.activityText(sp) },
      listener: { id: li.id, name: li.name, desc: li.persona.desc, activity: this.activityText(li) },
      time: this.clock,
      place: room ? ROOM_NAME[room] : '门口',
      scene: this.sceneText(),
      recent: recent.slice(-6).map((l) => ({ speaker: this.agents[l.speaker].name, text: l.text })),
      intent,
      allowRequest: li.id === 'robot' && sp.id !== 'robot',
    };
  }

  private requestLine(c: Conversation) {
    const sp = this.agents[c.next];
    const li = this.agents[c.next === c.a ? c.b : c.a];
    c.pending = true;
    c.requestedAt = this.tickCount;
    this.pendingLLM++;
    const req = this.buildDialogueRequest(sp, li, c.lines, c.lines.length ? 'reply' : 'open');
    const convId = c.id;
    this.llm
      .dialogue(req)
      .then((text) => this.inbox.push({ type: 'line', convId, speaker: sp.id, text }))
      .catch(() => this.inbox.push({ type: 'line', convId, speaker: sp.id, text: '' }));
  }

  pushParse(item: { from: AgentId; text: string; previous?: string; result: ParseResult }) {
    this.inbox.push({ type: 'parse', ...item });
  }

  private processInbox() {
    const items = this.inbox.splice(0);
    for (const it of items) {
      this.pendingLLM = Math.max(0, this.pendingLLM - 1);
      if (it.type === 'parse') {
        this.robot.onParseResult(it.from, it.text, it.previous, it.result);
        continue;
      }
      const c = this.convs.get(it.convId);
      if (!c || c.done) continue;
      c.pending = false;
      const sp = this.agents[it.speaker];
      const li = this.agents[it.speaker === c.a ? c.b : c.a];
      // 执行结果前再次检查对话条件是否仍然成立
      if (!it.text || sp.sleeping || li.sleeping || sp.controlled || !this.canTalk(sp, li, 1)) {
        this.finishConv(c, it.text ? `${sp.name}想说的话没说出口：两人已经走开或被墙隔开` : undefined);
        continue;
      }
      this.speak(sp, it.text, li.id);
      c.lines.push({ speaker: sp.id, text: it.text, t: this.t });
      if (li.id === 'robot') {
        // 机器人通过指令理解来回应，不再走普通对白
        this.finishConv(c);
        continue;
      }
      if (c.lines.length >= c.max) this.finishConv(c);
      else {
        c.next = li.id;
        c.nextAt = this.tickCount + 3;
      }
    }
  }

  /** 角色说出一句话：显示气泡、写入日志，并按同样规则触发机器人的指令理解 */
  speak(sp: Agent, text: string, listener?: AgentId) {
    sp.bubble = { text, until: this.tickCount + BUBBLE_TICKS };
    const li = listener ? this.agents[listener] : undefined;
    this.lines.push({ t: this.t, speaker: sp.id, listener, text });
    if (this.lines.length > 80) this.lines.shift();
    this.emit('dialogue', li ? `${sp.name} → ${li.name}：「${text}」` : `${sp.name}：「${text}」`, sp.id, {
      listener,
      text,
    });
    if (li && !li.controlled) li.holdUntil = this.tickCount + 4;
    if (listener === 'robot' && sp.id !== 'robot') this.robot.hear(sp.id, text);
  }

  /* ---------------- 用户接管 ---------------- */

  takeControl(id: AgentId) {
    if (this.controlledId === id) return;
    if (this.controlledId) this.release();
    const a = this.agents[id];
    if (a.convId !== null) {
      const c = this.convs.get(a.convId);
      if (c) this.finishConv(c);
    }
    this.endActivity(a);
    a.controlled = true;
    a.path = [];
    this.controlledId = id;
    this.emit('system', `用户接管了${a.name}：${a.name}暂停自主行动`, id);
  }

  release() {
    const id = this.controlledId;
    if (!id) return;
    const a = this.agents[id];
    if (a.act?.byUser || a.act?.kind === 'user_move' || a.act?.kind === 'user_toggle') this.endActivity(a);
    a.controlled = false;
    a.path = [];
    this.controlledId = null;
    this.emit('system', `释放了${a.name}：根据当前位置、时间(${this.clock})和剩余安排重新决定行动`, id);
  }

  get controlled(): Agent | null {
    return this.controlledId ? this.agents[this.controlledId] : null;
  }

  commandMove(x: number, y: number): boolean {
    const a = this.controlled;
    if (!a || !this.map.isEnterable(x, y)) return false;
    this.endActivity(a);
    return this.startActivity(a, 'user_move', { spot: { x, y }, byUser: true });
  }

  commandApproach(id: AgentId): boolean {
    const a = this.controlled;
    if (!a || id === a.id) return false;
    return this.startActivity(a, 'visit', { followId: id, byUser: true });
  }

  commandInteract(fid: string, actionId: string): boolean {
    const a = this.controlled;
    const f = this.map.byId.get(fid);
    if (!a || !f) return false;
    if (actionId.startsWith('toggle:')) {
      const spot = this.nearestSpot(a, f);
      if (!spot) return false;
      return this.startActivity(a, 'user_toggle', { fid, toggle: actionId.slice(7), byUser: true, spot });
    }
    const kind = actionId as ActivityKind;
    if (!(kind in ACTIVITIES)) return false;
    return this.startActivity(a, kind, { fid: kind === 'sleep' || kind === 'nap' || kind === 'eat' || kind === 'charge' ? undefined : fid, byUser: true });
  }

  private nearestSpot(a: Agent, f: FurnitureDef): Pt | null {
    const spots = f.spots.filter((p) => this.spotFree(p, a));
    if (!spots.length) return null;
    return spots.sort((p, q) => dist(p, a) - dist(q, a))[0];
  }

  /** 用户输入的话：由当前控制的角色说出，选择附近能交流的听者 */
  say(text: string): AgentId | null {
    const a = this.controlled;
    const clean = text.trim();
    if (!a || !clean) return null;
    const near = this.list.filter((o) => o !== a && !o.sleeping && this.canTalk(a, o));
    let li: Agent | undefined;
    for (const o of near) if (clean.includes(o.name) || (o.id === 'robot' && /机器人|小暖/.test(clean))) li = o;
    if (!li && near.length) li = near.sort((p, q) => dist(p, a) - dist(q, a))[0];
    if (li && li.convId !== null) {
      const c = this.convs.get(li.convId);
      if (c) this.finishConv(c);
    }
    this.speak(a, clean, li?.id);
    if (li && li.id !== 'robot' && !li.controlled) this.startConversation(a, li, 2, clean);
    if (!li) this.emit('system', `附近没有能听到${a.name}说话的人（距离太远或被墙隔开）`, a.id);
    return li?.id ?? null;
  }

  furnitureActions(f: FurnitureDef, a: Agent): { id: string; label: string }[] {
    const fs = this.fs[f.id];
    const isRobot = a.id === 'robot';
    const out: { id: string; label: string }[] = [];
    switch (f.type) {
      case 'lamp':
        out.push({ id: fs.on ? 'toggle:light_off' : 'toggle:light_on', label: fs.on ? '关灯' : '开灯' });
        break;
      case 'tv':
        if (!isRobot) out.push({ id: 'watch_tv', label: '坐下看电视' });
        out.push({ id: fs.on ? 'toggle:tv_off' : 'toggle:tv_on', label: fs.on ? '关电视' : '开电视' });
        break;
      case 'washer':
        if (this.fs.washer.mode !== 'running') {
          if (!isRobot) out.push({ id: 'do_laundry', label: '放衣服并启动洗衣机' });
          else out.push({ id: 'toggle:washer_start', label: '启动洗衣机' });
        }
        break;
      case 'stove':
        if (!isRobot) out.push({ id: 'cook', label: '做饭' });
        if (fs.on && !fs.users.length) out.push({ id: 'toggle:stove_off', label: '关火' });
        break;
      case 'computer':
        if (!isRobot) out.push({ id: 'use_computer', label: '用电脑' });
        break;
      case 'bookshelf':
        if (!isRobot) out.push({ id: 'read_book', label: '取书阅读' });
        break;
      case 'sink':
        if (!isRobot) out.push({ id: 'wash_dishes', label: '洗碗' });
        break;
      case 'sofa':
        if (!isRobot) out.push({ id: 'sofa_rest', label: '坐沙发休息' }, { id: 'watch_tv', label: '坐下看电视' });
        break;
      case 'armchair':
        if (!isRobot) out.push({ id: 'rest_chair', label: '坐摇椅休息' });
        break;
      case 'toybox':
        if (!isRobot) out.push({ id: 'play_toys', label: '玩积木' });
        break;
      case 'desk':
        if (!isRobot) out.push({ id: 'homework', label: '写作业' });
        break;
      case 'bed':
        if (f.owners?.includes(a.id)) out.push({ id: 'nap', label: '躺下休息' }, { id: 'sleep', label: '睡觉' });
        break;
      case 'table':
        if (!isRobot) out.push({ id: 'eat', label: this.phase() === 'lunch' ? '入座吃午饭' : '坐到自己的座位' });
        break;
      case 'dock':
        if (isRobot) out.push({ id: 'charge', label: '回座充电' });
        break;
    }
    return out;
  }

  furnitureStatus(f: FurnitureDef): string {
    const fs = this.fs[f.id];
    const names = fs.users.map((u) => this.agents[u].name).join('、');
    switch (f.type) {
      case 'lamp':
        return fs.on ? '灯亮着' : '灯关着';
      case 'tv':
        return fs.on ? `开着${names ? `，${names}在看` : '，没人看'}` : '关着';
      case 'washer':
        return fs.mode === 'running' ? `运行中，还剩约${Math.max(1, Math.ceil(((fs.runUntil ?? this.t) - this.t) / 60))}分钟` : '空闲';
      case 'stove':
        return fs.on ? `开着火${names ? `，${names}在做饭` : ''}` : '关着';
      case 'computer':
        return fs.on ? `开机中，${names}在用` : '待机';
      case 'bookshelf':
        return names ? `${names}正在读书（少了一本书）` : '书都在架上';
      case 'table':
        return fs.mode === 'served' ? `饭菜已上桌${names ? `，${names}在吃` : ''}` : fs.mode === 'dirty' ? '桌上有待收拾的碗筷' : '干净';
      case 'bed':
        return names ? `${names}在床上` : '空着';
      default:
        return names ? `${names}在用` : '空着';
    }
  }
}
