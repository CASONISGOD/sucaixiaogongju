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
  const common = { field: rule.field, label: rule.label, tip: rule.tip, rule, meta, spec, matchedVariant };

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
      // 按"调色板禁用区"和白字对比度判断底色是否合规
      const dc = meta.dominantColor;
      const maxS = rule.maxS ?? 40;
      const minB = rule.minB ?? 60;
      const minRatio = rule.minRatio ?? rule.minContrastRatio;
      const requiredParts = [`主色需避开 S≤${maxS}% 且 B≥${minB}% 的浅色/灰白区`];
      if (Number.isFinite(minRatio)) requiredParts.push(`与白色文字对比度 ≥ ${minRatio}:1`);
      const requiredStr = requiredParts.join('；');

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
      const ratio = Number.isFinite(minRatio) ? getContrastRatio(dc, { r: 255, g: 255, b: 255 }) : null;
      const contrastOk = ratio === null || ratio >= minRatio;
      const level = rule.level === 'warning' ? 'warn' : 'fail';
      const currentParts = [`${dc.hex} · S ${hsb.s.toFixed(0)}% / B ${hsb.b.toFixed(0)}%`];
      if (ratio !== null) currentParts.push(`对比度 ${ratio.toFixed(2)}:1`);
      return {
        ...common,
        status: inZone || !contrastOk ? level : 'pass',
        current: currentParts.join(' · '),
        required: requiredStr,
        dominantColor: dc,
        hsb,
        tip: inZone || !contrastOk ? (rule.tip || '底色过亮会导致框架 UI 的白色文字不清晰') : undefined
      };
    }

    case 'whiteTextContrast':
      return validateWhiteTextContrast(common, rule);

    case 'backgroundTexture':
      return validateBackgroundTexture(common, rule);

    case 'titleButtonSafeZone':
      return validateTitleButtonSafeZone(common, rule, matchedVariant);

    case 'logoPosition':
      return validateLogoPosition(common, rule, matchedVariant);

    case 'ipPosition':
      return validateIpPosition(common, rule, matchedVariant);

    case 'safeZone':
      return validateSafeZone(common, rule, matchedVariant);

    case 'dangerZone':
      return validateDangerZone(common, rule, matchedVariant);

    case 'textSafety':
      return validateTextSafety(common, rule, matchedVariant);

    case 'logoQuality':
      return validateLogoQuality(common, rule, matchedVariant);

    case 'ipCoverage':
      return validateIpCoverage(common, rule, matchedVariant);

    case 'localWhiteTextContrast':
      return validateLocalWhiteTextContrast(common, rule, matchedVariant);

    default:
      return {
        ...common,
        status: 'pass',
        current: '—',
        required: '—'
      };
  }
}

