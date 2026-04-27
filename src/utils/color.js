/**
 * 颜色工具：RGB ↔ HSB / HEX，以及"调色板禁用区"判定
 *
 * 禁用区（HSB 调色板左上角，浅色 / 灰白区）：
 *   - 饱和度 S ≤ 40%
 *   - 亮度   B ≥ 60%
 *   取色落在该区域即视为"不合规"。
 */

/** 数值 0-255 → HEX，形如 #RRGGBB */
export function rgbToHex(r, g, b) {
  const to2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return ('#' + to2(r) + to2(g) + to2(b)).toUpperCase();
}

/**
 * RGB → HSB（HSV）
 * 返回值：{ h: 0-360, s: 0-100, b: 0-100 }
 */
export function rgbToHsb(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r)      h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else                h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;
  return { h, s, b: v };
}

/**
 * 判定一个 RGB 颜色是否落在调色板禁用区（低饱和 + 高亮度）
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {{ maxS?: number, minB?: number }} [zone]
 * @returns {{ inZone: boolean, hsb: {h:number,s:number,b:number}, zone: {maxS:number,minB:number} }}
 */
export function isInForbiddenZone(r, g, b, zone = {}) {
  const maxS = zone.maxS ?? 40;  // S ≤ 40%
  const minB = zone.minB ?? 60;  // B ≥ 60%
  const hsb = rgbToHsb(r, g, b);
  const inZone = hsb.s <= maxS && hsb.b >= minB;
  return { inZone, hsb, zone: { maxS, minB } };
}
