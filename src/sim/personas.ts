import type { AgentId, FamilyId, RoomId } from './types';

export type ActivityKind =
  | 'use_computer'
  | 'read_book'
  | 'cook'
  | 'do_laundry'
  | 'wash_dishes'
  | 'watch_tv'
  | 'sofa_rest'
  | 'rest_chair'
  | 'play_toys'
  | 'homework'
  | 'nap'
  | 'eat'
  | 'sleep'
  | 'wander'
  | 'visit'
  | 'charge'
  | 'user_move'
  | 'user_toggle';

export interface ActivitySpec {
  label: string;
  icon: string;
  /** 使用的家具 id；'bed' 表示自己的床，'seat' 表示餐桌座位 */
  furniture?: string;
  dur: [number, number];
}

export const ACTIVITIES: Record<ActivityKind, ActivitySpec> = {
  use_computer: { label: '用电脑', icon: '💻', furniture: 'computer', dur: [30, 55] },
  read_book: { label: '读书', icon: '📖', furniture: 'bookshelf', dur: [20, 40] },
  cook: { label: '做饭', icon: '🍳', furniture: 'stove', dur: [20, 35] },
  do_laundry: { label: '放衣服进洗衣机', icon: '🧺', furniture: 'washer', dur: [4, 6] },
  wash_dishes: { label: '洗碗', icon: '🫧', furniture: 'sink', dur: [10, 15] },
  watch_tv: { label: '看电视', icon: '📺', furniture: 'tv', dur: [25, 45] },
  sofa_rest: { label: '沙发上休息', icon: '🛋️', furniture: 'sofa', dur: [15, 30] },
  rest_chair: { label: '摇椅上休息', icon: '🪑', furniture: 'rocker', dur: [25, 50] },
  play_toys: { label: '玩积木', icon: '🧸', furniture: 'toybox', dur: [25, 45] },
  homework: { label: '写作业', icon: '✏️', furniture: 'desk', dur: [20, 30] },
  nap: { label: '午睡', icon: '💤', furniture: 'bed', dur: [30, 45] },
  eat: { label: '吃午饭', icon: '🍚', furniture: 'seat', dur: [0, 0] },
  sleep: { label: '睡觉', icon: '😴', furniture: 'bed', dur: [0, 0] },
  wander: { label: '四处走走', icon: '🚶', dur: [3, 8] },
  visit: { label: '找家人聊天', icon: '💬', dur: [5, 9] },
  charge: { label: '充电', icon: '🔌', furniture: 'dock', dur: [0, 0] },
  user_move: { label: '按指令移动', icon: '🎮', dur: [0, 0] },
  user_toggle: { label: '按指令操作', icon: '🎮', dur: [0, 0] },
};

export interface Persona {
  id: AgentId;
  name: string;
  role: string;
  desc: string;
  color: string;
  hair: string;
  homeRoom: RoomId;
  bed?: string;
  prefs: { kind: ActivityKind; w: number }[];
  afterLunch?: ActivityKind;
  /** 负责在早饭、午饭、晚饭前做饭（其余时间不做饭） */
  cooksMeals?: boolean;
  /** 离开房间时会不会顺手关灯 */
  turnsOffLights: boolean;
}

export const PERSONAS: Record<AgentId, Persona> = {
  dad: {
    id: 'dad',
    name: '爸爸',
    role: '爸爸',
    desc: '林爸爸，42岁，程序员，周末也常在书房用电脑或看书；说话温和，偶尔冷幽默，常常忘记关灯。',
    color: '#4f7fb3',
    hair: '#33251c',
    homeRoom: 'study',
    bed: 'bed_master',
    prefs: [
      { kind: 'use_computer', w: 5 },
      { kind: 'read_book', w: 4 },
      { kind: 'watch_tv', w: 1 },
      { kind: 'visit', w: 1 },
      { kind: 'wander', w: 1 },
    ],
    afterLunch: 'watch_tv',
    turnsOffLights: false,
  },
  mom: {
    id: 'mom',
    name: '妈妈',
    role: '妈妈',
    desc: '林妈妈，38岁，中学语文老师，喜欢下厨和打理家务，做事利落，关心每个家人。',
    color: '#d4685a',
    hair: '#4a2a1e',
    homeRoom: 'kitchen',
    bed: 'bed_master',
    prefs: [
      { kind: 'do_laundry', w: 2 },
      { kind: 'read_book', w: 1 },
      { kind: 'watch_tv', w: 1 },
      { kind: 'visit', w: 2 },
      { kind: 'wander', w: 1 },
    ],
    afterLunch: 'wash_dishes',
    cooksMeals: true,
    turnsOffLights: true,
  },
  grandma: {
    id: 'grandma',
    name: '奶奶',
    role: '奶奶',
    desc: '奶奶，72岁，退休纺织厂工人，喜欢在客厅摇椅上休息、看电视；有高血压，饭后要吃药；说话慢悠悠，爱念叨家常。',
    color: '#9a7bb6',
    hair: '#eeeae4',
    homeRoom: 'living',
    bed: 'bed_grandma',
    prefs: [
      { kind: 'rest_chair', w: 5 },
      { kind: 'watch_tv', w: 3 },
      { kind: 'nap', w: 1 },
      { kind: 'visit', w: 1 },
      { kind: 'wander', w: 1 },
    ],
    afterLunch: 'rest_chair',
    turnsOffLights: true,
  },
  kid: {
    id: 'kid',
    name: '乐乐',
    role: '孩子',
    desc: '乐乐，8岁，小学二年级男孩，活泼好动，最喜欢在儿童房搭积木，好奇心强，爱问为什么。',
    color: '#eaa52c',
    hair: '#2a1b12',
    homeRoom: 'kids',
    bed: 'bed_kid',
    prefs: [
      { kind: 'play_toys', w: 5 },
      { kind: 'homework', w: 2 },
      { kind: 'watch_tv', w: 2 },
      { kind: 'visit', w: 2 },
      { kind: 'wander', w: 1 },
    ],
    afterLunch: 'play_toys',
    turnsOffLights: false,
  },
  robot: {
    id: 'robot',
    name: '小暖',
    role: '机器人',
    desc: '家用机器人小暖，负责巡视、提醒和简单家务；说话简短、礼貌、温暖。',
    color: '#5fb8bf',
    hair: '#ffffff',
    homeRoom: 'corridor',
    prefs: [],
    turnsOffLights: true,
  },
};

export const NAME_TO_ID: Record<string, FamilyId> = {
  爸爸: 'dad',
  老爸: 'dad',
  妈妈: 'mom',
  老妈: 'mom',
  奶奶: 'grandma',
  乐乐: 'kid',
  孩子: 'kid',
  儿子: 'kid',
};
