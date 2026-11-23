import type { AgentId, Pt, RoomId } from './types';

export const W = 38;
export const H = 23;
/** 机器人视野半径（格） */
export const VISION_R = 7;
/** 计算巡视点时使用的较小半径：让巡视路线铺满整个房间（包括走廊两端） */
export const PATROL_R = 4;

export type FloorStyle = 'parquet' | 'carpet' | 'wood' | 'warm' | 'runner' | 'tile' | 'oak' | 'honey';

export interface RoomDef {
  id: RoomId;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floor: FloorStyle;
}

export const ROOMS: RoomDef[] = [
  { id: 'study', name: '书房', x0: 1, y0: 1, x1: 8, y1: 8, floor: 'parquet' },
  { id: 'kids', name: '儿童房', x0: 10, y0: 1, x1: 17, y1: 8, floor: 'carpet' },
  { id: 'master', name: '卧室', x0: 19, y0: 1, x1: 28, y1: 8, floor: 'wood' },
  { id: 'grandma', name: '奶奶房', x0: 30, y0: 1, x1: 36, y1: 8, floor: 'warm' },
  { id: 'corridor', name: '走廊', x0: 1, y0: 10, x1: 36, y1: 11, floor: 'runner' },
  { id: 'kitchen', name: '厨房', x0: 1, y0: 13, x1: 9, y1: 21, floor: 'tile' },
  { id: 'dining', name: '餐厅', x0: 11, y0: 13, x1: 20, y1: 21, floor: 'oak' },
  { id: 'living', name: '客厅', x0: 22, y0: 13, x1: 36, y1: 21, floor: 'honey' },
];

export const ROOM_NAME: Record<RoomId, string> = Object.fromEntries(ROOMS.map((r) => [r.id, r.name])) as Record<
  RoomId,
  string
>;

export const DOORS: Pt[] = [
  { x: 5, y: 9 },
  { x: 14, y: 9 },
  { x: 23, y: 9 },
  { x: 33, y: 9 },
  { x: 5, y: 12 },
  { x: 16, y: 12 },
  { x: 28, y: 12 },
  { x: 10, y: 17 },
  { x: 21, y: 17 },
];

export type FurnitureType =
  | 'computer'
  | 'bookshelf'
  | 'stove'
  | 'sink'
  | 'fridge'
  | 'counter'
  | 'washer'
  | 'table'
  | 'bed'
  | 'lamp'
  | 'tv'
  | 'sofa'
  | 'coffeetable'
  | 'armchair'
  | 'toybox'
  | 'desk'
  | 'wardrobe'
  | 'cabinet'
  | 'plant'
  | 'dock';

export interface FurnitureDef {
  id: string;
  type: FurnitureType;
  name: string;
  room: RoomId;
  cells: Pt[];
  /** 占地格阻挡移动 */
  solid: boolean;
  /** 占地格只能作为目的地进入（床、沙发、摇椅） */
  seat: boolean;
  /** 使用时角色所在的格子 */
  spots: Pt[];
  /** 与 spots 对应的专属使用者 */
  owners?: AgentId[];
  /** 灯的开关位置（墙上） */
  switchAt?: Pt;
  interactive: boolean;
}

type Opt = { solid?: boolean; seat?: boolean; spots?: [number, number][]; owners?: AgentId[]; sw?: [number, number] };

function F(id: string, type: FurnitureType, name: string, room: RoomId, cells: [number, number][], o: Opt = {}): FurnitureDef {
  return {
    id,
    type,
    name,
    room,
    cells: cells.map(([x, y]) => ({ x, y })),
    solid: !!o.solid,
    seat: !!o.seat,
    spots: (o.spots ?? []).map(([x, y]) => ({ x, y })),
    owners: o.owners,
    switchAt: o.sw ? { x: o.sw[0], y: o.sw[1] } : undefined,
    interactive: (o.spots ?? []).length > 0,
  };
}

