import { H, W, ROOMS, type FloorStyle, type FurnitureDef } from '../sim/map';
import { CELL_DOOR, CELL_WALL } from '../sim/map';
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
}

const FLOOR: Record<FloorStyle, { base: string; alt: string; kind: 'planks' | 'checker' | 'dots' | 'runner' }> = {
  parquet: { base: '#caa071', alt: '#bb9062', kind: 'planks' },
  carpet: { base: '#f1d6dc', alt: '#e8c3cc', kind: 'dots' },
  wood: { base: '#ddbd94', alt: '#d0ae84', kind: 'planks' },
  warm: { base: '#e8d3ae', alt: '#dbc49c', kind: 'planks' },
  runner: { base: '#e6d9c3', alt: '#d8c7a9', kind: 'runner' },
  tile: { base: '#f4eee3', alt: '#e3d8c5', kind: 'checker' },
  oak: { base: '#d9b688', alt: '#cba878', kind: 'planks' },
  honey: { base: '#e6c695', alt: '#d9b884', kind: 'planks' },
};

const BLANKET: Record<string, string> = { bed_kid: '#7db3d8', bed_master: '#d98b8b', bed_grandma: '#b49ad0' };

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bbox(f: FurnitureDef) {
  const xs = f.cells.map((c) => c.x);
  const ys = f.cells.map((c) => c.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0 * T, y: y0 * T, w: (Math.max(...xs) - x0 + 1) * T, h: (Math.max(...ys) - y0 + 1) * T };
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

export function drawWorld(ctx: CanvasRenderingContext2D, w: World, o: RenderOpts) {
  const m = w.map;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  // 地板
  for (const r of ROOMS) {
    const st = FLOOR[r.floor];
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const px = x * T;
        const py = y * T;
        ctx.fillStyle = st.base;
        if (st.kind === 'checker' && (x + y) % 2) ctx.fillStyle = st.alt;
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = st.alt;
        if (st.kind === 'planks') {
          ctx.fillRect(px, py + T / 2 - 0.5, T, 1);
          ctx.fillRect(px + ((y % 2) * T) / 2, py, 1, T / 2);
          ctx.fillRect(px + (((y + 1) % 2) * T) / 2, py + T / 2, 1, T / 2);
        } else if (st.kind === 'dots') {
          ctx.beginPath();
          ctx.arc(px + T / 2, py + T / 2, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    if (st.kind === 'runner') {
      ctx.fillStyle = '#c9846a';
      rr(ctx, r.x0 * T + 6, r.y0 * T + 8, (r.x1 - r.x0 + 1) * T - 12, (r.y1 - r.y0 + 1) * T - 16, 6);
      ctx.fill();
      ctx.strokeStyle = '#e7b89c';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      rr(ctx, r.x0 * T + 10, r.y0 * T + 12, (r.x1 - r.x0 + 1) * T - 20, (r.y1 - r.y0 + 1) * T - 24, 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // 地毯
  const rugs: [number, number, number, number, string, string][] = [
    [3, 4, 6, 6, '#8fae9a', '#b9d1bf'],
    [12, 3, 15, 6, '#f6e7a6', '#f2c879'],
    [21, 5, 27, 7, '#c7a0a0', '#e2c2bf'],
    [27, 16, 33, 19, '#b5604a', '#e09a7d'],
    [31, 4, 34, 6, '#a99bc4', '#cfc3e0'],
  ];
  for (const [x0, y0, x1, y1, c1, c2] of rugs) {
    ctx.fillStyle = c1;
    rr(ctx, x0 * T + 3, y0 * T + 3, (x1 - x0 + 1) * T - 6, (y1 - y0 + 1) * T - 6, 8);
    ctx.fill();
    ctx.strokeStyle = c2;
    ctx.lineWidth = 2;
    rr(ctx, x0 * T + 8, y0 * T + 8, (x1 - x0 + 1) * T - 16, (y1 - y0 + 1) * T - 16, 5);
    ctx.stroke();
  }
  // 墙与门
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = m.kind[m.idx(x, y)];
      const px = x * T;
      const py = y * T;
      if (k === CELL_WALL) {
        ctx.fillStyle = '#7a5b48';
        ctx.fillRect(px, py, T, T);
        if (!m.isWall(x, y + 1)) {
          ctx.fillStyle = '#5f4535';
          ctx.fillRect(px, py + T - 4, T, 4);
        }
        if (!m.isWall(x, y - 1)) {
          ctx.fillStyle = '#9b7a63';
          ctx.fillRect(px, py, T, 3);
        }
      } else if (k === CELL_DOOR) {
        ctx.fillStyle = '#d8bb8e';
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = '#a77c55';
        const vertical = m.isWall(x - 1, y) && m.isWall(x + 1, y);
        if (vertical) {
          ctx.fillRect(px, py + 2, 3, T - 4);
          ctx.fillRect(px + T - 3, py + 2, 3, T - 4);
        } else {
          ctx.fillRect(px + 2, py, T - 4, 3);
          ctx.fillRect(px + 2, py + T - 3, T - 4, 3);
        }
      }
    }
  // 餐椅
  for (const s of m.byId.get('table')!.spots) {
    ctx.fillStyle = '#a5774f';
    rr(ctx, s.x * T + 5, s.y * T + 5, T - 10, T - 10, 4);
    ctx.fill();
  }
  // 家具
  for (const f of m.furniture) drawFurniture(ctx, w, f, o.now);
  // 积木散落
  if (w.fs.toybox.users.length) {
    const cols = ['#e46b5d', '#f2b134', '#5fa8d3', '#6cbf7b'];
    [
      [12, 2],
      [12, 3],
      [13, 2],
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
    const ly = r.id === 'corridor' ? r.y0 * T + 3 : r.y1 * T + T - 19;
    ctx.fillStyle = 'rgba(255,250,240,0.78)';
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
      ctx.fillRect(r.x0 * T, r.y0 * T, (r.x1 - r.x0 + 1) * T, (r.y1 - r.y0 + 1) * T);
    }
  }
  if (dark > 0.01) {
    ctx.fillStyle = `rgba(22,26,58,${dark * 0.6})`;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (m.kind[m.idx(x, y)] !== 1) ctx.fillRect(x * T, y * T, T, T);
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
      ctx.rect(r.x0 * T, r.y0 * T, (r.x1 - r.x0 + 1) * T, (r.y1 - r.y0 + 1) * T);
      ctx.clip();
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, T * 4.5);
      g.addColorStop(0, `rgba(255,220,120,${0.38 + dark * 0.3})`);
      g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - T * 5, cy - T * 5, T * 10, T * 10);
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

function drawFurniture(ctx: CanvasRenderingContext2D, w: World, f: FurnitureDef, now: number) {
  if (f.type === 'lamp') return;
  const b = bbox(f);
  const fs = w.fs[f.id];
  const flick = Math.sin(now / 120);
  switch (f.type) {
    case 'computer': {
      ctx.fillStyle = '#8a5f3f';
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
      rr(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 4, 3);
      ctx.fill();
      const cols = ['#d9685a', '#5f8fb8', '#e0b04f', '#76a873', '#9a7bb6', '#e08a5f'];
      const reading = fs.users.length > 0;
      for (let row = 0; row < 2; row++)
        for (let i = 0; i < 13; i++) {
          if (reading && row === 1 && (i === 6 || i === 7)) continue;
          ctx.fillStyle = cols[(i * 7 + row * 3) % cols.length];
          ctx.fillRect(b.x + 5 + i * 5.6, b.y + 4 + row * 9, 4, 8);
        }
      break;
    }
    case 'stove': {
      ctx.fillStyle = '#c9ced3';
      rr(ctx, b.x + 1, b.y + 2, b.w - 2, b.h - 5, 4);
      ctx.fill();
      for (const cx of [b.x + 13, b.x + b.w - 13]) {
        ctx.beginPath();
        ctx.arc(cx, b.y + 12, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#3b3f44';
        ctx.fill();
        if (fs.on) {
          ctx.beginPath();
          ctx.arc(cx, b.y + 12, 5 + flick, 0, Math.PI * 2);
          ctx.fillStyle = '#ff8a3d';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, b.y + 12, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd36b';
          ctx.fill();
        }
      }
      if (fs.on) {
        ctx.fillStyle = '#8a8f96';
        ctx.beginPath();
        ctx.arc(b.x + 13, b.y + 12, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
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
    case 'sink': {
      ctx.fillStyle = '#d9dfe3';
      rr(ctx, b.x + 1, b.y + 2, b.w - 2, b.h - 5, 4);
      ctx.fill();
      ctx.fillStyle = fs.on ? '#8cc8ea' : '#b8c1c7';
      rr(ctx, b.x + 5, b.y + 6, b.w - 10, b.h - 13, 3);
      ctx.fill();
      if (fs.on) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(b.x + 9 + flick * 2, b.y + 10, 2, 0, Math.PI * 2);
        ctx.arc(b.x + 16, b.y + 13 - flick, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fridge':
      ctx.fillStyle = '#f7f7f4';
      rr(ctx, b.x + 2, b.y + 1, b.w - 4, b.h - 3, 4);
      ctx.fill();
      ctx.strokeStyle = '#c9c4ba';
      ctx.strokeRect(b.x + 3, b.y + 12, b.w - 6, 0.5);
      ctx.fillStyle = '#9aa0a6';
      ctx.fillRect(b.x + b.w - 8, b.y + 5, 2, 5);
      break;
    case 'counter':
      ctx.fillStyle = '#e9dcc6';
      rr(ctx, b.x + 1, b.y + 1, b.w - 4, b.h - 2, 3);
      ctx.fill();
      ctx.fillStyle = '#c99b6d';
      rr(ctx, b.x + 4, b.y + 18, b.w - 10, 18, 3);
      ctx.fill();
      ctx.fillStyle = '#e46b5d';
      ctx.beginPath();
      ctx.arc(b.x + 12, b.y + 50, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
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
      ctx.fillStyle = running ? '#7cc3e8' : '#dde3e8';
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, b.y + b.h / 2 + 1, 6.5, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.fillStyle = '#b07d4f';
      rr(ctx, b.x + 3, b.y + 3, b.w - 6, b.h - 6, 10);
      ctx.fill();
      ctx.fillStyle = '#c69365';
      rr(ctx, b.x + 7, b.y + 7, b.w - 14, b.h - 14, 8);
      ctx.fill();
      const mode = fs.mode;
      if (mode === 'served' || mode === 'dirty') {
        for (const s of f.spots) {
          const px = s.x * T + T / 2;
          const py = s.y < 17 ? b.y + 14 : b.y + b.h - 14;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = mode === 'served' ? '#f6e3a1' : '#d8d2c8';
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (mode === 'served') {
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const dishes: [number, string][] = [
            [-30, '#e46b5d'],
            [0, '#76a873'],
            [30, '#e0a050'],
          ];
          for (const [dx, c] of dishes) {
            ctx.fillStyle = '#fbf6ee';
            ctx.beginPath();
            ctx.arc(cx + dx, cy, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(cx + dx, cy, 6.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        ctx.fillStyle = '#f2efe8';
        ctx.beginPath();
        ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e46b8a';
        ctx.beginPath();
        ctx.arc(b.x + b.w / 2, b.y + b.h / 2 - 4, 4, 0, Math.PI * 2);
        ctx.fill();
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
      const pillows = f.spots;
      for (const p of pillows) {
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
      ctx.fillStyle = '#6d4a32';
      rr(ctx, b.x + 1, b.y + 12, b.w - 2, 12, 3);
      ctx.fill();
      ctx.fillStyle = '#1f1f24';
      rr(ctx, b.x + 6, b.y + 3, b.w - 12, 12, 2);
      ctx.fill();
      if (fs.on) {
        const g = ctx.createLinearGradient(b.x + 8, 0, b.x + b.w - 8, 0);
        const hshift = (now / 30) % 360;
        g.addColorStop(0, `hsl(${hshift},70%,62%)`);
        g.addColorStop(1, `hsl(${(hshift + 120) % 360},70%,62%)`);
        ctx.fillStyle = g;
        ctx.fillRect(b.x + 8, b.y + 5, b.w - 16, 8);
        const glow = ctx.createRadialGradient(b.x + b.w / 2, b.y, 4, b.x + b.w / 2, b.y, 60);
        glow.addColorStop(0, 'rgba(160,200,255,0.35)');
        glow.addColorStop(1, 'rgba(160,200,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(b.x - 30, b.y - 60, b.w + 60, 70);
      }
      break;
    }
    case 'sofa':
      ctx.fillStyle = '#6f9583';
      rr(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 7);
      ctx.fill();
      ctx.fillStyle = '#87ad9a';
      for (let i = 0; i < 3; i++) {
        rr(ctx, b.x + 4 + i * T, b.y + 8, T - 6, b.h - 11, 5);
        ctx.fill();
      }
      ctx.fillStyle = '#5b7f6e';
      rr(ctx, b.x + 1, b.y + 1, b.w - 2, 7, 4);
      ctx.fill();
      break;
    case 'coffeetable':
      ctx.fillStyle = '#9c6c47';
      rr(ctx, b.x + 6, b.y + 5, b.w - 12, b.h - 10, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x + 22, b.y + 13, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'armchair': {
      const rock = fs.users.length ? Math.sin(now / 350) * 1.5 : 0;
      ctx.save();
      ctx.translate(0, rock);
      ctx.fillStyle = '#b5884f';
      rr(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 8);
      ctx.fill();
      ctx.fillStyle = '#e8c27a';
      rr(ctx, b.x + 5, b.y + 7, b.w - 10, b.h - 11, 5);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#8a6036';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, b.y - 8, 34, Math.PI * 0.38, Math.PI * 0.62);
      ctx.stroke();
      break;
    }
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
      ctx.fillStyle = '#c79a6b';
      rr(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 3);
      ctx.fill();
      ctx.fillStyle = fs.users.length ? '#ffffff' : '#e9dfcf';
      ctx.fillRect(b.x + 6, b.y + 10, b.w - 12, 14);
      ctx.fillStyle = '#5f8fb8';
      ctx.fillRect(b.x + 8, b.y + 30, 3, 10);
      break;
    case 'wardrobe':
    case 'cabinet':
      ctx.fillStyle = '#8b6446';
      rr(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 4, 3);
      ctx.fill();
      ctx.strokeStyle = '#6b4a32';
      ctx.lineWidth = 1;
      for (let x = b.x + T; x < b.x + b.w - 2; x += T) {
        ctx.beginPath();
        ctx.moveTo(x, b.y + 3);
        ctx.lineTo(x, b.y + b.h - 5);
        ctx.stroke();
      }
      ctx.fillStyle = '#e8c27a';
      ctx.fillRect(b.x + b.w / 2 - 4, b.y + b.h / 2 - 2, 2, 4);
      ctx.fillRect(b.x + b.w / 2 + 2, b.y + b.h / 2 - 2, 2, 4);
      break;
    case 'plant':
      ctx.fillStyle = '#b8714f';
      ctx.beginPath();
      ctx.arc(b.x + T / 2, b.y + T / 2 + 4, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5f9e5c';
      for (const [dx, dy] of [
        [-5, -3],
        [5, -3],
        [0, -8],
        [0, 0],
      ]) {
        ctx.beginPath();
        ctx.arc(b.x + T / 2 + dx, b.y + T / 2 + dy, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'dock':
      ctx.fillStyle = '#cfe9ea';
      ctx.beginPath();
      ctx.arc(b.x + T / 2, b.y + T / 2, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5fb8bf';
      ctx.lineWidth = 2;
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
