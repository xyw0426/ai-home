import type { DialogueRequest, LLMProvider, ParseRequest, ParseResult, TaskSpec, TriggerSpec } from './llm';
import type { AgentId, RoomId } from './types';
import { ROOM_NAME } from './map';
import { Rng } from './rng';

/* ------------------------------------------------------------------ */
/* 规则版指令解析（演示模式，也作为真实模型失败时的兜底）               */
/* ------------------------------------------------------------------ */

const ROOM_WORDS: [RegExp, RoomId][] = [
  [/书房|工作室/, 'study'],
  [/儿童房|乐乐(的)?房间|孩子(的)?房间/, 'kids'],
  [/奶奶(的)?房|奶奶屋|奶奶的屋/, 'grandma'],
  [/主卧|卧室|我们(的)?房间/, 'master'],
  [/走廊|过道|玄关|门口/, 'corridor'],
  [/厨房/, 'kitchen'],
  [/餐厅|饭厅/, 'dining'],
  [/客厅|大厅/, 'living'],
  [/阳台/, 'balcony'],
  [/影音室|放映室|家庭影院|看电影的(房间|屋)/, 'theater'],
  [/卫生间|洗手间|浴室|厕所/, 'bathroom'],
  [/储物间|杂物间/, 'storage'],
];

const PERSON_WORDS: [RegExp, AgentId][] = [
  [/奶奶/, 'grandma'],
  [/爸爸|老爸/, 'dad'],
  [/妈妈|老妈/, 'mom'],
  [/乐乐|孩子|儿子/, 'kid'],
];

const CN_NUM: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

function parseHour(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (s in CN_NUM) return CN_NUM[s];
  return null;
}

