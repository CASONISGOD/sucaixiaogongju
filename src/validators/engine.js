/**
 * 校验引擎
 * 输入：素材 meta + 规范 spec
 * 输出：每条规则的校验结果
 */
import { formatSize } from './meta.js';
import { isInForbiddenZone } from '../utils/color.js';

/**
 * @typedef {Object} CheckResult
 * @property {string} field
 * @property {string} label
 * @property {'pass'|'warn'|'fail'} status
 * @property {string} current   当前值的展示字符串
 * @property {string} required  要求值的展示字符串
 * @property {string} [tip]
 * @property {Object} rule      原始规则
 * @property {Object} meta      原始 meta
 */

export function validate(meta, spec) {
  // 如果规范定义了 variants（多尺寸变体），先匹配出具体变体
  let matchedVariant = null;
  if (Array.isArray(spec.variants) && spec.variants.length) {
    matchedVariant = spec.variants.find(v => v.width === meta.width && v.height === meta.height) || null;
  }

  const results = [];
  for (const rule of spec.rules) {
    results.push(validateRule(meta, rule, spec, matchedVariant));
  }

  // 汇总状态
  const hasFail = results.some(r => r.status === 'fail');
  const hasWarn = results.some(r => r.status === 'warn');
  const status = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

  return { status, results, meta, spec, matchedVariant };
}

function validateRule(meta, rule, spec, matchedVariant) {
  const common = { field: rule.field, label: rule.label, tip: rule.tip, rule, meta };

  switch (rule.field) {
    case 'format': {
      const allowed = (rule.allowed || []).map(x => x.toLowerCase());
      const current = meta.format;
      const ok = allowed.includes(current);
      return {
        ...common,
        status: ok ? 'pass' : (rule.level === 'warning' ? 'warn' : 'fail'),
        current: current?.toUpperCase() || '未知',
        required: allowed.map(x => x.toUpperCase()).join(' / ')
      };
    }

    case 'size': {
      const current = meta.size;
      const max = rule.max;
      const ok = current <= max;
      return {
        ...common,
        status: ok ? 'pass' : (rule.level === 'warning' ? 'warn' : 'fail'),
        current: formatSize(current),
        required: '≤ ' + formatSize(max)
      };
    }

    case 'dimensions': {
      const cw = meta.width;
      const ch = meta.height;
      let ok = false;
      let required = '';

      // 优先级：spec.variants > rule.options > rule.width/height
      if (Array.isArray(spec?.variants) && spec.variants.length) {
        ok = !!matchedVariant;
        required = matchedVariant
          ? `${matchedVariant.width}×${matchedVariant.height} (${matchedVariant.name})`
          : spec.variants.map(v => `${v.width}×${v.height} (${v.name})`).join(' 或 ');
      } else if (Array.isArray(rule.options)) {
        ok = rule.options.some(o => o.width === cw && o.height === ch);
        required = rule.options.map(o => `${o.width}×${o.height}`).join(' 或 ');
      } else {
        ok = cw === rule.width && ch === rule.height;
        required = `${rule.width}×${rule.height}`;
      }

      return {
        ...common,
        status: ok ? 'pass' : (rule.level === 'warning' ? 'warn' : 'fail'),
        current: `${cw}×${ch}`,
        required
      };
    }

    case 'aspectRatio': {
      const r = meta.width / meta.height;
      const [a, b] = rule.value.split(':').map(Number);
      const target = a / b;
      const ok = Math.abs(r - target) < 0.02;
      return {
        ...common,
        status: ok ? 'pass' : (rule.level === 'warning' ? 'warn' : 'fail'),
        current: (meta.width + ':' + meta.height),
        required: rule.value
      };
    }

    case 'duration': {
      const cur = meta.duration;
      const ok = cur <= rule.max && cur >= (rule.min || 0);
      return {
        ...common,
        status: ok ? 'pass' : (rule.level === 'warning' ? 'warn' : 'fail'),
        current: cur.toFixed(1) + 's',
        required: (rule.min ? rule.min + 's ~ ' : '≤ ') + rule.max + 's'
      };
    }

    case 'colorZone': {
      // 按"调色板禁用区"判断整图主色是否落入禁用区
      const dc = meta.dominantColor;
      const maxS = rule.maxS ?? 40;
      const minB = rule.minB ?? 60;
      const requiredStr = `主色需避开 S≤${maxS}% 且 B≥${minB}% 的浅色/灰白区`;

      if (!dc) {
        return {
          ...common,
          status: 'warn',
          current: '无法提取主色',
          required: requiredStr,
          tip: rule.tip || '跨域或空白图像可能导致主色无法读取'
        };
      }
      const { inZone, hsb } = isInForbiddenZone(dc.r, dc.g, dc.b, { maxS, minB });
      const level = rule.level === 'warning' ? 'warn' : 'fail';
      return {
        ...common,
        status: inZone ? level : 'pass',
        current: `${dc.hex} · S ${hsb.s.toFixed(0)}% / B ${hsb.b.toFixed(0)}%`,
        required: requiredStr,
        dominantColor: dc,
        hsb
      };
    }

    case 'backgroundTexture':
      return validateBackgroundTexture(common, rule);

    case 'logoPosition':
      return validateLogoPosition(common, rule, matchedVariant);

    case 'ipPosition':
      return validateIpPosition(common, rule, matchedVariant);

    default:
      return {
        ...common,
        status: 'pass',
        current: '—',
        required: '—'
      };
  }
}

