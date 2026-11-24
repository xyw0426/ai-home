export type RoomId =
  | 'balcony'
  | 'study'
  | 'dining'
  | 'kitchen'
  | 'kids'
  | 'living'
  | 'master'
  | 'theater'
  | 'bathroom'
  | 'grandma'
  | 'storage'
  | 'corridor';

export type AgentId = 'dad' | 'mom' | 'grandma' | 'kid' | 'robot';
export type FamilyId = Exclude<AgentId, 'robot'>;

export interface Pt {
  x: number;
  y: number;
}

/** 一个模拟步长对应的游戏秒数 */
export const TICK_SEC = 10;
export const DAY_SEC = 86400;

export const ROOM_IDS: RoomId[] = [
  'balcony',
  'study',
  'dining',
  'kitchen',
  'kids',
  'living',
  'master',
  'theater',
  'bathroom',
  'grandma',
  'storage',
  'corridor',
];
export const FAMILY_IDS: FamilyId[] = ['dad', 'mom', 'grandma', 'kid'];
export const AGENT_IDS: AgentId[] = ['dad', 'mom', 'grandma', 'kid', 'robot'];

export function hm(t: number): string {
  const s = ((t % DAY_SEC) + DAY_SEC) % DAY_SEC;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function tod(t: number): number {
  return ((t % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

export function dayOf(t: number): number {
  return Math.floor(t / DAY_SEC) + 1;
}

export function at(h: number, m = 0): number {
  return h * 3600 + m * 60;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
