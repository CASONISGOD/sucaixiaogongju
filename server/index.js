import http from 'node:http';
import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

loadDotEnv(resolve(process.cwd(), '.env'));
loadDotEnv(resolve(import.meta.dirname, '.env'));

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

const GPT_IMAGE2_API_BASE_URL = (process.env.GPT_IMAGE2_API_BASE_URL || 'http://v2.open.venus.oa.com/llmproxy').replace(/\/$/, '');
const GPT_IMAGE2_MODEL = process.env.GPT_IMAGE2_MODEL || 'gpt-image-2';
const GPT_IMAGE2_GENERATIONS_PATH = process.env.GPT_IMAGE2_GENERATIONS_PATH || '/images/generations';
const GPT_IMAGE2_EDITS_PATH = process.env.GPT_IMAGE2_EDITS_PATH || '/images/edits';
const GPT_IMAGE2_QUALITY = process.env.GPT_IMAGE2_QUALITY || 'medium';
// 留空时（默认）按 gpt-image-2 官方约束动态计算最贴近目标比例的合法尺寸；
// 仅在显式配置时才走白名单（兼容 gpt-image-1 / 旧网关）。
const GPT_IMAGE2_ALLOWED_SIZES = String(process.env.GPT_IMAGE2_ALLOWED_SIZES || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
const VISION_API_BASE_URL = (process.env.VISION_API_BASE_URL || 'http://v2.open.venus.oa.com/chatproxy').replace(/\/$/, '');
const VISION_CHAT_PATH = process.env.VISION_CHAT_PATH || '/chat/completions';
const VISION_MODEL = process.env.VISION_MODEL || 'gpt-5.5';

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, statusCode, data, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'X-Content-Type-Options': 'nosniff'
  };
  if (isOriginAllowed(origin)) headers['Access-Control-Allow-Origin'] = origin || '*';
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

function isOriginAllowed(origin) {
  return !origin || !allowedOrigins.length || allowedOrigins.includes(origin);
}

function sendStaticFile(res, filePath, statusCode = 200) {
  const contentType = getStaticContentType(filePath);
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': contentType.startsWith('text/html') || contentType.startsWith('text/javascript') || contentType.startsWith('text/css')
      ? 'no-cache'
      : 'public, max-age=3600'
  });
  createReadStream(filePath).pipe(res);
}

function getStaticContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  }[ext] || 'application/octet-stream';
}

function resolveStaticPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const safePath = normalizedPath.replace(/^\/+/, '');
  const filePath = resolve(rootDir, safePath);
  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${sep}`)) return '';
  return filePath;
}

function readJsonBody(req, { limit = 12 * 1024 * 1024 } = {}) {
  return new Promise((resolveBody, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolveBody({});
      try { resolveBody(JSON.parse(raw)); }
      catch { reject(new Error('请求 JSON 格式不正确')); }
    });
    req.on('error', reject);
  });
}

function isUsableSecret(value) {
  const key = String(value || '').trim();
  return !!key && !key.includes('你的') && !key.toLowerCase().includes('your');
}

function getGptImage2ApiKey() {
  const key = process.env.GPT_IMAGE2_API_KEY || process.env.OPENAI_API_KEY || '';
  return isUsableSecret(key) ? key : '';
}

function getVisionApiKey() {
  const key = process.env.VISION_API_KEY || process.env.GPT_IMAGE2_API_KEY || process.env.OPENAI_API_KEY || '';
  return isUsableSecret(key) ? key : '';
}

function sanitizeErrorMessage(message) {
  return String(message || '')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1****')
    .replace(/([A-Za-z0-9_-]{6})[A-Za-z0-9_-]{10,}([A-Za-z0-9_-]{4})/g, '$1****$2')
    .replace(/[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}/g, '****');
}

function getGptImage2Authorization() {
  const apiKey = getGptImage2ApiKey();
  if (!apiKey) throw new Error('请先在 server/.env 中配置 GPT_IMAGE2_API_KEY，或配置 OPENAI_API_KEY');
  return /^Bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`;
}

