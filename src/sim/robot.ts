import { ruleParse } from './demo';
import type { ParseResult, TaskSpec } from './llm';
import { LongTermMemory, ShortTermMemory } from './memory';
import { ROOM_NAME, W, H } from './map';
import {
  confirmText,
  logTask,
  priorityOf,
  taskTitle,
  timeTriggerSec,
  validateSpec,
  type SearchCandidate,
  type Task,
} from './tasks';
import { AGENT_IDS, DAY_SEC, ROOM_IDS, at, dist, hm, tod, type AgentId, type Pt, type RoomId } from './types';
import type { Agent, World, WorldEvent } from './world';

/** 一次检查房间时，需要在近期看见的格子比例 */
export const COVERAGE_OK = 0.95;
/** 视为“近期看见”的时间窗（秒） */
const SEEN_WINDOW = 180;
const RETRY_SEC = 20 * 60;
const ATTEND_MAX = 20 * 60;

export interface RobotPlan {
  doing: string;
  next: string;
  because: string;
}

export class RobotBrain {
  readonly stm = new ShortTermMemory();
  readonly ltm = new LongTermMemory();
  visible = new Set<number>();
  readonly cellSeenAt = new Float64Array(W * H).fill(-1e12);
  roomChecked = {} as Record<RoomId, number>;
  roomSeen = {} as Record<RoomId, Map<AgentId, number>>;
  lightKnown: Partial<Record<RoomId, { on: boolean; t: number }>> = {};
  sightCount = {} as Record<AgentId, Partial<Record<RoomId, number>>>;
  private lastCount = {} as Record<AgentId, { room: RoomId | null; t: number }>;
  todo: Task[] = [];
  history: Task[] = [];
  private nextTaskId = 1;
  currentTaskId: number | null = null;
  mode: 'patrol' | 'task' | 'charge' | 'attend' | 'user' = 'patrol';
  patrol: { room: RoomId | null; order: Pt[]; idx: number; since: number; scanUntil: number; why: string } = {
    room: null,
    order: [],
    idx: 0,
    since: 0,
    scanUntil: 0,
    why: '',
  };
  patrolResume: RoomId | null = null;
  doing = '待命';
  next = '—';
  because = '—';
  dest: Pt | null = null;
  attendUntil = 0;
  attendTo: AgentId | null = null;
  private attendStart = 0;
  private attendCooldown = 0;
  pendingClarify: { speaker: AgentId; text: string; t: number } | null = null;
  parsing = 0;

  constructor(
    private w: World,
    private a: Agent,
  ) {
    for (const r of ROOM_IDS) {
      this.roomChecked[r] = -Infinity;
      this.roomSeen[r] = new Map();
    }
    for (const id of AGENT_IDS) this.sightCount[id] = {};
    const t = w.t;
    // 长期记忆：开局就知道的固定安排与家人习惯
    this.ltm.upsert({ key: 'sched:lunch', kind: 'schedule', text: '每天12:00全家在餐厅吃午饭', pinned: true, strength: 9 }, t);
    this.ltm.upsert({ key: 'sched:med', kind: 'schedule', text: '每天午饭结束后提醒奶奶吃降压药', pinned: true, strength: 9 }, t);
    this.ltm.upsert({ key: 'sched:sleep', kind: 'schedule', text: '每晚21:30后家人回各自床位睡觉', pinned: true, strength: 9 }, t);
    const habits: [AgentId, RoomId, number][] = [
      ['grandma', 'living', 6],
      ['grandma', 'grandma', 3],
      ['dad', 'study', 6],
      ['mom', 'kitchen', 6],
      ['kid', 'kids', 6],
    ];
    for (const [who, room, s] of habits) this.upsertHabit(who, room, s, t);
    this.addTask(
      { action: 'remind', target: 'grandma', message: '按时吃降压药', trigger: { type: 'event', event: 'lunch_end' }, condition: 'none' },
      'preset',
      undefined,
      '每天午饭结束后提醒奶奶吃药',
      'daily',
    );
  }

  private upsertHabit(who: AgentId, room: RoomId, strength: number, t: number) {
    this.ltm.upsert(
      { key: `habit:${who}:${room}`, kind: 'habit', text: `${this.w.agents[who].name}常去${ROOM_NAME[room]}`, pinned: false, strength, who, room },
      t,
    );
  }

  get busy(): boolean {
    return this.mode === 'task' || this.parsing > 0 || this.a.controlled;
  }

  get currentTask(): Task | undefined {
    return this.todo.find((t) => t.id === this.currentTaskId);
  }

