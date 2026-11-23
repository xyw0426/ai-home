import { DemoLLM } from './demo';
import type { DialogueRequest, LLMProvider, ParseRequest, ParseResult } from './llm';

export interface ServerConfig {
  mode: 'live' | 'demo';
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyHint: string;
  source: 'env' | 'ui' | 'none';
  forceDemo: boolean;
  env: { hasKey: boolean; baseUrl: string; model: string };
  stats: { calls: number; failures: number; lastError: string; lastLatencyMs: number };
}

/**
 * 通过本地 Node 服务调用真实模型；服务处于演示模式或调用失败时，退回预置对白与规则解析。
 */
export class RemoteLLM implements LLMProvider {
  readonly mode = 'live' as const;
  fallbacks = 0;
  lastError = '';
  constructor(
    public model: string,
    private demo: DemoLLM,
    private apiBase = '/api',
    private onFallback?: (what: string, err: string) => void,
  ) {}
  get label() {
    return `真实模型 · ${this.model}`;
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    return data as T;
  }
  private fail(what: string, e: unknown) {
    this.fallbacks++;
    this.lastError = String((e as Error)?.message ?? e);
    this.onFallback?.(what, this.lastError);
  }
  async dialogue(req: DialogueRequest): Promise<string> {
    try {
      const r = await this.post<{ text: string }>('/dialogue', req);
      if (r.text) return r.text;
      throw new Error('空回复');
    } catch (e) {
      this.fail('对白生成', e);
      return this.demo.dialogue(req);
    }
  }
  async parse(req: ParseRequest): Promise<ParseResult> {
    try {
      const r = await this.post<{ result: ParseResult }>('/parse', req);
      return r.result;
    } catch (e) {
      this.fail('指令解析', e);
      return this.demo.parse(req);
    }
  }
}

export async function fetchServerConfig(apiBase = '/api'): Promise<ServerConfig | null> {
  try {
    const r = await fetch(`${apiBase}/config`);
    if (!r.ok) return null;
    return (await r.json()) as ServerConfig;
  } catch {
    return null;
  }
}
