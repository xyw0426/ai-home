import type { AgentId, Pt, RoomId } from './types';

/**
 * 房屋平面：参照一张竖版户型图重新设计，36×45 格。
 * 上方是种满绿植的阳台；左列是爸爸的工作室、餐厅（与客厅相通，餐桌下面一排咖啡机）、厨房、乐乐的房间；
 * 中间是大客厅；右列从上到下是主卧、奶奶房、浴室、影音室；影音室左边是储物间（机器人充电座）；底部是玄关走廊。
 * 只需定义房间矩形和门，墙由程序自动生成，房子外面是“室外”空地。
 */
export const W = 36;
export const H = 45;
/** 机器人视野半径（格） */
export const VISION_R = 7;
/** 计算巡视点时使用的较小半径：让巡视路线铺满整个房间（包括走廊两端） */
export const PATROL_R = 4;

export type FloorStyle = 'parquet' | 'carpet' | 'wood' | 'warm' | 'runner' | 'tile' | 'oak' | 'honey' | 'deck' | 'aqua' | 'plain' | 'rose';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RoomDef extends Rect {
  id: RoomId;
  name: string;
  floor: FloorStyle;
  /** 房间由一个或多个矩形组成；x0..y1 是第一个（主）矩形 */
  rects: Rect[];
}

function room(id: RoomId, name: string, floor: FloorStyle, ...rects: [number, number, number, number][]): RoomDef {
  const rs = rects.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 }));
  return { id, name, floor, rects: rs, ...rs[0] };
}

export const ROOMS: RoomDef[] = [
  room('balcony', '阳台', 'deck', [10, 1, 23, 4]),
  room('study', '工作室', 'parquet', [1, 6, 9, 15]),
  room('dining', '餐厅', 'oak', [1, 17, 9, 26]),
  room('kitchen', '厨房', 'tile', [1, 28, 9, 33]),
  room('kids', '乐乐的房间', 'carpet', [1, 35, 9, 43]),
  room('living', '客厅', 'honey', [11, 6, 22, 33], [10, 17, 10, 26], [11, 34, 15, 41]),
  room('master', '主卧', 'wood', [24, 6, 34, 15]),
  room('grandma', '奶奶房', 'warm', [24, 17, 34, 22]),
  room('bathroom', '浴室', 'aqua', [24, 24, 34, 29]),
  room('theater', '影音室', 'rose', [24, 31, 34, 40]),
  room('storage', '储物间', 'plain', [17, 35, 22, 40]),
  room('corridor', '玄关走廊', 'runner', [11, 42, 34, 43]),
];

export const ROOM_NAME: Record<RoomId, string> = Object.fromEntries(ROOMS.map((r) => [r.id, r.name])) as Record<
  RoomId,
  string
>;

export const DOORS: Pt[] = [
  // 阳台推拉门
  { x: 12, y: 5 },
  { x: 13, y: 5 },
  { x: 20, y: 5 },
  { x: 21, y: 5 },
  { x: 8, y: 16 }, // 书房—餐厅
  { x: 8, y: 27 }, // 厨房—餐厅
  { x: 10, y: 38 }, // 儿童房—客厅
  { x: 23, y: 8 }, // 主卧—客厅
  { x: 23, y: 21 }, // 奶奶房—客厅
  { x: 25, y: 23 }, // 奶奶房—浴室
  { x: 23, y: 27 }, // 浴室—客厅
  { x: 23, y: 32 }, // 影音室—客厅
  { x: 23, y: 38 }, // 影音室—储物间
  { x: 16, y: 38 }, // 储物间—客厅
];

