import { readImageMeta } from '../validators/meta.js';

// 密钥只放后端 server/.env，不能写到前端。
// OA Pages 前后端分域时，可通过 window.SUCAI_TOOL_API_BASE_URL、URL 参数 apiBase、localStorage.sucaiToolApiBaseUrl 配置后端地址。
export const GPT_IMAGE2_IMAGE_FIX_API = resolveApiEndpoint('/api/gpt-image2/fix-image');
export const GPT_IMAGE2_IMAGE_TEXT_API = resolveApiEndpoint('/api/vision/identify-text');

function resolveApiEndpoint(path) {
  const apiBase = getApiBaseUrl();
  if (apiBase) return `${apiBase}${path}`;
  if (isLocalFrontend()) return `http://localhost:3000${path}`;
  return path;
}

function getApiBaseUrl() {
  if (typeof window === 'undefined') return '';
  const fromQuery = new URLSearchParams(window.location.search).get('apiBase') || new URLSearchParams(window.location.search).get('api_base');
  if (fromQuery) window.localStorage?.setItem('sucaiToolApiBaseUrl', fromQuery);
  const value = fromQuery || window.SUCAI_TOOL_API_BASE_URL || window.localStorage?.getItem('sucaiToolApiBaseUrl') || '';
  return String(value).trim().replace(/\/$/, '');
}

function isLocalFrontend() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
}

/**
 * 使用后端视觉理解模型识别图片中的可见文案，供安全区检测和文案修改使用。
 */
export async function identifyImageTextsWithGptImage2(meta, options = {}) {
  const endpoint = options.endpoint || getWindowConfig('VISION_IMAGE_TEXT_API') || getWindowConfig('GPT_IMAGE2_IMAGE_TEXT_API') || GPT_IMAGE2_IMAGE_TEXT_API;
  if (!endpoint) throw new Error('AI 文案识别接口尚未配置');
  if (!meta?.file) throw new Error('缺少原始图片文件，无法识别文案');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: await fileToBase64(meta.file),
      mimeType: meta.file.type || `image/${meta.format === 'jpg' ? 'jpeg' : meta.format || 'png'}`,
      filename: meta.name || meta.file.name || 'source.png',
      width: meta.width,
      height: meta.height
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `AI 文案识别接口请求失败（${res.status}）`);
  return normalizeIdentifiedTexts(data.texts || data.items || data.copyTexts || data.text || data.content);
}

/**
 * 只替换图片中的指定文案，其他画面元素保持不变。
 */
export async function editImageCopyWithGptImage2(meta, spec, { sourceText, targetText } = {}) {
  if (!sourceText || !targetText) throw new Error('缺少要修改的原文或新文案');
  const copyEdit = { sourceText, targetText };
  const instruction = `保持图片尺寸不变，只修改文案【${sourceText}】修改为【${targetText}】，其他全部不变`;

  const result = await fixImageWithGptImage2(meta, spec, [], {
    instruction,
    copyEdit,
    mode: 'copy-edit',
    preserveSourceOutput: true,
    filenameSuffix: 'copy_edited'
  });
  return {
    ...result,
    log: [
      `文案替换：“${sourceText}” → “${targetText}”`,
      ...(result.log || [])
    ]
  };
}

/**
 * 使用 GPT Image2 按完整素材规范一键修复图片。
 * 接口约定：POST application/json
 * - imageBase64: 原图片 base64（不含 data URL 头也可）
 * - payload: JSON，包含目标规范、当前检测结果、所有待修复问题与输出要求
 *
 * 返回支持：
 * 1. image/* 二进制图片；
 * 2. JSON：{ imageBase64 | base64 | imageUrl | url, mimeType?, filename?, log?, warnings? }
 */
