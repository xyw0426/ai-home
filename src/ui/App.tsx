import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DemoLLM } from '../sim/demo';
import { RemoteLLM, fetchServerConfig, type ServerConfig } from '../sim/remote';
import { createDemoWorld } from '../sim/scenario';
import { at, dist, hm, tod, type AgentId } from '../sim/types';
import type { World } from '../sim/world';
import { ApiModal } from './ApiModal';
import { MapView } from './MapView';
import { EventLog, FamilyPanel, RobotPanel } from './Panels';

const BASE_TICK_MS = 250; // 1× 时每步（10 游戏秒）的真实毫秒数
const SPEEDS = [1, 2, 4, 8, 16];
const QUICK_LINES = ['吃完饭帮我看看书房的灯，没人就关掉', '帮我把灯关了', '下午三点帮我给阳台的花浇水', '晚上八点提醒我给奶奶打洗脚水', '今天天气真好'];

export function App() {
  const demoRef = useRef(new DemoLLM(7, [300, 900]));
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const worldRef = useRef<World>(createDemoWorld(demoRef.current));
  const [, setVersion] = useState(0);
  const [speed, setSpeed] = useState(2);
  const [paused, setPaused] = useState(false);
  const [ffTarget, setFfTarget] = useState<number | null>(null);
  const [robotView, setRobotView] = useState(false);
  const [selected, setSelected] = useState<AgentId | null>('robot');
  const [showApi, setShowApi] = useState(false);
  const [input, setInput] = useState('');
  const [script, setScript] = useState<null | { step: number }>(null);
  const w = worldRef.current;
  if (import.meta.env.DEV) (window as unknown as { __world: () => World }).__world = () => worldRef.current;

  const makeLLM = useCallback((cfg: ServerConfig | null) => {
    if (cfg && cfg.mode === 'live')
      return new RemoteLLM(cfg.model, demoRef.current, '/api', (what, err) =>
        worldRef.current.emit('system', `⚠️ ${what}调用失败，本次改用预置内容：${err.slice(0, 80)}`),
      );
    return demoRef.current;
  }, []);

  const refreshConfig = useCallback(async () => {
    const cfg = await fetchServerConfig();
    setServerDown(!cfg);
    setConfig(cfg);
    const llm = makeLLM(cfg);
    const prev = worldRef.current.llm.mode;
    worldRef.current.setLLM(llm);
    if (prev !== llm.mode) worldRef.current.emit('system', `对话模式切换为：${llm.label}`);
  }, [makeLLM]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  // 主循环
  const accRef = useRef(0);
  const alphaRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.min(250, now - last);
      last = now;
      const world = worldRef.current;
      if (ffTarget !== null) {
        for (let i = 0; i < 40; i++) {
          world.tick();
          if (tod(world.t) >= ffTarget && tod(world.t) < ffTarget + 3600) {
            setFfTarget(null);
            setSpeed(1);
            break;
          }
        }
        alphaRef.current = 1;
      } else if (!paused) {
        accRef.current += dt * speed;
        let n = 0;
        while (accRef.current >= BASE_TICK_MS && n < 20) {
          world.tick();
          accRef.current -= BASE_TICK_MS;
          n++;
        }
        alphaRef.current = Math.min(1, accRef.current / BASE_TICK_MS);
      }
      if (now - lastUi > 200) {
        lastUi = now;
        setVersion((v) => v + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, speed, ffTarget]);

  // 一键演示：接管爸爸 → 走到机器人身边 → 说出交代 → 释放
  useEffect(() => {
    if (!script) return;
    const world = worldRef.current;
    const dad = world.agents.dad;
    const robot = world.agents.robot;
    if (script.step === 0) {
      setSelected('dad');
      world.takeControl('dad');
      world.commandApproach('robot');
      setScript({ step: 1 });
    } else if (script.step === 1) {
      if (dist(dad, robot) <= 2 && world.canTalk(dad, robot)) {
        world.say(QUICK_LINES[0]);
        setScript({ step: 2 });
      } else if (dad.path.length === 0 || !dad.act) world.commandApproach('robot');
    } else if (script.step === 2) {
      if (world.robot.parsing === 0 && world.inbox.length === 0 && world.lines.some((l) => l.speaker === 'robot' && l.listener === 'dad'))
        setScript({ step: 3 });
    } else if (script.step === 3) {
      window.setTimeout(() => {
        world.release();
        setScript(null);
      }, 1500);
      setScript({ step: 4 });
    }
  });

  const reset = () => {
    worldRef.current = createDemoWorld(makeLLM(config));
    accRef.current = 0;
    setFfTarget(null);
    setScript(null);
    setSelected('robot');
    setPaused(false);
  };

  const ctl = w.controlled;
  const phase = w.phase();
  const s = w.timeOfDay;
  const phaseLabel =
    phase === 'sleep' ? '夜间 · 睡觉' : phase === 'lunch' ? '午饭中' : s < at(12, 0) ? '午饭前' : w.lunch.state === 'done' && s < at(14, 0) ? '午饭后' : s < at(18, 0) ? '下午' : '晚上';
  const mode = w.llm.mode;

  const send = () => {
    const text = input.trim();
    if (!text || !ctl) return;
    w.say(text);
    setInput('');
  };

  const modeBadge = useMemo(() => {
    if (serverDown) return { cls: 'demo', text: '演示模式 · 本地服务未连接' };
    if (mode === 'live') return { cls: 'live', text: `真实模型 · ${config?.model ?? ''}` };
    return { cls: 'demo', text: config?.forceDemo ? '演示模式（已手动切换）' : '演示模式 · 预置对白' };
  }, [mode, config, serverDown]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🏠</span>
          <div>
            <div className="title">AI Home</div>
            <div className="subtitle">可观察、可介入的家庭模拟</div>
          </div>
        </div>
        <div className="clock">
          <div className="clock-time">
            第{w.day}天 <b>{hm(w.t)}</b>
          </div>
          <span className={`phase phase-${phase}`}>{phaseLabel}</span>
        </div>
        <div className="speed" role="group" aria-label="游戏速度">
          <button className={paused ? 'on' : ''} onClick={() => setPaused((p) => !p)} title="暂停/继续">
            {paused ? '▶' : '⏸'}
          </button>
          {SPEEDS.map((v) => (
            <button
              key={v}
              className={!paused && speed === v && ffTarget === null ? 'on' : ''}
              onClick={() => {
                setSpeed(v);
                setPaused(false);
                setFfTarget(null);
              }}
            >
              {v}×
            </button>
          ))}
          <button className={ffTarget !== null ? 'on ff' : 'ff'} onClick={() => setFfTarget(at(21, 45))} title="快进到 21:45">
            ⏩ 快进到夜间
          </button>
        </div>
        <div className="top-actions">
          <button className={`mode-badge ${modeBadge.cls}`} onClick={() => setShowApi(true)} title="点击配置模型 API">
            <span className="dot" />
            {modeBadge.text}
          </button>
          <button className="btn" onClick={() => setShowApi(true)}>
            ⚙ API 设置
          </button>
          <button className="btn" onClick={reset} title="回到第1天 11:30 的演示场景">
            ↺ 重置演示
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="stage">
          <div className="stage-head">
            <label className="toggle">
              <input type="checkbox" checked={robotView} onChange={(e) => setRobotView(e.target.checked)} />
              <span>👁 机器人视角</span>
            </label>
            <span className="legend">
              {robotView ? '亮黄色格子 = 小暖此刻能看见；暗处被墙挡住或超出 7 格视野' : '点击人物查看详情，点击家具查看状态'}
            </span>
          </div>
          <MapView
            world={w}
            robotView={robotView}
            selected={selected}
            onSelect={setSelected}
            alphaRef={alphaRef}
          />
          <div className={`dock ${ctl ? 'active' : ''}`}>
            {ctl ? (
              <>
                <div className="dock-row">
                  <span className="ctl-tag" style={{ background: ctl.persona.color }}>
                    🎮 正在控制：{ctl.name}
                  </span>
                  <span className="hint">点地板移动 · 点家具选择互动 · 点人物走到他身边 · 其他角色和时钟照常运行</span>
                  <button className="btn release" onClick={() => w.release()}>
                    释放控制
                  </button>
                </div>
                <div className="dock-row">
                  <input
                    className="say"
                    value={input}
                    placeholder={`让${ctl.name}说点什么（附近、没被墙隔开的人能听到）…`}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && send()}
                  />
                  <button className="btn primary" onClick={send} disabled={!input.trim()}>
                    说出来
                  </button>
                </div>
                <div className="dock-row quick">
                  {QUICK_LINES.map((q) => (
                    <button key={q} className="chip" onClick={() => setInput(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="dock-row">
                <span className="hint">在右侧「家庭成员」点「接管」控制一个角色；或者直接运行验收场景 2：</span>
                <button className="btn primary" onClick={() => setScript({ step: 0 })} disabled={!!script || w.lunch.state !== 'before'}>
                  ▶ 一键演示：爸爸交代关灯
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="side">
          <FamilyPanel world={w} selected={selected} onSelect={setSelected} />
          <RobotPanel world={w} />
          <EventLog world={w} />
        </aside>
      </main>
      {showApi && (
        <ApiModal
          config={config}
          serverDown={serverDown}
          onClose={() => setShowApi(false)}
          onChanged={refreshConfig}
        />
      )}
    </div>
  );
}