function validateWhiteTextContrast(common, rule) {
  const dc = common.meta?.dominantColor;
  const minRatio = rule.minRatio ?? 4.5;
  const required = `与白色文字对比度 ≥ ${minRatio}:1`;
  if (!dc) {
    return {
      ...common,
      status: 'warn',
      current: '无法提取底色',
      required,
      tip: common.tip || '当前图片无法读取像素信息，请人工复核白色文字是否清晰'
    };
  }

  const ratio = getContrastRatio(dc, { r: 255, g: 255, b: 255 });
  const ok = ratio >= minRatio;
  return {
    ...common,
    status: ok ? 'pass' : (rule.level === 'warning' ? 'warn' : 'fail'),
    current: `${dc.hex} · 对比度 ${ratio.toFixed(2)}:1`,
    required,
    dominantColor: dc,
    tip: ok ? common.tip : (common.tip || '底色过亮会导致框架 UI 的白色文字不清晰')
  };
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

function validateTitleButtonSafeZone(common, rule, matchedVariant) {
  const safeZone = getRuleZone(rule.safeZone)
    || findLayoutZone(matchedVariant, rule.safeZoneKeyword || '文案')
    || findLayoutZone(matchedVariant, '按钮');
  const required = safeZone ? `标题和按钮需完整位于 ${formatZone(safeZone)}` : '需先读取文案 / 按钮安全区';
  if (!safeZone) return unavailableResult(common, required, '未配置文案 / 按钮安全区');

  const safeRect = zoneToRect(safeZone);
  const aiTextComponents = getAiTextComponents(common.meta, rule);
  if (aiTextComponents) {
    const error = getAiTextError(common.meta);
    if (!aiTextComponents.length) {
      const recognizedText = getAiRecognizedTextSummary(common.meta);
      return {
        ...common,
        status: 'warn',
        current: error
          ? `AI 识别失败：${error}`
          : recognizedText
            ? `AI 识别到文案但没有有效坐标：${recognizedText}`
            : 'AI 未识别到标题 / 按钮坐标',
        required,
        tip: error || common.tip || '请确认 AI 识别接口可用，或人工复核文字和按钮位置'
      };
    }

    const tolerance = rule.tolerance ?? 2;
    const offenders = aiTextComponents.filter(component => !rectInside(component, safeRect, tolerance));
    const checkedBounds = unionRects(aiTextComponents);
    const badBounds = offenders.length ? unionRects(offenders) : null;
    return {
      ...common,
      status: offenders.length ? (rule.level === 'warning' ? 'warn' : 'fail') : 'pass',
      current: offenders.length
        ? `AI 识别 ${formatBounds(badBounds, common.meta)}（超出安全区）`
        : `AI 识别 ${formatBounds(checkedBounds, common.meta)}（位于安全区）`,
      required,
      tip: offenders.length ? common.tip : undefined,
      markers: offenders.length ? createMarkersForComponents(offenders, 'AI识别超出安全区') : []
    };
  }

  const components = getLayoutComponents(common.meta);
  if (!components.length) return unavailableResult(common, required, '未识别到标题 / 按钮');

  const searchBox = expandRect(safeRect, rule.searchPadding ?? { left: 0, top: 0, right: 0, bottom: 0 });
  const minArea = getMinArea(common.meta, rule.minAreaRatio ?? 0.00002, 6);
  const maxArea = getAreaLimit(common.meta, rule.maxAreaRatio ?? 0.04, 18000);
  const candidates = components.filter(component => {
    if (component.area < minArea || component.area > maxArea) return false;
    if (!intersects(component, searchBox)) return false;
    return overlapRatio(component, safeRect) > 0;
  });

  if (!candidates.length) {
    return {
      ...common,
      status: 'warn',
      current: '安全区内未识别到标题 / 按钮',
      required,
      tip: common.tip || '当前图片无法稳定识别标题和按钮，请人工复核是否放在图中间空白安全区'
    };
  }

  const tolerance = rule.tolerance ?? 2;
  const offenders = candidates.filter(component => !rectInside(component, safeRect, tolerance));
  const checkedBounds = unionRects(candidates);
  const badBounds = offenders.length ? unionRects(offenders) : null;

  return {
    ...common,
    status: offenders.length ? (rule.level === 'warning' ? 'warn' : 'fail') : 'pass',
    current: offenders.length
      ? `${formatBounds(badBounds, common.meta)}（超出安全区）`
      : `${formatBounds(checkedBounds, common.meta)}（位于安全区）`,
    required,
    tip: offenders.length ? common.tip : undefined,
    markers: offenders.length ? [createMarker(badBounds, '超出安全区')] : []
  };
}

function validateLogoPosition(common, rule, matchedVariant) {
  const zone = findLayoutZone(matchedVariant, rule.zoneKeyword || 'LOGO');
  const required = zone
    ? `${formatZone(zone)}，LOGO 左边缘需贴近该区域左边`
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
    current: `${formatBounds(bounds, common.meta)}${problems.length ? `（${problems.join('，')}）` : ''}`,
    required,
    markers: problems.length ? [createMarker(bounds, problems.join('，'))] : []
  };
}

function validateSafeZone(common, rule, matchedVariant) {
  const logoResult = validateLogoPosition(common, { ...rule, zoneKeyword: 'LOGO' }, matchedVariant);
  const ipResult = validateIpPosition(common, { ...rule, zoneKeyword: 'IP' }, matchedVariant);
  const results = [logoResult, ipResult];
  const hasFail = results.some(result => result.status === 'fail');
  const hasWarn = results.some(result => result.status === 'warn');

  return {
    ...common,
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    current: `LOGO：${logoResult.current}；IP：${ipResult.current}`,
    required: `LOGO：${logoResult.required}；IP：${ipResult.required}`,
    tip: results.some(result => result.status !== 'pass') ? common.tip : undefined
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
    current: `${formatBounds(bounds, common.meta)}${inZone ? '' : '（超出 IP 区）'}`,
    required,
    markers: inZone ? [] : [createMarker(bounds, '超出 IP 区')]
  };
}