  get plan(): RobotPlan {
    return { doing: this.doing, next: this.next, because: this.because };
  }

  /* ---------------- 感知 ---------------- */

  perceive() {
    const w = this.w;
    const map = w.map;
    const t = w.t;
    const vis = map.visibleFrom(this.a);
    this.visible = new Set(vis);
    for (const i of vis) this.cellSeenAt[i] = t;
    for (const o of w.list) {
      if (o === this.a) continue;
      if (!this.visible.has(map.idx(o.x, o.y))) continue;
      const room = w.roomOfAgent(o);
      if (!room) continue;
      this.roomSeen[room].set(o.id, t);
      this.stm.record(t, o.id, room, `在${ROOM_NAME[room]}见过${o.name}${o.sleeping ? '（在睡觉）' : ''}`, { x: o.x, y: o.y });
      const lc = this.lastCount[o.id];
      if (!lc || lc.room !== room || t - lc.t >= 600) {
        this.sightCount[o.id][room] = (this.sightCount[o.id][room] ?? 0) + 1;
        this.lastCount[o.id] = { room, t };
      }
    }
    // 灯：看见房间里任何一格，就能判断灯是否亮着
    const touched = new Set<RoomId>();
    for (const i of vis) {
      const r = map.roomOf[i];
      if (r) touched.add(r);
    }
    for (const r of touched) {
      if (map.lampOf[r]) {
        const on = w.lampOn(r);
        const prev = this.lightKnown[r];
        if (!prev || prev.on !== on || t - prev.t > 600)
          this.stm.record(t, `light:${r}`, r, `${ROOM_NAME[r]}的灯${on ? '亮着' : '关着'}`, undefined, true);
        this.lightKnown[r] = { on, t };
      }
      const cov = this.coverage(r, t - SEEN_WINDOW);
      if (cov >= COVERAGE_OK && t - this.roomChecked[r] > 60) {
        const firstCheck = t - this.roomChecked[r] > 600;
        this.roomChecked[r] = t;
        const occ = this.occupantsSeen(r, t - 60);
        if (!occ.length && w.lampOn(r)) this.noticeEmptyLit(r);
        if (firstCheck) {
          this.stm.record(
            t,
            `room:${r}`,
            r,
            `检查过${ROOM_NAME[r]}：${occ.length ? occ.map((o) => w.agents[o].name).join('、') + '在里面' : '没人'}`,
            undefined,
            true,
          );
        }
      }
    }
    if (w.tickCount % 180 === 0) this.refreshHabits();
  }

  private refreshHabits() {
    for (const id of AGENT_IDS) {
      if (id === 'robot') continue;
      const counts = Object.entries(this.sightCount[id]) as [RoomId, number][];
      counts.sort((a, b) => b[1] - a[1]);
      for (const [room, c] of counts.slice(0, 2)) {
        if (c < 3) continue;
        const key = `habit:${id}:${room}`;
        const cur = this.ltm.entries.find((e) => e.key === key);
        this.upsertHabit(id, room, Math.max(c, cur?.strength ?? 0), this.w.t);
      }
    }
  }

  /** 房间内可站人的格子中，自 since 起被看见过的比例 */
  coverage(room: RoomId, since: number): number {
    const cells = this.w.map.roomCells[room];
    let n = 0;
    for (const i of cells) if (this.cellSeenAt[i] >= since) n++;
    return cells.length ? n / cells.length : 1;
  }

  /** 自 since 起在房间里看见过、且现在没看见离开的人 */
  occupantsSeen(room: RoomId, since: number): AgentId[] {
    const out: AgentId[] = [];
    for (const [id, tt] of this.roomSeen[room]) {
      if (tt < since) continue;
      const o = this.w.agents[id];
      const idx = this.w.map.idx(o.x, o.y);
      // 如果现在能看见他且已不在该房间，就不算
      if (this.visible.has(idx) && this.w.map.roomAt(o.x, o.y) !== room) continue;
      out.push(id);
    }
    return out;
  }

  sees(id: AgentId): boolean {
    const o = this.w.agents[id];
    return this.visible.has(this.w.map.idx(o.x, o.y));
  }

  /* ---------------- 待办 ---------------- */

