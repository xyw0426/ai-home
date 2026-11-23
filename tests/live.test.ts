/**
 * 真实模型验证（需要先用 LLM_API_KEY 启动本地服务）：
 *   AIHOME_API=http://127.0.0.1:8787/api npx vitest run tests/live.test.ts
 * 未设置 AIHOME_API 时自动跳过。
 */
import { describe, expect, test } from 'vitest';
import { DemoLLM } from '../src/sim/demo';
import { RemoteLLM, fetchServerConfig } from '../src/sim/remote';
import { validateSpec } from '../src/sim/tasks';
import { createDemoWorld } from '../src/sim/scenario';
import { dist } from '../src/sim/types';
import { runTicks, runUntil } from './helpers';

const API = process.env.AIHOME_API;

describe.skipIf(!API)('真实模型', () => {
  test('服务处于真实模型模式', async () => {
    const cfg = await fetchServerConfig(API);
    expect(cfg?.mode).toBe('live');
  });

  test('对话生成：一两句、贴合情境', async () => {
    const llm = new RemoteLLM('live', new DemoLLM(1), API, (w, e) => {
      throw new Error(`${w} 回退到了演示：${e}`);
    });
    const w = createDemoWorld(llm);
    const req = w.buildDialogueRequest(w.agents.grandma, w.agents.kid, [], 'open');
    const text = await llm.dialogue(req);
    console.log('奶奶 → 乐乐：', text);
    expect(text.length).toBeGreaterThan(2);
    expect(text.length).toBeLessThanOrEqual(60);
    expect(llm.fallbacks).toBe(0);
  });

  test('临时任务解析：吃完饭帮我看看书房的灯，没人就关掉', async () => {
    const llm = new RemoteLLM('live', new DemoLLM(1), API);
    const r = await llm.parse({ text: '吃完饭帮我看看书房的灯，没人就关掉', speaker: 'dad', speakerName: '爸爸', time: '11:40', lunch: 'before' });
    console.log('解析结果：', JSON.stringify(r));
    expect(llm.fallbacks).toBe(0);
    expect(r.kind).toBe('task');
    if (r.kind !== 'task') return;
    expect(r.task).toMatchObject({ action: 'light_off', room: 'study', condition: 'room_empty', trigger: { type: 'event', event: 'lunch_end' } });
    expect(validateSpec(r.task, 'dad', false).ok).toBe(true);
  });

  test('不明确时追问', async () => {
    const llm = new RemoteLLM('live', new DemoLLM(1), API);
    const r = await llm.parse({ text: '帮我把灯关了', speaker: 'dad', speakerName: '爸爸', time: '11:40', lunch: 'before' });
    console.log('解析结果：', JSON.stringify(r));
    expect(r.kind).toBe('clarify');
  });

  test('完整流程：真实模型下接管爸爸交代任务，午饭后机器人关灯', async () => {
    const llm = new RemoteLLM('live', new DemoLLM(1), API);
    const w = createDemoWorld(llm);
    await runTicks(w, 12);
    w.takeControl('dad');
    await runUntil(w, () => {
      const r = w.agents.robot;
      if (dist(w.agents.dad, r) <= 2 && w.canTalk(w.agents.dad, r)) return true;
      if (w.agents.dad.path.length === 0) w.commandApproach('robot');
      return false;
    }, 600);
    w.say('吃完饭帮我看看书房的灯，没人就关掉');
    // 等待真实模型返回（期间不推进模拟，避免对白过多）
    for (let i = 0; i < 200 && w.robot.parsing > 0; i++) await new Promise((r) => setTimeout(r, 100));
    await runTicks(w, 2);
    const reply = w.lines.filter((l) => l.speaker === 'robot').pop();
    console.log('小暖的确认：', reply?.text);
    const task = w.robot.todo.find((t) => t.spec.action === 'light_off' && t.spec.room === 'study');
    expect(task).toBeTruthy();
    w.release();
    // 推进到任务完成；真实对白异步返回，不阻塞时钟
    const ok = await runUntil(w, () => task!.status === 'done', 3000);
    const lines = w.lines.filter((l) => l.speaker !== 'robot').slice(0, 6).map((l) => `${w.agents[l.speaker].name}：${l.text}`);
    console.log('部分真实对白：\n' + lines.join('\n'));
    console.log('模型调用回退次数：', llm.fallbacks, llm.lastError);
    expect(ok).toBe(true);
    expect(w.fs.lamp_study.on).toBe(false);
  });
});