function getVisionAuthorization() {
  const apiKey = getVisionApiKey();
  if (!apiKey) throw new Error('请先在 server/.env 中配置 VISION_API_KEY，或复用 GPT_IMAGE2_API_KEY');
  return /^Bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`;
}

async function callGptImage2Json(path, payload) {
  const response = await fetch(`${GPT_IMAGE2_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: getGptImage2Authorization(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  return parseGptImage2Response(response);
}

async function callGptImage2Multipart(path, formData) {
  const response = await fetch(`${GPT_IMAGE2_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: getGptImage2Authorization() },
    body: formData
  });
  return parseGptImage2Response(response);
}

async function parseGptImage2Response(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(sanitizeErrorMessage(data.error?.message || data.message || `GPT Image2 接口请求失败：${response.status}`));
  }
  if (data.error) throw new Error(sanitizeErrorMessage(data.error.message || data.error.code || 'GPT Image2 接口返回错误'));
  return data;
}

async function callVisionJson(payload) {
  const response = await fetch(`${VISION_API_BASE_URL}${VISION_CHAT_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: getVisionAuthorization(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(sanitizeErrorMessage(data.error?.message || data.message || `视觉识别接口请求失败：${response.status}`));
  }
  if (data.error) throw new Error(sanitizeErrorMessage(data.error.message || data.error.code || '视觉识别接口返回错误'));
  return data;
}

function normalizeResolution(value) {
  const raw = String(value || '1024x1024').trim().replace(':', 'x');
  const matched = raw.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!matched) return GPT_IMAGE2_ALLOWED_SIZES[0] || '1024x1024';
  const w = Number(matched[1]);
  const h = Number(matched[2]);
  if (GPT_IMAGE2_ALLOWED_SIZES.length) {
    if (GPT_IMAGE2_ALLOWED_SIZES.includes(raw)) return raw;
    return getClosestGptImage2Size(w, h);
  }
  return pickGptImage2Size(w, h);
}

function getClosestGptImage2Size(width, height) {
  const targetRatio = width / height;
  return GPT_IMAGE2_ALLOWED_SIZES
    .filter(size => /^(\d{3,4})x(\d{3,4})$/.test(size))
    .sort((a, b) => {
      const [aw, ah] = a.split('x').map(Number);
      const [bw, bh] = b.split('x').map(Number);
      const ratioDiff = Math.abs((aw / ah) - targetRatio) - Math.abs((bw / bh) - targetRatio);
      if (Math.abs(ratioDiff) > 0.0001) return ratioDiff;
      return Math.abs((aw * ah) - (width * height)) - Math.abs((bw * bh) - (width * height));
    })[0] || '1024x1024';
}

/**
 * gpt-image-2 官方约束（OpenAI / 内部网关一致）：
 * - 宽高都必须是 16 的倍数
 * - 最长边 ≤ 3840
 * - 长边 : 短边 ≤ 3 : 1（含等于 3:1）
 * - 总像素数 ∈ [655_360, 8_294_400]
 *
 * 策略：优先保持目标宽高比，寻找一个 16 倍数、约 1K 工作尺寸的合法分辨率。
 * 目标尺寸本身如果是 16 的倍数（如 660×220 的比例 3:1 可缩放到 1440×480），
 * 就优先使用同倍率尺寸，这样前端只需要等比例缩放，不需要居中裁剪。
 */
function pickGptImage2Size(width, height) {
  const w0 = Number(width);
  const h0 = Number(height);
  if (!w0 || !h0) return '1024x1024';

  const STEP = 16;
  const MIN_PIXELS = 655_360;
  const MAX_PIXELS = 8_294_400;
  const MAX_EDGE = Math.floor(3840 / STEP) * STEP; // 3840
  const MAX_RATIO = 3;

  const ratio = Math.max(1 / MAX_RATIO, Math.min(MAX_RATIO, w0 / h0));
  const sourceLongEdge = Math.max(w0, h0);
  const targetLongEdge = Math.min(MAX_EDGE, Math.max(1024, sourceLongEdge));

  const exact = pickExactRatioSize(w0, h0, { step: STEP, minPixels: MIN_PIXELS, maxPixels: MAX_PIXELS, maxEdge: MAX_EDGE, targetLongEdge });
  if (exact) return `${exact.width}x${exact.height}`;

  return pickClosestRatioSize(ratio, { step: STEP, minPixels: MIN_PIXELS, maxPixels: MAX_PIXELS, maxEdge: MAX_EDGE, targetLongEdge });
}

function pickExactRatioSize(width, height, limits) {
  const { step, minPixels, maxPixels, maxEdge, targetLongEdge } = limits;
  const gcd = getGcd(Math.round(width), Math.round(height));
  const baseW = Math.round(width / gcd);
  const baseH = Math.round(height / gcd);

  // 让 baseW*k 和 baseH*k 同时成为 16 的倍数。
  const kStep = getLcm(step / getGcd(baseW, step), step / getGcd(baseH, step));
  const minKByEdge = Math.ceil(targetLongEdge / Math.max(baseW, baseH));
  const minKByPixels = Math.ceil(Math.sqrt(minPixels / (baseW * baseH)));
  const maxKByEdge = Math.floor(maxEdge / Math.max(baseW, baseH));
  const maxKByPixels = Math.floor(Math.sqrt(maxPixels / (baseW * baseH)));
  const maxK = Math.min(maxKByEdge, maxKByPixels);

  let k = Math.ceil(Math.max(minKByEdge, minKByPixels) / kStep) * kStep;
  if (k > maxK) k = Math.floor(maxK / kStep) * kStep;
  if (k <= 0) return null;

  const outW = baseW * k;
  const outH = baseH * k;
  if (!isValidGptImage2Size(outW, outH, limits)) return null;
  return { width: outW, height: outH };
}

function pickClosestRatioSize(ratio, limits) {
  const { step, minPixels, maxPixels, maxEdge, targetLongEdge } = limits;
  let best = null;
  for (let w = step; w <= maxEdge; w += step) {
    const idealH = w / ratio;
    for (const h of [Math.floor(idealH / step) * step, Math.ceil(idealH / step) * step]) {
      if (!isValidGptImage2Size(w, h, limits)) continue;
      const score = Math.abs(w / h - ratio) * 1_000_000
        + Math.abs(Math.max(w, h) - targetLongEdge)
        + Math.abs(w * h - Math.max(minPixels, targetLongEdge * targetLongEdge / Math.max(ratio, 1 / ratio))) / 10_000;
      if (!best || score < best.score) best = { width: w, height: h, score };
    }
  }
  return best ? `${best.width}x${best.height}` : '1024x1024';
}

function isValidGptImage2Size(width, height, limits) {
  const { step, minPixels, maxPixels, maxEdge } = limits;
  if (!width || !height) return false;
  if (width % step !== 0 || height % step !== 0) return false;
  if (width > maxEdge || height > maxEdge) return false;
  const pixels = width * height;
  if (pixels < minPixels || pixels > maxPixels) return false;
  return Math.max(width, height) / Math.min(width, height) <= 3;
}

function getGcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function getLcm(a, b) {
  return Math.abs(a * b) / getGcd(a, b);
}

async function imageUrlToBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`生成图下载失败：${response.status}`);
  const contentType = response.headers.get('content-type') || 'image/png';
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return { base64, mimeType: contentType };
}

function imageBase64ToBlob(base64, mimeType = 'image/png') {
  return new Blob([Buffer.from(base64, 'base64')], { type: mimeType });
}

function normalizeImageBase64(value) {
  const raw = String(value || '').trim();
  const base64 = raw.includes(',') ? raw.split(',').pop() : raw;
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('原图 base64 格式不正确');
  const bytes = Buffer.byteLength(base64, 'utf8');
  if (bytes > 6 * 1024 * 1024) throw new Error('原图 Base64 超过 6MB，暂不支持一键修复');
  return base64;
}

function truncateText(value, max = 4000) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const AI_EDITABLE_FIELDS = [
  'format',
  'size',
  'dimensions',
  'colorZone',
  'whiteTextContrast',
  'localWhiteTextContrast',
  'backgroundTexture',
  'safeZone',
  'titleButtonSafeZone',
  'logoPosition',
  'ipPosition',
  'dangerZone',
  'textSafety',
  'logoQuality',
  'ipCoverage'
];

function isAiEditableField(field) {
  return AI_EDITABLE_FIELDS.includes(field);
}

const SAFETY_FIX_FIELDS = ['safeZone', 'titleButtonSafeZone', 'logoPosition', 'ipPosition', 'dangerZone', 'textSafety', 'logoQuality', 'ipCoverage'];

function isSafetyFixField(field) {
  return SAFETY_FIX_FIELDS.includes(field);
}

function formatCheckItem(item) {
  if (item.field === 'titleButtonSafeZone') {
    return `${item.label || item.field}：当前 ${item.current}，要求把已有标题和按钮整体平移到上面写明的安全区内，禁止进入危险区`;
  }
  if (isSafetyFixField(item.field)) {
    return `${item.label || item.field}：当前 ${item.current}，要求把对应元素平移/缩放到上面写明的安全区内，禁止进入危险区`;
  }
  return `${item.label || item.field}：当前 ${item.current}，要求 ${item.required}`;
}

function formatAutoFixInstruction(item, context = {}) {
  const rule = item.rule || {};
  const required = !isSafetyFixField(item.field) && item.required ? `，规范要求：${item.required}` : '';
  const sizePreserve = context.hasDimensionIssue ? '尺寸只按尺寸不符合项单独处理' : '维持原图尺寸不变';
  switch (item.field) {
    case 'colorZone': return `识别元素主色调，仅修改底色至规范区域内（${formatColorRequirement(item, rule)}），${sizePreserve}，其他设计全部都不改变`;
    case 'whiteTextContrast': return `仅加深白色文字承载区域或底色，使白字对比度达到规范（${formatContrastRequirement(item, rule)}），${sizePreserve}，文字内容、字体、主体和其他设计全部不变`;
    case 'localWhiteTextContrast': return `仅加深局部白色文字承载区域，使白字对比度达到规范（${formatContrastRequirement(item, rule)}），${sizePreserve}，文字内容、字体、主体和其他设计全部不变`;
    case 'backgroundTexture': return `仅在现有背景上补充规范要求的底纹，不新增可识别物体，主体、文案和 LOGO 不变${formatTextureRequirement(rule)}`;
    case 'dimensions': return `仅调整画布至规范尺寸（${item.required || '目标尺寸'}），通过裁剪或延展原背景适配，主体、文案、LOGO 和其他设计不变`;
    case 'size': return `仅通过压缩降低文件体积至规范要求（${item.required || '符合文件大小限制'}），画面内容和设计元素不变`;
    case 'format': return `仅转换为规范要求的图片格式（${item.required || '符合格式要求'}），画面内容不变`;
    case 'titleButtonSafeZone':
      return '把标题文字和按钮作为一个整体保持原文字、字体和样式不变，平移到上面写明的安全区内，元素外接矩形不得越过安全区边界。';
    case 'safeZone':
      return '保留现有 LOGO、IP / 主元素的内容和样式不变，仅把它们整体平移或等比缩放到上面写明的对应安全区内，禁止进入危险区。';
    case 'logoPosition':
    case 'ipPosition':
    case 'dangerZone':
    case 'textSafety':
    case 'logoQuality':
    case 'ipCoverage':
      return `仅修复"${item.label || item.field}"的位置/占比问题：保留对应元素的内容、样式和其它设计不变，把它整体平移或等比缩放到上面写明的安全区内，不要进入危险区。`;
    default: return `仅修复“${item.label || item.field || '不符合项'}”这一项${required}，其他全部不变`;
  }
}

function formatColorRequirement(item, rule = {}) {
  const maxS = rule.maxS ?? extractPromptNumber(item.required, /S≤\s*(\d+(?:\.\d+)?)%?/i) ?? 40;
  const minB = rule.minB ?? extractPromptNumber(item.required, /B≥\s*(\d+(?:\.\d+)?)%?/i) ?? 60;
  const minRatio = rule.minRatio ?? rule.minContrastRatio ?? extractPromptNumber(item.required, /对比度\s*≥\s*(\d+(?:\.\d+)?)/i);
  const parts = [`避开禁用区 S≤${maxS}% 且 B≥${minB}%`, `建议调整至 S>${maxS}% 或 B<${minB}%`];
  if (Number.isFinite(minRatio)) parts.push(`白字对比度≥${minRatio}:1`);
  return parts.join('；');
}

function formatContrastRequirement(item, rule = {}) {
  const minRatio = rule.minRatio ?? rule.minContrastRatio ?? extractPromptNumber(item.required, /≥\s*(\d+(?:\.\d+)?):?1?/i) ?? 4.5;
  return `与白色文字对比度≥${minRatio}:1`;
}

function formatTextureRequirement(rule = {}) {
  const parts = [];
  if (Number.isFinite(rule.minBackgroundPixelRatio)) parts.push(`背景占比≥${Math.round(rule.minBackgroundPixelRatio * 100)}%`);
  if (Number.isFinite(rule.minVariedRatio)) parts.push(`变化像素≥${(rule.minVariedRatio * 100).toFixed(1)}%`);
  return parts.length ? `（${parts.join('；')}）` : '';
}

function extractPromptNumber(value, pattern) {
  const match = String(value || '').match(pattern);
  return match ? Number(match[1]) : undefined;
}

function getSourceAssetWarnings(payload = {}) {
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];
  return failedChecks
    .filter(item => !isAiEditableField(item.field))
    .map(item => `${item.label || item.field} 需要源设计资产或人工调整，智能修图不会臆造新文字、LOGO 或主体元素`);
}

