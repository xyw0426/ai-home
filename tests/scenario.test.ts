import { describe, expect, test } from 'vitest';
import { demoWorld, minutes, runTicks, runUntil } from './helpers';
import { at, dist, hm, tod, type AgentId } from '../src/sim/types';
import { COOK_WINDOWS, type World } from '../src/sim/world';

const INSTRUCTION = '吃完饭帮我看看书房的灯，没人就关掉';

/** 模拟用户：接管爸爸，点击机器人附近的地板走过去，输入那句话 */
async function dadInstructsRobot(w: World) {
  w.takeControl('dad');
  const dad = w.agents.dad;
  const robot = w.agents.robot;
  const ok = await runUntil(
    w,
    () => {
      if (dist(dad, robot) <= 2 && w.canTalk(dad, robot)) return true;
      if (w.tickCount % 3 === 0 || dad.path.length === 0) {
        // 点击机器人旁边一格可走的地板
        const cands = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
          .map(([dx, dy]) => ({ x: robot.x + dx, y: robot.y + dy }))
          .filter((p) => w.map.isWalkable(p.x, p.y) && !w.agentAt(p.x, p.y));
        if (cands.length) w.commandMove(cands[0].x, cands[0].y);
      }
      return false;
    },
    600,
  );
  expect(ok).toBe(true);
  const listener = w.say(INSTRUCTION);
  expect(listener).toBe('robot');
  await runUntil(w, () => w.robot.parsing === 0 && w.inbox.length === 0, 30);
  await runTicks(w, 2);
}

function lightTask(w: World) {
  return [...w.robot.todo, ...w.robot.history].find((t) => t.spec.action === 'light_off' && t.spec.room === 'study');
}

describe('地图与视线', () => {
  test('墙阻挡视线，门洞不阻挡', () => {
    const w = demoWorld();
    const m = w.map;
    // 客厅(11,12) 看书房(8,12)：中间隔着书房的墙
    expect(m.los(11, 12, 8, 12)).toBe(false);
    // 餐厅(8,18) 透过书房门(8,16) 看见书房里的(8,13)
    expect(m.los(8, 18, 8, 13)).toBe(true);
    const vis = new Set(m.visibleFrom({ x: 8, y: 18 }));
    expect(vis.has(m.idx(8, 13))).toBe(true);
    expect(vis.has(m.idx(6, 14))).toBe(false);
    // 屋外空地也挡视线、不能走
    expect(m.isWall(2, 2)).toBe(true);
    expect(m.isWalkable(2, 2)).toBe(false);
    // 机器人视角：站在客厅时看不到书房里用电脑的爸爸
    w.place('robot', 13, 12);
    w.robot.perceive();
    expect(w.robot.sees('dad')).toBe(false);
  });

  test('参照户型图的房间都在，墙自动围起来', () => {
    const w = demoWorld();
    const names = w.map.rooms.map((r) => r.name);
    for (const n of ['阳台', '书房', '餐厅', '厨房', '儿童房', '客厅', '主卧', '衣帽间', '卫生间', '奶奶房', '储物间', '玄关走廊']) expect(names).toContain(n);
    // 每个房间都能从充电座走到，并且有灯
    const dock = w.map.byId.get('dock')!.spots[0];
    for (const r of w.map.rooms) {
      expect(w.map.lampOf[r.id], r.id).toBeTruthy();
      const cell = w.map.pt(w.map.roomCells[r.id].find((i) => w.map.walk[i] === 1)!);
      expect(w.map.bfs(dock, cell), r.id).not.toBeNull();
    }
  });

  test('所有家具使用位置都可以从充电座走到', () => {
    const w = demoWorld();
    const dock = w.map.byId.get('dock')!.spots[0];
    for (const f of w.map.furniture) for (const s of f.spots) expect(w.map.bfs(dock, s), `${f.id} (${s.x},${s.y})`).not.toBeNull();
  });
});

