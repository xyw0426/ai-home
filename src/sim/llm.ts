import type { AgentId, RoomId } from './types';

export interface DialogueRequest {
  speaker: { id: AgentId; name: string; desc: string; activity: string };
  listener: { id: AgentId; name: string; desc: string; activity: string };
  time: string;
  place: string;
  scene: string;
  recent: { speaker: string; text: string }[];
  intent: 'open' | 'reply';
  /** 家人对机器人说话时，允许顺带提出家务请求 */
  allowRequest?: boolean;
}

export type TriggerSpec = { type: 'now' } | { type: 'event'; event: 'lunch_end' } | { type: 'time'; time: string };

export type TaskAction = 'light_off' | 'light_on' | 'tv_off' | 'washer_start' | 'remind';

export interface TaskSpec {
  action: TaskAction;
  room?: RoomId;
  target?: AgentId;
  message?: string;
  trigger: TriggerSpec;
  condition: 'none' | 'room_empty';
}

export type ParseResult =
  | { kind: 'task'; task: TaskSpec; reply?: string }
  | { kind: 'clarify'; question: string }
  | { kind: 'chat'; reply?: string };

export interface ParseRequest {
  text: string;
  previous?: string;
  speaker: AgentId;
  speakerName: string;
  time: string;
  lunch: 'before' | 'during' | 'done';
}

export interface LLMProvider {
  readonly mode: 'demo' | 'live';
  readonly label: string;
  dialogue(req: DialogueRequest): Promise<string>;
  parse(req: ParseRequest): Promise<ParseResult>;
}