/**
 * 把 layoutZones 里的坐标转换为精确像素描述，提示词中不使用百分比或模糊方位。
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
    const isDanger = /危险|禁/.test(String(zone.name || ''));
    return {
      name: String(zone.name || '').trim() || '布局区',
      tip: String(zone.tip || '').trim(),
      left, top, width, height, right, bottom,
      isDanger,
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

function buildSafeZoneSection(output = {}, failedChecks = []) {
  const zones = buildSafeZoneDescriptions(output);
  if (!zones.length) return '';
  const wantsSafeZoneFix = failedChecks.some(item => SAFETY_FIX_FIELDS.includes(item.field));
  if (!wantsSafeZoneFix) return '';

  const allowed = zones.filter(zone => !zone.isDanger);
  const danger = zones.filter(zone => zone.isDanger);

  const lines = [];
  if (allowed.length) {
    lines.push('安全区（必须把对应元素完整放进去）：');
    allowed.forEach(zone => {
      lines.push(`- ${zone.name}：${zone.humanPosition}${zone.tip ? `；${zone.tip}` : ''}`);
    });
  }
  if (danger.length) {
    lines.push('危险区（除背景外，禁止出现 LOGO、IP、文字、按钮等关键元素）：');
    danger.forEach(zone => {
      lines.push(`- ${zone.name}：${zone.humanPosition}${zone.tip ? `；${zone.tip}` : ''}`);
    });
  }
  return lines.join('\n');
}

function buildFixPrompt(payload = {}, filename = 'source.png') {
  const output = payload.output || {};
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];
  const targetSize = output.width && output.height ? `${output.width}×${output.height}` : '';
  const safeZoneSection = buildSafeZoneSection(output, failedChecks);
  const hasSafeZoneIssue = failedChecks.some(item => SAFETY_FIX_FIELDS.includes(item.field));
  const hasDimensionIssue = failedChecks.some(item => item.field === 'dimensions');
  const userInstruction = String(payload.instruction || '').trim();
  const instructionLines = failedChecks
    .filter(item => isAiEditableField(item.field)
      && !SAFETY_FIX_FIELDS.includes(item.field)
      && !['dimensions', 'size', 'format'].includes(item.field))
    .map(item => formatAutoFixInstruction(item, { hasDimensionIssue }))
    .filter(Boolean);

  const sections = [
    '基于原图做局部修复，只修用户勾选的不合规项，其他保持不变。',
    targetSize ? `输出尺寸 ${targetSize}。` : '',
    targetSize ? `以下坐标均基于最终输出 ${targetSize} 的像素坐标系，左上角为 (0,0)，x 向右，y 向下。` : '',
    output.format ? `输出格式 ${String(output.format).toUpperCase()}。` : '',
  ];

  if (failedChecks.length) {
    sections.push(`修复项：${failedChecks.map(item => item.label || item.field).join('、')}。`);
  }

  if (hasSafeZoneIssue && safeZoneSection) {
    sections.push('安全区/危险区：');
    sections.push(safeZoneSection);
    sections.push('把对应元素的外接矩形完整移入安全区，元素外接矩形不得与危险区相交。');
  }

  if (instructionLines.length) {
    sections.push('具体修复：');
    instructionLines.forEach(line => sections.push(`- ${line}`));
  }

  if (userInstruction) sections.push(userInstruction);

  sections.push('保持背景、主体、文案、LOGO 内容、字体和整体风格不变；移动后用周围背景补全原位置。');
  sections.push('最终只输出修复后的图片，不要文字说明、参考线、标注色块、箭头或坐标。');
  sections.push(`源文件：${filename}`);

  return truncateText(sections.filter(Boolean).join('\n'));
}

function buildImageEditPrompt(payload = {}, filename = 'source.png') {
  if (payload.mode === 'generic-image-edit') {
    const instruction = String(payload.instruction || '').slice(0, 4000);
    const guard = payload.editType === 'copy'
      ? '仅修改文案，其他全部不变。'
      : payload.editType === 'other'
        ? '保持素材中的标题和按钮处于安全区内，除了提示语修改的内容其他全部不变。'
        : '';
    return [instruction, guard].filter(Boolean).join('\n');
  }
  return payload.mode === 'copy-edit' ? buildCopyEditPrompt(payload, filename) : buildFixPrompt(payload, filename);
}

function buildCopyEditPrompt(payload = {}, filename = 'source.png') {
  const copyEdit = payload.copyEdit || {};
  const sourceText = String(copyEdit.sourceText || '').trim();
  const targetText = String(copyEdit.targetText || '').trim();
  const prefix = sourceText && targetText
    ? `保持图片尺寸不变，只修改文案【${sourceText}】修改为【${targetText}】，其他全部不变`
    : (payload.instruction || '保持图片尺寸不变，只修改指定文案，其他全部不变');
  return truncateText([
    prefix,
    `源文件：${filename}`
  ].filter(Boolean).join('\n'));
}

async function generateImageWithGptImage2({ prompt, resolution }) {
  const data = await callGptImage2Json(GPT_IMAGE2_GENERATIONS_PATH, {
    model: GPT_IMAGE2_MODEL,
    prompt,
    n: 1,
    size: resolution,
    quality: GPT_IMAGE2_QUALITY
  });
  return normalizeGptImage2ImageResult(data);
}

async function editImageWithGptImage2({ prompt, resolution, images = [] }) {
  if (!images.length) return generateImageWithGptImage2({ prompt, resolution });

  const formData = new FormData();
  formData.append('model', GPT_IMAGE2_MODEL);
  formData.append('prompt', prompt);
  formData.append('n', '1');
  formData.append('size', resolution);
  formData.append('quality', GPT_IMAGE2_QUALITY);
  images.slice(0, 3).forEach((image, index) => {
    const blob = imageBase64ToBlob(image.base64, image.mimeType || 'image/png');
    formData.append('image[]', blob, image.filename || `source-${index + 1}.png`);
  });

  const data = await callGptImage2Multipart(GPT_IMAGE2_EDITS_PATH, formData);
  return normalizeGptImage2ImageResult(data);
}

async function normalizeGptImage2ImageResult(data) {
  const item = Array.isArray(data.data) ? data.data[0] : data;
  const imageBase64 = item?.b64_json || item?.imageBase64 || item?.base64 || data.imageBase64 || data.base64;
  if (imageBase64) {
    return {
      requestId: data.id || data.request_id || '',
      imageUrl: '',
      image: { base64: imageBase64, mimeType: item?.mimeType || data.mimeType || 'image/png' },
      raw: data
    };
  }

  const imageUrl = item?.url || data.url || data.imageUrl;
  if (imageUrl) {
    return {
      requestId: data.id || data.request_id || '',
      imageUrl,
      image: await imageUrlToBase64(imageUrl),
      raw: data
    };
  }

  throw new Error('GPT Image2 接口未返回图片数据');
}

function extractJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { /* continue */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch (_) { /* continue */ }
  }
  const arrayStart = raw.indexOf('[');
  const arrayEnd = raw.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try { return JSON.parse(raw.slice(arrayStart, arrayEnd + 1)); } catch (_) { /* continue */ }
  }
  const objectStart = raw.indexOf('{');
  const objectEnd = raw.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    try { return JSON.parse(raw.slice(objectStart, objectEnd + 1)); } catch (_) { /* continue */ }
  }
  return null;
}

