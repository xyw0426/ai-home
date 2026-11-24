import { useRef, useState } from 'react';
import { ROOMS, W, type FurnitureType } from '../sim/map';
import type { World } from '../sim/world';

const ICON: Partial<Record<FurnitureType, string>> = {
  lamp: '💡',
  tv: '📺',
  computer: '💻',
  bookshelf: '📚',
  stove: '🔥',
  sink: '🚰',
  fridge: '🧊',
  washer: '🧺',
  table: '🍽️',
  bed: '🛏️',
  sofa: '🛋️',
  armchair: '🪑',
  toybox: '🧸',
  desk: '✏️',
  piano: '🎹',
  stool: '🪑',
  coffee: '☕',
  plants: '🪴',
  rattan: '🍵',
  mirror: '🪞',
  basin: '🪥',
  bathtub: '🛁',
  radio: '📻',
  dock: '🔌',
};

const STATE_LABEL = { busy: '使用中', on: '开着', alert: '需要照料', idle: '空闲' } as const;

interface Props {
  world: World;
  onFocus: (fid: string) => void;
  onClose: () => void;
}

/** 可拖动的小窗：列出所有可交互家具的实时状态 */
export function FurniturePanel({ world, onFocus, onClose }: Props) {
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [pos, setPos] = useState({ x: 16, y: 56 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const items = world.map.furniture.filter((f) => f.interactive);
  const states = new Map(items.map((f) => [f.id, world.furnitureState(f)]));
  const count = { busy: 0, on: 0, alert: 0, idle: 0 };
  for (const s of states.values()) count[s]++;

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const parent = boxRef.current?.parentElement?.getBoundingClientRect();
    const w = boxRef.current?.offsetWidth ?? 320;
    const maxX = Math.max(0, (parent?.width ?? 900) - w);
    const maxY = Math.max(0, (parent?.height ?? 700) - 60);
    setPos({
      x: Math.min(maxX, Math.max(0, e.clientX - drag.current.dx)),
      y: Math.min(maxY, Math.max(0, e.clientY - drag.current.dy)),
    });
  };
  const onUp = () => (drag.current = null);

  /** 定位家具；如果它在地图左半边，就把窗口挪到右边，免得挡住高亮 */
  const focusOn = (fid: string, cellX: number) => {
    const parentW = boxRef.current?.parentElement?.getBoundingClientRect().width ?? 900;
    const w = boxRef.current?.offsetWidth ?? 340;
    const right = Math.max(0, parentW - w - 16);
    setPos((p) => ({ ...p, x: cellX < W / 2 ? right : 16 }));
    onFocus(fid);
  };

  return (
    <div className="fpanel" ref={boxRef} style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="家具状态">
      <div className="fpanel-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <span className="fpanel-title">🛋 家具状态</span>
        <span className="fpanel-sum">
          <i className="st-busy">{count.busy}</i> 使用中 · <i className="st-on">{count.on}</i> 开着 · <i className="st-alert">{count.alert}</i> 要照料
        </span>
        <button className="x" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="fpanel-filter">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          全部 {items.length}
        </button>
        <button className={filter === 'active' ? 'on' : ''} onClick={() => setFilter('active')}>
          有动静的 {count.busy + count.on + count.alert}
        </button>
        <span className="muted">点一行可在地图上找到它</span>
      </div>
      <div className="fpanel-body">
        {ROOMS.map((r) => {
          const list = items.filter((f) => f.room === r.id && (filter === 'all' || states.get(f.id) !== 'idle'));
          if (!list.length) return null;
          return (
            <section key={r.id}>
              <h4>{r.name}</h4>
              <ul>
                {list.map((f) => {
                  const st = states.get(f.id)!;
                  const fs = world.fs[f.id];
                  return (
                    <li key={f.id} className={`frow frow-${st}`} onClick={() => focusOn(f.id, f.cells[0].x)} title="在地图上定位">
                      <span className="ficon">{ICON[f.type] ?? '•'}</span>
                      <span className="fname">{f.name}</span>
                      <span className={`ftag tag-${st}`}>{STATE_LABEL[st]}</span>
                      <span className="fstatus">{world.furnitureStatus(f)}</span>
                      {f.type === 'plants' && (
                        <span className="fwater" aria-label={`水分 ${Math.round((fs.water ?? 1) * 100)}%`}>
                          <span style={{ width: `${Math.round((fs.water ?? 1) * 100)}%` }} className={(fs.water ?? 1) < 0.35 ? 'dry' : ''} />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