function validateBackgroundTexture(common, rule) {
  const texture = common.meta?.backgroundTexture;
  const required = '需添加底纹，背景不能为纯色';
  if (!texture) {
    return {
      ...common,
      status: 'warn',
      current: '无法分析背景底纹',
      required,
      tip: common.tip || '当前图片无法读取像素信息，请人工复核是否为纯色背景'
    };
  }

  const minVariedRatio = rule.minVariedRatio ?? 0.035;
  const minAverageDistance = rule.minAverageDistance ?? 4;
  const minP90Distance = rule.minP90Distance ?? 12;
  const minBackgroundPixelRatio = rule.minBackgroundPixelRatio ?? 0.2;
  const hasEnoughBackground = texture.backgroundPixelRatio >= minBackgroundPixelRatio;
  const hasTexture = hasEnoughBackground
    && texture.variedRatio >= minVariedRatio
    && (texture.averageDistance >= minAverageDistance || texture.p90Distance >= minP90Distance);
  const level = rule.level === 'warning' ? 'warn' : 'fail';
  const variedPercent = (texture.variedRatio * 100).toFixed(1);
  const backgroundPercent = (texture.backgroundPixelRatio * 100).toFixed(0);

  return {
    ...common,
    status: hasTexture ? 'pass' : level,
    current: hasTexture
      ? `已检测到底纹（变化像素 ${variedPercent}% / 背景占比 ${backgroundPercent}%）`
      : `疑似纯色背景（变化像素 ${variedPercent}% / 背景占比 ${backgroundPercent}%）`,
    required,
    tip: hasTexture ? common.tip : (common.tip || '背景变化过少，疑似只使用了纯色底')
  };
}

function validateLogoPosition(common, rule, matchedVariant) {
  const zone = findLayoutZone(matchedVariant, rule.zoneKeyword || 'LOGO');
  const required = zone
    ? `${formatZone(zone)}，左边缘对齐 x=${zone.left}`
    : '需先匹配素材尺寸后读取 LOGO 区';
  if (!zone) return unavailableResult(common, required, '未匹配到尺寸变体');

  const components = getLayoutComponents(common.meta);
  if (!components.length) return unavailableResult(common, required, '未识别到前景元素');

  const zoneRect = zoneToRect(zone);
  const searchBox = expandRect(zoneRect, rule.searchPadding || { left: 8, top: 8, right: 24, bottom: 16 });
  const minArea = getMinArea(common.meta, rule.minAreaRatio ?? 0.0005, 24);
  const candidates = components.filter(component => {
    if (component.area < minArea) return false;
    if (!intersects(component, searchBox)) return false;
    return component.centerX < zoneRect.right + (rule.searchRightExtra ?? 32);
  });

  if (!candidates.length) {
    return {
      ...common,
      status: rule.level === 'warning' ? 'warn' : 'fail',
      current: '未识别到 LOGO',
      required
    };
  }

  const bounds = unionRects(candidates);
  const tolerance = rule.tolerance ?? 2;
  const alignTolerance = rule.alignTolerance ?? 8;
  const inZone = rectInside(bounds, zoneRect, tolerance);
  const leftAligned = Math.abs(bounds.left - zone.left) <= alignTolerance;
  const status = inZone && leftAligned ? 'pass' : (rule.level === 'warning' ? 'warn' : 'fail');
  const problems = [];
  if (!inZone) problems.push('超出 LOGO 区');
  if (!leftAligned) problems.push('未居左对齐');

  return {
    ...common,
    status,
    current: `${formatBounds(bounds)}${problems.length ? `（${problems.join('，')}）` : ''}`,
    required
  };
}