  addTask(spec: TaskSpec, source: Task['source'], requester?: AgentId, title?: string, recurring?: 'daily'): Task {
    const w = this.w;
    const task: Task = {
      id: this.nextTaskId++,
      spec,
      title: title ?? taskTitle(spec),
      source,
      requester,
      recurring,
      status: 'pending',
      priority: priorityOf(spec),
      createdAt: w.t,
      log: [],
    };
    const who = requester ? w.agents[requester].name : '预设';
    const src = source === 'preset' ? '预设任务' : source === 'observation' ? '小暖自己的观察' : who + '的对白';
    logTask(task, w.t, `加入待办（来源：${src}）`);
    if (spec.trigger.type === 'now') {
      task.status = 'due';
      task.dueAt = w.t;
    } else if (spec.trigger.type === 'time') {
      const sec = timeTriggerSec(spec.trigger)!;
      const dayStart = w.t - tod(w.t);
      let when = dayStart + sec;
      if (when <= w.t) when += DAY_SEC;
      task.dueAt = when;
      logTask(task, w.t, `计划在第${Math.floor(when / DAY_SEC) + 1}天 ${hm(when)} 执行`);
    } else if (spec.trigger.event === 'lunch_end' && w.lunch.state === 'done' && source === 'preset') {
      // 预设任务：今天午饭已过，等明天
    }
    this.todo.push(task);
    w.emit('task', `机器人待办 +「${task.title}」（触发：${trigText(task)}）`, 'robot', { taskId: task.id });
    return task;
  }

  onEvent(e: WorldEvent) {
    if (e.type === 'activity_end' && e.data?.activity === 'lunch') {
      for (const task of this.todo) {
        if (task.status !== 'pending') continue;
        if (task.spec.trigger.type === 'event' && task.spec.trigger.event === 'lunch_end') {
          if (task.recurring && task.doneDay === this.w.day) continue;
          task.status = 'due';
          task.dueAt = this.w.t;
          task.search = undefined;
          logTask(task, this.w.t, '收到「午饭结束」事件，任务到期');
        }
      }
    }
  }

  private updateTriggers() {
    const t = this.w.t;
    for (const task of this.todo) {
      if (task.status === 'pending' && task.spec.trigger.type === 'time' && task.dueAt !== undefined && t >= task.dueAt) {
        task.status = 'due';
        logTask(task, t, `到了约定时间 ${task.spec.trigger.time}，任务到期`);
      }
      if (task.status === 'waiting' && task.retryAt !== undefined && t >= task.retryAt) {
        task.status = 'due';
        task.search = undefined;
        logTask(task, t, '到了再次检查的时间');
      }
      if (task.recurring && task.status === 'done' && task.doneDay !== undefined && task.doneDay < this.w.day) {
        task.status = 'pending';
        task.search = undefined;
        logTask(task, t, '新的一天，重置为待触发');
      }
    }
    // 完成/取消的任务移入历史（循环任务保留）
    for (const task of this.todo.slice()) {
      if ((task.status === 'done' || task.status === 'cancelled') && !task.recurring) {
        this.todo.splice(this.todo.indexOf(task), 1);
        this.history.unshift(task);
        if (this.history.length > 20) this.history.pop();
      }
    }
  }