function validateDangerZone(common, rule, matchedVariant) {
  const forbiddenZones = getRuleZones(rule.forbiddenZones, matchedVariant, rule.forbiddenZoneKeywords || ['危险区']);
  if (!forbiddenZones.length) return unavailableResult(common, rule.requiredText || '需先读取危险区', '未配置危险区');

  const allowedZones = getRuleZones(rule.allowedZones, matchedVariant, rule.allowedZoneKeywords || []);
  const forbiddenRects = forbiddenZones.map(zoneToRect);
  const allowedRects = allowedZones.map(zoneToRect);
  const components = getComponentsByType(common.meta, rule);
  const minOverlapRatio = rule.minOverlapRatio ?? 0.08;
  const tolerance = rule.tolerance ?? 2;

  const offenders = components.filter(component => {
    if (allowedRects.some(rect => rectInside(component, rect, tolerance))) return false;
    return forbiddenRects.some(rect => overlapRatio(component, rect) >= minOverlapRatio || intersects(component, rect) && overlapArea(component, rect) >= getMinArea(common.meta, rule.minForbiddenAreaRatio ?? 0.00015, 24));
  });

  const required = rule.requiredText || '关键元素不得进入危险区';
  if (!offenders.length) {
    return {
      ...common,
      status: 'pass',
      current: rule.passText || '未发现关键元素进入危险区',
      required
    };
  }

  const bounds = unionRects(offenders);
  return {
    ...common,
    status: rule.level === 'warning' ? 'warn' : 'fail',
    current: `${rule.targetLabel || '关键元素'}进入危险区：${formatBounds(bounds, common.meta)}`,
    required,
    tip: common.tip,
    markers: [createMarker(bounds, '进入危险区')]
  };
}

function validateTextSafety(common, rule, matchedVariant) {
  const safeZones = getRuleZones(rule.safeZones, matchedVariant, rule.safeZoneKeywords || ['文案', '按钮']);
  if (!safeZones.length) return unavailableResult(common, rule.requiredText || '需先读取文字安全区', '未配置文字安全区');

  const textComponents = getTextLikeComponents(common.meta, rule);
  const usingAiText = hasAiTextAnalysis(common.meta);
  if (!textComponents.length) {
    const error = getAiTextError(common.meta);
    const recognizedText = getAiRecognizedTextSummary(common.meta);
    return {
      ...common,
      status: 'warn',
      current: usingAiText
        ? (error
          ? `AI 识别失败：${error}`
          : recognizedText
            ? `AI 识别到文案但没有有效坐标：${recognizedText}`
            : 'AI 未识别到文字 / 按钮坐标')
        : '未稳定识别到文字 / 按钮',
      required: rule.requiredText || '文字和按钮需位于安全区内',
      tip: error || common.tip || (usingAiText ? '请人工复核 AI 未识别出的文字和按钮位置' : '当前为启发式图像检测，请人工复核文字和按钮位置')
    };
  }

  const safeRects = safeZones.map(zoneToRect);
  const tolerance = rule.tolerance ?? 2;
  const offenders = textComponents.filter(component => !safeRects.some(rect => rectInside(component, rect, tolerance)));
  const checkedBounds = unionRects(textComponents);
  const badBounds = offenders.length ? unionRects(offenders) : null;

  return {
    ...common,
    status: offenders.length ? (rule.level === 'warning' ? 'warn' : 'fail') : 'pass',
    current: offenders.length
      ? `${usingAiText ? 'AI 识别文字 / 按钮超出安全区' : '文字 / 按钮疑似进入危险区'}：${formatBounds(badBounds, common.meta)}`
      : `${usingAiText ? 'AI 识别文字 / 按钮位于安全区' : '文字 / 按钮位于安全区'}：${formatBounds(checkedBounds, common.meta)}`,
    required: rule.requiredText || '文字和按钮需位于安全区内',
    tip: offenders.length ? common.tip : undefined,
    markers: offenders.length
      ? (usingAiText ? createMarkersForComponents(offenders, 'AI识别超出安全区') : [createMarker(badBounds, '文字/按钮超出安全区')])
      : []
  };
}

