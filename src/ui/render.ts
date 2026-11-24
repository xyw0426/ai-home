import { H, W, ROOMS, WALL_DECOR, type FloorStyle, type FurnitureDef, type RoomDef } from '../sim/map';
import { CELL_DOOR, CELL_FLOOR, CELL_VOID, CELL_WALL } from '../sim/map';
import type { Agent, World } from '../sim/world';
import { at, tod, type AgentId } from '../sim/types';

export const T = 26;
export const CANVAS_W = W * T;
export const CANVAS_H = H * T;

export interface RenderOpts {
  robotView: boolean;
  selected: AgentId | null;
  hover: { x: number; y: number } | null;
  alpha: number; // 插值 0..1
  now: number; // 毫秒，用于动画
  /** 需要闪烁高亮的格子（从家具状态窗口定位） */
  highlight?: { x: number; y: number }[];
}

type FloorKind = 'planks' | 'grid' | 'dots';
// 参照户型图：大部分房间是奶油色方砖，工作室是深色木地板，乐乐房间粉白方砖，浴室蓝色瓷砖，厨房白瓷砖
const FLOOR: Record<FloorStyle, { base: string; alt: string; kind: FloorKind }> = {
  parquet: { base: '#a86a3e', alt: '#93582f', kind: 'planks' },
  carpet: { base: '#fbf0ee', alt: '#f0dcd9', kind: 'grid' },
  wood: { base: '#fbeedd', alt: '#f0dbc0', kind: 'grid' },
  warm: { base: '#fbeedd', alt: '#f0dbc0', kind: 'grid' },
  runner: { base: '#f9ead6', alt: '#efd6b7', kind: 'grid' },
  tile: { base: '#fcfaf6', alt: '#ebe3d6', kind: 'grid' },
  oak: { base: '#fbeedd', alt: '#f0dbc0', kind: 'grid' },
  honey: { base: '#fbeedd', alt: '#f0dbc0', kind: 'grid' },
  deck: { base: '#fbeedd', alt: '#f0dbc0', kind: 'grid' },
  aqua: { base: '#bfd4ea', alt: '#e8f0f8', kind: 'grid' },
  plain: { base: '#f8ebd9', alt: '#ecd6b9', kind: 'grid' },
  rose: { base: '#fbeedd', alt: '#f0dbc0', kind: 'grid' },
};

const BLANKET: Record<string, string> = { bed_kid: '#e8a0a0', bed_master: '#8fb07f', bed_grandma: '#c3a9dc' };

