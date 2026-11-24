/** 盆栽从浇透到完全干透大约需要的秒数 */
export const PLANT_DRY_SEC = 14 * 3600;
/** 水分低于这个值叶子发黄 */
export const PLANT_YELLOW = 0.35;

/** 叶子状态：水分 ≥ 60% 翠绿，35%–60% 有点蔫，低于 35% 发黄 */
export function leafState(water: number): '翠绿' | '有点蔫' | '发黄' {
  return water >= 0.6 ? '翠绿' : water >= PLANT_YELLOW ? '有点蔫' : '发黄';
}