describe('验收场景（演示模式）', () => {
  test('1. 五个角色出现在各自区域，自主活动、使用家具、碰面说话，午饭到餐桌集合', async () => {
    const w = demoWorld();
    const roomOf = (id: AgentId) => w.map.roomAt(w.agents[id].x, w.agents[id].y);
    expect(roomOf('dad')).toBe('study');
    expect(roomOf('mom')).toBe('kitchen');
    expect(roomOf('kid')).toBe('kids');
    expect(roomOf('grandma')).toBe('living');
    expect(roomOf('robot')).toBe('storage');
    await runUntil(w, () => tod(w.t) >= at(12, 15));
    const starts = w.events.filter((e) => e.type === 'activity_start' && e.data?.fid);
    const fids = new Set(starts.map((e) => e.data!.fid));
    expect(fids.has('computer')).toBe(true);
    expect(fids.has('stove')).toBe(true);
    expect(fids.has('toybox')).toBe(true);
    expect(fids.has('rocker')).toBe(true);
    // 午饭集合：每个人坐在自己的座位上
    const seats = w.map.byId.get('table')!.spots;
    const owners = w.map.byId.get('table')!.owners!;
    owners.forEach((id, i) => {
      const a = w.agents[id];
      expect([a.x, a.y, a.act?.kind]).toEqual([seats[i].x, seats[i].y, 'eat']);
    });
    expect(w.fs.table.mode).toBe('served');
    const talk = w.events.filter((e) => e.type === 'dialogue' && e.actor !== 'robot');
    expect(talk.length).toBeGreaterThan(0);
  });

  test('2-3. 接管爸爸交代任务 → 释放 → 午饭后先提醒奶奶，再确认书房无人后关灯', async () => {
    const w = demoWorld();
    await runTicks(w, minutes(2));
    await dadInstructsRobot(w);
    const task = lightTask(w)!;
    expect(task).toBeTruthy();
    expect(task.spec).toMatchObject({ trigger: { type: 'event', event: 'lunch_end' }, condition: 'room_empty' });
    expect(task.status).toBe('pending');
    const confirm = w.lines.filter((l) => l.speaker === 'robot').pop()!;
    expect(confirm.text).toMatch(/书房/);

    // 释放控制：爸爸恢复自主活动
    w.release();
    await runTicks(w, 6);
    expect(w.agents.dad.controlled).toBe(false);
    expect(w.agents.dad.act).not.toBeNull();
    expect(w.agents.dad.act!.byUser).toBeFalsy();

    // 午饭后：先完成提醒，再关灯
    await runUntil(w, () => w.lunch.state === 'done');
    const lunchEnd = w.t;
    const grandmaSeen = w.robot.stm.latest('grandma');
    expect(grandmaSeen).toBeTruthy();
    await runTicks(w, 1);
    const remind = w.robot.todo.find((t) => t.recurring)!;
    expect(remind.search?.candidates[0].room ?? w.robot.stm.latest('grandma')?.room).toBeTruthy();
    const ok = await runUntil(w, () => lightTask(w)?.status === 'done', minutes(90));
    expect(ok).toBe(true);
    expect(remind.status).toBe('done');
    expect(remind.doneAt!).toBeGreaterThanOrEqual(lunchEnd);
    expect(remind.doneAt!).toBeLessThan(lightTask(w)!.doneAt!);
    expect(w.fs.lamp_study.on).toBe(false);
    expect(w.occupants('study').filter((a) => a.id !== 'robot')).toHaveLength(0);
    const firstSearch = w.events.find((e) => e.type === 'robot' && e.data?.firstRoom);
    if (firstSearch) expect(firstSearch.data!.firstRoom).toBe(grandmaSeen!.room);
    const reminderLine = w.lines.find((l) => l.speaker === 'robot' && l.listener === 'grandma');
    expect(reminderLine?.text).toMatch(/药/);
    console.log('提醒完成', hm(remind.doneAt!), '关灯完成', hm(lightTask(w)!.doneAt!));
  });

  test('3b. 书房有人时，关灯任务保持待办', async () => {
    const w = demoWorld();
    await runTicks(w, minutes(2));
    await dadInstructsRobot(w);
    // 爸爸回书房坐着，不释放控制
    w.commandInteract('computer', 'use_computer');
    await runUntil(w, () => w.lunch.state === 'done');
    const ok = await runUntil(w, () => lightTask(w)?.status === 'waiting', minutes(60));
    expect(ok).toBe(true);
    const t = lightTask(w)!;
    expect(w.fs.lamp_study.on).toBe(true);
    expect(t.log.some((l) => /书房里有爸爸/.test(l.text))).toBe(true);
    expect(w.robot.todo.includes(t)).toBe(true);
    // 爸爸离开后，再次检查时完成
    w.release();
    w.agents.dad.afterLunchPending = true;
    const ok2 = await runUntil(w, () => t.status === 'done', minutes(120));
    expect(ok2).toBe(true);
    expect(w.fs.lamp_study.on).toBe(false);
  });

  test('4. 快进到夜间，家人回到各自床位睡觉', async () => {
    const w = demoWorld();
    await runUntil(w, () => tod(w.t) >= at(21, 50));
    const beds: Record<string, [number, number]> = {};
    for (const f of w.map.furniture)
      if (f.type === 'bed') f.owners!.forEach((o, i) => (beds[o] = [f.spots[i].x, f.spots[i].y]));
    expect(Object.keys(beds).sort()).toEqual(['dad', 'grandma', 'kid', 'mom']);
    for (const [id, [x, y]] of Object.entries(beds)) {
      const a = w.agents[id as AgentId];
      expect([a.name, a.x, a.y, a.sleeping]).toEqual([a.name, x, y, true]);
    }
    await runUntil(w, () => tod(w.t) >= at(22, 40));
    const dock = w.map.byId.get('dock')!.spots[0];
    expect([w.agents.robot.x, w.agents.robot.y]).toEqual([dock.x, dock.y]);
    expect(w.robot.todo.find((t) => t.recurring)?.status).toBe('done');
  });

  test('临时交代不明确时机器人当面追问，补充后加入待办', async () => {
    const w = demoWorld();
    await runTicks(w, minutes(2));
    w.takeControl('dad');
    await runUntil(w, () => {
      const r = w.agents.robot;
      if (dist(w.agents.dad, r) <= 2 && w.canTalk(w.agents.dad, r)) return true;
      if (w.agents.dad.path.length === 0) w.commandApproach('robot');
      return false;
    }, 600);
    w.say('帮我把灯关了');
    await runTicks(w, 3);
    expect(w.lines.filter((l) => l.speaker === 'robot').pop()?.text).toMatch(/哪个房间/);
    w.say('书房的');
    await runTicks(w, 3);
    expect(w.robot.todo.some((t) => t.spec.action === 'light_off' && t.spec.room === 'study')).toBe(true);
  });

  test('记忆容量与淘汰规则', async () => {
    const w = demoWorld();
    await runUntil(w, () => tod(w.t) >= at(15, 0));
    expect(w.robot.stm.entries.length).toBeLessThanOrEqual(16);
    expect(w.robot.ltm.entries.length).toBeLessThanOrEqual(10);
    expect(w.robot.ltm.entries.filter((e) => e.pinned)).toHaveLength(3);
  });

  test('等待模型回复时时钟和其他角色继续运行，回复返回时重新检查条件', async () => {
    const w = demoWorld({
      mode: 'live',
      label: 'slow',
      dialogue: () => new Promise((r) => setTimeout(() => r('慢回复'), 30)),
      parse: async () => ({ kind: 'chat' }),
    });
    await runUntil(w, () => w.pendingLLM > 0, minutes(60));
    const t0 = w.t;
    const pos = w.list.map((a) => `${a.x},${a.y}`).join('|');
    // 同步推进 30 步，期间不让出事件循环，模型回复不可能到达
    for (let i = 0; i < 30; i++) w.tick();
    expect(w.t - t0).toBe(300);
    expect(w.list.map((a) => `${a.x},${a.y}`).join('|')).not.toBe(pos);
    expect(w.pendingLLM).toBeGreaterThan(0);
  });
});