function findTime(text: string): string | null {
  const m = text.match(/(早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2}|十二|十一|十|[一二两三四五六七八九])\s*[点:：]\s*(半|(\d{1,2})分?)?/);
  if (!m) return null;
  const tail = text.slice((m.index ?? 0) + m[0].length);
  if (!m[1] && !/\d/.test(m[2]) && !m[3] && !tail.startsWith('钟')) return null;
  let h = parseHour(m[2]);
  if (h === null || h > 24) return null;
  const period = m[1];
  if ((period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里') && h < 12) h += 12;
  if (period === '中午' && h < 6) h += 12;
  let min = 0;
  if (m[3] === '半') min = 30;
  else if (m[4]) min = Math.min(59, Number(m[4]));
  return `${String(h % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function looksLikeRequest(text: string): boolean {
  return /帮|麻烦|记得|提醒|关掉|关上|关了|关一下|打开|开一下|开灯|关灯|看看|启动|洗衣|电视|浇花|浇水|小暖/.test(text);
}

export function ruleParse(req: ParseRequest): ParseResult {
  const text = (req.previous ? req.previous + '。' : '') + req.text;
  if (!looksLikeRequest(text)) return { kind: 'chat' };

  let room: RoomId | undefined;
  for (const [re, id] of ROOM_WORDS) if (re.test(text)) room = id;
  // 以最后提到的房间为准（追问后补充的房间写在后面）
  const roomHits = ROOM_WORDS.map(([re, id]) => ({ id, i: text.search(re) })).filter((h) => h.i >= 0);
  if (roomHits.length) room = roomHits.sort((a, b) => b.i - a.i)[0].id;
  if (!room && /我(的)?(房间|屋)/.test(text)) {
    room = ({ grandma: 'grandma', kid: 'kids', dad: 'master', mom: 'master', robot: undefined } as const)[req.speaker];
  }

  let trigger: TriggerSpec = { type: 'now' };
  const time = findTime(text);
  if (time) trigger = { type: 'time', time };
  else if (/吃完饭|吃完午饭|饭后|午饭后|吃好饭|吃过饭/.test(text)) trigger = { type: 'event', event: 'lunch_end' };

  const condition: TaskSpec['condition'] = /没人|无人|没有人|屋里空|没人在/.test(text) ? 'room_empty' : 'none';

  // 提醒
  if (/提醒/.test(text)) {
    let target: AgentId | undefined;
    const after = text.slice(text.indexOf('提醒') + 2);
    if (/^我/.test(after)) target = req.speaker;
    else for (const [re, id] of PERSON_WORDS) if (re.test(after.slice(0, 4))) target = id;
    if (!target) return { kind: 'clarify', question: '要我提醒谁呢？' };
    let message = after
      .replace(/^(我|奶奶|爸爸|老爸|妈妈|老妈|乐乐|孩子|儿子)/, '')
      .replace(/^(一下|一声)/, '')
      .replace(/[。！!，,]+$/, '')
      .trim();
    if (!message) return { kind: 'clarify', question: '要提醒什么事呢？' };
    if (trigger.type === 'now' && !/现在|马上|这就/.test(text)) return { kind: 'clarify', question: '好的，要在什么时候提醒呢？' };
    return { kind: 'task', task: { action: 'remind', target, message, trigger, condition: 'none' } };
  }

  if (/浇花|浇水|浇浇|给.{0,6}花/.test(text)) {
    return { kind: 'task', task: { action: 'water_plants', room: 'balcony', trigger, condition: 'none' } };
  }

  if (/洗衣机|洗衣服|把衣服洗/.test(text)) {
    return { kind: 'task', task: { action: 'washer_start', room: 'bathroom', trigger, condition: 'none' } };
  }

  if (/电视|投影|电影/.test(text) && /关/.test(text)) {
    return { kind: 'task', task: { action: 'tv_off', room: room === 'theater' ? 'theater' : 'living', trigger, condition } };
  }

  if (/灯/.test(text)) {
    const off = /关/.test(text);
    const on = /开灯|打开|开一下|开着|把灯开/.test(text) && !off;
    if (!off && !on) return { kind: 'clarify', question: room ? `要我把${roomLabel(room)}的灯打开还是关掉呢？` : '是要开灯还是关灯呢？' };
    if (!room) return { kind: 'clarify', question: off ? '要关哪个房间的灯呢？' : '要开哪个房间的灯呢？' };
    return { kind: 'task', task: { action: off ? 'light_off' : 'light_on', room, trigger, condition } };
  }

  if (/帮|麻烦/.test(text)) return { kind: 'clarify', question: '需要我帮什么忙呢？可以说得具体一点吗？' };
  return { kind: 'chat' };
}

function roomLabel(r: RoomId): string {
  return ROOM_NAME[r];
}

/* ------------------------------------------------------------------ */
/* 预置对白                                                            */
/* ------------------------------------------------------------------ */

const OPEN: Record<AgentId, string[]> = {
  dad: [
    '{L}，我刚写完一段代码，脑子终于能歇会儿了。',
    '{L}，今天天气不错，下午要不要一起出去走走？',
    '{L}，你看我这黑眼圈，是不是该早点睡了？',
    '{L}，我书房那本旧相册你见过没？',
    '{L}，晚上想吃点什么？我来打下手。',
  ],
  mom: [
    '{L}，中午做了你爱吃的番茄炒蛋。',
    '{L}，衣服我待会儿一起洗了啊。',
    '{L}，别老坐着，起来活动活动。',
    '{L}，冰箱里的酸奶快过期了，记得喝。',
    '{L}，今天作业写了多少啦？',
  ],
  grandma: [
    '{L}，过来坐会儿，陪奶奶说说话。',
    '{L}，天凉了，多穿件衣服。',
    '{L}，我年轻那会儿啊，一顿能吃三个馒头。',
    '{L}，这电视剧演得跟真的一样。',
    '{L}，别光顾着忙，喝口热水。',
  ],
  kid: [
    '{L}，我搭了一座超高的城堡！',
    '{L}，为什么天是蓝色的呀？',
    '{L}，我能再看一集动画片吗？',
    '{L}，你猜我今天在学校学了什么？',
    '{L}，陪我玩一会儿积木嘛！',
  ],
  robot: ['{L}，我在巡视，家里一切正常。', '{L}，需要帮忙随时叫我。', '{L}，记得多喝水哦。'],
};

/** 「目标|台词」：带目标的台词只对该听者说 */
const LUNCH: Record<AgentId, string[]> = {
  dad: ['今天这鱼烧得真入味。', 'kid|乐乐，青菜也要吃，长个子。', 'grandma|妈，您多吃点，这个炖得软。', 'mom|辛苦啦，今天的菜都是我爱吃的。'],
  mom: ['趁热吃，凉了就不好吃了。', 'kid|乐乐，别挑食哦。', 'grandma|妈，汤我少放了盐。', 'dad|你少喝点饮料，多喝汤。'],
  grandma: ['你们多吃点，我吃不了这么多。', '这汤真鲜，比饭馆的还好。', 'kid|乐乐慢点吃，别噎着。'],
  kid: ['我要再来一碗饭！', 'mom|妈妈做的番茄炒蛋天下第一！', '吃完饭我能去玩积木吗？'],
  robot: ['大家慢慢吃，我去巡视一下。'],
};

const REPLY: Record<AgentId, string[]> = {
  dad: ['哈哈，有道理。', '行，听你的。', '好嘞，我记住了。', '嗯，等我忙完这阵就来。'],
  mom: ['知道啦，你也别太累。', '好呀，一会儿我来弄。', '嗯，这个主意不错。', '你呀，就会说好听的。'],
  grandma: ['好好好，你们年轻人说得对。', '哎，奶奶记下了。', '慢慢来，不着急。', '嗯，这样挺好。'],
  kid: ['好耶！', '知道啦知道啦！', '那我们说好了哦！', '为什么呀？'],
  robot: ['好的，有需要随时叫我。', '收到，我会留意的。', '没问题。'],
};

/** 看到对方正在做的事时说的话 */
const ACTIVITY_LINES: [RegExp, string[]][] = [
  [/弹钢琴/, ['{L}，这首曲子真好听，再弹一遍吧！', '{L}，琴弹得越来越好了。', '{L}，弹的是什么曲子呀？']],
  [/听钢琴/, ['{L}，一起听会儿琴吧。']],
  [/冰箱|零食/, ['{L}，又去冰箱找零食啦？快吃饭了，少吃点。', '{L}，冰箱里有新买的酸奶。']],
  [/咖啡/, ['{L}，又冲咖啡？下午喝多了晚上睡不着。', '{L}，咖啡好香，给我也来一杯。']],
  [/浇水/, ['{L}，阳台的花开得真好，都是你照顾的功劳。']],
  [/喝茶/, ['{L}，阳台晒太阳真舒服吧？']],
  [/收音机|戏曲/, ['{L}，又在听戏呢？这段唱得真好。']],
  [/试衣服/, ['{L}，这件衣服挺好看的！']],
  [/积木/, ['{L}，你搭的是什么呀？']],
  [/电脑/, ['{L}，别老盯着电脑，起来活动活动。']],
];

const ROBOT_REQUESTS: { from: AgentId; text: string }[] = [
  { from: 'grandma', text: '小暖，下午三点帮我给阳台的花浇浇水。' },
  { from: 'mom', text: '小暖，晚上八点提醒我把阳台的衣服收进来。' },
  { from: 'grandma', text: '小暖，晚上七点帮我把我房间的灯打开。' },
  { from: 'kid', text: '小暖，帮我把洗衣机打开，我的球衣要洗。' },
];

export function demoLine(req: DialogueRequest, rng: Rng, used: Set<string>): string {
  const sp = req.speaker.id;
  const L = req.listener.name;
  const last = req.recent[req.recent.length - 1];
  if (req.intent === 'reply' && last) {
    const t = last.text;
    if (/药/.test(t)) {
      if (sp === 'grandma') return '哎，好嘞，我这就去吃药，小暖真贴心。';
      if (sp === 'robot') return req.listener.id === 'grandma' ? '不客气，奶奶，有事随时叫我。' : '好的，我会留意奶奶吃药的。';
      return '好的，我会盯着奶奶吃药的。';
    }
    if (/灯/.test(t) && sp !== 'robot') return '好，谢谢小暖。';
    if (sp === 'robot') return rng.pick(REPLY.robot);
    if (/吗|？|\?|为什么/.test(t)) {
      const ans: Record<AgentId, string[]> = {
        dad: ['当然可以，不过别太久哦。', '这个嘛，爸爸查查资料再告诉你。'],
        mom: ['可以，但是先把手洗干净。', '好呀，不过要早点睡。'],
        grandma: ['行啊，奶奶都依你。', '这个奶奶也说不清，问你爸去。'],
        kid: ['我也不知道呀！', '那我想一想！'],
        robot: ['这个我可以帮你查一下。'],
      };
      return rng.pick(ans[sp]);
    }
    return pickUnused(REPLY[sp], rng, used);
  }
  if (req.listener.id === 'robot' && req.allowRequest) {
    const r = ROBOT_REQUESTS.find((x) => x.from === sp && !used.has(x.text));
    if (r) {
      used.add(r.text);
      return r.text;
    }
  }
  if (!/午饭/.test(req.scene) && sp !== 'robot' && rng.chance(0.6)) {
    const hit = ACTIVITY_LINES.find(([re]) => re.test(req.listener.activity));
    if (hit) return pickUnused(hit[1], rng, used).replace('{L}', L);
  }
  const raw = /午饭/.test(req.scene) ? LUNCH[sp] : OPEN[sp];
  const pool = raw
    .filter((l) => !l.includes('|') || l.startsWith(req.listener.id + '|'))
    .map((l) => (l.includes('|') ? l.slice(l.indexOf('|') + 1) : l));
  return pickUnused(pool.length ? pool : OPEN[sp], rng, used).replace('{L}', L);
}

function pickUnused(pool: string[], rng: Rng, used: Set<string>): string {
  const fresh = pool.filter((p) => !used.has(p));
  const s = rng.pick(fresh.length ? fresh : pool);
  used.add(s);
  if (used.size > 60) used.clear();
  return s;
}

/** 演示模式：用预置对白与规则解析，不需要 API 密钥 */
export class DemoLLM implements LLMProvider {
  readonly mode = 'demo' as const;
  readonly label = '演示模式（预置对白）';
  private rng: Rng;
  private used = new Set<string>();
  constructor(
    seed = 7,
    private latencyMs: [number, number] = [0, 0],
  ) {
    this.rng = new Rng(seed);
  }
  private wait(): Promise<void> {
    const [a, b] = this.latencyMs;
    if (b <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, a + Math.random() * (b - a)));
  }
  async dialogue(req: DialogueRequest): Promise<string> {
    await this.wait();
    return demoLine(req, this.rng, this.used);
  }
  async parse(req: ParseRequest): Promise<ParseResult> {
    await this.wait();
    return ruleParse(req);
  }
}