function rect(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

export const FURNITURE: FurnitureDef[] = [
  // 书房
  F('computer', 'computer', '电脑', 'study', [[2, 1], [3, 1]], { solid: true, spots: [[2, 2]] }),
  F('bookshelf', 'bookshelf', '书架', 'study', [[6, 1], [7, 1], [8, 1]], { solid: true, spots: [[7, 2]] }),
  F('study_plant', 'plant', '绿植', 'study', [[1, 8]], { solid: true }),
  F('lamp_study', 'lamp', '书房灯', 'study', [[4, 4]], { spots: [[4, 8]], sw: [4, 9] }),
  // 儿童房
  F('toybox', 'toybox', '玩具箱', 'kids', [[10, 1], [11, 1]], { solid: true, spots: [[11, 2]] }),
  F('desk', 'desk', '小书桌', 'kids', [[10, 6], [10, 7]], { solid: true, spots: [[11, 6]] }),
  F('bed_kid', 'bed', '乐乐的床', 'kids', [[17, 1], [17, 2]], { seat: true, spots: [[17, 1]], owners: ['kid'] }),
  F('lamp_kids', 'lamp', '儿童房灯', 'kids', [[14, 4]], { spots: [[13, 8]], sw: [13, 9] }),
  // 卧室
  F('wardrobe', 'wardrobe', '衣柜', 'master', [[19, 1], [20, 1]], { solid: true }),
  F('bed_master', 'bed', '双人床', 'master', rect(24, 1, 25, 3), { seat: true, spots: [[24, 1], [25, 1]], owners: ['dad', 'mom'] }),
  F('master_plant', 'plant', '绿植', 'master', [[28, 8]], { solid: true }),
  F('lamp_master', 'lamp', '卧室灯', 'master', [[23, 5]], { spots: [[22, 8]], sw: [22, 9] }),
  // 奶奶房
  F('bed_grandma', 'bed', '奶奶的床', 'grandma', [[35, 1], [35, 2]], { seat: true, spots: [[35, 1]], owners: ['grandma'] }),
  F('cabinet', 'cabinet', '五斗柜', 'grandma', [[30, 1]], { solid: true }),
  F('lamp_grandma', 'lamp', '奶奶房灯', 'grandma', [[33, 4]], { spots: [[32, 8]], sw: [32, 9] }),
  // 走廊
  F('dock', 'dock', '充电座', 'corridor', [[36, 10]], { spots: [[36, 10]] }),
  F('lamp_corridor', 'lamp', '走廊灯', 'corridor', [[18, 10]], { spots: [[18, 11]], sw: [18, 12] }),
  // 厨房
  F('stove', 'stove', '灶台', 'kitchen', [[1, 13], [2, 13]], { solid: true, spots: [[2, 14]] }),
  F('sink', 'sink', '水槽', 'kitchen', [[3, 13]], { solid: true, spots: [[3, 14]] }),
  F('fridge', 'fridge', '冰箱', 'kitchen', [[9, 13]], { solid: true }),
  F('counter', 'counter', '操作台', 'kitchen', [[1, 17], [1, 18], [1, 19]], { solid: true }),
  F('washer', 'washer', '洗衣机', 'kitchen', [[8, 21]], { solid: true, spots: [[8, 20]] }),
  F('lamp_kitchen', 'lamp', '厨房灯', 'kitchen', [[5, 17]], { spots: [[4, 13]], sw: [4, 12] }),
  // 餐厅
  F('table', 'table', '餐桌', 'dining', rect(13, 16, 18, 18), {
    solid: true,
    spots: [[14, 15], [17, 15], [14, 19], [17, 19]],
    owners: ['dad', 'mom', 'grandma', 'kid'],
  }),
  F('sideboard', 'cabinet', '餐边柜', 'dining', [[11, 13], [12, 13]], { solid: true }),
  F('lamp_dining', 'lamp', '餐厅灯', 'dining', [[15, 17]], { spots: [[15, 13]], sw: [15, 12] }),
  // 客厅
  F('tv', 'tv', '电视', 'living', [[29, 21], [30, 21], [31, 21]], { solid: true, spots: [[29, 18], [30, 18], [31, 18]] }),
  F('sofa', 'sofa', '沙发', 'living', [[29, 18], [30, 18], [31, 18]], { seat: true, spots: [[29, 18], [30, 18], [31, 18]] }),
  F('coffee', 'coffeetable', '茶几', 'living', [[29, 20], [30, 20], [31, 20]], { solid: true }),
  F('rocker', 'armchair', '摇椅', 'living', [[24, 14]], { seat: true, spots: [[24, 14]], owners: ['grandma'] }),
  F('living_plant', 'plant', '绿植', 'living', [[36, 13]], { solid: true }),
  F('living_plant2', 'plant', '绿植', 'living', [[22, 21]], { solid: true }),
  F('lamp_living', 'lamp', '客厅灯', 'living', [[29, 15]], { spots: [[27, 13]], sw: [27, 12] }),
];

export const CELL_WALL = 0;
export const CELL_FLOOR = 1;
export const CELL_DOOR = 2;

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class HouseMap {
  readonly w = W;
  readonly h = H;
  readonly kind = new Uint8Array(W * H);
  readonly roomOf: (RoomId | null)[] = new Array(W * H).fill(null);
  /** 0 不可走；1 可走；2 只能作为目的地 */
  readonly walk = new Uint8Array(W * H);
  readonly furnAt: (FurnitureDef | null)[] = new Array(W * H).fill(null);
  readonly furniture = FURNITURE;
  readonly byId = new Map<string, FurnitureDef>();
  readonly lampOf: Partial<Record<RoomId, FurnitureDef>> = {};
  /** 房间内人可能出现的格子 */
  readonly roomCells: Record<RoomId, number[]>;
  /** 每个房间的观察点（静态地图上预先计算，用于执行任务时快速看清房间） */
  readonly lookouts: Record<RoomId, Pt[]>;
  /** 每个房间的巡视点：更密，巡视时要逐个走到 */
  readonly patrolPoints: Record<RoomId, Pt[]>;
  readonly rooms = ROOMS;

  constructor() {
    for (const r of ROOMS) {
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) {
          const i = this.idx(x, y);
          this.kind[i] = CELL_FLOOR;
          this.roomOf[i] = r.id;
          this.walk[i] = 1;
        }
    }
    for (const d of DOORS) {
      const i = this.idx(d.x, d.y);
      this.kind[i] = CELL_DOOR;
      this.walk[i] = 1;
    }
    for (const f of FURNITURE) {
      this.byId.set(f.id, f);
      if (f.type === 'lamp') {
        this.lampOf[f.room] = f;
        continue;
      }
      for (const c of f.cells) {
        const i = this.idx(c.x, c.y);
        this.furnAt[i] = f;
        if (f.solid) this.walk[i] = 0;
        else if (f.seat) this.walk[i] = 2;
      }
    }
    const rc = {} as Record<RoomId, number[]>;
    for (const r of ROOMS) rc[r.id] = [];
    for (let i = 0; i < W * H; i++) {
      const r = this.roomOf[i];
      if (r && this.walk[i] > 0) rc[r].push(i);
    }
    this.roomCells = rc;
    this.lookouts = {} as Record<RoomId, Pt[]>;
    this.patrolPoints = {} as Record<RoomId, Pt[]>;
    for (const r of ROOMS) {
      this.lookouts[r.id] = this.computeLookouts(r, VISION_R, 0.97, 4);
      this.patrolPoints[r.id] = this.computePatrolPoints(r);
    }
  }

  idx(x: number, y: number): number {
    return y * W + x;
  }
  pt(i: number): Pt {
    return { x: i % W, y: Math.floor(i / W) };
  }
  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < W && y < H;
  }
  isWall(x: number, y: number): boolean {
    return !this.inb(x, y) || this.kind[this.idx(x, y)] === CELL_WALL;
  }
  roomAt(x: number, y: number): RoomId | null {
    return this.inb(x, y) ? this.roomOf[this.idx(x, y)] : null;
  }
  isWalkable(x: number, y: number): boolean {
    return this.inb(x, y) && this.walk[this.idx(x, y)] === 1;
  }
  isEnterable(x: number, y: number): boolean {
    return this.inb(x, y) && this.walk[this.idx(x, y)] > 0;
  }
  room(id: RoomId): RoomDef {
    return ROOMS.find((r) => r.id === id)!;
  }
  furnitureAt(x: number, y: number): FurnitureDef | null {
    if (!this.inb(x, y)) return null;
    const f = this.furnAt[this.idx(x, y)];
    if (f) return f;
    for (const l of Object.values(this.lampOf)) {
      if (!l) continue;
      if ((l.cells[0].x === x && l.cells[0].y === y) || (l.switchAt && l.switchAt.x === x && l.switchAt.y === y)) return l;
    }
    return null;
  }

  /** 视线检测：墙阻挡，门洞和家具不阻挡 */
  los(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (!(x === x1 && y === y1)) {
      const e2 = 2 * err;
      let nx = x;
      let ny = y;
      if (e2 > -dy) {
        err -= dy;
        nx += sx;
      }
      if (e2 < dx) {
        err += dx;
        ny += sy;
      }
      if (nx !== x && ny !== y && this.isWall(nx, y) && this.isWall(x, ny)) return false;
      x = nx;
      y = ny;
      if (x === x1 && y === y1) break;
      if (this.isWall(x, y)) return false;
    }
    return true;
  }

  /** 从某点出发、在半径内且不被墙遮挡的格子 */
  visibleFrom(from: Pt, r = VISION_R): number[] {
    const out: number[] = [];
    const r2 = r * r;
    const R = Math.ceil(r);
    for (let y = from.y - R; y <= from.y + R; y++)
      for (let x = from.x - R; x <= from.x + R; x++) {
        if (!this.inb(x, y)) continue;
        const d2 = (x - from.x) ** 2 + (y - from.y) ** 2;
        if (d2 > r2) continue;
        if (this.los(from.x, from.y, x, y)) out.push(this.idx(x, y));
      }
    return out;
  }

  /**
   * 四方向 BFS。goal 可以是坐标或判定函数。
   * blocked 用于临时把其他角色当作障碍（不作用于目标格）。
   * 返回不含起点、含终点的路径；起点即目标返回 []；不可达返回 null。
   */
  bfs(from: Pt, goal: Pt | ((x: number, y: number) => boolean), blocked?: (x: number, y: number) => boolean): Pt[] | null {
    const isGoal = typeof goal === 'function' ? goal : (x: number, y: number) => x === goal.x && y === goal.y;
    if (isGoal(from.x, from.y)) return [];
    const N = W * H;
    const prev = new Int32Array(N).fill(-1);
    const start = this.idx(from.x, from.y);
    prev[start] = start;
    const q = new Int32Array(N);
    let qh = 0;
    let qt = 0;
    q[qt++] = start;
    while (qh < qt) {
      const ci = q[qh++];
      const cx = ci % W;
      const cy = (ci - cx) / W;
      for (const [ddx, ddy] of DIRS) {
        const nx = cx + ddx;
        const ny = cy + ddy;
        if (!this.inb(nx, ny)) continue;
        const ni = ny * W + nx;
        if (prev[ni] !== -1) continue;
        const wv = this.walk[ni];
        if (wv === 0) continue;
        const g = isGoal(nx, ny);
        if (wv === 2 && !g) continue;
        if (!g && blocked && blocked(nx, ny)) continue;
        prev[ni] = ci;
        if (g) {
          const path: Pt[] = [];
          let k = ni;
          while (k !== start) {
            path.push(this.pt(k));
            k = prev[k];
          }
          return path.reverse();
        }
        q[qt++] = ni;
      }
    }
    return null;
  }

  /** 巡视点：小半径全覆盖；狭长房间（走廊）额外加上两端 */
  private computePatrolPoints(r: RoomDef): Pt[] {
    const pts = this.computeLookouts(r, PATROL_R, 1, 8);
    const w = r.x1 - r.x0 + 1;
    const h = r.y1 - r.y0 + 1;
    if (w >= h * 3 || h >= w * 3) {
      const horizontal = w >= h;
      const cy = Math.floor((r.y0 + r.y1) / 2);
      const cx = Math.floor((r.x0 + r.x1) / 2);
      const ends: Pt[] = horizontal
        ? [
            { x: r.x0, y: cy },
            { x: r.x1, y: cy },
          ]
        : [
            { x: cx, y: r.y0 },
            { x: cx, y: r.y1 },
          ];
      for (const e of ends) {
        // 选端点附近最靠墙的可走格子
        const cands = this.roomCells[r.id]
          .filter((i) => this.walk[i] === 1)
          .map((i) => this.pt(i))
          .sort((p, q) => Math.abs(p.x - e.x) + Math.abs(p.y - e.y) - (Math.abs(q.x - e.x) + Math.abs(q.y - e.y)));
        const c = cands[0];
        if (c && !pts.some((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) <= 1)) pts.push(c);
      }
    }
    return pts;
  }

  private computeLookouts(r: RoomDef, radius: number, target: number, maxPoints: number): Pt[] {
    // 不把家具的使用位置（座位、开关前等）当作观察点，免得机器人挡住家人
    const spots = new Set(this.furniture.flatMap((f) => f.spots.map((p) => this.idx(p.x, p.y))));
    let candidates = this.roomCells[r.id].filter((i) => this.walk[i] === 1 && !spots.has(i));
    if (!candidates.length) candidates = this.roomCells[r.id].filter((i) => this.walk[i] === 1);
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const vis = new Map<number, number[]>();
    const want = new Set(this.roomCells[r.id]);
    for (const c of candidates) vis.set(c, this.visibleFrom(this.pt(c), radius).filter((i) => want.has(i)));
    const covered = new Set<number>();
    const points: Pt[] = [];
    while (covered.size < want.size * target && points.length < maxPoints) {
      let best = -1;
      let bestScore = -1;
      for (const c of candidates) {
        const p = this.pt(c);
        let gain = 0;
        for (const i of vis.get(c)!) if (!covered.has(i)) gain++;
        const score = gain - 0.01 * Math.hypot(p.x - cx, p.y - cy);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best < 0 || bestScore <= 0) break;
      for (const i of vis.get(best)!) covered.add(i);
      points.push(this.pt(best));
    }
    return points;
  }
}