describe('巡视与自主关灯', () => {
  test('巡视会走到走廊两端', async () => {
    const w = demoWorld();
    const xs = new Set<number>();
    await runUntil(w, () => {
      const r = w.agents.robot;
      if (w.map.roomAt(r.x, r.y) === 'corridor') xs.add(r.x);
      return tod(w.t) >= at(15, 0);
    });
    const corridor = w.map.room('corridor');
    expect(Math.min(...xs)).toBe(corridor.x0);
    expect(Math.max(...xs)).toBe(corridor.x1);
    // 巡视点不占用家人的座位、开关等使用位置
    // （充电座是机器人自己的位置，允许）
    const spots = new Set(w.map.furniture.filter((f) => f.type !== 'dock').flatMap((f) => f.spots.map((p) => `${p.x},${p.y}`)));
    for (const pts of Object.values(w.map.patrolPoints)) for (const p of pts) expect(spots.has(`${p.x},${p.y}`)).toBe(false);
  });

  test('房间没人但灯亮着时，机器人自己确认后关灯；有人时不关', async () => {
    const w = demoWorld();
    w.fs.lamp_kids.on = true; // 乐乐在儿童房玩，灯开着
    await runUntil(w, () => tod(w.t) >= at(11, 55));
    expect(w.fs.lamp_kids.on).toBe(true);
    expect(w.robot.todo.some((t) => t.spec.action === 'light_off' && t.spec.room === 'kids')).toBe(false);
    // 爸爸去吃午饭没关书房灯（没有任何人交代），机器人发现后自己关掉
    let offAt = 0;
    w.onEvent((e) => {
      if (e.data?.fid === 'lamp_study' && e.data.on === false && !offAt) {
        offAt = w.t;
        expect(w.occupants('study').filter((a) => a.id !== 'robot')).toHaveLength(0);
      }
    });
    const ok = await runUntil(w, () => !w.fs.lamp_study.on, minutes(120));
    expect(ok).toBe(true);
    const task = [...w.robot.todo, ...w.robot.history].find((t) => t.spec.action === 'light_off' && t.spec.room === 'study')!;
    expect(task.source).toBe('observation');
    expect(task.log.some((l) => /屋里没人，灯却亮着/.test(l.text))).toBe(true);
    console.log('自主关书房灯：', hm(offAt));
  });

  test('有人交代开灯的房间，不会因为没人就马上关掉', async () => {
    const w = demoWorld();
    w.robot.addTask({ action: 'light_on', room: 'grandma', trigger: { type: 'now' }, condition: 'none' }, 'dialogue', 'grandma');
    await runUntil(w, () => w.fs.lamp_grandma.on, minutes(60));
    expect(w.fs.lamp_grandma.on).toBe(true);
    await runTicks(w, minutes(60));
    expect(w.fs.lamp_grandma.on).toBe(true);
  });
});