function validateLogoQuality(common, rule, matchedVariant) {
  const zone = findLayoutZone(matchedVariant, rule.zoneKeyword || 'LOGO');
  if (!zone) return unavailableResult(common, '需先读取 LOGO 区', '未匹配到尺寸变体');

  const zoneRect = zoneToRect(zone);
  const candidates = getLogoCandidates(common.meta, rule, zoneRect);
  if (!candidates.length) {
    return {
      ...common,
      status: rule.level === 'warning' ? 'warn' : 'fail',
      current: '未识别到 LOGO',
      required: rule.requiredText || 'LOGO 需要清晰且大小适中'
    };
  }

  const bounds = unionRects(candidates);
  const widthRatio = bounds.width / zone.width;
  const heightRatio = bounds.height / zone.height;
  const minWidthRatio = rule.minWidthRatio ?? 0.35;
  const minHeightRatio = rule.minHeightRatio ?? 0.35;
  const maxWidthRatio = rule.maxWidthRatio ?? 1.05;
  const maxHeightRatio = rule.maxHeightRatio ?? 1.05;
  const problems = [];
  if (widthRatio < minWidthRatio || heightRatio < minHeightRatio) problems.push('LOGO 偏小');
  if (widthRatio > maxWidthRatio || heightRatio > maxHeightRatio) problems.push('LOGO 偏大');
  if ((bounds.width * bounds.height) <= (rule.minPixelArea || 320)) problems.push('LOGO 清晰度风险');

  return {
    ...common,
    status: problems.length ? (rule.level === 'warning' ? 'warn' : 'fail') : 'pass',
    current: `${formatBounds(bounds, common.meta)}，占 LOGO 区 ${Math.round(widthRatio * 100)}%×${Math.round(heightRatio * 100)}%${problems.length ? `（${problems.join('，')}）` : ''}`,
    required: rule.requiredText || 'LOGO 大小需适中、清晰，并完整处于 LOGO 区内',
    tip: problems.length ? common.tip : undefined
  };
}

function validateIpCoverage(common, rule, matchedVariant) {
  const zone = findLayoutZone(matchedVariant, rule.zoneKeyword || 'IP') || findLayoutZone(matchedVariant, '主元素');
  if (!zone) return unavailableResult(common, '需先读取 IP / 主元素区', '未匹配到尺寸变体');

  const zoneRect = zoneToRect(zone);
  const candidates = getIpCandidates(common.meta, rule, zoneRect, matchedVariant);
  if (!candidates.length) {
    return {
      ...common,
      status: rule.level === 'warning' ? 'warn' : 'fail',
      current: '未识别到 IP / 主元素',
      required: rule.requiredText || 'IP / 主元素需有足够画面占比'
    };
  }

  const primary = candidates[0];
  const related = candidates.filter(component => component === primary || component.area >= primary.area * (rule.relatedAreaRatio ?? 0.08));
  const bounds = unionRects(related);
  const widthRatio = bounds.width / zone.width;
  const heightRatio = bounds.height / zone.height;
  const areaRatio = bounds.width * bounds.height / Math.max(1, zone.width * zone.height);
  const minWidthRatio = rule.minWidthRatio ?? 0.42;
  const minHeightRatio = rule.minHeightRatio ?? 0.35;
  const minAreaRatio = rule.minBoxAreaRatio ?? 0.18;
  const problems = [];
  if (widthRatio < minWidthRatio) problems.push('横向占比偏小');
  if (heightRatio < minHeightRatio) problems.push('纵向占比偏小');
  if (areaRatio < minAreaRatio) problems.push('整体占比偏小');

  return {
    ...common,
    status: problems.length ? (rule.level === 'warning' ? 'warn' : 'fail') : 'pass',
    current: `${formatBounds(bounds, common.meta)}，占主元素区 ${Math.round(widthRatio * 100)}%×${Math.round(heightRatio * 100)}%${problems.length ? `（${problems.join('，')}）` : ''}`,
    required: rule.requiredText || 'IP / 主元素需在右侧区域保持足够视觉占比',
    tip: problems.length ? common.tip : undefined
  };
}

