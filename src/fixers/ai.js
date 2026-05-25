import { readImageMeta } from '../validators/meta.js';

// 预留 Hunyuan 图片修复 API。实际接入时可通过 window.HUNYUAN_IMAGE_FIX_API 或这里配置接口地址。
export const HUNYUAN_IMAGE_FIX_API = '';

/**
 * 使用 Hunyuan AI 按完整素材规范一键修复图片。
 * 接口约定：POST multipart/form-data
 * - image: 原图片文件
 * - payload: JSON，包含目标规范、当前检测结果、所有待修复问题与输出要求
 *
 * 返回支持：
 * 1. image/* 二进制图片；
 * 2. JSON：{ imageBase64 | base64 | imageUrl | url, mimeType?, filename?, log?, warnings? }
 */
export async function fixImageWithHunyuan(meta, spec, checkResults = [], options = {}) {
  const endpoint = options.endpoint || window.HUNYUAN_IMAGE_FIX_API || HUNYUAN_IMAGE_FIX_API;
  if (!endpoint) {
    throw new Error('Hunyuan AI 修复接口尚未配置，请先设置 window.HUNYUAN_IMAGE_FIX_API 或在 src/fixers/ai.js 中填写接口地址');
  }
  if (!meta?.file) throw new Error('缺少原始图片文件，无法提交 AI 修复');

  const output = getTargetOutput(meta, spec, options);
  const failedChecks = checkResults.filter(r => r.status !== 'pass');
  const payload = {
    mode: 'full-compliance-fix',
    output,
    spec: simplifySpec(spec),
    failedChecks: failedChecks.map(simplifyCheckResult),
    instruction: buildHunyuanInstruction(output, failedChecks)
  };

  const form = new FormData();
  form.append('image', meta.file, meta.name || meta.file.name || 'source.png');
  form.append('payload', new Blob([JSON.stringify(payload)], { type: 'application/json' }));

  const res = await fetch(endpoint, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hunyuan AI 修复接口请求失败（${res.status}）${text ? `：${text}` : ''}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const parsed = contentType.includes('application/json')
    ? await parseJsonResponse(res, output)
    : { blob: await res.blob(), filename: buildFilename(meta.name, output.format), log: [], warnings: [] };

  const file = new File([parsed.blob], parsed.filename || buildFilename(meta.name, output.format), {
    type: parsed.blob.type || `image/${output.format === 'jpg' ? 'jpeg' : output.format}`
  });
  const fixedMeta = await readImageMeta(file);

  return {
    blob: parsed.blob,
    meta: fixedMeta,
    filename: file.name,
    log: parsed.log?.length ? parsed.log : ['Hunyuan AI 已按完整素材规范一键修复'],
    warnings: parsed.warnings || []
  };
}

function getTargetOutput(meta, spec, options) {
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

function simplifyCheckResult(r) {
  return {
    field: r.field,
    label: r.label,
    status: r.status,
    current: r.current,
    required: r.required,
    tip: r.tip
  };
}

function buildHunyuanInstruction(output, failedChecks) {
  const problems = failedChecks.map(r => `${r.label || r.field}：当前 ${r.current}，要求 ${r.required}`).join('\n');
  return [
    '请在尽量保留原素材主体与视觉风格的前提下，按规范修复所有不通过项。',
    `输出尺寸必须为 ${output.width}×${output.height}。`,
    `输出格式必须为 ${String(output.format).toUpperCase()}。`,
    output.maxSize ? `输出文件体积不得超过 ${output.maxSize} bytes。` : '',
    '需要同时修复文件规格、底色、背景底纹、LOGO 位置、IP / 主元素位置，以及后续新增的所有校验限制。',
    output.layoutZones?.length ? `布局区域：${JSON.stringify(output.layoutZones)}` : '',
    problems ? `待修复问题：\n${problems}` : ''
  ].filter(Boolean).join('\n');
}

async function parseJsonResponse(res, output) {
  const data = await res.json();
  let blob;
  if (data.imageBase64 || data.base64) {
    blob = base64ToBlob(data.imageBase64 || data.base64, data.mimeType || `image/${output.format === 'jpg' ? 'jpeg' : output.format}`);
  } else if (data.imageUrl || data.url) {
    const imgRes = await fetch(data.imageUrl || data.url);
    if (!imgRes.ok) throw new Error('Hunyuan AI 修复图片下载失败');
    blob = await imgRes.blob();
  } else {
    throw new Error('Hunyuan AI 修复接口未返回图片数据');
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

function buildFilename(name = 'image.png', format = 'png') {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  const ext = format === 'jpeg' ? 'jpg' : format;
  return `${base}_ai_fixed.${ext}`;
}
