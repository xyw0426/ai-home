import type { LLMProvider } from './llm';
import { World } from './world';
import { at } from './types';

export const DEMO_SEED = 20261121;
export const DEMO_START = at(11, 30);

/**
 * 可反复运行的演示场景：第 1 天 11:30（午饭前）。
 * 爸爸在书房用电脑（书房灯亮着），妈妈在厨房做饭，乐乐在儿童房搭积木，
 * 奶奶在客厅摇椅上休息，机器人小暖从走廊开始巡视。
 */
export function createDemoWorld(llm: LLMProvider, seed = DEMO_SEED): World {
  const w = new World(llm, { seed, startTime: DEMO_START });
  w.place('dad', 2, 3);
  w.place('mom', 4, 15);
  w.place('kid', 12, 3);
  w.place('grandma', 25, 15);
  w.place('robot', 18, 11);
  w.fs.lamp_study.on = true;
  w.fs.lamp_kitchen.on = true;

  w.startActivity(w.agents.dad, 'use_computer', { durMin: 25 });
  w.startActivity(w.agents.mom, 'cook', { until: at(11, 58), label: '做午饭' });
  w.startActivity(w.agents.kid, 'play_toys', { durMin: 30 });
  w.startActivity(w.agents.grandma, 'rest_chair', { durMin: 30 });
  w.emit('system', '演示场景开始：第1天 11:30，午饭前。书房的灯开着。');
  return w;
}