export async function fixImageWithGptImage2(meta, spec, checkResults = [], options = {}) {
  const endpoint = options.endpoint || getWindowConfig('GPT_IMAGE2_IMAGE_FIX_API') || GPT_IMAGE2_IMAGE_FIX_API;
  if (!endpoint) throw new Error('智能修图接口尚未配置');
  if (!meta?.file) throw new Error('缺少原始图片文件，无法执行一键修复');

  const output = getTargetOutput(meta, spec, options);
  const failedChecks = checkResults.filter(r => r.status !== 'pass');
  const referenceImages = await normalizeReferenceImages(options.referenceImages);
  const mode = options.mode || 'full-compliance-fix';
  const referenceImageMeta = referenceImages.map(image => ({
    filename: image.filename,
    mimeType: image.mimeType,
    role: image.role || 'reference'
  }));
  const payload = mode === 'generic-image-edit'
    ? {
      mode,
      editType: options.editType || '',
      output,
      instruction: String(options.instruction || ''),
      referenceImages: referenceImageMeta
    }
    : {
      mode,
      output,
      spec: simplifySpec(spec),
      failedChecks: failedChecks.map(simplifyCheckResult),
      instruction: options.generateInstructionOnServer ? '' : (options.instruction || buildGptImage2Instruction(output, failedChecks)),
      referenceImages: referenceImageMeta,
      copyEdit: options.copyEdit ? simplifyCopyEdit(options.copyEdit) : undefined
    };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: await fileToBase64(meta.file),
      mimeType: meta.file.type || `image/${meta.format === 'jpg' ? 'jpeg' : meta.format || 'png'}`,
      filename: meta.name || meta.file.name || 'source.png',
      referenceImages,
      payload
    })
  });
  if (!res.ok) {
    const data = await res.clone().json().catch(() => null);
    const text = data?.error || (await res.text().catch(() => ''));
    throw new Error(`GPT Image2 修复接口请求失败（${res.status}）${text ? `：${text}` : ''}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const parsed = contentType.includes('application/json')
    ? await parseJsonResponse(res, output)
    : { blob: await res.blob(), filename: buildFilename(meta.name, output.format, options.filenameSuffix), log: [], warnings: [] };

  // gpt-image-2 输出尺寸由服务端按官方约束动态换算，仍可能与业务目标 W×H 不完全一致。
  // 这里按目标 W×H 居中裁剪 + 缩放 + 转换格式，保证最终图严格符合规范。
  const finalOutput = options.preserveSourceOutput
    ? { blob: parsed.blob, log: [], warnings: [] }
    : await normalizeAiImageToTargetSize(parsed.blob, output, options);

  const filename = parsed.filename || buildFilename(meta.name, output.format, options.filenameSuffix);
  const mimeType = finalOutput.blob.type || `image/${output.format === 'jpg' ? 'jpeg' : output.format || 'png'}`;
  const aiFile = new File([finalOutput.blob], filename, { type: mimeType });
  const aiMeta = await readImageMeta(aiFile);

  const baseLog = parsed.log?.length
    ? parsed.log
    : [mode === 'generic-image-edit' ? 'GPT Image2 已按用户提示词完成图生图编辑' : 'GPT Image2 已按素材规范生成修复图'];
  return {
    blob: finalOutput.blob,
    meta: aiMeta,
    filename: aiFile.name,
    log: [...baseLog, ...(finalOutput.log || [])],
    warnings: [...(parsed.warnings || []), ...(finalOutput.warnings || [])]
  };
}

function getWindowConfig(key) {
  return typeof window !== 'undefined' ? window[key] : '';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('读取原图失败，无法执行一键修复'));
    reader.readAsDataURL(file);
  });
}

async function normalizeReferenceImages(images = []) {
  if (!Array.isArray(images) || !images.length) return [];
  const normalized = [];
  for (const [index, image] of images.entries()) {
    if (!image) continue;
    if (image.base64) {
      normalized.push({
        base64: String(image.base64).split(',').pop() || '',
        mimeType: image.mimeType || 'image/png',
        filename: image.filename || `reference-${index + 1}.png`,
        role: image.role || 'reference'
      });
      continue;
    }
    const src = typeof image === 'string' ? image : (image.src || image.url);
    if (!src) continue;
    normalized.push(await fetchReferenceImage(src, image, index));
  }
  return normalized.slice(0, 2);
}

async function fetchReferenceImage(src, image = {}, index = 0) {
  if (typeof window === 'undefined') throw new Error('当前环境无法读取参考图');
  const url = new URL(src, window.location.href);
  if (url.origin !== window.location.origin) throw new Error('参考图必须是同源资源');
  const res = await fetch(url.href);
  if (!res.ok) throw new Error(`读取参考图失败（${res.status}）`);
  const blob = await res.blob();
  const mimeType = blob.type || image.mimeType || guessImageMimeType(url.pathname) || 'image/png';
  if (!mimeType.startsWith('image/')) throw new Error('参考图必须是图片文件');
  return {
    base64: await blobToBase64(blob),
    mimeType,
    filename: image.filename || decodeURIComponent(url.pathname.split('/').pop() || `reference-${index + 1}.png`),
    role: image.role || 'reference'
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('读取参考图失败'));
    reader.readAsDataURL(blob);
  });
}

function guessImageMimeType(path = '') {
  const ext = String(path).split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'png') return 'image/png';
  return '';
}

function getTargetOutput(meta, spec, options) {
  if (options.preserveSourceOutput || options.useSourceDimensions) {
    return {
      width: meta.width,
      height: meta.height,
      format: meta.format || 'png',
      maxSize: null,
      variantId: null,
      variantName: null,
      layoutZones: []
    };
  }

  const matchedVariant = options.matchedVariant;
  const variant = spec?.variants?.find(v => v.id === options.targetVariantId)
    || matchedVariant
    || spec?.variants?.[0];
  const dimRule = spec?.rules?.find(r => r.field === 'dimensions');
  const formatRule = spec?.rules?.find(r => r.field === 'format');
  const sizeRule = spec?.rules?.find(r => r.field === 'size');
  const allowed = (formatRule?.allowed || []).map(v => String(v).toLowerCase());
  const format = allowed.includes(meta.format) ? meta.format : (allowed[0] || meta.format || 'png');

  return {
    width: variant?.width || dimRule?.width || meta.width,
    height: variant?.height || dimRule?.height || meta.height,
    format,
    maxSize: sizeRule?.max || null,
    variantId: variant?.id || null,
    variantName: variant?.name || null,
    layoutZones: variant?.layoutZones || dimRule?.layoutZones || []
  };
}

function simplifySpec(spec) {
  return {
    id: spec?.id,
    name: spec?.name,
    shortName: spec?.shortName,
    fileType: spec?.fileType,
    variants: spec?.variants,
    generator: spec?.generator,
    rules: spec?.rules?.map(rule => ({ ...rule })) || []
  };
}

function simplifyCopyEdit(copyEdit = {}) {
  return {
    sourceText: String(copyEdit.sourceText || '').trim(),
    targetText: String(copyEdit.targetText || '').trim(),
    targetBox: copyEdit.targetBox ? { ...copyEdit.targetBox } : null
  };
}

function simplifyCheckResult(r) {
  return {
    field: r.field,
    label: r.label,
    status: r.status,
    current: r.current,
    required: r.required,
    tip: r.tip,
    rule: r.rule ? { ...r.rule } : undefined
  };
}

const SAFETY_REFERENCE_FIELDS = ['safeZone', 'titleButtonSafeZone', 'logoPosition', 'ipPosition', 'dangerZone', 'textSafety', 'logoQuality', 'ipCoverage'];

function isSafetyField(field) {
  return SAFETY_REFERENCE_FIELDS.includes(field);
}

/**
 * 把 layoutZones 的坐标转换为精确像素描述，提示词中不使用百分比或模糊方位。
 */
function buildSafeZoneDescriptions(output = {}) {
  const zones = Array.isArray(output.layoutZones) ? output.layoutZones : [];
  if (!zones.length) return [];
  return zones.map(zone => {
    const left = toPixelNumber(zone.left);
    const top = toPixelNumber(zone.top);
    const width = toPixelNumber(zone.width);
    const height = toPixelNumber(zone.height);
    const right = left + width;
    const bottom = top + height;
    return {
      name: String(zone.name || '').trim() || '布局区',
      tip: String(zone.tip || '').trim(),
      left, top, width, height, right, bottom,
      isDanger: /危险|禁/.test(String(zone.name || '')),
      humanPosition: describeRegion(left, top, width, height)
    };
  });
}

function toPixelNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function describeRegion(left, top, width, height) {
  const right = left + width;
  const bottom = top + height;
  return `左边界 x=${left}px，上边界 y=${top}px，右边界 x=${right}px，下边界 y=${bottom}px，宽 ${width}px，高 ${height}px`;
}

function buildSafeZoneSection(output, failedChecks) {
  const zones = buildSafeZoneDescriptions(output);
  if (!zones.length) return '';
  const wantsSafeZoneFix = failedChecks.some(rule => isSafetyField(rule.field));
  if (!wantsSafeZoneFix) return '';

  const allowed = zones.filter(z => !z.isDanger);
  const danger = zones.filter(z => z.isDanger);
  const lines = [];
  if (allowed.length) {
    lines.push('安全区（必须把对应元素完整放进去）：');
    allowed.forEach(z => lines.push(`- ${z.name}：${z.humanPosition}${z.tip ? `；${z.tip}` : ''}`));
  }
  if (danger.length) {
    lines.push('危险区（除背景外，禁止出现 LOGO、IP、文字、按钮等关键元素）：');
    danger.forEach(z => lines.push(`- ${z.name}：${z.humanPosition}${z.tip ? `；${z.tip}` : ''}`));
  }
  return lines.join('\n');
}

function buildGptImage2Instruction(output, failedChecks) {
  const targetSize = output.width && output.height ? `${output.width}×${output.height}` : '';
  const safeZoneSection = buildSafeZoneSection(output, failedChecks);
  const hasSafeZoneIssue = failedChecks.some(rule => isSafetyField(rule.field));
  const sections = [
    '这是素材规范自动修复任务，不是自由创作任务。请基于上传的原始素材做局部编辑，只修复违规元素，不要重新生成整张图。',
    targetSize ? `最终输出尺寸必须严格等于 ${targetSize}，保持原始比例、清晰度和设计风格。` : '',
    output.format ? `最终输出格式：${String(output.format).toUpperCase()}。` : '',
    '',
    '【必须保持不变】',
    '- 背景、人物、商品、主视觉、光影、色调、整体构图不变。',
    '- 标题文字、按钮文字、LOGO、主文案内容不变。',
    '- 字体风格、描边、阴影、颜色、按钮圆角、质感保持和原图一致。',
    '- 不要新增无关元素；如果移动元素后原位置露出空白，请根据周围背景补全。',
    ''
  ];
  if (hasSafeZoneIssue && safeZoneSection) {
    sections.push('【安全区修复】');
    sections.push('参考安全区/危险区规范：红色区域为危险区，不能放标题、按钮、核心文案、LOGO、重要角色脸部、关键商品信息；绿色/透明区域为安全区。');
    sections.push(safeZoneSection);
    sections.push('做法：只移动或等比缩放标题、按钮、LOGO、主文案等违规元素，让元素外接矩形完整落入安全区；其它像素保持不变。');
    sections.push('最终图严禁出现安全区标注线、红区、绿区、参考框、辅助线、箭头、坐标或英文标签。');
    sections.push('');
  }
  failedChecks.forEach(rule => {
    const line = buildGptImage2RuleInstruction(rule, { hasDimensionIssue: failedChecks.some(r => r.field === 'dimensions') });
    if (line) sections.push(line);
  });
  return sections.filter(s => s !== undefined && s !== null).join('\n');
}

function buildGptImage2RuleInstruction(rule, context = {}) {
  const config = rule?.rule || {};
  const sizePreserve = context.hasDimensionIssue ? '尺寸只按尺寸不符合项单独处理' : '维持原图尺寸不变';
  switch (rule?.field) {
    case 'colorZone':
      return `- 识别元素主色调，仅修改底色至规范区域内（${formatAiColorRequirement(rule, config)}），${sizePreserve}，其他设计全部都不改变。`;
    case 'whiteTextContrast':
      return `- 仅加深白色文字承载区域或底色，使白字对比度达到规范（${formatAiContrastRequirement(rule, config)}），${sizePreserve}，文字内容、字体、主体和其他设计全部不变。`;
    case 'localWhiteTextContrast':
      return `- 仅加深局部白色文字承载区域，使白字对比度达到规范（${formatAiContrastRequirement(rule, config)}），${sizePreserve}，文字内容、字体、主体和其他设计全部不变。`;
    case 'backgroundTexture':
      return `- 仅在现有背景上补充规范要求的底纹，不新增可识别物体，主体、文案和 LOGO 不变${formatAiTextureRequirement(config)}。`;
    case 'dimensions':
    case 'size':
    case 'format':
      // 这三项由前端后处理强制生效，不再要求模型处理。
      return '';
    case 'titleButtonSafeZone':
    case 'safeZone':
    case 'logoPosition':
    case 'ipPosition':
    case 'dangerZone':
    case 'textSafety':
    case 'logoQuality':
    case 'ipCoverage':
      // 安全区相关问题已在上面的"安全区"小节用精确像素统一描述，
      // 不再重复，避免给模型多份冲突指令。
      return '';
    default:
      return `- 仅修复"${rule?.label || rule?.field || '不符合项'}"这一项${rule?.required ? `（${rule.required}）` : ''}，其他全部不变。`;
  }
}

function formatAiColorRequirement(result, config = {}) {
  const maxS = config.maxS ?? extractAiNumber(result?.required, /S≤\s*(\d+(?:\.\d+)?)%?/i) ?? 40;
  const minB = config.minB ?? extractAiNumber(result?.required, /B≥\s*(\d+(?:\.\d+)?)%?/i) ?? 60;
  const minRatio = config.minRatio ?? config.minContrastRatio ?? extractAiNumber(result?.required, /对比度\s*≥\s*(\d+(?:\.\d+)?)/i);
  const parts = [`避开禁用区 S≤${maxS}% 且 B≥${minB}%`, `建议调整至 S>${maxS}% 或 B<${minB}%`];
  if (Number.isFinite(minRatio)) parts.push(`白字对比度≥${minRatio}:1`);
  return parts.join('；');
}

function formatAiContrastRequirement(result, config = {}) {
  const minRatio = config.minRatio ?? config.minContrastRatio ?? extractAiNumber(result?.required, /≥\s*(\d+(?:\.\d+)?):?1?/i) ?? 4.5;
  return `与白色文字对比度≥${minRatio}:1`;
}

function formatAiTextureRequirement(config = {}) {
  const parts = [];
  if (Number.isFinite(config.minBackgroundPixelRatio)) parts.push(`背景占比≥${Math.round(config.minBackgroundPixelRatio * 100)}%`);
  if (Number.isFinite(config.minVariedRatio)) parts.push(`变化像素≥${(config.minVariedRatio * 100).toFixed(1)}%`);
  return parts.length ? `（${parts.join('；')}）` : '';
}

function extractAiNumber(value, pattern) {
  const match = String(value || '').match(pattern);
  return match ? Number(match[1]) : undefined;
}

async function parseJsonResponse(res, output) {
  const data = await res.json();
  let blob;
  if (data.imageBase64 || data.base64) {
    blob = base64ToBlob(data.imageBase64 || data.base64, data.mimeType || `image/${output.format === 'jpg' ? 'jpeg' : output.format}`);
  } else if (data.imageUrl || data.url) {
    const imgRes = await fetch(data.imageUrl || data.url);
    if (!imgRes.ok) throw new Error('GPT Image2 修复图片下载失败');
    blob = await imgRes.blob();
  } else {
    throw new Error('GPT Image2 修复接口未返回图片数据');
  }

  return {
    blob,
    filename: data.filename,
    log: Array.isArray(data.log) ? data.log : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : []
  };
}

function base64ToBlob(value, mimeType) {
  const raw = String(value).includes(',') ? String(value).split(',').pop() : String(value);
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * 把 AI 输出的图片裁剪/缩放/转码到规范要求的精确尺寸和格式。
 *
 * 关键点：
 * 1. gpt-image-2 仅支持 1024×1024 / 1536×1024 / 1024×1536 三档分辨率，
 *    与目标尺寸（660×220、380×220、750×500 等）的宽高比往往不一致。
 * 2. 必须按"目标比例"先做居中裁剪，再缩放到目标 W×H，否则元素位置/占比都会乱。
 * 3. 体积超限时按 0.95 → 0.4 递减质量重压。
 */
async function normalizeAiImageToTargetSize(blob, output = {}, options = {}) {
  const tgtW = Number(output.width);
  const tgtH = Number(output.height);
  const targetFormat = (output.format || 'png').toLowerCase();
  const mime = targetFormat === 'jpg' || targetFormat === 'jpeg' ? 'image/jpeg' : targetFormat === 'webp' ? 'image/webp' : 'image/png';
  const log = [];
  const warnings = [];

  if (!Number.isFinite(tgtW) || !Number.isFinite(tgtH) || tgtW <= 0 || tgtH <= 0) {
    return { blob, log, warnings };
  }

  const objectUrl = URL.createObjectURL(blob);
  let img;
  try {
    img = await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const tgtRatio = tgtW / tgtH;
  const srcRatio = srcW / srcH;

  // 居中裁剪到目标比例
  let cropW;
  let cropH;
  let cropX;
  let cropY;
  if (Math.abs(srcRatio - tgtRatio) < 1e-3) {
    cropW = srcW;
    cropH = srcH;
    cropX = 0;
    cropY = 0;
  } else if (srcRatio > tgtRatio) {
    // 源更宽 → 左右各裁掉一些
    cropH = srcH;
    cropW = Math.round(srcH * tgtRatio);
    cropX = Math.round((srcW - cropW) / 2);
    cropY = 0;
  } else {
    // 源更高 → 上下各裁掉一些
    cropW = srcW;
    cropH = Math.round(srcW / tgtRatio);
    cropX = 0;
    cropY = Math.round((srcH - cropH) / 2);
  }

  const canvas = document.createElement('canvas');
  canvas.width = tgtW;
  canvas.height = tgtH;
  const ctx = canvas.getContext('2d');
  if (mime !== 'image/png') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tgtW, tgtH);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, tgtW, tgtH);

  if (srcW !== tgtW || srcH !== tgtH) {
    log.push(`已按目标比例居中裁剪并缩放：${srcW}×${srcH} → ${tgtW}×${tgtH}`);
  }

  let finalBlob;
  if (mime === 'image/png') {
    finalBlob = await canvasToBlob(canvas, 'image/png');
  } else {
    const steps = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5, 0.4];
    const max = Number(output.maxSize) || Infinity;
    let chosen = null;
    for (const q of steps) {
      const candidate = await canvasToBlob(canvas, mime, q);
      chosen = { blob: candidate, quality: q };
      if (candidate.size <= max) break;
    }
    finalBlob = chosen?.blob || await canvasToBlob(canvas, mime, 0.85);
    if (chosen && finalBlob.size > max && Number.isFinite(max)) {
      warnings.push(`修复图体积 ${(finalBlob.size / 1024).toFixed(1)}KB 仍超过限制 ${(max / 1024).toFixed(1)}KB`);
    }
  }

  if (options.filenameSuffix !== undefined) {
    // 占位，保持签名兼容
  }
  return { blob: finalBlob, log, warnings };
}

function normalizeIdentifiedTexts(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|、|；|;/).map(text => ({ text }))
      : [];
  const seen = new Set();
  return source
    .map(item => typeof item === 'string' ? { text: item } : item)
    .map(item => {
      const bbox = normalizeBBox(item);
      const text = String(item?.text || item?.content || item?.copy || '').trim();
      return {
        text,
        type: normalizeTextType(item?.type),
        bbox,
        confidence: normalizeConfidence(item?.confidence),
        note: String(item?.note || item?.position || item?.area || '').trim()
      };
    })
    .filter(item => {
      if (!item.text) return false;
      const key = [item.type, item.text, item.bbox?.left, item.bbox?.top, item.bbox?.width, item.bbox?.height].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function normalizeTextType(value) {
  const type = String(value || 'text').toLowerCase();
  return ['text', 'button', 'logo', 'number'].includes(type) ? type : 'text';
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null;
}

function normalizeBBox(item = {}) {
  const box = item.bbox || item.box || item.rect || item.bounds;
  if (Array.isArray(box) && box.length >= 4) {
    return normalizeRect(box[0], box[1], box[2], box[3]);
  }
  const source = box && typeof box === 'object' ? box : item;
  const left = source.left ?? source.x ?? source.x1;
  const top = source.top ?? source.y ?? source.y1;
  const width = source.width ?? (Number.isFinite(Number(source.right ?? source.x2)) && Number.isFinite(Number(left)) ? Number(source.right ?? source.x2) - Number(left) : undefined);
  const height = source.height ?? (Number.isFinite(Number(source.bottom ?? source.y2)) && Number.isFinite(Number(top)) ? Number(source.bottom ?? source.y2) - Number(top) : undefined);
  return normalizeRect(left, top, width, height);
}

function normalizeRect(left, top, width, height) {
  const rect = {
    left: Math.round(Number(left)),
    top: Math.round(Number(top)),
    width: Math.round(Number(width)),
    height: Math.round(Number(height))
  };
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

function findTargetTextBox(texts, sourceText) {
  const normalized = normalizeIdentifiedTexts(texts);
  const exact = normalized.find(item => item.text === sourceText && item.bbox);
  if (exact) return exact.bbox;
  const partial = normalized.find(item => item.bbox && (item.text.includes(sourceText) || sourceText.includes(item.text)));
  return partial?.bbox || null;
}

async function compositeCopyEditPatch(sourceMeta, result, bbox, copyEdit = {}) {
  const sourceTempUrl = sourceMeta.objectUrl ? '' : URL.createObjectURL(sourceMeta.file);
  const resultTempUrl = result.meta?.objectUrl ? '' : URL.createObjectURL(result.blob);
  const sourceUrl = sourceMeta.objectUrl || sourceTempUrl;
  const resultUrl = result.meta?.objectUrl || resultTempUrl;

  try {
    const [sourceImg, resultImg] = await Promise.all([loadImage(sourceUrl), loadImage(resultUrl)]);
    const width = sourceMeta.width || sourceImg.naturalWidth;
    const height = sourceMeta.height || sourceImg.naturalHeight;
    const patch = expandPatchRect(bbox, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(sourceImg, 0, 0, width, height);

    const sx = patch.left / width * resultImg.naturalWidth;
    const sy = patch.top / height * resultImg.naturalHeight;
    const sw = patch.width / width * resultImg.naturalWidth;
    const sh = patch.height / height * resultImg.naturalHeight;
    ctx.drawImage(resultImg, sx, sy, sw, sh, patch.left, patch.top, patch.width, patch.height);
    if (copyEdit.targetText) drawReplacementText(ctx, bbox, copyEdit.targetText, width, height);

    const format = sourceMeta.format || result.meta?.format || 'png';
    const mimeType = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, mimeType);
    const filename = result.filename || buildFilename(sourceMeta.name, format, 'copy_edited');
    const file = new File([blob], filename, { type: mimeType });
    const meta = await readImageMeta(file);
    return { ...result, blob, meta, filename };
  } finally {
    if (sourceTempUrl) URL.revokeObjectURL(sourceTempUrl);
    if (resultTempUrl) URL.revokeObjectURL(resultTempUrl);
  }
}

function expandPatchRect(rect, imageWidth, imageHeight) {
  const padX = Math.max(8, Math.round(rect.width * 0.35));
  const padY = Math.max(6, Math.round(rect.height * 0.7));
  const left = Math.max(0, rect.left - padX);
  const top = Math.max(0, rect.top - padY);
  const right = Math.min(imageWidth, rect.left + rect.width + padX);
  const bottom = Math.min(imageHeight, rect.top + rect.height + padY);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function drawReplacementText(ctx, bbox, targetText, imageWidth, imageHeight) {
  const text = String(targetText || '').trim();
  if (!text) return;
  const rect = expandTextRect(bbox, imageWidth, imageHeight);
  const bg = sampleBackgroundColor(ctx, rect);
  const bgColor = `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.88)`;
  const lines = splitTextLines(text);

  ctx.save();
  drawRoundedRect(ctx, rect.left, rect.top, rect.width, rect.height, Math.max(4, Math.round(rect.height * 0.12)));
  ctx.fillStyle = bgColor;
  ctx.fill();

  const maxWidth = rect.width * 0.9;
  let fontSize = Math.min(rect.height * 0.68 / lines.length, rect.width / Math.max(2.4, text.length) * 1.4, 52);
  fontSize = Math.max(10, Math.floor(fontSize));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  do {
    ctx.font = `italic 900 ${fontSize}px "Arial Black", "PingFang SC", "Microsoft YaHei", sans-serif`;
    if (lines.every(line => ctx.measureText(line).width <= maxWidth)) break;
    fontSize -= 1;
  } while (fontSize > 10);

  const lineHeight = fontSize * 1.08;
  const startY = rect.top + rect.height / 2 - lineHeight * (lines.length - 1) / 2;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = Math.max(2, fontSize * 0.12);
  ctx.shadowOffsetX = Math.max(1, fontSize * 0.05);
  ctx.shadowOffsetY = Math.max(1, fontSize * 0.05);
  lines.forEach((line, index) => {
    const x = rect.left + rect.width / 2;
    const y = startY + index * lineHeight;
    ctx.lineWidth = Math.max(3, fontSize * 0.14);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.strokeText(line, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

function expandTextRect(rect, imageWidth, imageHeight) {
  const padX = Math.max(4, Math.round(rect.width * 0.08));
  const padY = Math.max(3, Math.round(rect.height * 0.18));
  const left = Math.max(0, rect.left - padX);
  const top = Math.max(0, rect.top - padY);
  const right = Math.min(imageWidth, rect.left + rect.width + padX);
  const bottom = Math.min(imageHeight, rect.top + rect.height + padY);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function splitTextLines(text) {
  const explicit = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit.slice(0, 3);
  return [text.replace(/\s+/g, ' ')];
}

function sampleBackgroundColor(ctx, rect) {
  try {
    const data = ctx.getImageData(rect.left, rect.top, rect.width, rect.height).data;
    const border = Math.max(2, Math.round(Math.min(rect.width, rect.height) * 0.18));
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    const step = Math.max(1, Math.floor(Math.min(rect.width, rect.height) / 18));
    for (let y = 0; y < rect.height; y += step) {
      for (let x = 0; x < rect.width; x += step) {
        if (x > border && x < rect.width - border && y > border && y < rect.height - border) continue;
        const index = (y * rect.width + x) * 4;
        const pr = data[index];
        const pg = data[index + 1];
        const pb = data[index + 2];
        const brightness = (pr + pg + pb) / 3;
        if (brightness > 220) continue;
        r += pr;
        g += pg;
        b += pb;
        count += 1;
      }
    }
    if (count) return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
  } catch (_) {
    // ignore canvas sampling failure and use fallback
  }
  return { r: 18, g: 30, b: 52 };
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('文案区域合成失败：图片加载失败'));
    img.src = url;
  });
}

function canvasToBlob(canvas, mimeType, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片导出失败')), mimeType, quality);
  });
}

function buildFilename(name = 'image.png', format = 'png', suffix = 'ai_fixed') {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  const ext = format === 'jpeg' ? 'jpg' : format;
  return `${base}_${suffix}.${ext}`;
}
