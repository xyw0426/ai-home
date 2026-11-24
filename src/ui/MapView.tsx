import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { FurnitureDef } from '../sim/map';
import type { AgentId } from '../sim/types';
import type { World } from '../sim/world';
import { CANVAS_H, CANVAS_W, T, drawWorld } from './render';

interface Props {
  world: World;
  robotView: boolean;
  selected: AgentId | null;
  onSelect: (id: AgentId | null) => void;
  alphaRef: MutableRefObject<number>;
}

interface Menu {
  f: FurnitureDef;
  left: number;
  top: number;
}

type Zoom = 'all' | 'width' | number;

const NOT_CLICKABLE = new Set(['plant', 'counter', 'wardrobe', 'cabinet', 'coffeetable', 'teatable', 'nightstand', 'microwave', 'toilet', 'shower', 'shelf', 'boxes', 'shoecab', 'floorlamp', 'vanity', 'rack']);

export function MapView({ world, robotView, selected, onSelect, alphaRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [zoom, setZoom] = useState<Zoom>('width');
  const [follow, setFollow] = useState(true);
  const [box, setBox] = useState({ w: 900, h: 640 });
  const [, force] = useState(0);

  // 量出可视区域大小，计算缩放
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fitW = box.w / CANVAS_W;
  const fitAll = Math.min(fitW, box.h / CANVAS_H);
  const scale = zoom === 'all' ? fitAll : zoom === 'width' ? fitW : zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const optsRef = useRef({ robotView, selected, world, follow });
  optsRef.current = { robotView, selected, world, follow };

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = CANVAS_W * dpr;
    c.height = CANVAS_H * dpr;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    let lastFollow = 0;
    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const o = optsRef.current;
      drawWorld(ctx, o.world, { robotView: o.robotView, selected: o.selected, hover: hoverRef.current, alpha: alphaRef.current, now });
      // 跟随：让被控制或被选中的角色留在视野中间区域
      const el = scrollRef.current;
      const target = o.world.controlled ?? (o.selected ? o.world.agents[o.selected] : null);
      if (o.follow && el && target && now - lastFollow > 300) {
        lastFollow = now;
        const sc = scaleRef.current;
        const px = (target.x + 0.5) * T * sc;
        const py = (target.y + 0.5) * T * sc;
        const mx = el.clientWidth * 0.25;
        const my = el.clientHeight * 0.25;
        let left = el.scrollLeft;
        let top = el.scrollTop;
        if (px < left + mx || px > left + el.clientWidth - mx) left = px - el.clientWidth / 2;
        if (py < top + my || py > top + el.clientHeight - my) top = py - el.clientHeight / 2;
        if (left !== el.scrollLeft || top !== el.scrollTop) el.scrollTo({ left, top, behavior: 'smooth' });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [alphaRef]);

  useEffect(() => setMenu(null), [world]);

  const cellOf = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * (CANVAS_W / T));
    const y = Math.floor(((e.clientY - r.top) / r.height) * (CANVAS_H / T));
    return { x, y, px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const onClick = (e: React.MouseEvent) => {
    const { x, y, px, py } = cellOf(e);
    const w = world;
    const ag = w.list.find((a) => a.x === x && a.y === y);
    const ctl = w.controlled;
    if (ag && (!ctl || ag !== ctl)) {
      if (ctl) w.commandApproach(ag.id);
      onSelect(ag.id);
      setMenu(null);
      return;
    }
    const f = w.map.furnitureAt(x, y);
    if (f && !NOT_CLICKABLE.has(f.type)) {
      setMenu({ f, left: px, top: py });
      return;
    }
    setMenu(null);
    if (ctl) w.commandMove(x, y);
  };

  const onMove = (e: React.MouseEvent) => {
    const { x, y } = cellOf(e);
    hoverRef.current = { x, y };
  };

  const ctl = world.controlled;
  const actions = menu && ctl ? world.furnitureActions(menu.f, ctl) : [];
  const cw = CANVAS_W * scale;
  const ch = CANVAS_H * scale;
  const zoomBy = (k: number) => setZoom(Math.max(0.35, Math.min(2, Math.round(scale * k * 100) / 100)));

  return (
    <div className="map-wrap">
      <div className="map-tools" role="group" aria-label="地图缩放">
        <button className={zoom === 'all' ? 'on' : ''} onClick={() => setZoom('all')} title="缩放到能看见整个房子">
          全屋
        </button>
        <button className={zoom === 'width' ? 'on' : ''} onClick={() => setZoom('width')} title="铺满宽度，上下滚动查看">
          适应宽度
        </button>
        <button onClick={() => zoomBy(1 / 1.2)} aria-label="缩小">
          −
        </button>
        <span className="zoom-val">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomBy(1.2)} aria-label="放大">
          +
        </button>
        <label className="follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          跟随{ctl ? ctl.name : selected ? world.agents[selected].name : '角色'}
        </label>
      </div>
      <div className="map-scroll" ref={scrollRef}>
        <div className="map-inner" style={{ width: cw, height: ch }}>
          <canvas
            ref={canvasRef}
            className="map"
            style={{ width: cw, height: ch, cursor: ctl ? 'crosshair' : 'pointer' }}
            onClick={onClick}
            onMouseMove={onMove}
            onMouseLeave={() => (hoverRef.current = null)}
          />
          {menu && (
            <div
              className="fmenu"
              style={{ left: Math.min(menu.left + 8, Math.max(0, cw - 230)), top: Math.min(menu.top + 8, Math.max(0, ch - 160)) }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="fmenu-title">
                {menu.f.name}
                <button className="x" onClick={() => setMenu(null)} aria-label="关闭">
                  ×
                </button>
              </div>
              <div className="fmenu-status">{world.furnitureStatus(menu.f)}</div>
              {ctl ? (
                actions.length ? (
                  actions.map((a) => (
                    <button
                      key={a.id}
                      className="btn block"
                      onClick={() => {
                        const ok = world.commandInteract(menu.f.id, a.id);
                        if (!ok) world.emit('system', `${ctl.name}没法${a.label}（位置被占或走不过去）`, ctl.id);
                        setMenu(null);
                        force((v) => v + 1);
                      }}
                    >
                      {ctl.name}：{a.label}
                    </button>
                  ))
                ) : (
                  <div className="muted">{ctl.name}暂时不能使用它</div>
                )
              ) : (
                <div className="muted">接管一个角色后，可以让他走过去使用</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