describe('做饭时间', () => {
  test('妈妈只在早饭、午饭、晚饭前做饭，每顿一次', async () => {
    const w = demoWorld();
    const starts: string[] = [];
    w.onEvent((e) => {
      if (e.type === 'activity_start' && e.data?.activity === 'cook') {
        expect(e.actor).toBe('mom');
        starts.push(`${w.day}:${hm(w.t)}`);
      }
    });
    let stoveOff = true;
    await runUntil(w, () => {
      const s = tod(w.t);
      if (w.fs.stove.on) {
        // 灶台只在做饭时间内（允许到达稍晚、收尾几分钟）开着
        const inWin = COOK_WINDOWS.some((c) => s >= c.start && s < c.end + 6 * 60);
        if (!inWin) stoveOff = false;
      }
      return w.day === 2 && s >= at(12, 0);
    }, 30000);
    console.log('妈妈做饭开始时间：', starts.join(' | '));
    const laundry = w.events.filter((e) => e.type === 'activity_start' && e.data?.activity === 'do_laundry');
    for (let i = 1; i < laundry.length; i++) expect(laundry[i].t - laundry[i - 1].t).toBeGreaterThanOrEqual(3 * 3600);
    expect(stoveOff).toBe(true);
    // 第1天午饭(开局已在做) + 第1天晚饭 + 第2天早饭 + 第2天午饭
    expect(starts).toHaveLength(4);
    const inWindow = (st: string) => {
      const [h, m] = st.split(':').slice(1).map(Number);
      const s = h * 3600 + m * 60;
      return COOK_WINDOWS.some((c) => s >= c.start && s < c.end);
    };
    expect(starts.every(inWindow)).toBe(true);
  });
});