function validateLocalWhiteTextContrast(common, rule, matchedVariant) {
  const regions = getContrastRegions(rule, matchedVariant);
  if (!regions.length) return unavailableResult(common, '需先配置局部白字检测区域', '未配置检测区域');

  const minRatio = rule.minRatio ?? 4.5;
  const checks = regions.map(region => {
    const rect = zoneToRect(region);
    const color = getAverageColorForRect(common.meta, rect) || common.meta?.dominantColor;
    if (!color) return { region, color: null, ratio: 0, ok: false };
    const ratio = getContrastRatio(color, { r: 255, g: 255, b: 255 });
    return { region, color, ratio, ok: ratio >= minRatio };
  });

  const unavailable = checks.filter(item => !item.color);
  if (unavailable.length === checks.length) {
    return unavailableResult(common, `局部背景与白色文字对比度 ≥ ${minRatio}:1`, '无法读取局部底色');
  }

  const failed = checks.filter(item => item.color && !item.ok);
  return {
    ...common,
    status: failed.length ? (rule.level === 'warning' ? 'warn' : 'fail') : 'pass',
    current: checks
      .filter(item => item.color)
      .map(item => `${item.region.name || '检测区'} ${item.color.hex} ${item.ratio.toFixed(2)}:1`)
      .join('；'),
    required: `局部背景与白色文字对比度 ≥ ${minRatio}:1`,
    tip: failed.length ? common.tip : undefined
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

function getContrastRatio(a, b) {
  const l1 = getRelativeLuminance(a);
  const l2 = getRelativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(color) {
  const toLinear = value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

function getLayoutComponents(meta) {
  return Array.isArray(meta?.layoutAnalysis?.components) ? meta.layoutAnalysis.components : [];
}

function getMinArea(meta, ratio, fallback) {
  const area = (meta?.width || 0) * (meta?.height || 0);
  return Math.max(fallback, Math.round(area * ratio));
}

function getAreaLimit(meta, ratio, fallback) {
  const area = (meta?.width || 0) * (meta?.height || 0);
  return Math.max(fallback, Math.round(area * ratio));
}

function getRuleZone(zone) {
  if (!zone || !Number.isFinite(zone.left) || !Number.isFinite(zone.top) || !Number.isFinite(zone.width) || !Number.isFinite(zone.height)) {
    return null;
  }
  return zone;
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

function getRuleZones(explicitZones, variant, keywords = []) {
  const zones = [];
  if (Array.isArray(explicitZones)) {
    zones.push(...explicitZones.map(getRuleZone).filter(Boolean));
  }
  const keywordList = Array.isArray(keywords) ? keywords : [keywords];
  keywordList.forEach(keyword => {
    const zone = findLayoutZone(variant, keyword);
    if (zone && !zones.some(item => item.name === zone.name && item.left === zone.left && item.top === zone.top)) zones.push(zone);
  });
  return zones;
}

function getComponentsByType(meta, rule) {
  if (rule.componentType === 'text') return getTextLikeComponents(meta, rule);
  const components = getLayoutComponents(meta);
  const minArea = getMinArea(meta, rule.minAreaRatio ?? (rule.componentType === 'keyVisual' ? 0.003 : 0.0002), rule.minArea || 24);
  const maxArea = rule.maxAreaRatio ? getAreaLimit(meta, rule.maxAreaRatio, Infinity) : Infinity;
  return components.filter(component => component.area >= minArea && component.area <= maxArea);
}

function getTextLikeComponents(meta, rule = {}) {
  const aiTextComponents = getAiTextComponents(meta, rule);
  if (aiTextComponents) return aiTextComponents;
  const candidates = getTextGlyphCandidates(meta, rule);
  return groupTextGlyphCandidates(candidates, rule);
}

function hasAiTextAnalysis(meta) {
  return !!meta?.aiTextAnalysis && Array.isArray(meta.aiTextAnalysis.texts);
}

function getAiTextError(meta) {
  return String(meta?.aiTextAnalysis?.error || '').trim();
}

function getAiRecognizedTextSummary(meta) {
  const texts = Array.isArray(meta?.aiTextAnalysis?.texts) ? meta.aiTextAnalysis.texts : [];
  return texts
    .map(item => String(item?.text || item?.content || item?.copy || '').trim())
    .filter(Boolean)
    .slice(0, 5)
    .join('、');
}

function getAiTextComponents(meta, rule = {}) {
  if (!hasAiTextAnalysis(meta) || getAiTextError(meta)) return null;
  const allowedTypes = new Set((rule.aiTextTypes || ['text', 'button', 'number']).map(type => String(type).toLowerCase()));
  const components = meta.aiTextAnalysis.texts
    .map(item => textItemToComponent(item))
    .filter(component => component && allowedTypes.has(component.type));
  return components.length ? components : null;
}

function textItemToComponent(item = {}) {
  const label = String(item.text || item.content || item.copy || '').trim();
  if (!isMeaningfulAiTextLabel(label)) return null;
  const confidence = normalizeComponentConfidence(item.confidence);

  const bbox = item.bbox;
  if (!bbox) return null;
  const left = Math.round(Number(bbox.left));
  const top = Math.round(Number(bbox.top));
  const width = Math.round(Number(bbox.width));
  const height = Math.round(Number(bbox.height));
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const right = left + width - 1;
  const bottom = top + height - 1;
  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    area: width * height,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
    type: String(item.type || 'text').toLowerCase(),
    label,
    confidence,
    source: 'ai'
  };
}

function isMeaningfulAiTextLabel(label) {
  if (!label) return false;
  if (/^按钮\d*$/.test(label)) return false;
  return /[\p{Script=Han}A-Za-z0-9]/u.test(label);
}

function normalizeComponentConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null;
}

function getTextGlyphCandidates(meta, rule = {}) {
  const minArea = getMinArea(meta, rule.minAreaRatio ?? 0.000015, rule.minArea || 6);
  const maxArea = getAreaLimit(meta, rule.maxGlyphAreaRatio ?? 0.004, rule.maxGlyphArea || 1800);
  const minHeight = rule.minTextHeight ?? 5;
  const maxHeight = rule.maxTextHeight ?? Math.max(24, Math.round((meta?.height || 0) * 0.12));
  const maxWidth = rule.maxGlyphWidth ?? Math.max(32, Math.round((meta?.width || 0) * 0.18));
  return getLayoutComponents(meta).filter(component => {
    if (component.area < minArea || component.area > maxArea) return false;
    if (component.height < minHeight || component.height > maxHeight) return false;
    if (component.width > maxWidth) return false;
    const aspect = component.width / Math.max(1, component.height);
    const density = component.density ?? component.area / Math.max(1, component.width * component.height);
    if (aspect > (rule.maxGlyphAspectRatio ?? 8)) return false;
    if (density < (rule.minTextDensity ?? 0.04) || density > (rule.maxTextDensity ?? 0.9)) return false;
    return true;
  });
}

function groupTextGlyphCandidates(candidates, rule = {}) {
  const minGroupCount = rule.minTextGroupComponents ?? 3;
  const maxLineGap = rule.maxTextLineGap ?? 10;
  const maxCharGap = rule.maxTextCharGap ?? 26;
  const minGroupWidth = rule.minTextGroupWidth ?? 28;
  const maxGroupHeight = rule.maxTextGroupHeight ?? (rule.maxTextHeight || 90);
  const sorted = candidates.slice().sort((a, b) => a.centerY - b.centerY || a.left - b.left);
  const lines = [];

  sorted.forEach(component => {
    let line = lines.find(item => Math.abs(item.centerY - component.centerY) <= Math.max(maxLineGap, Math.min(item.height, component.height)));
    if (!line) {
      line = { items: [], centerY: component.centerY, height: component.height };
      lines.push(line);
    }
    line.items.push(component);
    line.centerY = Math.round(line.items.reduce((sum, item) => sum + item.centerY, 0) / line.items.length);
    line.height = Math.max(...line.items.map(item => item.height));
  });

  return lines.flatMap(line => splitTextLine(line.items, maxCharGap))
    .map(group => unionRects(group))
    .filter(bounds => groupIsTextLike(bounds, groupLengthAtBounds(bounds, candidates), { minGroupCount, minGroupWidth, maxGroupHeight }));
}

function splitTextLine(items, maxGap) {
  const sorted = items.slice().sort((a, b) => a.left - b.left);
  const groups = [];
  let current = [];
  sorted.forEach(item => {
    const previous = current[current.length - 1];
    if (!previous || item.left - previous.right <= maxGap) {
      current.push(item);
      return;
    }
    if (current.length) groups.push(current);
    current = [item];
  });
  if (current.length) groups.push(current);
  return groups;
}

function groupLengthAtBounds(bounds, candidates) {
  return candidates.filter(component => intersects(component, bounds)).length;
}

function groupIsTextLike(bounds, count, limits) {
  if (count < limits.minGroupCount) return false;
  if (bounds.width < limits.minGroupWidth) return false;
  if (bounds.height > limits.maxGroupHeight) return false;
  const aspect = bounds.width / Math.max(1, bounds.height);
  return aspect >= 1.2 && aspect <= 24;
}

function getLogoCandidates(meta, rule, zoneRect) {
  const searchBox = expandRect(zoneRect, rule.searchPadding || { left: 8, top: 8, right: 24, bottom: 16 });
  const minArea = getMinArea(meta, rule.minAreaRatio ?? 0.00035, rule.minArea || 18);
  return getLayoutComponents(meta).filter(component => {
    if (component.area < minArea) return false;
    if (!intersects(component, searchBox)) return false;
    return component.centerX < zoneRect.right + (rule.searchRightExtra ?? 40);
  });
}

function getIpCandidates(meta, rule, ipRect, matchedVariant) {
  const logoZone = findLayoutZone(matchedVariant, 'LOGO');
  const logoRect = logoZone ? zoneToRect(logoZone) : null;
  const minArea = getMinArea(meta, rule.minAreaRatio ?? 0.003, rule.minArea || 80);
  return getLayoutComponents(meta).filter(component => {
    if (component.area < minArea) return false;
    if (logoRect && overlapRatio(component, logoRect) > 0.35) return false;
    return intersects(component, expandRect(ipRect, rule.searchPadding || { left: 24, top: 8, right: 8, bottom: 8 }));
  });
}

function getContrastRegions(rule, matchedVariant) {
  const regions = [];
  if (Array.isArray(rule.regions)) regions.push(...rule.regions.map(getRuleZone).filter(Boolean));
  const zoneKeywords = Array.isArray(rule.zoneKeywords) ? rule.zoneKeywords : [];
  zoneKeywords.forEach(keyword => {
    const zone = findLayoutZone(matchedVariant, keyword);
    if (zone) regions.push(zone);
  });
  return regions;
}

function getAverageColorForRect(meta, rect) {
  const cells = meta?.layoutAnalysis?.colorGrid?.cells;
  if (!Array.isArray(cells) || !cells.length || !rect) return null;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let weightSum = 0;
  cells.forEach(cell => {
    const weight = overlapArea(cell, rect);
    if (weight <= 0) return;
    rSum += cell.r * weight;
    gSum += cell.g * weight;
    bSum += cell.b * weight;
    weightSum += weight;
  });
  if (!weightSum) return null;
  const r = Math.round(rSum / weightSum);
  const g = Math.round(gSum / weightSum);
  const b = Math.round(bSum / weightSum);
  return { r, g, b, hex: rgbToHex(r, g, b) };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function overlapArea(a, b) {
  if (!intersects(a, b)) return 0;
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  return Math.max(0, right - left + 1) * Math.max(0, bottom - top + 1);
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

function createMarker(bounds, label) {
  if (!bounds) return null;
  return {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    label
  };
}

function createMarkersForComponents(components, fallbackLabel) {
  return components
    .map(component => createMarker(component, fallbackLabel))
    .filter(Boolean);
}

function formatZone(zone) {
  return `${zone.name || '区域'}（距左 ${zone.left}px，距上 ${zone.top}px，宽 ${zone.width}px，高 ${zone.height}px）`;
}

function formatBounds(bounds, meta = null) {
  const position = describeBoundsPosition(bounds, meta);
  return `${position}（左起 ${bounds.left}-${bounds.right}px，顶部 ${bounds.top}-${bounds.bottom}px）`;
}

function describeBoundsPosition(bounds, meta) {
  const width = meta?.width || 0;
  const height = meta?.height || 0;
  if (!width || !height) return '检测到的区域';

  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const widthRatio = bounds.width / width;
  const heightRatio = bounds.height / height;
  const horizontal = widthRatio > 0.55
    ? '横跨大部分画面'
    : centerX < width * 0.33
      ? '偏左'
      : centerX > width * 0.66
        ? '偏右'
        : '中间';
  const vertical = heightRatio > 0.5
    ? '纵向占比较大'
    : centerY < height * 0.33
      ? '偏上'
      : centerY > height * 0.66
        ? '偏下'
        : '中部';
  return `画面${vertical}${horizontal}位置`;
}