function validateIpPosition(common, rule, matchedVariant) {
  const zone = findLayoutZone(matchedVariant, rule.zoneKeyword || 'IP') || findLayoutZone(matchedVariant, '主元素');
  const required = zone ? `完整位于 ${formatZone(zone)}` : '需先匹配素材尺寸后读取 IP 区';
  if (!zone) return unavailableResult(common, required, '未匹配到尺寸变体');

  const components = getLayoutComponents(common.meta);
  if (!components.length) return unavailableResult(common, required, '未识别到前景元素');

  const ipRect = zoneToRect(zone);
  const logoZone = findLayoutZone(matchedVariant, 'LOGO');
  const logoRect = logoZone ? zoneToRect(logoZone) : null;
  const minArea = getMinArea(common.meta, rule.minAreaRatio ?? 0.003, 80);
  const candidates = components.filter(component => {
    if (component.area < minArea) return false;
    if (logoRect && overlapRatio(component, logoRect) > 0.35) return false;
    return intersects(component, expandRect(ipRect, rule.searchPadding || { left: 24, top: 8, right: 8, bottom: 8 }));
  });

  if (!candidates.length) {
    return {
      ...common,
      status: rule.level === 'warning' ? 'warn' : 'fail',
      current: '未识别到 IP / 主元素',
      required
    };
  }

  const primary = candidates[0];
  const related = candidates.filter(component => component === primary || component.area >= primary.area * (rule.relatedAreaRatio ?? 0.08));
  const bounds = unionRects(related);
  const tolerance = rule.tolerance ?? 2;
  const inZone = rectInside(bounds, ipRect, tolerance);

  return {
    ...common,
    status: inZone ? 'pass' : (rule.level === 'warning' ? 'warn' : 'fail'),
    current: `${formatBounds(bounds)}${inZone ? '' : '（超出 IP 区）'}`,
    required
  };
}

function unavailableResult(common, required, current) {
  return {
    ...common,
    status: 'warn',
    current,
    required,
    tip: common.tip || '当前图片无法完成区域识别，请人工复核'
  };
}

function getLayoutComponents(meta) {
  return Array.isArray(meta?.layoutAnalysis?.components) ? meta.layoutAnalysis.components : [];
}

function getMinArea(meta, ratio, fallback) {
  const area = (meta?.width || 0) * (meta?.height || 0);
  return Math.max(fallback, Math.round(area * ratio));
}

function findLayoutZone(variant, keyword) {
  const upperKeyword = String(keyword || '').toUpperCase();
  return variant?.layoutZones?.find(zone => String(zone.name || '').toUpperCase().includes(upperKeyword)) || null;
}

function zoneToRect(zone) {
  return {
    left: zone.left,
    top: zone.top,
    right: zone.left + zone.width - 1,
    bottom: zone.top + zone.height - 1,
    width: zone.width,
    height: zone.height
  };
}

function expandRect(rect, padding) {
  return {
    left: rect.left - (padding.left || 0),
    top: rect.top - (padding.top || 0),
    right: rect.right + (padding.right || 0),
    bottom: rect.bottom + (padding.bottom || 0)
  };
}

function intersects(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function rectInside(inner, outer, tolerance = 0) {
  return inner.left >= outer.left - tolerance
    && inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance
    && inner.bottom <= outer.bottom + tolerance;
}

function overlapRatio(a, b) {
  if (!intersects(a, b)) return 0;
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  const overlap = Math.max(0, right - left + 1) * Math.max(0, bottom - top + 1);
  return overlap / Math.max(1, a.width * a.height);
}

function unionRects(rects) {
  const left = Math.min(...rects.map(r => r.left));
  const top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1
  };
}

function formatZone(zone) {
  return `${zone.name || '区域'} x:${zone.left}-${zone.left + zone.width - 1} / y:${zone.top}-${zone.top + zone.height - 1}`;
}

function formatBounds(bounds) {
  return `x:${bounds.left}-${bounds.right} / y:${bounds.top}-${bounds.bottom}`;
}
