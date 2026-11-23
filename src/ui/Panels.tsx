import { useState } from 'react';
import { ROOM_NAME } from '../sim/map';
import { LTM_CAP, STM_CAP } from '../sim/memory';
import type { Task } from '../sim/tasks';
import { ROOM_IDS, hm, type AgentId } from '../sim/types';
import type { World, WorldEvent } from '../sim/world';

const STATUS: Record<Task['status'], [string, string]> = {
  pending: ['待触发', 'st-pending'],
  due: ['已到期', 'st-due'],
  active: ['执行中', 'st-active'],
  waiting: ['稍后再查', 'st-waiting'],
  done: ['已完成', 'st-done'],
  cancelled: ['已取消', 'st-cancel'],
};

function trig(t: Task): string {
  const tr = t.spec.trigger;
  if (tr.type === 'now') return '立即';
  if (tr.type === 'event') return '午饭结束后';
  return `${tr.time}`;
}

export function FamilyPanel({ world, selected, onSelect }: { world: World; selected: AgentId | null; onSelect: (id: AgentId) => void }) {
  return (
    <section className="card">
      <h3>家庭成员</h3>
      <ul className="members">
        {world.list.map((a) => {
          const room = world.roomOfAgent(a);
          return (
            <li key={a.id} className={`${selected === a.id ? 'sel' : ''} ${a.controlled ? 'ctl' : ''}`} onClick={() => onSelect(a.id)}>
              <span className="avatar" style={{ background: a.persona.color }}>
                {a.id === 'robot' ? '🤖' : a.name.slice(0, 1)}
              </span>
              <div className="m-main">
                <div className="m-name">
                  {a.name}
                  <span className="m-room">{room ? ROOM_NAME[room] : '门口'}</span>
                  {a.controlled && <span className="tag green">接管中</span>}
                  {a.convId !== null && <span className="tag">💬 交谈中</span>}
                </div>
                <div className="m-act">{world.activityText(a)}</div>
              </div>
              {a.controlled ? (
                <button
                  className="btn small release"
                  onClick={(e) => {
                    e.stopPropagation();
                    world.release();
                  }}
                >
                  释放
                </button>
              ) : (
                <button
                  className="btn small"
                  onClick={(e) => {
                    e.stopPropagation();
                    world.takeControl(a.id);
                    onSelect(a.id);
                  }}
                >
                  接管
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RobotPanel({ world }: { world: World }) {
  const [tab, setTab] = useState<'todo' | 'stm' | 'ltm' | 'rooms'>('todo');
  const [open, setOpen] = useState<number | null>(null);
  const rb = world.robot;
  const plan = rb.plan;
  const tasks = [...rb.todo, ...rb.history.slice(0, 6)];
  return (
    <section className="card robot">
      <h3>
        🤖 小暖 <span className={`tag mode-${rb.mode}`}>{{ patrol: '巡视', task: '执行任务', charge: '充电', attend: '倾听', user: '用户控制' }[rb.mode]}</span>
      </h3>
      <dl className="plan">
        <dt>正在做</dt>
        <dd>{plan.doing}</dd>
        <dt>下一站</dt>
        <dd>{plan.next}</dd>
        <dt>起因</dt>
        <dd>{plan.because}</dd>
      </dl>
      <div className="tabs">
        {(
          [
            ['todo', `待办 ${rb.todo.filter((t) => t.status !== 'done').length}`],
            ['stm', `短期记忆 ${rb.stm.entries.length}/${STM_CAP}`],
            ['ltm', `长期记忆 ${rb.ltm.entries.length}/${LTM_CAP}`],
            ['rooms', '房间巡视'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'todo' && (
          <ul className="tasks">
            {tasks.length === 0 && <li className="muted">暂无任务</li>}
            {tasks.map((t) => (
              <li key={t.id} className={rb.currentTaskId === t.id ? 'cur' : ''}>
                <div className="t-head" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <span className={`st ${STATUS[t.status][1]}`}>{STATUS[t.status][0]}</span>
                  <span className="t-title">
                    #{t.id} {t.title}
                  </span>
                  <span className="t-meta">
                    {t.priority >= 2 ? '⏰ 提醒' : '🧹 家务'} · {trig(t)}
                    {t.recurring ? ' · 每天' : ''}
                    {t.status === 'waiting' && t.retryAt ? ` · ${hm(t.retryAt)} 再查` : ''}
                  </span>
                </div>
                {(open === t.id || rb.currentTaskId === t.id) && (
                  <ol className="t-log">
                    {t.log.slice(-8).map((l, i) => (
                      <li key={i}>{l.text}</li>
                    ))}
                    {t.status !== 'done' && t.status !== 'cancelled' && !t.recurring && (
                      <li>
                        <button className="link" onClick={() => rb.cancelTask(t.id)}>
                          取消此任务
                        </button>
                      </li>
                    )}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
        {tab === 'stm' && (
          <>
            <p className="rule">容量 {STM_CAP} 条；同一对象在同一房间只保留最新一条；满了淘汰最旧的。已淘汰 {rb.stm.evicted} 条。</p>
            <ul className="mem">
              {rb.stm.entries
                .slice()
                .reverse()
                .map((e, i) => (
                  <li key={i}>{e.text}</li>
                ))}
            </ul>
          </>
        )}
        {tab === 'ltm' && (
          <>
            <p className="rule">容量 {LTM_CAP} 条，跨天保留；📌 固定安排不淘汰；满了淘汰强度最低（相同则最久未更新）的条目。</p>
            <ul className="mem">
              {rb.ltm.entries.map((e) => (
                <li key={e.key}>
                  {e.pinned ? '📌 ' : e.kind === 'habit' ? '🏠 ' : '💡 '}
                  {e.text}
                  {!e.pinned && <span className="muted"> · 强度 {e.strength}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {tab === 'rooms' && (
          <table className="rooms">
            <thead>
              <tr>
                <th>房间</th>
                <th>上次检查</th>
                <th>灯（观察到的）</th>
              </tr>
            </thead>
            <tbody>
              {ROOM_IDS.map((r) => {
                const c = rb.roomChecked[r];
                const l = rb.lightKnown[r];
                return (
                  <tr key={r}>
                    <td>{ROOM_NAME[r]}</td>
                    <td>{Number.isFinite(c) ? hm(c) : '从未'}</td>
                    <td>{l ? `${l.on ? '💡 亮' : '⚫ 灭'}（${hm(l.t)}）` : '未知'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

const FILTERS: { id: string; label: string; match: (e: WorldEvent) => boolean }[] = [
  { id: 'all', label: '全部', match: (e) => !(e.type === 'robot' && /巡视完/.test(e.text)) },
  { id: 'talk', label: '对话', match: (e) => e.type === 'dialogue' },
  { id: 'task', label: '任务', match: (e) => e.type === 'task' || e.type === 'robot' },
  { id: 'act', label: '活动与家具', match: (e) => e.type === 'activity_start' || e.type === 'activity_end' || e.type === 'furniture' },
];

export function EventLog({ world }: { world: World }) {
  const [f, setF] = useState('all');
  const filt = FILTERS.find((x) => x.id === f)!;
  const items = world.events.filter(filt.match).slice(-80).reverse();
  return (
    <section className="card log">
      <h3>
        刚刚发生了什么
        <span className="filters">
          {FILTERS.map((x) => (
            <button key={x.id} className={f === x.id ? 'on' : ''} onClick={() => setF(x.id)}>
              {x.label}
            </button>
          ))}
        </span>
      </h3>
      <ul className="events">
        {items.map((e) => (
          <li key={e.id} className={`ev ev-${e.type}`}>
            <time>{hm(e.t)}</time>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