function normalizeTextItems(value, imageSize = {}) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|、|；|;/).map(text => ({ text }))
      : [];
  const seen = new Set();
  return source
    .map(item => typeof item === 'string' ? { text: item } : item)
    .map(item => {
      const bbox = normalizeBBox(item, imageSize);
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

function normalizeBBox(item = {}, imageSize = {}) {
  const box = item.bbox || item.box || item.rect || item.bounds;
  if (Array.isArray(box) && box.length >= 4) {
    return normalizeRect(box[0], box[1], box[2], box[3], imageSize);
  }
  const source = box && typeof box === 'object' ? box : item;
  const left = source.left ?? source.x ?? source.x1;
  const top = source.top ?? source.y ?? source.y1;
  const width = source.width ?? (Number.isFinite(Number(source.right ?? source.x2)) && Number.isFinite(Number(left)) ? Number(source.right ?? source.x2) - Number(left) : undefined);
  const height = source.height ?? (Number.isFinite(Number(source.bottom ?? source.y2)) && Number.isFinite(Number(top)) ? Number(source.bottom ?? source.y2) - Number(top) : undefined);
  return normalizeRect(left, top, width, height, imageSize);
}

function normalizeRect(left, top, width, height, imageSize = {}) {
  const rect = {
    left: Math.round(Number(left)),
    top: Math.round(Number(top)),
    width: Math.round(Number(width)),
    height: Math.round(Number(height))
  };
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;

  const imageWidth = Number(imageSize.width);
  const imageHeight = Number(imageSize.height);
  if (Number.isFinite(imageWidth) && imageWidth > 0) {
    rect.left = Math.max(0, Math.min(imageWidth - 1, rect.left));
    rect.width = Math.max(1, Math.min(imageWidth - rect.left, rect.width));
  }
  if (Number.isFinite(imageHeight) && imageHeight > 0) {
    rect.top = Math.max(0, Math.min(imageHeight - 1, rect.top));
    rect.height = Math.max(1, Math.min(imageHeight - rect.top, rect.height));
  }
  return rect;
}

function buildVisionPrompt(width, height) {
  const sizeText = width && height ? `图片尺寸为 ${width}×${height}px。` : '';
  return `${sizeText}请识别这张游戏/广告素材图片中真实可见的文字、带文字按钮、数字价格/日期、LOGO文字，并返回它们在原图像素坐标系中的 bbox。坐标系左上角为 (0,0)，向右为 x，向下为 y。只返回 JSON，不要 Markdown，不要解释。格式必须为：{"texts":[{"text":"逐字可读的完整文案","type":"text|button|logo|number","bbox":{"left":0,"top":0,"width":0,"height":0},"confidence":0.8,"note":"位置或用途"}]}。bbox 必须贴合文字或带文字按钮的可见区域，不要把人物、背景光效、大面积空白、纯装饰边框包含进去；如果没有可读文字或带文字按钮，返回 {"texts":[]}`;
}

async function identifyImageTexts(imageBase64, mimeType, imageSize = {}) {
  const width = Number(imageSize.width) || 0;
  const height = Number(imageSize.height) || 0;
  const dataUrl = `data:${mimeType || 'image/png'};base64,${imageBase64}`;
  const data = await callVisionJson({
    model: VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildVisionPrompt(width, height) },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }]
  });
  const content = data.choices?.[0]?.message?.content || data.content || data.output_text || '';
  const parsed = extractJsonFromText(content);
  return normalizeTextItems(parsed?.texts || parsed?.items || parsed || content, { width, height });
}

