// 提示词与输出清洗。模拟器负责时间、位置、碰撞和任务状态；模型只负责台词和理解临时交代。

export function buildDialogueMessages(ctx) {
  const s = ctx.speaker ?? {};
  const l = ctx.listener ?? {};
  const recent = (ctx.recent ?? []).map((r) => `${r.speaker}：${r.text}`).join('\n') || '（还没有人说话）';
  const system = [
    '你是一个温馨的2D家庭生活模拟的台词作者。家里有爸爸、妈妈、奶奶、8岁的孩子乐乐和家用机器人小暖。',
    '根据人物设定、时间地点、双方正在做的事和最近的对白，只为“说话人”写下一句台词。',
    '要求：中文口语；一到两句话，不超过40个字；贴合说话人的身份和当下情境；如果是回应，要接住对方上一句。',
    '只输出台词本身：不要引号、不要写说话人名字、不要写动作或旁白。',
  ].join('\n');
  const lines = [
    `时间：${ctx.time}；地点：${ctx.place}；场景：${ctx.scene}`,
    `说话人：${s.name}（${s.desc}）——正在：${s.activity}`,
    `听话人：${l.name}（${l.desc}）——正在：${l.activity}`,
    `最近对白：\n${recent}`,
    ctx.intent === 'reply' ? `请写${s.name}对上一句的回应。` : `请写${s.name}主动对${l.name}说的第一句话。`,
  ];
  if (ctx.allowRequest && ctx.intent === 'open')
    lines.push(
      '提示：说话人在和家用机器人小暖说话。可以只是闲聊，也可以有三成可能请它帮一件小事（例如某个房间开灯或关灯、没人看时关电视、启动洗衣机、到某个时间提醒某人做某事），请求要说清楚房间和时间。',
    );
  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}

export function buildParseMessages(ctx) {
  const system = `你是家用机器人“小暖”的指令理解模块。把家人刚对你说的话解析成 JSON，只输出 JSON。
可执行动作 action：
- light_off：关某个房间的灯（常与条件 room_empty 搭配，如“没人就关掉”）
- light_on：开某个房间的灯
- tv_off：关客厅的电视
- washer_start：启动厨房的洗衣机
- remind：到时候当面提醒某个家人做某事（message 写要提醒的事，不带称呼，如“按时吃降压药”）
房间 room：study=书房，kids=儿童房(乐乐的房间)，master=卧室(爸爸妈妈的房间)，grandma=奶奶房，corridor=走廊，kitchen=厨房，dining=餐厅，living=客厅。说话人说“我房间”时按说话人推断。
家人 target：dad=爸爸，mom=妈妈，grandma=奶奶，kid=乐乐；说话人说“提醒我”时 target 为说话人自己。
触发时机 trigger：{"type":"now"} 立即；{"type":"event","event":"lunch_end"} 吃完午饭后/吃完饭；{"type":"time","time":"HH:MM"} 指定时刻（24小时制，“晚上八点”=20:00）。
执行条件 condition："room_empty"（房间没人才执行）或 "none"。
输出三选一：
{"kind":"task","task":{"action":"...","room":"...","target":"...","message":"...","trigger":{...},"condition":"..."},"reply":"小暖的一句口头确认，复述要做的事和时机，不超过30字"}
{"kind":"clarify","question":"目标或意思不明确时，小暖当面追问的一句话"}
{"kind":"chat","reply":"不是请求、只是闲聊时，小暖的一句简短回应"}
不在上述能力范围内的请求，用 clarify 礼貌说明并询问。`;
  const user = [
    `当前时间：${ctx.time}；午饭状态：${ctx.lunch === 'done' ? '今天午饭已经吃完' : ctx.lunch === 'during' ? '正在吃午饭' : '还没吃午饭'}`,
    `说话人：${ctx.speakerName}（id=${ctx.speaker}）`,
    ctx.previous ? `之前的对话（你曾就此追问）：${ctx.previous}` : '',
    `刚说的话：${ctx.text}`,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function cleanLine(text, speakerName) {
  let t = String(text ?? '').trim();
  t = t.split('\n').filter(Boolean)[0] ?? '';
  if (speakerName) t = t.replace(new RegExp(`^${speakerName}\\s*[:：]\\s*`), '');
  t = t.replace(/^[^：:]{1,4}[：:]\s*/, (m) => (m.length <= 5 ? '' : m));
  t = t.replace(/^[“"「『]+|[”"」』]+$/g, '').replace(/[（(][^）)]*[）)]/g, '').trim();
  if (t.length > 60) {
    const cut = t.slice(0, 60);
    const i = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
    t = i > 10 ? cut.slice(0, i + 1) : cut;
  }
  return t;
}

export function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