describe('新家具', () => {
  test('家人一天里会用到钢琴、冰箱、咖啡机、花架等新家具，并且有可观察的状态变化', async () => {
    const w = demoWorld();
    const used = new Map<string, string>();
    const seen = { piano: false, fridge: false, coffee: false, plants: false, radio: false };
    w.onEvent((e) => {
      if (e.type === 'activity_start' && e.data?.fid && e.actor) used.set(String(e.data.fid), `${hm(e.t)} ${e.text}`);
    });
    await runUntil(w, () => {
      if (w.fs.piano.on) seen.piano = true;
      if (w.fs.fridge.on) seen.fridge = true;
      if (w.fs.coffee.on) seen.coffee = true;
      if ((w.fs.plants.runUntil ?? 0) > w.t) seen.plants = true;
      if (w.fs.radio.on) seen.radio = true;
      return tod(w.t) >= at(21, 0);
    }, 30000);
    const newOnes = ['piano', 'fridge', 'coffee', 'plants', 'rattan', 'mirror', 'basin', 'bathtub', 'radio', 'stools'].filter((f) => used.has(f));
    console.log('用到的新家具：', newOnes.map((f) => used.get(f)).join(' | '));
    expect(newOnes.length).toBeGreaterThanOrEqual(5);
    expect(Object.values(seen).filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  test('接管角色后可以弹钢琴、开冰箱，状态随之变化', async () => {
    const w = demoWorld();
    w.takeControl('kid');
    expect(w.furnitureActions(w.map.byId.get('piano')!, w.agents.kid).map((a) => a.id)).toContain('play_piano');
    w.commandInteract('piano', 'play_piano');
    await runUntil(w, () => w.fs.piano.on, minutes(30));
    expect(w.fs.piano.users).toEqual(['kid']);
    expect(w.furnitureStatus(w.map.byId.get('piano')!)).toMatch(/乐乐正在弹琴/);
    w.commandInteract('fridge', 'get_snack');
    expect(w.fs.piano.on).toBe(false);
    await runUntil(w, () => w.fs.fridge.on, minutes(30));
    expect(w.furnitureStatus(w.map.byId.get('fridge')!)).toMatch(/门开着/);
  });

  test('机器人能听懂“帮我给阳台的花浇水”并去阳台浇花', async () => {
    const w = demoWorld();
    w.fs.plants.runUntil = 0;
    w.robot.hear('grandma', '小暖，帮我给阳台的花浇浇水');
    await runTicks(w, 2);
    const task = w.robot.todo.find((t) => t.spec.action === 'water_plants');
    expect(task?.spec.room).toBe('balcony');
    const ok = await runUntil(w, () => task!.status === 'done', minutes(90));
    expect(ok).toBe(true);
    expect(w.fs.plants.runUntil!).toBeGreaterThan(w.t);
    const r = w.agents.robot;
    expect(w.map.roomAt(r.x, r.y)).toBe('balcony');
  });
});