async function handleIdentifyText(req, res, origin) {
  const { imageBase64, mimeType = 'image/png', width, height } = await readJsonBody(req, { limit: 16 * 1024 * 1024 });
  const sourceImage = normalizeImageBase64(imageBase64);
  const texts = await identifyImageTexts(sourceImage, mimeType, { width, height });
  sendJson(res, 200, { texts, model: VISION_MODEL }, origin);
}

async function handleGenerateImage(req, res, origin) {
  const { prompt, resolution, images = [], mimeType = 'image/png', filename = 'source.png' } = await readJsonBody(req);
  const cleanPrompt = truncateText(prompt, 4000);
  if (!cleanPrompt) return sendJson(res, 400, { error: '缺少 prompt' }, origin);

  const apiResolution = normalizeResolution(resolution);
  const normalizedImages = Array.isArray(images)
    ? images.slice(0, 3).map((image, index) => ({
      base64: normalizeImageBase64(image?.base64 || image),
      mimeType: image?.mimeType || mimeType,
      filename: image?.filename || `source-${index + 1}.png`
    }))
    : [];
  const result = normalizedImages.length
    ? await editImageWithGptImage2({ prompt: cleanPrompt, resolution: apiResolution, images: normalizedImages })
    : await generateImageWithGptImage2({ prompt: cleanPrompt, resolution: apiResolution });

  sendJson(res, 200, {
    jobId: result.requestId,
    requestId: result.requestId,
    status: 'completed',
    imageUrl: result.imageUrl,
    imageBase64: result.image.base64,
    mimeType: result.image.mimeType,
    filename,
    revisedPrompt: '',
    resultDetails: result.raw?.data || []
  }, origin);
}

