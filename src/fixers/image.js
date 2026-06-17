import { analyzeBackgroundTextureFromCanvas, analyzeImageLayoutFromCanvas } from '../validators/meta.js';

/**
 * 图片修复引擎（基于 Canvas）
 *
 * 根据校验结果和用户选择的修复方式，生成修复后的 Blob
 *
 * 支持的修复：
 *  - 尺寸不对：缩放 / 裁剪（居中） / 加边框
 *  - 文件过大：按质量递减压缩
 *  - 格式不对：转换为目标格式
 */

/**
 * @param {Object} meta      原素材 meta
 * @param {Object} spec      规范
 * @param {Array} checkResults  校验结果
 * @param {Object} options   用户选择的修复参数
 *    - dimensionMethod: 'scale' | 'crop' | 'pad' | 'manualCrop'
 *    - manualCrop: { x, y, width, height }（可选，手动裁剪时使用）
 *    - compressionLevel: 'high' | 'balanced' | 'low' （画质：高/中/低）
 *    - targetFormat: 'jpg' | 'png' （可选）
 *
 * @returns {Promise<{blob, meta, log, filename}>}
 */
export async function fixImage(meta, spec, _checkResults, options = {}) {
  const {
    dimensionMethod = 'scale',
    manualCrop,
    compressionLevel = 'balanced',
    targetFormat,
    targetVariantId
  } = options;

  const log = [];
  const dimRule = spec.rules.find(r => r.field === 'dimensions');
  const formatRule = spec.rules.find(r => r.field === 'format');
  const sizeRule = spec.rules.find(r => r.field === 'size');

  // 目标尺寸
  let target;
  if (Array.isArray(spec.variants) && spec.variants.length) {
    // 优先用显式指定的 variantId
    let variant = spec.variants.find(v => v.id === targetVariantId);
    // 否则选"最接近当前尺寸的变体"（按像素总数差距最小）
    if (!variant) {
      const curArea = meta.width * meta.height;
      variant = spec.variants.slice().sort((a, b) => {
        return Math.abs(a.width * a.height - curArea) - Math.abs(b.width * b.height - curArea);
      })[0];
    }
    target = { width: variant.width, height: variant.height, variant };
  } else {
    target = {
      width: dimRule?.width || meta.width,
      height: dimRule?.height || meta.height
    };
  }

  // 目标格式
  const allowed = (formatRule?.allowed || []).map(x => x.toLowerCase());
  let outFormat = targetFormat;
  if (!outFormat) {
    if (allowed.length && !allowed.includes(meta.format)) {
      outFormat = allowed.includes('jpg') ? 'jpg' : allowed[0];
    } else {
      outFormat = meta.format;
    }
  }
  if (outFormat === 'jpeg') outFormat = 'jpg';
  const mime = outFormat === 'png' ? 'image/png' : 'image/jpeg';

  // 先做尺寸修复
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');

  // 非 PNG 时默认白底，避免透明区变黑
  if (outFormat !== 'png') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 加载源图（重新加载一次，避免被外部回收）
  const img = await loadImage(meta.objectUrl);

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const tgtW = target.width;
  const tgtH = target.height;

  if (srcW === tgtW && srcH === tgtH && dimensionMethod !== 'manualCrop') {
    ctx.drawImage(img, 0, 0);
  } else {
    switch (dimensionMethod) {
      case 'manualCrop': {
        const drawW = Math.max(1, Number(manualCrop?.width) || srcW);
        const drawH = Math.max(1, Number(manualCrop?.height) || srcH);
        const dx = Number.isFinite(Number(manualCrop?.x)) ? Number(manualCrop.x) : (tgtW - drawW) / 2;
        const dy = Number.isFinite(Number(manualCrop?.y)) ? Number(manualCrop.y) : (tgtH - drawH) / 2;
        ctx.drawImage(img, dx, dy, drawW, drawH);
        log.push(`手动裁剪 ${srcW}×${srcH} → ${tgtW}×${tgtH}`);
        break;
      }
      case 'crop': {
        // 居中裁剪 - 先按比例铺满画布
        const scale = Math.max(tgtW / srcW, tgtH / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        const dx = (tgtW - drawW) / 2;
        const dy = (tgtH - drawH) / 2;
        ctx.drawImage(img, dx, dy, drawW, drawH);
        log.push(`居中裁剪 ${srcW}×${srcH} → ${tgtW}×${tgtH}`);
        break;
      }
      case 'pad': {
        // 加白边 - 按比例装入画布
        const scale = Math.min(tgtW / srcW, tgtH / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        const dx = (tgtW - drawW) / 2;
        const dy = (tgtH - drawH) / 2;
        ctx.drawImage(img, dx, dy, drawW, drawH);
        log.push(`加边框缩放 ${srcW}×${srcH} → ${tgtW}×${tgtH}（两侧补白）`);
        break;
      }
      case 'scale':
      default: {
        // 缩放（可能变形）
        ctx.drawImage(img, 0, 0, tgtW, tgtH);
        log.push(`缩放 ${srcW}×${srcH} → ${tgtW}×${tgtH}`);
      }
    }
  }

  const dominantColor = getDominantColorFromCanvas(canvas);
  const layoutAnalysis = analyzeImageLayoutFromCanvas(canvas, dominantColor);
  const backgroundTexture = analyzeBackgroundTextureFromCanvas(canvas, dominantColor);

  if (outFormat !== meta.format) {
    log.push(`格式转换 ${meta.format?.toUpperCase()} → ${outFormat.toUpperCase()}`);
  }

  // 按质量递减压缩直到满足 size 要求
  const maxSize = sizeRule?.max || Infinity;
  const qualitySteps = compressionLevel === 'high'
    ? [0.95, 0.9, 0.85, 0.8]
    : compressionLevel === 'low'
      ? [0.7, 0.6, 0.5, 0.4, 0.3]
      : [0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5];

  let blob = null;
  let finalQuality = null;

  if (outFormat === 'png') {
    blob = await canvasToBlob(canvas, 'image/png');
  } else {
    for (const q of qualitySteps) {
      blob = await canvasToBlob(canvas, mime, q);
      finalQuality = q;
      if (blob.size <= maxSize) break;
    }
  }

  if (finalQuality !== null && blob.size !== meta.size) {
    log.push(`体积压缩 ${formatBytes(meta.size)} → ${formatBytes(blob.size)}（质量 ${Math.round(finalQuality * 100)}%）`);
  }

  // 生成新文件名
  const baseName = meta.name.replace(/\.[^.]+$/, '');
  const filename = `${baseName}_fixed.${outFormat}`;

  const newMeta = {
    ...meta,
    width: tgtW,
    height: tgtH,
    size: blob.size,
    format: outFormat,
    name: filename,
    objectUrl: URL.createObjectURL(blob),
    dominantColor,
    layoutAnalysis,
    backgroundTexture
  };

  // 在阻止成功的情况下（压缩后还超限），标记警告
  const warnings = [];
  if (blob.size > maxSize) {
    warnings.push(`压缩后体积 ${formatBytes(blob.size)} 仍超过限制 ${formatBytes(maxSize)}，请考虑进一步优化原图内容`);
  }

  return { blob, meta: newMeta, log, filename, warnings };
}

/**
 * 判断规则是否可以自动修复
 */
export function canAutoFix(checkResult) {
  if (checkResult.status === 'pass') return { fixable: false };
  const { field, meta, rule } = checkResult;

  switch (field) {
    case 'format': return { fixable: true };
    case 'size': return { fixable: true };
    case 'dimensions': {
      // 取可能的目标尺寸（来自 rule.width/height 或 rule.options）
      // variants 场景下，rule 上没有尺寸信息，跳过"过小警告"检查
      const tgtW = rule.width || rule.options?.[0]?.width || 0;
      const tgtH = rule.height || rule.options?.[0]?.height || 0;
      if (tgtW && tgtH && (meta.width < tgtW * 0.75 || meta.height < tgtH * 0.75)) {
        return {
          fixable: false,
          reason: `原图 ${meta.width}×${meta.height} 显著小于要求 ${tgtW}×${tgtH}，强行放大会严重失真`,
          suggestion: '请让设计师重新出图，或使用图像放大工具获取更高分辨率版本'
        };
      }
      return { fixable: true };
    }
    case 'backgroundTexture': return {
      fixable: false,
      reason: '背景底纹需要补充源设计素材',
      suggestion: '请在底色上叠加游戏海报或画面作为底纹后重新上传检测'
    };
    case 'logoPosition': return {
      fixable: false,
      reason: 'LOGO 区域位置需调整源设计稿',
      suggestion: '请将 LOGO 完整放入左上角 LOGO 区，并与区域左边缘对齐'
    };
    case 'ipPosition': return {
      fixable: false,
      reason: 'IP / 主元素位置需调整源设计稿',
      suggestion: '请将游戏 IP 或主元素完整放入右侧 IP 区域内'
    };
    case 'safeZone': return {
      fixable: false,
      reason: '安全区位置需调整源设计稿',
      suggestion: '请将 LOGO 和游戏 IP / 主元素分别完整放入对应安全区内'
    };
    default: return { fixable: false, reason: '暂不支持该字段的自动修复' };
  }
}

function getDominantColorFromCanvas(canvas) {
  const maxSide = 64;
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const sample = document.createElement('canvas');
  sample.width = width;
  sample.height = height;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, width, height);

  let data;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch (_) {
    return null;
  }

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  if (!buckets.size) return null;

  let top = null;
  for (const bucket of buckets.values()) {
    if (!top || bucket.count > top.count) top = bucket;
  }

  const r = Math.round(top.r / top.count);
  const g = Math.round(top.g / top.count);
  const b = Math.round(top.b / top.count);
  return { r, g, b, hex: rgbToHex(r, g, b) };
}

function clamp255(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(n => clamp255(n).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}
