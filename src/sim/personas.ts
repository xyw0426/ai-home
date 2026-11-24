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
  | 'play_piano'
  | 'listen_piano'
  | 'get_snack'
  | 'make_coffee'
  | 'water_plants'
  | 'balcony_tea'
  | 'dress_up'
  | 'wash_up'
  | 'bath'
  | 'listen_radio'
  | 'user_move'
  | 'user_toggle';

export interface ActivitySpec {
  label: string;
  icon: string;
  /** 使用的家具 id（可以有多个候选）；'bed' 表示自己的床，'seat' 表示餐桌座位 */
  furniture?: string | string[];
  dur: [number, number];
}

export const ACTIVITIES: Record<ActivityKind, ActivitySpec> = {
  use_computer: { label: '用电脑', icon: '💻', furniture: 'computer', dur: [30, 55] },
  read_book: { label: '读书', icon: '📖', furniture: ['bookshelf', 'study_chair', 'living_shelf'], dur: [20, 40] },
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
  play_piano: { label: '弹钢琴', icon: '🎹', furniture: 'piano', dur: [15, 30] },
  listen_piano: { label: '坐在琴边听钢琴', icon: '🎶', furniture: 'stools', dur: [10, 20] },
  get_snack: { label: '从冰箱拿零食', icon: '🧃', furniture: 'fridge', dur: [3, 5] },
  make_coffee: { label: '冲咖啡', icon: '☕', furniture: 'coffee', dur: [4, 7] },
  water_plants: { label: '给阳台的花浇水', icon: '🪴', furniture: 'plants', dur: [6, 10] },
  balcony_tea: { label: '在阳台喝茶晒太阳', icon: '🍵', furniture: 'rattan', dur: [20, 40] },
  dress_up: { label: '在衣帽间试衣服', icon: '👗', furniture: 'mirror', dur: [8, 15] },
  wash_up: { label: '洗漱', icon: '🪥', furniture: 'basin', dur: [4, 7] },
  bath: { label: '泡澡', icon: '🛁', furniture: 'bathtub', dur: [20, 30] },
  listen_radio: { label: '听收音机里的戏曲', icon: '📻', furniture: 'radio', dur: [20, 40] },
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
    desc: '林爸爸，42岁，程序员，周末也常在书房用电脑或看书；喜欢去餐厅的咖啡机冲杯咖啡，偶尔在阳台藤椅上喝茶，会弹两下钢琴但弹得不太好；说话温和，偶尔冷幽默，常常忘记关灯。',
    color: '#4f7fb3',
    hair: '#33251c',
    homeRoom: 'study',
    bed: 'bed_master',
    prefs: [
      { kind: 'use_computer', w: 5 },
      { kind: 'read_book', w: 3 },
      { kind: 'make_coffee', w: 2 },
      { kind: 'watch_tv', w: 1 },
      { kind: 'balcony_tea', w: 1 },
      { kind: 'get_snack', w: 1 },
      { kind: 'play_piano', w: 0.4 },
      { kind: 'listen_piano', w: 1 },
      { kind: 'visit', w: 1 },
      { kind: 'wander', w: 0.6 },
    ],
    afterLunch: 'watch_tv',
    turnsOffLights: false,
  },
  mom: {
    id: 'mom',
    name: '妈妈',
    role: '妈妈',
    desc: '林妈妈，38岁，中学语文老师，负责一家的三餐，钢琴弹得很好；喜欢在衣帽间搭配衣服、给阳台的花浇水、打理家务，做事利落，关心每个家人。',
    color: '#d4685a',
    hair: '#4a2a1e',
    homeRoom: 'kitchen',
    bed: 'bed_master',
    prefs: [
      { kind: 'play_piano', w: 2 },
      { kind: 'water_plants', w: 1.5 },
      { kind: 'dress_up', w: 1.5 },
      { kind: 'do_laundry', w: 1.5 },
      { kind: 'read_book', w: 1 },
      { kind: 'watch_tv', w: 1 },
      { kind: 'listen_piano', w: 1 },
      { kind: 'wash_up', w: 0.5 },
      { kind: 'visit', w: 2 },
      { kind: 'wander', w: 0.6 },
    ],
    afterLunch: 'wash_dishes',
    cooksMeals: true,
    turnsOffLights: true,
  },
  grandma: {
    id: 'grandma',
    name: '奶奶',
    role: '奶奶',
    desc: '奶奶，72岁，退休纺织厂工人，喜欢在客厅摇椅上休息、看电视，在自己房间用收音机听戏曲，常去阳台浇花、坐在藤椅上晒太阳喝茶，爱听孙子弹钢琴；有高血压，饭后要吃药；说话慢悠悠，爱念叨家常。',
    color: '#9a7bb6',
    hair: '#eeeae4',
    homeRoom: 'living',
    bed: 'bed_grandma',
    prefs: [
      { kind: 'rest_chair', w: 5 },
      { kind: 'watch_tv', w: 3 },
      { kind: 'listen_radio', w: 2 },
      { kind: 'water_plants', w: 2 },
      { kind: 'balcony_tea', w: 2 },
      { kind: 'listen_piano', w: 2 },
      { kind: 'nap', w: 1 },
      { kind: 'visit', w: 1 },
      { kind: 'wander', w: 0.5 },
    ],
    afterLunch: 'rest_chair',
    turnsOffLights: true,
  },
  kid: {
    id: 'kid',
    name: '乐乐',
    role: '孩子',
    desc: '乐乐，8岁，小学二年级男孩，活泼好动，最喜欢在儿童房搭积木，正在学钢琴，爱偷偷从冰箱拿零食和酸奶，晚上喜欢泡澡玩水；好奇心强，爱问为什么。',
    color: '#eaa52c',
    hair: '#2a1b12',
    homeRoom: 'kids',
    bed: 'bed_kid',
    prefs: [
      { kind: 'play_toys', w: 5 },
      { kind: 'play_piano', w: 2 },
      { kind: 'homework', w: 2 },
      { kind: 'get_snack', w: 2 },
      { kind: 'watch_tv', w: 2 },
      { kind: 'bath', w: 1 },
      { kind: 'listen_piano', w: 1 },
      { kind: 'visit', w: 2 },
      { kind: 'wander', w: 0.8 },
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
    homeRoom: 'storage',
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