async function handleFixImage(req, res, origin) {
  const { imageBase64, mimeType = 'image/png', filename = 'source.png', referenceImages = [], payload = {} } = await readJsonBody(req, { limit: 18 * 1024 * 1024 });
  const sourceImage = normalizeImageBase64(imageBase64);
  const normalizedReferenceImages = Array.isArray(referenceImages)
    ? referenceImages.slice(0, 2).map((image, index) => ({
      base64: normalizeImageBase64(image?.base64 || image),
      mimeType: image?.mimeType || 'image/png',
      filename: image?.filename || `reference-${index + 1}.png`
    }))
    : [];
  const output = payload.output || {};
  const sourceAssetWarnings = getSourceAssetWarnings(payload);
  const width = Number(output.width);
  const height = Number(output.height);
  if (!width || !height) return sendJson(res, 400, { error: '缺少目标输出尺寸' }, origin);

  const targetResolution = `${width}x${height}`;
  const apiResolution = normalizeResolution(targetResolution);
  const prompt = buildImageEditPrompt(payload, filename);
  if (!String(prompt).trim()) return sendJson(res, 400, { error: '缺少 prompt' }, origin);
  const result = await editImageWithGptImage2({
    prompt,
    resolution: apiResolution,
    images: [{ base64: sourceImage, mimeType, filename }, ...normalizedReferenceImages]
  });

  sendJson(res, 200, {
    jobId: result.requestId,
    requestId: result.requestId,
    status: 'completed',
    imageUrl: result.imageUrl,
    imageBase64: result.image.base64,
    mimeType: result.image.mimeType,
    revisedPrompt: '',
    resultDetails: result.raw?.data || [],
    log: [payload.mode === 'generic-image-edit'
      ? 'GPT Image2 已按用户提示词完成图生图编辑'
      : payload.mode === 'copy-edit'
        ? 'GPT Image2 已根据原图执行局部文案修改'
        : '后台已根据勾选的不合规项生成精简修复描述语，并完成一键修复'],
    warnings: [
      ...(apiResolution === targetResolution
        ? []
        : [`模型按合法工作分辨率 ${apiResolution} 生成（${targetResolution} 低于 gpt-image-2 size 最小像素限制），最终导出仍会是 ${targetResolution}`]),
      ...sourceAssetWarnings
    ]
  }, origin);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (!isOriginAllowed(origin)) return sendJson(res, 403, { error: `当前来源不允许访问 GPT Image2 后端：${origin}` }, origin);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {}, origin);

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, service: 'sucai-tool-gpt-image2-server' }, origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/gpt-image2/generate-image') {
      return await handleGenerateImage(req, res, origin);
    }
    if (req.method === 'POST' && (url.pathname === '/api/vision/identify-text' || url.pathname === '/api/gpt-image2/identify-text')) {
      return await handleIdentifyText(req, res, origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/gpt-image2/fix-image') {
      return await handleFixImage(req, res, origin);
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const filePath = resolveStaticPath(url.pathname);
      if (filePath && existsSync(filePath)) return sendStaticFile(res, filePath);
      const indexPath = join(rootDir, 'index.html');
      if (existsSync(indexPath)) return sendStaticFile(res, indexPath, 404);
    }
    sendJson(res, 404, { error: '接口不存在' }, origin);
  } catch (error) {
    console.error('[gpt-image2-server]', sanitizeErrorMessage(error.message || error));
    sendJson(res, 500, { error: sanitizeErrorMessage(error.message || '服务异常') }, origin);
  }
});

server.listen(port, host, () => {
  console.log(`GPT Image2 server running at http://${host}:${port}`);
});
