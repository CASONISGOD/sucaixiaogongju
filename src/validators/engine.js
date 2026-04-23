/**
 * 校验引擎
 * 输入：素材 meta + 规范 spec
 * 输出：每条规则的校验结果
 */
import { formatSize } from './meta.js';

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
        required = spec.variants.map(v => `${v.width}×${v.height} (${v.name})`).join(' 或 ');
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

    default:
      return {
        ...common,
        status: 'pass',
        current: '—',
        required: '—'
      };
  }
}