/** 水分 → 叶子颜色：浇透是绿色，缺水慢慢变黄，干透带一点褐色 */
export function leafColor(water: number, shade = 0): string {
  const g = [106 - shade * 12, 168 - shade * 14, 79 - shade * 8];
  const y = [222, 188, 74];
  const b = [190, 140, 70];
  let c: number[];
  if (water >= 0.6) c = g;
  else if (water >= 0.35) {
    const k = (0.6 - water) / 0.25;
    c = g.map((v, i) => v + (y[i] - v) * k * 0.6);
  } else {
    const k = Math.min(1, (0.35 - water) / 0.35);
    c = y.map((v, i) => v + (b[i] - v) * k * 0.5);
  }
  return `rgb(${c.map((v) => Math.round(v)).join(',')})`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function bbox(f: FurnitureDef) {
  const xs = f.cells.map((c) => c.x);
  const ys = f.cells.map((c) => c.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0 * T, y: y0 * T, w: (Math.max(...xs) - x0 + 1) * T, h: (Math.max(...ys) - y0 + 1) * T };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function roomRectPx(r: RoomDef) {
  return r.rects.map((q) => ({ x: q.x0 * T, y: q.y0 * T, w: (q.x1 - q.x0 + 1) * T, h: (q.y1 - q.y0 + 1) * T }));
}

export function ambientDark(t: number): number {
  const s = tod(t);
  const MAX = 0.55;
  if (s < at(6, 0)) return MAX;
  if (s < at(7, 30)) return MAX * (1 - (s - at(6, 0)) / (at(7, 30) - at(6, 0)));
  if (s < at(17, 30)) return 0;
  if (s < at(19, 0)) return (MAX * (s - at(17, 30))) / (at(19, 0) - at(17, 30));
  return MAX;
}

const RUGS: [number, number, number, number, string, string][] = [
  [3, 11, 6, 14, '#a5543c', '#e0a27c'], // 工作室
  [14, 9, 17, 12, '#efe2c8', '#d8bf98'], // 客厅茶几
  [13, 19, 18, 24, '#e9d3aa', '#c9a271'], // 钢琴
  [4, 39, 8, 42, '#f6c9d3', '#fbe6eb'], // 乐乐的房间
  [28, 11, 33, 14, '#efe2c8', '#d8bf98'], // 主卧
  [28, 33, 32, 37, '#efe0c5', '#cfae84'], // 影音室
  [26, 26, 30, 27, '#cfe3d7', '#9fc3b0'], // 浴室地垫
];

export function drawWorld(ctx: CanvasRenderingContext2D, w: World, o: RenderOpts) {
  const m = w.map;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  // 屋外：白色
  ctx.fillStyle = '#fffdf9';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // 地板
  for (const r of ROOMS) {
    const st = FLOOR[r.floor];
    for (const q of r.rects)
      for (let y = q.y0; y <= q.y1; y++)
        for (let x = q.x0; x <= q.x1; x++) {
          const px = x * T;
          const py = y * T;
          ctx.fillStyle = st.base;
          ctx.fillRect(px, py, T, T);
          ctx.fillStyle = st.alt;
          if (st.kind === 'planks') {
            ctx.fillRect(px, py + T / 2 - 0.5, T, 1);
            ctx.fillRect(px + ((y % 2) * T) / 2, py, 1, T / 2);
            ctx.fillRect(px + (((y + 1) % 2) * T) / 2, py + T / 2, 1, T / 2);
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(px, py, T, 2);
          } else if (st.kind === 'grid') {
            // 方砖：每格一条细缝
            ctx.fillRect(px, py + T - 1, T, 1);
            ctx.fillRect(px + T - 1, py, 1, T);
          } else {
            dot(ctx, px + T / 2, py + T / 2, 2, st.alt);
          }
        }
  }
  // 地毯
  for (const [x0, y0, x1, y1, c1, c2] of RUGS) {
    ctx.fillStyle = c1;
    rr(ctx, x0 * T + 3, y0 * T + 3, (x1 - x0 + 1) * T - 6, (y1 - y0 + 1) * T - 6, 8);
    ctx.fill();
    ctx.strokeStyle = c2;
    ctx.lineWidth = 2;
    rr(ctx, x0 * T + 8, y0 * T + 8, (x1 - x0 + 1) * T - 16, (y1 - y0 + 1) * T - 16, 5);
    ctx.stroke();
    // 地毯中间的菱形花纹
    const cx = ((x0 + x1 + 1) / 2) * T;
    const cy = ((y0 + y1 + 1) / 2) * T;
    const rx = ((x1 - x0 + 1) * T) / 2 - 18;
    const ry = ((y1 - y0 + 1) * T) / 2 - 16;
    if (rx > 10 && ry > 10) {
      ctx.beginPath();
      ctx.moveTo(cx - rx, cy);
      ctx.lineTo(cx, cy - ry);
      ctx.lineTo(cx + rx, cy);
      ctx.lineTo(cx, cy + ry);
      ctx.closePath();
      ctx.stroke();
      dot(ctx, cx, cy, 3, c2);
    }
  }
  // 墙与门
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = m.kind[m.idx(x, y)];
      const px = x * T;
      const py = y * T;
      if (k === CELL_WALL) {
        // 浅橙色砖块墙
        ctx.fillStyle = '#f7d3ae';
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = '#fbe4cb';
        ctx.fillRect(px + 2, py + 2, T - 4, 3);
        ctx.strokeStyle = '#e6b385';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
        const below = m.kind[m.idx(x, Math.min(H - 1, y + 1))];
        if (y + 1 < H && (below === CELL_FLOOR || below === CELL_DOOR)) {
          ctx.fillStyle = '#ebbd92';
          ctx.fillRect(px, py + T - 3, T, 3);
        }
      } else if (k === CELL_DOOR) {
        const glass = y === 5; // 阳台推拉门
        ctx.fillStyle = glass ? '#d9e8ee' : '#ffffff';
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = glass ? '#6d6f73' : '#f0d2b2';
        const vertical = m.isWall(x - 1, y) || m.isWall(x + 1, y) ? false : true;
        if (!vertical) {
          ctx.fillRect(px, py + 2, 3, T - 4);
          ctx.fillRect(px + T - 3, py + 2, 3, T - 4);
        } else {
          ctx.fillRect(px + 2, py, T - 4, 3);
          ctx.fillRect(px + 2, py + T - 3, T - 4, 3);
        }
        if (glass) {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px + 6, py + T - 6);
          ctx.lineTo(px + T - 6, py + 6);
          ctx.stroke();
        }
      }
    }
  drawWallDecor(ctx);
  // 餐椅
  for (const s of m.byId.get('table')!.spots) {
    ctx.fillStyle = '#b8875a';
    rr(ctx, s.x * T + 5, s.y * T + 5, T - 10, T - 10, 4);
    ctx.fill();
  }
  // 钢琴凳
  const bench = m.byId.get('piano')!.spots[0];
  ctx.fillStyle = '#3a3030';
  rr(ctx, bench.x * T + 5, bench.y * T + 4, T - 10, T - 8, 3);
  ctx.fill();
  // 家具
  for (const f of m.furniture) drawFurniture(ctx, w, f, o.now);
  // 积木散落
  if (w.fs.toybox.users.length) {
    const cols = ['#e46b5d', '#f2b134', '#5fa8d3', '#6cbf7b'];
    [
      [5, 41],
      [5, 42],
      [7, 42],
    ].forEach(([x, y], i) => {
      ctx.fillStyle = cols[i % 4];
      ctx.fillRect(x * T + 5 + i * 3, y * T + 8, 8, 8);
      ctx.fillStyle = cols[(i + 1) % 4];
      ctx.fillRect(x * T + 13, y * T + 14 - i * 2, 7, 7);
    });
  }
  // 房间名
  ctx.font = '600 11px "PingFang SC","Microsoft YaHei",sans-serif';
  for (const r of ROOMS) {
    const label = r.name;
    const tw = ctx.measureText(label).width + 10;
    const lx = r.x1 * T + T - tw - 3;
    const ly = r.id === 'corridor' || r.id === 'balcony' ? r.y0 * T + 3 : r.y1 * T + T - 19;
    ctx.fillStyle = 'rgba(255,250,240,0.85)';
    rr(ctx, lx, ly, tw, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#6b513f';
    ctx.fillText(label, lx + 5, ly + 12);
  }

  // 夜色与灯光
  const dark = ambientDark(w.t);
  for (const r of ROOMS) {
    const on = w.lampOn(r.id);
    const a = on ? dark * 0.18 : dark;
    if (a > 0.01) {
      ctx.fillStyle = `rgba(22,26,58,${a})`;
      for (const q of roomRectPx(r)) ctx.fillRect(q.x, q.y, q.w, q.h);
    }
  }
  if (dark > 0.01) {
    ctx.fillStyle = `rgba(22,26,58,${dark * 0.6})`;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (m.kind[m.idx(x, y)] !== CELL_FLOOR) ctx.fillRect(x * T, y * T, T, T);
  }
  for (const r of ROOMS) {
    const l = m.lampOf[r.id];
    if (!l) continue;
    const on = w.fs[l.id].on;
    const cx = l.cells[0].x * T + T / 2;
    const cy = l.cells[0].y * T + T / 2;
    if (on) {
      ctx.save();
      ctx.beginPath();
      for (const q of roomRectPx(r)) ctx.rect(q.x, q.y, q.w, q.h);
      ctx.clip();
      const rad = T * (r.id === 'living' ? 8 : 5);
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
      g.addColorStop(0, `rgba(255,220,120,${0.38 + dark * 0.3})`);
      g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = on ? '#ffe28a' : '#bfb5a6';
    ctx.fill();
    ctx.strokeStyle = on ? '#e0a83c' : '#8e8476';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (l.switchAt) {
      const sx = l.switchAt.x * T + T / 2;
      const sy = l.switchAt.y * T + T / 2;
      ctx.fillStyle = '#f5efe4';
      rr(ctx, sx - 4, sy - 5, 8, 10, 2);
      ctx.fill();
      ctx.fillStyle = on ? '#f2b134' : '#8e8476';
      ctx.fillRect(sx - 1.5, sy - (on ? 3 : 0), 3, 3);
    }
  }

  // 机器人视角
  const rb = w.robot;
  if (o.robotView) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = m.idx(x, y);
        if (m.kind[i] === CELL_VOID) continue;
        if (rb.visible.has(i)) {
          ctx.fillStyle = 'rgba(255,233,140,0.30)';
          ctx.fillRect(x * T, y * T, T, T);
        } else {
          ctx.fillStyle = 'rgba(16,22,40,0.50)';
          ctx.fillRect(x * T, y * T, T, T);
        }
      }
    const r = w.agents.robot;
    ctx.strokeStyle = 'rgba(95,184,191,0.9)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(r.x * T + T / 2, r.y * T + T / 2, 7 * T, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 路径
  const drawPath = (a: Agent, color: string) => {
    if (!a.path.length) return;
    ctx.fillStyle = color;
    for (const p of a.path) {
      ctx.beginPath();
      ctx.arc(p.x * T + T / 2, p.y * T + T / 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const e = a.path[a.path.length - 1];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(e.x * T + 4, e.y * T + 4, T - 8, T - 8);
  };
  if (o.robotView || o.selected === 'robot') drawPath(w.agents.robot, 'rgba(47,140,150,0.85)');
  if (w.controlled) drawPath(w.controlled, 'rgba(76,160,90,0.9)');

  // 悬停
  if (o.hover) {
    const f = m.furnitureAt(o.hover.x, o.hover.y);
    ctx.strokeStyle = 'rgba(224,122,79,0.95)';
    ctx.lineWidth = 2;
    if (f) {
      const cells = f.type === 'lamp' ? [f.cells[0], ...(f.switchAt ? [f.switchAt] : [])] : f.cells;
      for (const c of cells) ctx.strokeRect(c.x * T + 1, c.y * T + 1, T - 2, T - 2);
    } else ctx.strokeRect(o.hover.x * T + 1, o.hover.y * T + 1, T - 2, T - 2);
  }

  // 定位高亮
  if (o.highlight?.length) {
    const pulse = 0.55 + 0.45 * Math.sin(o.now / 160);
    ctx.save();
    ctx.strokeStyle = `rgba(232,145,91,${pulse})`;
    ctx.fillStyle = `rgba(255,214,150,${0.25 * pulse})`;
    ctx.lineWidth = 3;
    for (const c of o.highlight) {
      rr(ctx, c.x * T - 2, c.y * T - 2, T + 4, T + 4, 6);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // 角色
  const pos = (a: Agent) => ({
    x: (a.px + (a.x - a.px) * o.alpha) * T + T / 2,
    y: (a.py + (a.y - a.py) * o.alpha) * T + T / 2,
  });
  const order = w.list.slice().sort((p, q) => p.y - q.y);
  for (const a of order) drawAgent(ctx, w, a, pos(a), o);
  // 气泡
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (const a of order) if (a.bubble) drawBubble(ctx, a, pos(a), placed);
}

function drawWallDecor(ctx: CanvasRenderingContext2D) {
  for (const d of WALL_DECOR) {
    const px = d.x * T;
    const py = d.y * T;
    const wd = (d.w ?? 1) * T;
    switch (d.type) {
      case 'clock':
        dot(ctx, px + T / 2, py + T / 2, 9, '#fffaf2');
        ctx.strokeStyle = '#6b513f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px + T / 2, py + T / 2, 9, 0, Math.PI * 2);
        ctx.moveTo(px + T / 2, py + T / 2);
        ctx.lineTo(px + T / 2, py + T / 2 - 6);
        ctx.moveTo(px + T / 2, py + T / 2);
        ctx.lineTo(px + T / 2 + 4, py + T / 2 + 1);
        ctx.stroke();
        break;
      case 'board':
        ctx.fillStyle = '#ffffff';
        rr(ctx, px + 3, py + 5, wd - 6, T - 10, 2);
        ctx.fill();
        ctx.strokeStyle = '#8a8f96';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = '#5f8fb8';
        ctx.beginPath();
        ctx.moveTo(px + 8, py + 11);
        ctx.lineTo(px + wd - 14, py + 11);
        ctx.moveTo(px + 8, py + 15);
        ctx.lineTo(px + wd - 22, py + 15);
        ctx.stroke();
        break;
      case 'window': {
        const vertical = d.x === 0 || d.x === W - 1;
        ctx.fillStyle = '#bfe0ec';
        if (vertical) {
          ctx.fillRect(px + 8, py + 2, T - 16, T * 2 - 4);
        } else {
          ctx.fillRect(px + 2, py + 8, wd - 4, T - 16);
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          for (let x = px + 10; x < px + wd - 4; x += 18) ctx.fillRect(x, py + 9, 4, T - 18);
        }
        break;
      }
      case 'painting':
        ctx.fillStyle = '#8a6043';
        ctx.fillRect(px + 4, py + 4, wd - 8, T - 8);
        ctx.fillStyle = '#9fc3b0';
        ctx.fillRect(px + 7, py + 7, wd - 14, T - 14);
        ctx.fillStyle = '#f2b134';
        dot(ctx, px + wd - 14, py + 11, 3, '#f2b134');
        break;
      case 'frontdoor':
        ctx.fillStyle = '#8a5a3a';
        ctx.fillRect(px + 3, py + 2, wd - 6, T - 4);
        ctx.fillStyle = '#e8c27a';
        dot(ctx, px + wd - 12, py + T / 2, 2.5, '#e8c27a');
        break;
      case 'mat':
        ctx.fillStyle = '#9a8d76';
        rr(ctx, px + 4, py + 6, wd - 8, T - 12, 4);
        ctx.fill();
        break;
    }
  }
}

function drawFurniture(ctx: CanvasRenderingContext2D, w: World, f: FurnitureDef, now: number) {
  if (f.type === 'lamp') return;
  const b = bbox(f);
  const fs = w.fs[f.id];
  const flick = Math.sin(now / 120);
  const vertical = b.h > b.w;
  switch (f.type) {
    case 'computer': {
      ctx.fillStyle = '#7a4f32';
      rr(ctx, b.x + 2, b.y + 4, b.w - 4, b.h - 6, 4);
      ctx.fill();
      ctx.fillStyle = '#2d2a2a';
      rr(ctx, b.x + 10, b.y + 5, b.w - 20, 13, 2);
      ctx.fill();
      ctx.fillStyle = fs.on ? '#7fd6ff' : '#3a3a3a';
      ctx.fillRect(b.x + 12, b.y + 7, b.w - 24, 9);
      if (fs.on) {
        ctx.fillStyle = '#2b6f9e';
        for (let i = 0; i < 3; i++) ctx.fillRect(b.x + 14, b.y + 8 + i * 3, ((now / 60 + i * 9) % (b.w - 30)) + 4, 1.5);
        const g = ctx.createRadialGradient(b.x + b.w / 2, b.y + 16, 2, b.x + b.w / 2, b.y + 16, 30);
        g.addColorStop(0, 'rgba(127,214,255,0.35)');
        g.addColorStop(1, 'rgba(127,214,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(b.x - 10, b.y, b.w + 20, b.h + 30);
      }
      ctx.fillStyle = '#d9d2c6';
      ctx.fillRect(b.x + 16, b.y + 19, b.w - 32, 3);
      break;
    }
    case 'bookshelf': {
      ctx.fillStyle = '#6d4a32';
      rr(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 3);
      ctx.fill();
      const cols = ['#d9685a', '#5f8fb8', '#e0b04f', '#76a873', '#9a7bb6', '#e08a5f'];
      const reading = fs.users.length > 0;
      const len = vertical ? b.h : b.w;
      const n = Math.floor((len - 8) / 5.6);
      for (let row = 0; row < 2; row++)
        for (let i = 0; i < n; i++) {
          if (reading && row === 1 && (i === Math.floor(n / 2) || i === Math.floor(n / 2) + 1)) continue;
          ctx.fillStyle = cols[(i * 7 + row * 3) % cols.length];
          if (vertical) ctx.fillRect(b.x + 4 + row * 9, b.y + 5 + i * 5.6, 8, 4);
          else ctx.fillRect(b.x + 5 + i * 5.6, b.y + 4 + row * 9, 4, 8);
        }
      break;
    }
    case 'stove': {
      ctx.fillStyle = '#c9ced3';
      rr(ctx, b.x + 1, b.y + 2, b.w - 2, b.h - 5, 4);
      ctx.fill();
      for (const cx of [b.x + 13, b.x + b.w - 13]) {
        dot(ctx, cx, b.y + 12, 7, '#3b3f44');
        if (fs.on) {
          dot(ctx, cx, b.y + 12, 5 + flick, '#ff8a3d');
          dot(ctx, cx, b.y + 12, 2.5, '#ffd36b');
        }
      }
      if (fs.on) {
        dot(ctx, b.x + 13, b.y + 12, 6, '#8a8f96');
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const ox = b.x + 9 + i * 4;
          const phase = ((now / 400 + i) % 1) * 8;
          ctx.beginPath();
          ctx.moveTo(ox, b.y + 4 - phase);
          ctx.quadraticCurveTo(ox + 3, b.y - phase, ox, b.y - 4 - phase);
          ctx.stroke();
        }
      }
      break;
    }
    case 'sink':
    case 'basin': {
      ctx.fillStyle = f.type === 'basin' ? '#f6f1e8' : '#d9dfe3';
      rr(ctx, b.x + 1, b.y + 2, b.w - 2, b.h - 4, 4);
      ctx.fill();
      ctx.fillStyle = fs.on ? '#8cc8ea' : '#b8c1c7';
      const bw = vertical ? b.w - 10 : Math.min(b.w - 10, 26);
      const bh = vertical ? Math.min(b.h - 10, 26) : b.h - 12;
      rr(ctx, b.x + 5, b.y + 6, bw, bh, 6);
      ctx.fill();
      if (f.type === 'basin') {
        ctx.fillStyle = '#d6e9f2';
        rr(ctx, b.x + b.w - 20, b.y + 3, 16, 6, 2);
        ctx.fill();
      }
      if (fs.on) {
        dot(ctx, b.x + 10 + flick * 2, b.y + 11, 2, '#fff');
        dot(ctx, b.x + 15, b.y + 14 - flick, 1.6, '#fff');
      }
      break;
    }
    case 'fridge': {
      ctx.fillStyle = '#f7f7f4';
      rr(ctx, b.x + 2, b.y + 1, b.w - 4, b.h - 3, 4);
      ctx.fill();
      ctx.strokeStyle = '#c9c4ba';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 3, b.y + b.h * 0.38, b.w - 6, 0.5);
      ctx.fillStyle = '#9aa0a6';
      ctx.fillRect(b.x + 5, b.y + 6, 2, 8);
      ctx.fillRect(b.x + 5, b.y + b.h * 0.45, 2, 10);
      if (fs.on) {
        // 门打开：里面亮着灯，摆着饮料
        ctx.fillStyle = '#fff6c9';
        rr(ctx, b.x - 9, b.y + 4, 12, b.h - 10, 3);
        ctx.fill();
        ['#e46b5d', '#5fa8d3', '#f2b134'].forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(b.x - 6, b.y + 10 + i * 10, 6, 6);
        });
      }
      break;
    }
    case 'counter':
    case 'microwave': {
      ctx.fillStyle = '#ede1cc';
      rr(ctx, b.x + 1, b.y + 2, b.w - 2, b.h - 4, 3);
      ctx.fill();
      ctx.fillStyle = '#d2bf9f';
      ctx.fillRect(b.x + 1, b.y + b.h - 6, b.w - 2, 3);
      if (f.type === 'microwave') {
        ctx.fillStyle = '#3d4247';
        rr(ctx, b.x + b.w - 26, b.y + 5, 22, 14, 2);
        ctx.fill();
        ctx.fillStyle = '#7fa3b8';
        ctx.fillRect(b.x + b.w - 23, b.y + 8, 12, 8);
      } else {
        const items = ['#e46b5d', '#76a873', '#e0b04f', '#5fa8d3'];
        const cells = f.cells.length;
        for (let i = 0; i < Math.min(cells, 4); i++) dot(ctx, b.x + 12 + i * T, b.y + b.h / 2, 4, items[i]);
      }
      break;
    }
    case 'washer': {
      ctx.fillStyle = '#f4f4f2';
      rr(ctx, b.x + 2, b.y + 1, b.w - 4, b.h - 3, 4);
      ctx.fill();
      ctx.strokeStyle = '#b9bec4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, b.y + b.h / 2 + 1, 8, 0, Math.PI * 2);
      ctx.stroke();
      const running = fs.mode === 'running';
      dot(ctx, b.x + b.w / 2, b.y + b.h / 2 + 1, 6.5, running ? '#7cc3e8' : '#dde3e8');
      if (running) {
        const ang = now / 150;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x + b.w / 2, b.y + b.h / 2 + 1, 4, ang, ang + 2.2);
        ctx.stroke();
      }
      ctx.fillStyle = running ? '#5cc46b' : '#c0c0c0';
      ctx.fillRect(b.x + 5, b.y + 4, 4, 2);
      break;
    }
    case 'table': {
      ctx.fillStyle = '#c48e5c';
      rr(ctx, b.x + 3, b.y + 3, b.w - 6, b.h - 6, 10);
      ctx.fill();
      ctx.fillStyle = '#d6a575';
      rr(ctx, b.x + 7, b.y + 7, b.w - 14, b.h - 14, 8);
      ctx.fill();
      const mode = fs.mode;
      const top = f.cells.reduce((m, c) => Math.min(m, c.y), 99);
      if (mode === 'served' || mode === 'dirty') {
        f.spots.slice(0, 4).forEach((s) => {
          const px = s.x * T + T / 2;
          const py = s.y < top ? (s.y + 1) * T + 9 : (s.y - 1) * T + T - 9;
          dot(ctx, px, py, 7, '#ffffff');
          dot(ctx, px, py, 4, mode === 'served' ? '#f6e3a1' : '#d8d2c8');
        });
        if (mode === 'served') {
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const dishes: [number, string][] = [
            [-36, '#e46b5d'],
            [0, '#76a873'],
            [36, '#e0a050'],
          ];
          for (const [dx, c] of dishes) {
            dot(ctx, cx + dx, cy, 10, '#fbf6ee');
            dot(ctx, cx + dx, cy, 6.5, c);
          }
        }
      } else {
        dot(ctx, b.x + b.w / 2, b.y + b.h / 2, 6, '#f2efe8');
        dot(ctx, b.x + b.w / 2, b.y + b.h / 2 - 4, 4, '#e46b8a');
      }
      break;
    }
    case 'bed': {
      ctx.fillStyle = '#8a6043';
      rr(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 5);
      ctx.fill();
      ctx.fillStyle = '#fbf7f0';
      rr(ctx, b.x + 3, b.y + 3, b.w - 6, b.h - 6, 4);
      ctx.fill();
      for (const p of f.spots) {
        ctx.fillStyle = '#ffffff';
        rr(ctx, p.x * T + 4, p.y * T + 4, T - 8, 10, 4);
        ctx.fill();
        ctx.strokeStyle = '#e2d9cc';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = BLANKET[f.id] ?? '#c9a0a0';
      rr(ctx, b.x + 3, b.y + T * 0.62, b.w - 6, b.h - T * 0.62 - 3, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(b.x + 3, b.y + T * 0.62, b.w - 6, 4);
      break;
    }
    case 'tv': {
      // 竖着靠墙的电视：客厅的贴左墙朝右，影音室的大电视贴右墙朝左
      const faceLeft = b.x > CANVAS_W / 2;
      const big = f.id === 'theater_tv';
      ctx.fillStyle = big ? '#8a2f2f' : '#c69a6b';
      if (vertical) rr(ctx, faceLeft ? b.x + b.w - 13 : b.x + 1, b.y + 1, 12, b.h - 2, 3);
      else rr(ctx, b.x + 1, b.y + 1, b.w - 2, 12, 3);
      ctx.fill();
      ctx.fillStyle = '#1f1f24';
      const sx = faceLeft ? b.x + b.w - 22 : b.x + 12;
      if (vertical) rr(ctx, sx, b.y + (big ? 2 : 8), 10, b.h - (big ? 4 : 16), 2);
      else rr(ctx, b.x + 6, b.y + 12, b.w - 12, 9, 2);
      ctx.fill();
      if (fs.on) {
        const hshift = (now / 30) % 360;
        const g = vertical ? ctx.createLinearGradient(0, b.y + 10, 0, b.y + b.h - 10) : ctx.createLinearGradient(b.x + 8, 0, b.x + b.w - 8, 0);
        g.addColorStop(0, `hsl(${hshift},70%,62%)`);
        g.addColorStop(1, `hsl(${(hshift + 120) % 360},70%,62%)`);
        ctx.fillStyle = g;
        if (vertical) ctx.fillRect(sx + 2, b.y + (big ? 4 : 10), 6, b.h - (big ? 8 : 20));
        else ctx.fillRect(b.x + 8, b.y + 14, b.w - 16, 5);
        const gx = faceLeft ? b.x : b.x + b.w;
        const glow = ctx.createRadialGradient(gx, b.y + b.h / 2, 4, gx, b.y + b.h / 2, big ? 110 : 80);
        glow.addColorStop(0, 'rgba(160,200,255,0.38)');
        glow.addColorStop(1, 'rgba(160,200,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(faceLeft ? gx - 120 : gx - 10, b.y - 50, 130, b.h + 100);
      }
      break;
    }
    case 'sofa': {
      ctx.fillStyle = f.id === 'theater_sofa' ? '#e6cfa8' : '#7f9e78';
      rr(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 7);
      ctx.fill();
      ctx.fillStyle = f.id === 'theater_sofa' ? '#f4e4c6' : '#9cbb93';
      for (const c of f.cells) {
        rr(ctx, c.x * T + (vertical ? 3 : 4), c.y * T + (vertical ? 4 : 8), T - (vertical ? 11 : 6), T - (vertical ? 6 : 11), 5);
        ctx.fill();
      }
      ctx.fillStyle = f.id === 'theater_sofa' ? '#c9a77c' : '#6a8a64';
      const backLeft = f.id === 'theater_sofa'; // 影音室沙发面朝右边的大电视
      if (vertical) rr(ctx, backLeft ? b.x + 1 : b.x + b.w - 8, b.y + 1, 7, b.h - 2, 4);
      else rr(ctx, b.x + 1, b.y + 1, b.w - 2, 7, 4);
      ctx.fill();
      break;
    }
    case 'coffeetable':
    case 'teatable': {
      ctx.fillStyle = f.type === 'teatable' ? '#b98a5a' : '#8a5a3a';
      rr(ctx, b.x + 5, b.y + 5, b.w - 10, b.h - 10, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      dot(ctx, b.x + b.w / 2 - 6, b.y + b.h / 2, 3.5, '#fff');
      if (f.type === 'teatable') {
        dot(ctx, b.x + b.w / 2 + 6, b.y + b.h / 2, 5, '#e8d6b8');
        const tea = w.fs.rattan.users.length > 0 && f.room === 'balcony';
        if (tea) {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 1.3;
          const ph = ((now / 500) % 1) * 6;
          ctx.beginPath();
          ctx.moveTo(b.x + b.w / 2 + 6, b.y + b.h / 2 - 6 - ph);
          ctx.quadraticCurveTo(b.x + b.w / 2 + 9, b.y + b.h / 2 - 10 - ph, b.x + b.w / 2 + 6, b.y + b.h / 2 - 14 - ph);
          ctx.stroke();
        }
      }
      break;
    }
    case 'armchair': {
      const rock = fs.users.length && f.id === 'rocker' ? Math.sin(now / 350) * 1.5 : 0;
      ctx.save();
      ctx.translate(0, rock);
      ctx.fillStyle = f.id === 'rocker' ? '#b5884f' : '#8b5a3c';
      rr(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 8);
      ctx.fill();
      ctx.fillStyle = f.id === 'rocker' ? '#e8c27a' : '#c8765a';
      rr(ctx, b.x + 5, b.y + 7, b.w - 10, b.h - 11, 5);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'rattan':
      for (const c of f.cells) {
        dot(ctx, c.x * T + T / 2, c.y * T + T / 2, 11, '#c99a5e');
        dot(ctx, c.x * T + T / 2, c.y * T + T / 2, 7.5, '#f2dfb7');
        ctx.strokeStyle = '#a77a45';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(c.x * T + T / 2, c.y * T + T / 2, 9.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'stool':
      for (const c of f.cells) {
        dot(ctx, c.x * T + T / 2, c.y * T + T / 2, 8, '#a77a45');
        dot(ctx, c.x * T + T / 2, c.y * T + T / 2, 6, '#f2dfb7');
      }
      break;
    case 'piano': {
      ctx.fillStyle = '#1e1b1c';
      ctx.beginPath();
      ctx.moveTo(b.x + 4, b.y + 4);
      ctx.lineTo(b.x + b.w - 10, b.y + 4);
      ctx.quadraticCurveTo(b.x + b.w + 2, b.y + b.h / 2, b.x + b.w - 14, b.y + b.h - 4);
      ctx.lineTo(b.x + 4, b.y + b.h - 4);
      ctx.closePath();
      ctx.fill();
      // 琴键在左侧，对着琴凳
      ctx.fillStyle = '#fbfbf8';
      ctx.fillRect(b.x + 4, b.y + 6, 7, b.h - 12);
      ctx.fillStyle = '#1e1b1c';
      for (let y = b.y + 9; y < b.y + b.h - 8; y += 5) ctx.fillRect(b.x + 4, y, 4, 2.5);
      ctx.strokeStyle = '#4a4245';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x + 14, b.y + 8);
      ctx.lineTo(b.x + b.w - 14, b.y + b.h - 10);
      ctx.stroke();
      if (fs.on) {
        const notes = ['♪', '♫', '♩'];
        ctx.font = 'bold 13px sans-serif';
        for (let i = 0; i < 3; i++) {
          const ph = ((now / 1400 + i / 3) % 1);
          ctx.fillStyle = `rgba(${[224, 122, 79][i % 3]},${[122, 150, 180][i % 3]},${[79, 200, 120][i % 3]},${1 - ph})`;
          ctx.fillText(notes[i], b.x + 8 + i * 14 + Math.sin(ph * 6 + i) * 4, b.y - 4 - ph * 26);
        }
      }
      break;
    }
    case 'coffee': {
      // 一排咖啡机：彩色的豆仓 + 深色机身
      const domes = ['#7fae6a', '#d9685a', '#e8b44f', '#8a6043', '#7fae6a', '#d9685a'];
      ctx.fillStyle = '#8a5a3a';
      rr(ctx, b.x + 1, b.y + 12, b.w - 2, b.h - 14, 3);
      ctx.fill();
      f.cells.forEach((c, k) => {
        const cx = c.x * T + T / 2;
        ctx.fillStyle = '#3d3430';
        rr(ctx, cx - 7, c.y * T + 8, 14, 12, 2);
        ctx.fill();
        ctx.fillStyle = domes[k % domes.length];
        rr(ctx, cx - 6, c.y * T + 1, 12, 9, 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(cx - 4, c.y * T + 3, 2, 5);
      });
      if (fs.on) {
        for (const sp of f.spots) {
          const cx = sp.x * T + T / 2;
          dot(ctx, cx, b.y + b.h - 6, 3.5, '#ffffff');
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = 1.3;
          const ph = ((now / 450) % 1) * 7;
          ctx.beginPath();
          ctx.moveTo(cx, b.y + b.h - 10 - ph);
          ctx.quadraticCurveTo(cx + 3, b.y + b.h - 14 - ph, cx, b.y + b.h - 18 - ph);
          ctx.stroke();
        }
      }
      break;
    }
    case 'plants': {
      const wv = fs.water ?? 1;
      const justWatered = fs.wateredAt !== undefined && w.t - fs.wateredAt < 15 * 60;
      f.cells.forEach((c, k) => {
        const cx = c.x * T + T / 2;
        const cy = c.y * T + T / 2;
        // 花盆
        ctx.fillStyle = k % 2 ? '#d98b5f' : '#f2efe8';
        rr(ctx, cx - 7, cy + 1, 14, 10, 3);
        ctx.fill();
        ctx.fillStyle = wv > 0.5 ? '#7a5236' : '#b48a62';
        ctx.fillRect(cx - 6, cy + 1, 12, 2);
        // 叶子：颜色由水分决定
        const big = k === f.cells.length - 1 && f.id === 'planter_br';
        const r = big ? 7 : 5.2;
        const droop = wv < 0.35 ? 2.5 : 0;
        const leaves: [number, number][] = big
          ? [
              [-7, -4],
              [7, -4],
              [0, -10],
              [-4, 1],
              [4, 1],
            ]
          : [
              [-5, -3 + droop],
              [5, -3 + droop],
              [0, -8 + droop],
            ];
        leaves.forEach(([dx, dy], li) => dot(ctx, cx + dx, cy + dy, r, leafColor(wv, li % 2)));
        if (wv >= 0.6 && (c.x + c.y) % 3 === 0) dot(ctx, cx + 2, cy - 6, 2.4, '#f28aa0');
        if (justWatered) {
          const ph = (now / 700 + c.x * 0.3) % 1;
          dot(ctx, cx - 4, cy - 4 + ph * 7, 1.6, `rgba(110,180,235,${1 - ph})`);
          dot(ctx, cx + 5, cy - 6 + ph * 7, 1.4, `rgba(110,180,235,${1 - ph})`);
        }
      });
      // 水分条
      const s0 = f.spots[0];
      const gx = s0.x * T + 3;
      const gy = s0.y * T + T - 6;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      rr(ctx, gx, gy, T - 6, 4, 2);
      ctx.fill();
      ctx.fillStyle = wv < 0.35 ? '#e0a33c' : '#5fa8d3';
      rr(ctx, gx, gy, Math.max(2, (T - 6) * wv), 4, 2);
      ctx.fill();
      break;
    }
    case 'rack':
      if (f.cells.length === 1) {
        ctx.strokeStyle = '#8a6043';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x + T / 2, b.y + 4);
        ctx.lineTo(b.x + T / 2, b.y + T - 3);
        ctx.stroke();
        dot(ctx, b.x + T / 2 - 5, b.y + 8, 4, '#5f8fb8');
        dot(ctx, b.x + T / 2 + 5, b.y + 10, 4, '#d4685a');
      } else {
        ctx.strokeStyle = '#a8adb3';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x + 3, b.y + 6, b.w - 6, b.h - 12);
        ['#f2b134', '#5f8fb8', '#ffffff', '#d4685a'].forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(b.x + 6 + i * ((b.w - 12) / 4), b.y + 7, (b.w - 12) / 4 - 3, b.h - 16);
        });
      }
      break;
    case 'nightstand':
      ctx.fillStyle = '#b98a5a';
      rr(ctx, b.x + 4, b.y + 4, b.w - 8, b.h - 8, 3);
      ctx.fill();
      dot(ctx, b.x + b.w / 2, b.y + b.h / 2, 4, '#ffe8a8');
      break;
    case 'toilet':
      ctx.fillStyle = '#ffffff';
      rr(ctx, b.x + 6, b.y + 2, b.w - 12, 7, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + 16, 7, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#cfd6db';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case 'bathtub': {
      ctx.fillStyle = '#ffffff';
      rr(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 12);
      ctx.fill();
      ctx.strokeStyle = '#cfd6db';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = fs.on ? '#8fd0e8' : '#dbeef5';
      rr(ctx, b.x + 7, b.y + 7, b.w - 14, b.h - 14, 9);
      ctx.fill();
      if (fs.on)
        for (let i = 0; i < 6; i++) {
          const ph = (now / 900 + i / 6) % 1;
          dot(ctx, b.x + 14 + i * 11, b.y + b.h - 12 - ph * (b.h - 20), 3 - ph * 1.5, `rgba(255,255,255,${0.95 - ph * 0.6})`);
        }
      break;
    }
    case 'shower':
      ctx.fillStyle = 'rgba(200,225,235,0.8)';
      rr(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 3);
      ctx.fill();
      ctx.strokeStyle = '#9fb3bd';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      dot(ctx, b.x + 10, b.y + 9, 4, '#a8adb3');
      break;
    case 'mirror': {
      ctx.fillStyle = '#c9a36a';
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, 8, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dff1f6';
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, 6, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      if (fs.users.length) {
        const ph = (now / 600) % 1;
        ctx.fillStyle = `rgba(255,255,255,${1 - ph})`;
        ctx.font = '10px sans-serif';
        ctx.fillText('✦', b.x + b.w / 2 - 3, b.y + 8 - ph * 6);
      }
      break;
    }
    case 'radio': {
      ctx.fillStyle = '#8a5a3a';
      rr(ctx, b.x + 3, b.y + 6, b.w - 6, b.h - 10, 4);
      ctx.fill();
      dot(ctx, b.x + 9, b.y + 14, 4, '#e8d6b8');
      ctx.fillStyle = '#e8d6b8';
      ctx.fillRect(b.x + 15, b.y + 10, 7, 2);
      ctx.fillRect(b.x + 15, b.y + 14, 7, 2);
      if (fs.on) {
        ctx.strokeStyle = 'rgba(224,122,79,0.8)';
        ctx.lineWidth = 1.5;
        for (let i = 1; i <= 2; i++) {
          const ph = (now / 800) % 1;
          ctx.beginPath();
          ctx.arc(b.x + b.w - 3, b.y + 12, 4 + i * 4 + ph * 3, -0.7, 0.7);
          ctx.stroke();
        }
      }
      break;
    }
    case 'shelf':
    case 'shoecab': {
      ctx.fillStyle = f.type === 'shelf' ? '#a8adb3' : '#c69a6b';
      rr(ctx, b.x + 1, b.y + 3, b.w - 2, b.h - 6, 3);
      ctx.fill();
      const cs = ['#d8b98b', '#9fc3b0', '#e4a07f', '#b7a4cf'];
      for (let i = 0; i < f.cells.length * 2; i++) {
        ctx.fillStyle = cs[i % cs.length];
        ctx.fillRect(b.x + 4 + i * (T / 2), b.y + 7, T / 2 - 4, b.h - 14);
      }
      break;
    }
    case 'boxes':
      ctx.fillStyle = '#d2a679';
      rr(ctx, b.x + 3, b.y + 6, b.w - 6, b.h - 9, 2);
      ctx.fill();
      ctx.fillStyle = '#b98a5a';
      ctx.fillRect(b.x + b.w / 2 - 1, b.y + 6, 2, b.h - 9);
      break;
    case 'floorlamp':
      dot(ctx, b.x + T / 2, b.y + T / 2, 7, '#fbe7b8');
      ctx.strokeStyle = '#b98a5a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x + T / 2, b.y + T / 2, 7, 0, Math.PI * 2);
      ctx.stroke();
      dot(ctx, b.x + T / 2, b.y + T / 2, 2, '#8a6043');
      break;
    case 'vanity':
      ctx.fillStyle = '#e8d6c0';
      rr(ctx, b.x + 2, b.y + 6, b.w - 4, b.h - 9, 3);
      ctx.fill();
      dot(ctx, b.x + b.w / 2, b.y + 9, 6, '#dff1f6');
      break;
    case 'toybox': {
      ctx.fillStyle = '#e46b5d';
      rr(ctx, b.x + 2, b.y + 3, b.w - 4, b.h - 6, 4);
      ctx.fill();
      ctx.fillStyle = '#f2b134';
      ctx.fillRect(b.x + 2, b.y + 9, b.w - 4, 4);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.fillText(fs.users.length ? '▢▣' : '★', b.x + b.w / 2 - 8, b.y + 20);
      break;
    }
    case 'desk':
      ctx.fillStyle = '#e8b4c4';
      rr(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 3);
      ctx.fill();
      ctx.fillStyle = fs.users.length ? '#ffffff' : '#f6e7ec';
      ctx.fillRect(b.x + 8, b.y + 6, b.w - 18, b.h - 12);
      ctx.fillStyle = '#5f8fb8';
      ctx.fillRect(b.x + b.w - 9, b.y + 6, 3, 12);
      break;
    case 'wardrobe':
    case 'cabinet': {
      ctx.fillStyle = f.type === 'wardrobe' ? '#c69a6b' : '#a9774f';
      rr(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 3, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,50,30,0.45)';
      ctx.lineWidth = 1;
      if (vertical)
        for (let y = b.y + T; y < b.y + b.h - 2; y += T) {
          ctx.beginPath();
          ctx.moveTo(b.x + 3, y);
          ctx.lineTo(b.x + b.w - 3, y);
          ctx.stroke();
        }
      else
        for (let x = b.x + T; x < b.x + b.w - 2; x += T) {
          ctx.beginPath();
          ctx.moveTo(x, b.y + 3);
          ctx.lineTo(x, b.y + b.h - 5);
          ctx.stroke();
        }
      ctx.fillStyle = '#f2d38f';
      ctx.fillRect(b.x + b.w / 2 - 4, b.y + b.h / 2 - 2, 2, 4);
      ctx.fillRect(b.x + b.w / 2 + 2, b.y + b.h / 2 - 2, 2, 4);
      break;
    }
    case 'plant':
      dot(ctx, b.x + T / 2, b.y + T / 2 + 4, 7, '#b8714f');
      for (const [dx, dy] of [
        [-5, -3],
        [5, -3],
        [0, -8],
        [0, 0],
      ])
        dot(ctx, b.x + T / 2 + dx, b.y + T / 2 + dy, 5.5, '#5f9e5c');
      break;
    case 'dock':
      dot(ctx, b.x + T / 2, b.y + T / 2, 11, '#cfe9ea');
      ctx.strokeStyle = '#5fb8bf';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x + T / 2, b.y + T / 2, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#3d9aa2';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('⚡', b.x + 7, b.y + 18);
      break;
  }
}

function drawAgent(ctx: CanvasRenderingContext2D, w: World, a: Agent, p: { x: number; y: number }, o: RenderOpts) {
  const { x, y } = p;
  const color = a.persona.color;
  if (a.controlled) {
    const pulse = 13 + Math.sin(o.now / 200) * 2;
    ctx.strokeStyle = 'rgba(76,175,96,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y + 2, pulse, 0, Math.PI * 2);
    ctx.stroke();
  } else if (o.selected === a.id) {
    ctx.strokeStyle = 'rgba(224,122,79,0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(x, y + 2, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(60,40,20,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y + 10, 9, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (a.id === 'robot') {
    ctx.fillStyle = '#e9f6f6';
    rr(ctx, x - 10, y - 9, 20, 19, 7);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#24343a';
    rr(ctx, x - 7, y - 6, 14, 9, 4);
    ctx.fill();
    const blink = Math.floor(o.now / 2600) % 7 === 0 && o.now % 2600 < 160;
    ctx.fillStyle = '#7ff0ea';
    if (blink) {
      ctx.fillRect(x - 5, y - 2, 3, 1.2);
      ctx.fillRect(x + 2, y - 2, 3, 1.2);
    } else {
      ctx.beginPath();
      ctx.arc(x - 3.2, y - 1.5, 1.8, 0, Math.PI * 2);
      ctx.arc(x + 3.2, y - 1.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#7a8a8e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x, y - 14);
    ctx.stroke();
    const busy = w.robot.mode === 'task';
    ctx.fillStyle = busy ? (Math.floor(o.now / 400) % 2 ? '#ff7a59' : '#ffb199') : '#7fd8a0';
    ctx.beginPath();
    ctx.arc(x, y - 15, 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (a.sleeping) {
    ctx.fillStyle = '#f6d2b4';
    ctx.beginPath();
    ctx.arc(x, y - 4, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = a.persona.hair;
    ctx.beginPath();
    ctx.arc(x, y - 6, 7, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b4a3a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 3);
    ctx.lineTo(x - 1.5, y - 3);
    ctx.moveTo(x + 1.5, y - 3);
    ctx.lineTo(x + 4, y - 3);
    ctx.stroke();
    const zf = (o.now / 900) % 1;
    ctx.fillStyle = `rgba(80,90,160,${1 - zf})`;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('z', x + 8, y - 8 - zf * 8);
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText('z', x + 14, y - 14 - zf * 8);
  } else {
    // 身体
    ctx.fillStyle = color;
    rr(ctx, x - 8, y - 1, 16, 12, 6);
    ctx.fill();
    if (a.id === 'mom') {
      ctx.fillStyle = '#fbefe2';
      ctx.fillRect(x - 4, y + 1, 8, 9);
    }
    // 头
    ctx.fillStyle = '#f6d2b4';
    ctx.beginPath();
    ctx.arc(x, y - 7, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = a.persona.hair;
    ctx.beginPath();
    ctx.arc(x, y - 9, 7.6, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    if (a.id === 'mom') {
      ctx.fillRect(x - 8, y - 9, 3, 10);
      ctx.fillRect(x + 5, y - 9, 3, 10);
    }
    if (a.id === 'grandma') {
      ctx.beginPath();
      ctx.arc(x, y - 16, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (a.id === 'kid') {
      ctx.beginPath();
      ctx.moveTo(x - 1, y - 16);
      ctx.lineTo(x + 2, y - 20);
      ctx.lineTo(x + 3, y - 15);
      ctx.fill();
    }
    ctx.fillStyle = '#3b2a20';
    ctx.beginPath();
    ctx.arc(x - 2.6, y - 6.5, 1.1, 0, Math.PI * 2);
    ctx.arc(x + 2.6, y - 6.5, 1.1, 0, Math.PI * 2);
    ctx.fill();
    if (a.id === 'dad' || a.id === 'grandma') {
      ctx.strokeStyle = '#3b2a20';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(x - 2.6, y - 6.5, 2.4, 0, Math.PI * 2);
      ctx.moveTo(x + 5, y - 6.5);
      ctx.arc(x + 2.6, y - 6.5, 2.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (a.id === 'kid') {
      ctx.fillStyle = 'rgba(240,120,110,0.5)';
      ctx.beginPath();
      ctx.arc(x - 4.5, y - 4, 1.6, 0, Math.PI * 2);
      ctx.arc(x + 4.5, y - 4, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 名牌
  ctx.font = '600 10px "PingFang SC","Microsoft YaHei",sans-serif';
  const tw = ctx.measureText(a.name).width + 8;
  ctx.fillStyle = a.controlled ? 'rgba(76,175,96,0.95)' : 'rgba(255,252,246,0.92)';
  rr(ctx, x - tw / 2, y + 12, tw, 13, 6);
  ctx.fill();
  ctx.fillStyle = a.controlled ? '#fff' : '#4a3628';
  ctx.fillText(a.name, x - tw / 2 + 4, y + 22);
  // 活动图标
  let icon = '';
  if (a.controlled) icon = '🎮';
  else if (a.id === 'robot') icon = w.robot.mode === 'task' ? '📋' : w.robot.mode === 'charge' ? '🔌' : w.robot.mode === 'attend' ? '👂' : '';
  else if (a.act?.started && !a.sleeping) icon = a.act.icon;
  if (icon) {
    ctx.font = '12px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
    ctx.fillText(icon, x + 7, y - 12);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.slice(0, 4);
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  a: Agent,
  p: { x: number; y: number },
  placed: { x: number; y: number; w: number; h: number }[],
) {
  ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
  const lines = wrap(ctx, a.bubble!.text, 150);
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const bh = lines.length * 16 + 10;
  let bx = Math.min(Math.max(p.x - bw / 2, 4), CANVAS_W - bw - 4);
  let by = p.y - 26 - bh;
  if (by < 4) by = p.y + 28;
  for (let k = 0; k < 6; k++) {
    const hit = placed.find((r) => bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y);
    if (!hit) break;
    by = hit.y - bh - 4;
    if (by < 4) {
      by = hit.y + hit.h + 4;
      bx = Math.min(bx + 20, CANVAS_W - bw - 4);
    }
  }
  placed.push({ x: bx, y: by, w: bw, h: bh });
  ctx.fillStyle = 'rgba(255,253,248,0.97)';
  ctx.strokeStyle = a.persona.color;
  ctx.lineWidth = 2;
  rr(ctx, bx, by, bw, bh, 8);
  ctx.fill();
  ctx.stroke();
  const tx = Math.min(Math.max(p.x, bx + 10), bx + bw - 10);
  if (by < p.y) {
    ctx.beginPath();
    ctx.moveTo(tx - 5, by + bh - 1);
    ctx.lineTo(tx, Math.min(by + bh + 7, p.y - 16));
    ctx.lineTo(tx + 5, by + bh - 1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,253,248,0.97)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tx - 5, by + bh);
    ctx.lineTo(tx, Math.min(by + bh + 7, p.y - 16));
    ctx.lineTo(tx + 5, by + bh);
    ctx.stroke();
  }
  ctx.fillStyle = '#3d2f25';
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 18 + i * 16));
}
