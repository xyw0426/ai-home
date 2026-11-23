import { DemoLLM } from '../src/sim/demo';
import { createDemoWorld } from '../src/sim/scenario';
import type { World } from '../src/sim/world';
import type { LLMProvider } from '../src/sim/llm';

export const flush = () => new Promise<void>((r) => setImmediate(r));

export function demoWorld(llm: LLMProvider = new DemoLLM(7)): World {
  return createDemoWorld(llm);
}

/** 运行若干步，每步之后让出事件循环，使异步模型回复得以返回 */
export async function runTicks(w: World, n: number) {
  for (let i = 0; i < n; i++) {
    w.tick();
    await flush();
  }
}

export async function runUntil(w: World, pred: () => boolean, maxTicks = 20000): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return true;
    w.tick();
    await flush();
  }
  return pred();
}

export function minutes(m: number) {
  return Math.round((m * 60) / 10);
}