  dueTasks(): Task[] {
    return this.todo
      .filter((t) => t.status === 'due' || t.status === 'active')
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          (a.status === 'active' ? -1 : 0) - (b.status === 'active' ? -1 : 0) ||
          (a.dueAt ?? 0) - (b.dueAt ?? 0),
      );
  }

  cancelTask(id: number) {
    const task = this.todo.find((t) => t.id === id);
    if (!task) return;
    task.status = 'cancelled';
    logTask(task, this.w.t, '已取消');
    if (this.currentTaskId === id) this.currentTaskId = null;
    this.w.emit('task', `取消了任务「${task.title}」`, 'robot');
  }

  /* ---------------- 决策 ---------------- */

  update() {
    const w = this.w;
    const a = this.a;
    this.updateTriggers();
    if (a.controlled) {
      this.mode = 'user';
      this.doing = '由用户控制';
      this.next = a.path.length ? `前往 (${a.path[a.path.length - 1].x},${a.path[a.path.length - 1].y})` : '—';
      this.because = '用户接管期间暂停自主行动（感知和记忆照常更新）';
      return;
    }
    if (a.act && a.act.byUser) w.endActivity(a);

    // 注意到被接管的家人走近：停下来等待吩咐
    const ctl = w.controlled;
    const due = this.dueTasks();
    if (
      ctl &&
      ctl !== a &&
      !due.some((t) => t.status === 'active' && t.priority >= 2) &&
      dist(ctl, a) <= 2.5 &&
      w.map.los(a.x, a.y, ctl.x, ctl.y) &&
      w.t >= this.attendCooldown
    ) {
      if (this.attendTo !== ctl.id || w.t >= this.attendUntil) this.attendStart = w.t;
      if (w.t - this.attendStart > ATTEND_MAX) {
        this.attendCooldown = w.t + 10 * 60;
      } else {
        this.attendUntil = Math.max(this.attendUntil, w.t + 60);
        this.attendTo = ctl.id;
      }
    }
    if (w.t < this.attendUntil || this.parsing > 0) {
      a.path = [];
      this.mode = 'attend';
      const who = this.attendTo ? w.agents[this.attendTo].name : '家人';
      this.doing = this.parsing > 0 ? `正在理解${who}的话` : `停下来听${who}说话`;
      this.next = '等对方说完再继续';
      this.because = `${who}走到了身边`;
      return;
    }

    const best = due[0];
    if (best) {
      if (this.currentTaskId !== best.id) {
        const cur = this.currentTask;
        if (cur && cur.status === 'active') {
          cur.status = 'due';
          logTask(cur, w.t, `被更高优先级的「${best.title}」打断，稍后继续`);
        }
        if (this.mode === 'patrol' && this.patrol.room && !this.patrol.why.startsWith('处理完任务'))
          this.patrol.why = `处理完任务后继续巡视${ROOM_NAME[this.patrol.room]}（${this.patrol.why}）`;
        this.currentTaskId = best.id;
      }
      this.mode = 'task';
      this.execTask(best);
      return;
    }
    this.currentTaskId = null;
    const s = tod(w.t);
    if (s >= at(22, 0) || s < at(6, 30)) {
      this.mode = 'charge';
      const dock = w.map.byId.get('dock')!.spots[0];
      if (a.x === dock.x && a.y === dock.y) {
        this.doing = '在充电座上充电';
        this.next = '06:30 开始巡视';
        this.because = '夜间，家人都睡了';
        a.path = [];
      } else {
        this.goTo(dock, '充电座');
        this.doing = '回充电座充电';
        this.because = '夜间，没有待办任务';
      }
      return;
    }
    this.mode = 'patrol';
    this.doPatrol();
  }

  /** 规划到某点；若该点被占或只能作为目的地，则走到它旁边 */
  private goTo(p: Pt, label: string): boolean {
    const a = this.a;
    const w = this.w;
    if (a.x === p.x && a.y === p.y) {
      this.dest = p;
      a.path = [];
      return true;
    }
    if (!this.dest || this.dest.x !== p.x || this.dest.y !== p.y || a.path.length === 0 || a.blocked > 4) {
      let path = w.map.bfs(a, p);
      const occ = w.agentAt(p.x, p.y, a);
      if (!path || occ) path = w.map.bfs(a, (x, y) => w.map.isWalkable(x, y) && Math.abs(x - p.x) + Math.abs(y - p.y) <= 1 && !w.agentAt(x, y, a));
      a.path = path ?? [];
      this.dest = p;
    }
    this.next = `${label} (${p.x},${p.y})`;
    return false;
  }

  private arrived(p: Pt): boolean {
    return (this.a.x === p.x && this.a.y === p.y) || (this.a.path.length === 0 && Math.abs(this.a.x - p.x) + Math.abs(this.a.y - p.y) <= 1);
  }

  /** 巡视顺序：狭长房间（走廊）从离自己近的一端扫到另一端；其他房间按最近邻依次走 */
  private orderPatrol(room: RoomId): Pt[] {
    const pts = this.w.map.patrolPoints[room].slice();
    const a = this.a;
    const r = this.w.map.room(room);
    const wd = r.x1 - r.x0 + 1;
    const ht = r.y1 - r.y0 + 1;
    if (wd >= ht * 3 || ht >= wd * 3) {
      const key = (p: Pt) => (wd >= ht ? p.x : p.y);
      const asc = pts.sort((p, q) => key(p) - key(q));
      return dist(asc[0], a) <= dist(asc[asc.length - 1], a) ? asc : asc.reverse();
    }
    const out: Pt[] = [];
    let cur: Pt = a;
    while (pts.length) {
      pts.sort((p, q) => dist(p, cur) - dist(q, cur));
      cur = pts.shift()!;
      out.push(cur);
    }
    return out;
  }

  /** 看清一个房间后发现没人但灯亮着：加一条关灯家务（执行时还会再确认一次无人） */
  private noticeEmptyLit(room: RoomId) {
    const w = this.w;
    const exists = this.todo.some(
      (t) => t.spec.action === 'light_off' && t.spec.room === room && t.status !== 'done' && t.status !== 'cancelled',
    );
    if (exists) return;
    // 有人交代过要开这盏灯（还没做，或两小时内刚开的），就不擅自关掉
    const wanted = [...this.todo, ...this.history].some(
      (t) =>
        t.spec.action === 'light_on' &&
        t.spec.room === room &&
        t.status !== 'cancelled' &&
        (t.status !== 'done' || (t.doneAt !== undefined && w.t - t.doneAt < 2 * 3600)),
    );
    if (wanted) return;
    const task = this.addTask(
      { action: 'light_off', room, trigger: { type: 'now' }, condition: 'room_empty' },
      'observation',
      undefined,
      `关${ROOM_NAME[room]}的灯（发现没人但灯亮着）`,
    );
    logTask(task, w.t, `巡视时看清了${ROOM_NAME[room]}：屋里没人，灯却亮着`);
  }

  private pickPatrolRoom(): { room: RoomId; why: string } {
    const w = this.w;
    const here = w.roomOfAgent(this.a);
    let rooms = ROOM_IDS.filter((r) => r !== here || this.roomChecked[r] < w.t - 1800);
    if (!rooms.length) rooms = ROOM_IDS.slice();
    rooms.sort((p, q) => {
      const d = this.roomChecked[p] - this.roomChecked[q];
      if (d !== 0 && Number.isFinite(d)) return d;
      if (!Number.isFinite(this.roomChecked[p]) && Number.isFinite(this.roomChecked[q])) return -1;
      if (Number.isFinite(this.roomChecked[p]) && !Number.isFinite(this.roomChecked[q])) return 1;
      const lp = this.w.map.lookouts[p][0];
      const lq = this.w.map.lookouts[q][0];
      return dist(lp, this.a) - dist(lq, this.a);
    });
    const r = rooms[0];
    const last = this.roomChecked[r];
    return { room: r, why: `${ROOM_NAME[r]}最久没检查（上次：${Number.isFinite(last) ? hm(last) : '从未检查'}）` };
  }

  private doPatrol() {
    const w = this.w;
    const P = this.patrol;
    if (!P.room) {
      let pick: { room: RoomId; why: string };
      if (this.patrolResume) {
        pick = { room: this.patrolResume, why: `处理完任务，继续之前的巡视（${ROOM_NAME[this.patrolResume]}）` };
        this.patrolResume = null;
      } else pick = this.pickPatrolRoom();
      P.room = pick.room;
      P.why = pick.why;
      P.order = this.orderPatrol(pick.room);
      P.idx = 0;
      P.since = w.t;
      P.scanUntil = 0;
    }
    this.doing = `巡视${ROOM_NAME[P.room]}`;
    this.because = P.why;
    const pt = P.order[P.idx];
    if (!pt) {
      P.room = null;
      return;
    }
    if (this.arrived(pt)) {
      this.a.path = [];
      if (!P.scanUntil) P.scanUntil = w.t + 30;
      this.next = `在巡视点 (${pt.x},${pt.y}) 环顾四周（${P.idx + 1}/${P.order.length}）`;
      if (w.t >= P.scanUntil) {
        P.idx++;
        P.scanUntil = 0;
        if (P.idx >= P.order.length) {
          // 每个巡视点都走到了，才算巡视完这个房间
          this.roomChecked[P.room] = w.t;
          w.emit('robot', `小暖巡视完${ROOM_NAME[P.room]}（走遍 ${P.order.length} 个巡视点）`, 'robot');
          P.room = null;
        }
      }
      return;
    }
    this.goTo(pt, `下一站：${ROOM_NAME[P.room]}巡视点 ${P.idx + 1}/${P.order.length}`);
  }

  /* ---------------- 执行任务 ---------------- */

  private execTask(task: Task) {
    const w = this.w;
    if (task.status === 'due') {
      task.status = 'active';
      task.attemptStart = w.t;
      task.lookIdx = 0;
      logTask(task, w.t, '开始执行');
      w.emit('task', `小暖开始执行「${task.title}」`, 'robot', { taskId: task.id });
    }
    if (task.spec.action === 'remind') this.execRemind(task);
    else this.execRoomTask(task);
  }

  private finish(task: Task, text: string) {
    const w = this.w;
    task.status = 'done';
    task.doneAt = w.t;
    task.doneDay = w.day;
    task.search = undefined;
    logTask(task, w.t, `完成：${text}`);
    w.emit('task', `✅ 完成「${task.title}」：${text}`, 'robot', { taskId: task.id, done: true });
    this.currentTaskId = null;
    this.dest = null;
  }

  private postpone(task: Task, text: string, delay = RETRY_SEC) {
    const w = this.w;
    task.status = 'waiting';
    task.retryAt = w.t + delay;
    task.search = undefined;
    logTask(task, w.t, `${text}，${hm(task.retryAt)} 再来`);
    w.emit('task', `⏳「${task.title}」暂缓：${text}，${hm(task.retryAt)} 再检查`, 'robot', { taskId: task.id });
    this.currentTaskId = null;
    this.dest = null;
  }

  private buildCandidates(target: AgentId): SearchCandidate[] {
    const w = this.w;
    const out: SearchCandidate[] = [];
    const last = this.stm.latest(target);
    if (last && last.room) out.push({ room: last.room, pos: last.pos, why: `短期记忆「${last.text}」` });
    for (const h of this.ltm.habitsOf(target)) {
      if (h.room && !out.some((c) => c.room === h.room)) out.push({ room: h.room, why: `长期记忆「${h.text}」` });
    }
    const rest = ROOM_IDS.filter((r) => !out.some((c) => c.room === r)).sort((p, q) => this.roomChecked[p] - this.roomChecked[q]);
    for (const r of rest) out.push({ room: r, why: '常去的地方都没找到，逐个检查其余房间' });
    void w;
    return out;
  }

  private execRemind(task: Task) {
    const w = this.w;
    const a = this.a;
    const target = w.agents[task.spec.target!];
    const name = target.name;
    if (this.sees(target.id)) {
      const room = w.roomOfAgent(target);
      if (dist(a, target) <= 2.3 && w.canTalk(a, target)) {
        const lunch = task.spec.trigger.type === 'event' ? '午饭吃完啦，' : '到时间啦，';
        const text = `${name}，${lunch}记得${task.spec.message}哦。`;
        a.path = [];
        w.speak(a, text, target.id);
        if (!target.controlled && !target.sleeping && target.convId === null) w.startConversation(a, target, 2, text);
        this.finish(task, `在${room ? ROOM_NAME[room] : '门口'}见到${name}并说出提醒`);
        return;
      }
      this.doing = `走向${name}（${task.title}）`;
      this.because = `任务#${task.id}「${task.title}」· 现在看见${name}在${room ? ROOM_NAME[room] : '门口'}`;
      const p = w.map.bfs(a, (x, y) => w.map.isWalkable(x, y) && Math.hypot(x - target.x, y - target.y) <= 2 && !w.agentAt(x, y, a) && w.map.los(x, y, target.x, target.y));
      a.path = p ?? [];
      this.dest = p && p.length ? p[p.length - 1] : null;
      this.next = `${name}身边 (${target.x},${target.y})`;
      return;
    }
    if (!task.search) {
      const cands = this.buildCandidates(target.id);
      task.search = { candidates: cands, idx: 0, since: w.t, rounds: 0, atPos: false };
      logTask(task, w.t, `先去${ROOM_NAME[cands[0].room]}找${name}（依据：${cands[0].why}）`);
      w.emit('robot', `小暖要找${name}：先去${ROOM_NAME[cands[0].room]}${cands[0].pos ? `(${cands[0].pos.x},${cands[0].pos.y})` : ''}，依据${cands[0].why}`, 'robot', {
        taskId: task.id,
        firstRoom: cands[0].room,
      });
    }
    const S = task.search;
    let c = S.candidates[S.idx];
    if (!c) {
      S.rounds++;
      if (S.rounds >= 2) {
        this.postpone(task, `把家里找了两遍都没见到${name}`, 10 * 60);
        return;
      }
      S.candidates = this.buildCandidates(target.id);
      S.idx = 0;
      S.since = w.t;
      S.atPos = false;
      c = S.candidates[0];
    }
    this.doing = `寻找${name}（${task.title}）`;
    this.because = `任务#${task.id} 由「${task.spec.trigger.type === 'event' ? '午饭结束事件' : '到点'}」触发 · 搜索依据：${c.why}`;
    if (c.pos && !S.atPos) {
      const posVisible = this.visible.has(w.map.idx(c.pos.x, c.pos.y)) && dist(a, c.pos) <= 3;
      if (this.arrived(c.pos) || posVisible) {
        S.atPos = true;
        S.since = w.t;
        logTask(task, w.t, `到了最近一次见到${name}的位置 (${c.pos.x},${c.pos.y})，没看到人，检查整个${ROOM_NAME[c.room]}`);
      } else {
        this.goTo(c.pos, `最近见到${name}的位置`);
        return;
      }
    }
    if (this.coverage(c.room, S.since) >= COVERAGE_OK) {
      logTask(task, w.t, `${ROOM_NAME[c.room]}里没有${name}`);
      S.idx++;
      S.since = w.t;
      S.atPos = false;
      task.lookIdx = 0;
      const nx = S.candidates[S.idx];
      if (nx) {
        logTask(task, w.t, `继续去${ROOM_NAME[nx.room]}找（${nx.why}）`);
        w.emit('robot', `小暖在${ROOM_NAME[c.room]}没找到${name}，接着去${ROOM_NAME[nx.room]}`, 'robot');
      }
      return;
    }
    this.sweep(task, c.room, `检查${ROOM_NAME[c.room]}`);
  }

  /** 依次走到房间观察点，直到看清整个房间 */
  private sweep(task: Task, room: RoomId, label: string) {
    const pts = this.w.map.lookouts[room];
    const order = pts.slice().sort((p, q) => dist(p, this.a) - dist(q, this.a));
    let i = task.lookIdx ?? 0;
    const pt = i < pts.length ? pts[i] : order[0];
    if (this.arrived(pt)) {
      i++;
      task.lookIdx = i % pts.length;
      this.a.path = [];
      this.next = `在${ROOM_NAME[room]}观察点环顾`;
      return;
    }
    this.goTo(pt, `${label}：观察点`);
  }

  private deviceFor(task: Task): { fid: string; spot: Pt } | null {
    const w = this.w;
    const sp = task.spec;
    if (sp.action === 'light_off' || sp.action === 'light_on') {
      const l = w.map.lampOf[sp.room!];
      return l ? { fid: l.id, spot: l.spots[0] } : null;
    }
    if (sp.action === 'tv_off') return { fid: 'tv', spot: { x: 30, y: 19 } };
    if (sp.action === 'washer_start') return { fid: 'washer', spot: w.map.byId.get('washer')!.spots[0] };
    return null;
  }

  private targetReached(task: Task): boolean {
    const w = this.w;
    const sp = task.spec;
    switch (sp.action) {
      case 'light_off':
        return !w.lampOn(sp.room!);
      case 'light_on':
        return w.lampOn(sp.room!);
      case 'tv_off':
        return !w.fs.tv.on;
      case 'washer_start':
        return w.fs.washer.mode === 'running';
      default:
        return false;
    }
  }

  private execRoomTask(task: Task) {
    const w = this.w;
    const a = this.a;
    const sp = task.spec;
    const room = sp.room!;
    const rn = ROOM_NAME[room];
    const dev = this.deviceFor(task);
    if (!dev) {
      task.status = 'cancelled';
      logTask(task, w.t, '找不到对应的设备，取消');
      this.currentTaskId = null;
      return;
    }
    const since = task.attemptStart ?? w.t;
    const trig = task.spec.trigger.type === 'event' ? '午饭结束事件' : task.spec.trigger.type === 'time' ? `到点 ${task.spec.trigger.time}` : '立即执行';
    const req = task.requester ? `${w.agents[task.requester].name}的交代` : task.source === 'observation' ? '巡视时发现' : '预设';
    this.because = `任务#${task.id}「${task.title}」· 来源：${req} · 触发：${trig}`;

    if (sp.condition === 'room_empty') {
      const occ = this.occupantsSeen(room, Math.max(since, w.t - 120)).filter((id) => id !== 'robot');
      if (occ.length) {
        const names = occ.map((o) => w.agents[o].name).join('、');
        w.speak(a, `${rn}里有${names}，我待会儿再来看看。`);
        this.postpone(task, `${rn}里有${names}`);
        return;
      }
      const cov = this.coverage(room, since);
      if (cov < COVERAGE_OK) {
        this.doing = `前往${rn}，确认屋里有没有人`;
        this.sweep(task, room, `检查${rn}`);
        return;
      }
    }
    // 已确认（或无需确认）：检查设备状态
    const lightKnown = this.lightKnown[room];
    const observed = sp.action === 'light_off' || sp.action === 'light_on' ? !!lightKnown && lightKnown.t >= since : this.visible.has(w.map.idx(dev.spot.x, dev.spot.y));
    if (observed && this.targetReached(task)) {
      a.path = [];
      this.finish(task, sp.action === 'light_off' ? `${rn}没人，灯本来就是关着的` : '设备已经是目标状态');
      return;
    }
    if (this.arrived(dev.spot)) {
      a.path = [];
      const action = sp.action === 'light_off' ? 'light_off' : sp.action === 'light_on' ? 'light_on' : sp.action === 'tv_off' ? 'tv_off' : 'washer_start';
      w.applyToggle(a, dev.fid, action);
      let text = '';
      if (sp.action === 'light_off') text = sp.condition === 'room_empty' ? `确认${rn}灯亮着且屋内无人，已关灯` : `已关掉${rn}的灯`;
      else if (sp.action === 'light_on') text = `已打开${rn}的灯`;
      else if (sp.action === 'tv_off') text = '已关掉电视';
      else text = '洗衣机已启动';
      if (sp.action === 'light_off' && task.requester)
        this.ltm.upsert(
          {
            key: `pref:${task.requester}:light:${room}`,
            kind: 'preference',
            text: `${w.agents[task.requester].name}希望${rn}没人时关灯`,
            pinned: false,
            strength: 4,
          },
          w.t,
        );
      w.speak(a, sp.action === 'light_off' ? `${rn}没人，灯我关好啦。` : '办好啦。');
      this.finish(task, text);
      return;
    }
    this.doing = sp.action === 'light_off' ? `去关${rn}的灯` : `去执行「${task.title}」`;
    this.goTo(dev.spot, sp.action.startsWith('light') ? `${rn}的灯开关` : rn);
  }

  /* ---------------- 听懂临时交代 ---------------- */

  hear(from: AgentId, text: string) {
    const w = this.w;
    const sp = w.agents[from];
    this.attendTo = from;
    this.attendUntil = Math.max(this.attendUntil, w.t + 120);
    const pc = this.pendingClarify;
    const previous = pc && pc.speaker === from && w.t - pc.t < 600 ? pc.text : undefined;
    this.parsing++;
    w.pendingLLM++;
    const req = {
      text,
      previous,
      speaker: from,
      speakerName: sp.name,
      time: w.clock,
      lunch: w.lunch.state === 'gathering' ? ('during' as const) : w.lunch.state === 'done' ? ('done' as const) : ('before' as const),
    };
    w.llm
      .parse(req)
      .then((result) => w.pushParse({ from, text, previous, result }))
      .catch(() => w.pushParse({ from, text, previous, result: ruleParse(req) }));
  }

  onParseResult(from: AgentId, text: string, previous: string | undefined, result: ParseResult) {
    const w = this.w;
    const a = this.a;
    this.parsing = Math.max(0, this.parsing - 1);
    const sp = w.agents[from];
    this.attendUntil = Math.max(this.attendUntil, w.t + 30);
    const merged = (previous ? previous + '。' : '') + text;
    if (sp.sleeping) return;
    if (result.kind === 'task') {
      const v = validateSpec(result.task, from, w.lunch.state === 'done');
      if (!v.ok) {
        this.pendingClarify = { speaker: from, text: merged, t: w.t };
        w.speak(a, v.question, from);
        w.emit('task', `小暖没法确定任务，当面追问${sp.name}：${v.question}`, 'robot');
        return;
      }
      const dup = this.todo.find(
        (t) =>
          t.status !== 'done' &&
          t.status !== 'cancelled' &&
          t.spec.action === v.spec.action &&
          t.spec.room === v.spec.room &&
          t.spec.target === v.spec.target,
      );
      if (dup) {
        w.speak(a, '这件事我已经记在待办里了。', from);
        this.pendingClarify = null;
        return;
      }
      this.pendingClarify = null;
      const task = this.addTask(v.spec, 'dialogue', from);
      logTask(task, w.t, `原话：「${merged}」`);
      if (v.note) logTask(task, w.t, v.note);
      const llmReply = result.reply && result.reply.length <= 60 && !v.note ? result.reply : undefined;
      w.speak(a, llmReply ?? confirmText(v.spec, from), from);
      if (dist(a, sp) > 8) w.emit('system', `（${sp.name}已经走远，不过小暖还是记下了任务）`);
      return;
    }
    if (result.kind === 'clarify') {
      this.pendingClarify = { speaker: from, text: merged, t: w.t };
      w.speak(a, result.question, from);
      w.emit('task', `小暖当面追问${sp.name}：${result.question}`, 'robot');
      return;
    }
    // 闲聊
    if (result.reply) w.speak(a, result.reply, from);
    else if (sp.convId === null && a.convId === null) w.startConversation(sp, a, 2, text);
  }
}

function trigText(task: Task): string {
  const tr = task.spec.trigger;
  if (tr.type === 'now') return '立即';
  if (tr.type === 'event') return '午饭结束后';
  return `${tr.time}`;
}
