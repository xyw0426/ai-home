import type { RoomId, Pt } from './types';
import { hm } from './types';

/**
 * 短期记忆：带时间戳的现场观察。
 * - 容量 STM_CAP 条
 * - 同一对象在同一房间的观察只保留最新一条（原条目更新时间并移到队尾）
 * - 超出容量时淘汰最旧的一条（FIFO）
 */
export const STM_CAP = 16;

export interface StmEntry {
  t: number;
  subject: string; // agent id 或 light:<room> / room:<room>
  room: RoomId | null;
  pos?: Pt;
  text: string;
  detail: string; // 不含时间的描述，用于生成 text
}

export class ShortTermMemory {
  entries: StmEntry[] = [];
  evicted = 0;

  record(t: number, subject: string, room: RoomId | null, detail: string, pos?: Pt, sameSubjectOnly = false) {
    const i = this.entries.findIndex((e) => e.subject === subject && (sameSubjectOnly || e.room === room));
    if (i >= 0) this.entries.splice(i, 1);
    this.entries.push({ t, subject, room, pos, detail, text: `${hm(t)} ${detail}` });
    while (this.entries.length > STM_CAP) {
      this.entries.shift();
      this.evicted++;
    }
  }

  latest(subject: string): StmEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].subject === subject) return this.entries[i];
    return undefined;
  }
}

/**
 * 长期记忆：跨天有效的信息（固定安排、家人常去的地方、家人的偏好）。
 * - 容量 LTM_CAP 条
 * - pinned（固定安排）不会被淘汰
 * - 满了以后淘汰 strength 最低的非固定条目，强度相同淘汰最久未更新的
 */
export const LTM_CAP = 10;

export type LtmKind = 'schedule' | 'habit' | 'preference';

export interface LtmEntry {
  key: string;
  kind: LtmKind;
  text: string;
  pinned: boolean;
  strength: number;
  updated: number;
  /** habit 条目：谁、在哪 */
  who?: string;
  room?: RoomId;
}

export class LongTermMemory {
  entries: LtmEntry[] = [];
  evicted: string[] = [];

  upsert(e: Omit<LtmEntry, 'updated'>, t: number): void {
    const cur = this.entries.find((x) => x.key === e.key);
    if (cur) {
      Object.assign(cur, e, { updated: t });
      return;
    }
    this.entries.push({ ...e, updated: t });
    while (this.entries.length > LTM_CAP) {
      const candidates = this.entries.filter((x) => !x.pinned);
      if (!candidates.length) break;
      candidates.sort((a, b) => a.strength - b.strength || a.updated - b.updated);
      const victim = candidates[0];
      this.entries.splice(this.entries.indexOf(victim), 1);
      this.evicted.push(victim.text);
    }
  }

  habitsOf(who: string): LtmEntry[] {
    return this.entries.filter((e) => e.kind === 'habit' && e.who === who).sort((a, b) => b.strength - a.strength);
  }
}