/** 只用于绘制的墙面/地面装饰 */
export const WALL_DECOR: { type: 'clock' | 'board' | 'window' | 'frontdoor' | 'mat' | 'painting'; x: number; y: number; w?: number }[] = [
  { type: 'clock', x: 4, y: 5 },
  { type: 'board', x: 6, y: 5, w: 2 },
  { type: 'window', x: 2, y: 27, w: 3 },
  { type: 'window', x: 27, y: 5, w: 5 },
  { type: 'window', x: 0, y: 20, w: 1 },
  { type: 'window', x: 35, y: 25, w: 1 },
  { type: 'painting', x: 3, y: 16, w: 2 },
  { type: 'frontdoor', x: 33, y: 44, w: 2 },
  { type: 'mat', x: 33, y: 43, w: 2 },
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
  | 'dock'
  | 'plants'
  | 'rattan'
  | 'teatable'
  | 'rack'
  | 'coffee'
  | 'microwave'
  | 'nightstand'
  | 'piano'
  | 'stool'
  | 'basin'
  | 'toilet'
  | 'bathtub'
  | 'shower'
  | 'mirror'
  | 'radio'
  | 'shelf'
  | 'boxes'
  | 'shoecab'
  | 'floorlamp'
  | 'vanity';

export interface FurnitureDef {
  id: string;
  type: FurnitureType;
  name: string;
  room: RoomId;
  cells: Pt[];
  /** 占地格阻挡移动 */
  solid: boolean;
  /** 占地格只能作为目的地进入（床、沙发、椅子、浴缸） */
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

const TABLE_SEATS: [number, number][] = [
  [4, 18],
  [6, 18],
  [4, 21],
  [6, 21],
  [3, 18],
  [5, 18],
  [7, 18],
  [8, 18],
  [3, 21],
  [5, 21],
  [7, 21],
  [8, 21],
];

export const FURNITURE: FurnitureDef[] = [
  // 阳台：四组盆栽，每组单独计算水分
  F('planter_l', 'plants', '左边的盆栽', 'balcony', [[10, 1], [11, 1], [12, 1], [10, 2]], { solid: true, spots: [[11, 2]] }),
  F('planter_r', 'plants', '右边的盆栽', 'balcony', [[21, 1], [22, 1], [23, 1], [23, 2]], { solid: true, spots: [[22, 2]] }),
  F('planter_bl', 'plants', '门边的盆栽', 'balcony', [[10, 4], [11, 4]], { solid: true, spots: [[11, 3]] }),
  F('planter_br', 'plants', '龟背竹和花盆', 'balcony', [[22, 4], [23, 4], [23, 3]], { solid: true, spots: [[22, 3]] }),
  F('rattan', 'rattan', '藤椅', 'balcony', [[15, 2], [18, 2]], { seat: true, spots: [[15, 2], [18, 2]] }),
  F('balcony_table', 'teatable', '小茶桌', 'balcony', [[16, 2], [17, 2]], { solid: true }),
  F('rack', 'rack', '晾衣架', 'balcony', [[16, 4], [17, 4]], { solid: true }),
  F('lamp_balcony', 'lamp', '阳台灯', 'balcony', [[17, 3]], { spots: [[14, 4]], sw: [14, 5] }),
  // 书房
  F('bookshelf', 'bookshelf', '书架', 'study', [[1, 6], [2, 6], [3, 6]], { solid: true, spots: [[2, 7]] }),
  F('computer', 'computer', '电脑', 'study', [[5, 8], [6, 8]], { solid: true, spots: [[5, 9]] }),
  F('study_chair', 'armchair', '阅读椅', 'study', [[3, 12]], { seat: true, spots: [[3, 12]] }),
  F('study_cabinet', 'cabinet', '文件柜', 'study', [[9, 11], [9, 12]], { solid: true }),
  F('study_plant', 'plant', '绿植', 'study', [[9, 6]], { solid: true }),
  F('lamp_study', 'lamp', '工作室灯', 'study', [[5, 11]], { spots: [[7, 15]], sw: [7, 16] }),
  // 餐厅
  F('table', 'table', '长餐桌', 'dining', rect(3, 19, 8, 20), {
    solid: true,
    spots: TABLE_SEATS,
    owners: ['dad', 'mom', 'grandma', 'kid'],
  }),
  F('coffee', 'coffee', '一排咖啡机', 'dining', [[1, 23], [2, 23], [3, 23], [4, 23], [5, 23], [6, 23]], { solid: true, spots: [[2, 24], [5, 24]] }),
  F('bar', 'counter', '水吧台', 'dining', [[1, 26], [2, 26], [3, 26], [4, 26], [5, 26], [6, 26]], { solid: true }),
  F('dining_plant', 'plant', '绿植', 'dining', [[1, 17]], { solid: true }),
  F('lamp_dining', 'lamp', '餐厅灯', 'dining', [[5, 20]], { spots: [[9, 17]], sw: [9, 16] }),
  // 厨房
  F('kitchen_counter', 'counter', '操作台', 'kitchen', [[1, 28], [2, 28], [3, 28], [4, 28]], { solid: true }),
  F('sink', 'sink', '水槽', 'kitchen', [[1, 30], [1, 31]], { solid: true, spots: [[2, 30]] }),
  F('stove', 'stove', '灶台', 'kitchen', [[3, 33], [4, 33]], { solid: true, spots: [[3, 32]] }),
  F('microwave', 'microwave', '微波炉台', 'kitchen', [[5, 33], [6, 33]], { solid: true }),
  F('fridge', 'fridge', '冰箱', 'kitchen', [[9, 32], [9, 33]], { solid: true, spots: [[8, 32]] }),
  F('kitchen_cab', 'cabinet', '橱柜', 'kitchen', [[9, 29], [9, 30]], { solid: true }),
  F('lamp_kitchen', 'lamp', '厨房灯', 'kitchen', [[5, 30]], { spots: [[7, 28]], sw: [7, 27] }),
  // 儿童房
  F('bed_kid', 'bed', '乐乐的床', 'kids', rect(2, 36, 3, 37), { seat: true, spots: [[2, 36]], owners: ['kid'] }),
  F('kid_nightstand', 'nightstand', '床头柜', 'kids', [[4, 35]], { solid: true }),
  F('kid_wardrobe', 'wardrobe', '小衣柜', 'kids', [[7, 35], [8, 35]], { solid: true }),
  F('desk', 'desk', '小书桌', 'kids', [[1, 42], [2, 42]], { solid: true, spots: [[2, 41]] }),
  F('toybox', 'toybox', '玩具箱', 'kids', [[6, 40], [7, 40]], { solid: true, spots: [[6, 41]] }),
  F('kid_lamp', 'floorlamp', '落地灯', 'kids', [[9, 43]], { solid: true }),
  F('lamp_kids', 'lamp', '儿童房灯', 'kids', [[5, 38]], { spots: [[9, 37]], sw: [10, 37] }),
  // 客厅
  F('living_plant', 'plant', '大绿植', 'living', [[11, 6]], { solid: true }),
  F('tv', 'tv', '电视', 'living', [[11, 9], [11, 10], [11, 11], [11, 12]], { solid: true, spots: [[20, 9], [20, 10], [20, 11], [20, 12]] }),
  F('sofa', 'sofa', '沙发', 'living', [[20, 9], [20, 10], [20, 11], [20, 12]], { seat: true, spots: [[20, 9], [20, 10], [20, 11], [20, 12]] }),
  F('coffee_table', 'coffeetable', '茶几', 'living', rect(15, 10, 16, 11), { solid: true }),
  F('living_floorlamp', 'floorlamp', '落地灯', 'living', [[21, 8]], { solid: true }),
  F('rocker', 'armchair', '摇椅', 'living', [[19, 14]], { seat: true, spots: [[19, 14]], owners: ['grandma'] }),
  F('piano', 'piano', '钢琴', 'living', rect(16, 20, 17, 21), { solid: true, spots: [[15, 21]] }),
  F('stools', 'stool', '小圆凳', 'living', [[13, 23], [15, 23], [17, 23]], { seat: true, spots: [[13, 23], [15, 23], [17, 23]] }),
  F('living_shelf', 'bookshelf', '书柜', 'living', [[22, 19], [22, 20], [22, 21], [22, 22]], { solid: true, spots: [[21, 20]] }),
  F('living_plant2', 'plant', '绿植', 'living', [[11, 30]], { solid: true }),
  F('lamp_living', 'lamp', '客厅灯', 'living', [[16, 15]], { spots: [[22, 7]], sw: [23, 7] }),
  // 主卧
  F('bed_master', 'bed', '双人床', 'master', rect(30, 7, 31, 9), { seat: true, spots: [[30, 7], [31, 7]], owners: ['dad', 'mom'] }),
  F('nightstand_l', 'nightstand', '床头柜', 'master', [[29, 7]], { solid: true }),
  F('nightstand_r', 'nightstand', '床头柜', 'master', [[32, 7]], { solid: true }),
  F('master_wardrobe', 'wardrobe', '衣柜', 'master', [[24, 6], [25, 6]], { solid: true }),
  F('vanity', 'vanity', '书桌', 'master', [[26, 13], [27, 13]], { solid: true }),
  F('mirror', 'mirror', '穿衣镜', 'master', [[24, 14]], { solid: true, spots: [[25, 14]] }),
  F('master_plant', 'plant', '绿植', 'master', [[34, 6]], { solid: true }),
  F('lamp_master', 'lamp', '主卧灯', 'master', [[29, 11]], { spots: [[24, 9]], sw: [23, 9] }),
  // 奶奶房
  F('grandma_wardrobe', 'wardrobe', '衣柜', 'grandma', [[24, 17], [24, 18], [24, 19]], { solid: true }),
  F('grandma_shelf', 'cabinet', '置物架', 'grandma', [[27, 17], [28, 17], [29, 17], [30, 17]], { solid: true }),
  F('bed_grandma', 'bed', '奶奶的床', 'grandma', rect(33, 18, 34, 19), { seat: true, spots: [[33, 18]], owners: ['grandma'] }),
  F('grandma_plant', 'plant', '绿植', 'grandma', [[34, 17]], { solid: true }),
  F('radio', 'radio', '收音机', 'grandma', [[30, 22]], { solid: true, spots: [[30, 21]] }),
  F('grandma_cab', 'cabinet', '五斗柜', 'grandma', [[26, 22], [27, 22], [28, 22]], { solid: true }),
  F('grandma_vanity', 'vanity', '梳妆台', 'grandma', [[34, 21]], { solid: true }),
  F('lamp_grandma', 'lamp', '奶奶房灯', 'grandma', [[29, 19]], { spots: [[24, 22]], sw: [23, 22] }),
  // 浴室
  F('basin', 'basin', '洗手台', 'bathroom', [[27, 24], [28, 24]], { solid: true, spots: [[27, 25]] }),
  F('toilet', 'toilet', '马桶', 'bathroom', [[34, 24]], { solid: true }),
  F('bathtub', 'bathtub', '浴缸', 'bathroom', rect(32, 28, 34, 29), { seat: true, spots: [[33, 28]] }),
  F('shower', 'shower', '淋浴间', 'bathroom', [[24, 29], [25, 29]], { solid: true }),
  F('washer', 'washer', '洗衣机', 'bathroom', [[28, 29]], { solid: true, spots: [[28, 28]] }),
  F('lamp_bathroom', 'lamp', '浴室灯', 'bathroom', [[29, 26]], { spots: [[24, 26]], sw: [23, 26] }),
  // 影音室
  F('theater_tv', 'tv', '大电视', 'theater', [[34, 33], [34, 34], [34, 35], [34, 36]], { solid: true, spots: [[27, 33], [27, 34], [27, 35], [27, 36]] }),
  F('theater_sofa', 'sofa', '影音室沙发', 'theater', [[27, 33], [27, 34], [27, 35], [27, 36]], { seat: true, spots: [[27, 33], [27, 34], [27, 35], [27, 36]] }),
  F('theater_table', 'teatable', '圆茶几', 'theater', [[30, 35]], { solid: true }),
  F('theater_chairs', 'rattan', '小圆椅', 'theater', [[29, 31], [31, 31]], { seat: true, spots: [[29, 31], [31, 31]] }),
  F('theater_shelf', 'cabinet', '碟片柜', 'theater', [[33, 31], [34, 31]], { solid: true }),
  F('theater_plant', 'plant', '绿植', 'theater', [[25, 40]], { solid: true }),
  F('theater_plant2', 'plant', '绿植', 'theater', [[34, 40]], { solid: true }),
  F('lamp_theater', 'lamp', '影音室灯', 'theater', [[30, 38]], { spots: [[24, 33]], sw: [23, 33] }),
  // 储物间
  F('storage_shelf', 'shelf', '储物架', 'storage', [[19, 35], [20, 35], [21, 35]], { solid: true }),
  F('boxes', 'boxes', '纸箱', 'storage', [[17, 35]], { solid: true }),
  F('cleaning_cart', 'boxes', '清洁车', 'storage', [[22, 40]], { solid: true }),
  F('dock', 'dock', '充电座', 'storage', [[18, 40]], { spots: [[18, 40]] }),
  F('lamp_storage', 'lamp', '储物间灯', 'storage', [[19, 37]], { spots: [[17, 37]], sw: [16, 37] }),
  // 玄关走廊
  F('shoecab', 'shoecab', '鞋柜', 'corridor', [[17, 43], [18, 43], [19, 43], [20, 43]], { solid: true }),
  F('coat_rack', 'rack', '衣帽架', 'corridor', [[11, 43]], { solid: true }),
  F('lamp_corridor', 'lamp', '走廊灯', 'corridor', [[27, 42]], { spots: [[13, 43]], sw: [13, 44] }),
];

/** 某件家具旁边第一个可走的格子（机器人操作它时站的位置） */
export function frontOf(map: HouseMap, f: FurnitureDef): Pt | null {
  for (const c of f.cells)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (map.isWalkable(x, y) && !map.furnAt[map.idx(x, y)]) return { x, y };
    }
  return null;
}

export const CELL_WALL = 0;
export const CELL_FLOOR = 1;
export const CELL_DOOR = 2;
/** 房子外面（不可走、挡视线、不画墙） */
export const CELL_VOID = 3;

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
    this.kind.fill(CELL_VOID);
    for (const r of ROOMS)
      for (const rc of r.rects)
        for (let y = rc.y0; y <= rc.y1; y++)
          for (let x = rc.x0; x <= rc.x1; x++) {
            const i = this.idx(x, y);
            this.kind[i] = CELL_FLOOR;
            this.roomOf[i] = r.id;
            this.walk[i] = 1;
          }
    for (const d of DOORS) {
      const i = this.idx(d.x, d.y);
      this.kind[i] = CELL_DOOR;
      this.walk[i] = 1;
    }
    // 自动生成墙：紧挨着室内格子的空地都是墙
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = this.idx(x, y);
        if (this.kind[i] !== CELL_VOID) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!this.inb(nx, ny)) continue;
            const k = this.kind[this.idx(nx, ny)];
            if (k === CELL_FLOOR || k === CELL_DOOR) {
              near = true;
              break;
            }
          }
        if (near) this.kind[i] = CELL_WALL;
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
      this.lookouts[r.id] = this.computeLookouts(r, VISION_R, 0.97, 6);
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
  /** 墙或屋外：挡路也挡视线 */
  isWall(x: number, y: number): boolean {
    if (!this.inb(x, y)) return true;
    const k = this.kind[this.idx(x, y)];
    return k === CELL_WALL || k === CELL_VOID;
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
    const pts = this.computeLookouts(r, PATROL_R, 1, 14);
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
        const useSpots = new Set(this.furniture.filter((f) => f.type !== 'dock').flatMap((f) => f.spots.map((p) => this.idx(p.x, p.y))));
        const cands = this.roomCells[r.id]
          .filter((i) => this.walk[i] === 1 && !useSpots.has(i))
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
