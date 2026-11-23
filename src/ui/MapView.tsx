import { useEffect, useRef, useState, type MutableRefObject } from 'react';
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

export function MapView({ world, robotView, selected, onSelect, alphaRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const optsRef = useRef({ robotView, selected, world });
  optsRef.current = { robotView, selected, world };
  const [menu, setMenu] = useState<Menu | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = CANVAS_W * dpr;
    c.height = CANVAS_H * dpr;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const o = optsRef.current;
      drawWorld(ctx, o.world, { robotView: o.robotView, selected: o.selected, hover: hoverRef.current, alpha: alphaRef.current, now });
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
    if (f && f.type !== 'plant' && f.type !== 'counter' && f.type !== 'fridge' && f.type !== 'wardrobe' && f.type !== 'cabinet' && f.type !== 'coffeetable') {
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
  const wrapW = wrapRef.current?.clientWidth ?? 800;

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map"
        style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, cursor: ctl ? 'crosshair' : 'pointer' }}
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={() => (hoverRef.current = null)}
      />
      {menu && (
        <div className="fmenu" style={{ left: Math.min(menu.left + 8, wrapW - 230), top: menu.top + 8 }} onClick={(e) => e.stopPropagation()}>
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
  );
}
