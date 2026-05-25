/**
 * 新游戏频道 banner 生成器
 *
 * 输入背景、LOGO、游戏形象，按规范自动生成大/小两张 banner。
 */
import { analyzeBackgroundTextureFromCanvas, analyzeImageLayoutFromCanvas, extractDominantColor } from '../validators/meta.js';
import { isInForbiddenZone, rgbToHex, rgbToHsb } from '../utils/color.js';

const DEFAULT_PALETTE = ['#A50000', '#5B6919', '#381B96', '#523914', '#314733', '#5E1053', '#184054', '#253254'];
const CHARACTER_VERTICAL_PADDING = 16;
const CHARACTER_SHARPEN_AMOUNT = 0.45;
const CHARACTER_SHARPEN_THRESHOLD = 4;
const VISIBLE_BOUNDS_CACHE = new WeakMap();

export async function generateBannerSet({ backgroundFile, logoFile, characterFile, spec, characterType = 'full' }) {
  if (!backgroundFile || !logoFile || !characterFile) {
    throw new Error('请先上传背景、LOGO 和游戏形象');
  }
  if (!Array.isArray(spec?.variants) || !spec.variants.length) {
    throw new Error('当前规范没有可生成的尺寸配置');
  }

  const [background, logo, character] = await Promise.all([
    loadImageFromFile(backgroundFile),
    loadImageFromFile(logoFile),
    loadImageFromFile(characterFile)
  ]);

  try {
    const detectedColor = extractDominantColor(background.img) || { r: 49, g: 71, b: 51, hex: '#314733' };
    const baseColor = normalizeBannerColor(detectedColor, spec.generator?.palette || DEFAULT_PALETTE);
    const backgroundOpacity = spec.generator?.backgroundOpacity ?? 0.2;
    const baseName = safeName(backgroundFile.name.replace(/\.[^.]+$/, '') || 'game');

    const outputs = [];
    for (const variant of spec.variants) {
      const canvas = document.createElement('canvas');
      canvas.width = variant.width;
      canvas.height = variant.height;
      const ctx = canvas.getContext('2d');
      configureCanvasContext(ctx);

      drawBannerCanvas(ctx, canvas, variant, {
        background: background.img,
        logo: logo.img,
        character: character.img,
        characterType,
        baseColor,
        backgroundOpacity
      });

      const layoutAnalysis = analyzeImageLayoutFromCanvas(canvas, baseColor);
      const backgroundTexture = analyzeBackgroundTextureFromCanvas(canvas, baseColor);
      const exported = await exportBannerCanvas(canvas, baseName, variant, spec);
      const file = new File([exported.blob], exported.filename, { type: exported.mime });

      outputs.push({
        blob: exported.blob,
        file,
        filename: exported.filename,
        variant,
        width: variant.width,
        height: variant.height,
        size: exported.blob.size,
        format: exported.format,
        dominantColor: baseColor,
        detectedColor,
        layoutAnalysis,
        backgroundTexture,
        objectUrl: URL.createObjectURL(exported.blob),
        log: [
          `自动识别背景底色 ${detectedColor.hex}`,
          baseColor.hex !== detectedColor.hex ? `底色优化为合规色 ${baseColor.hex}` : `使用识别底色 ${baseColor.hex}`,
          `背景图以 ${Math.round(backgroundOpacity * 100)}% 透明度作为底纹`,
          getCharacterLayoutLog(characterType),
          `按 ${variant.name} ${variant.width}×${variant.height} 合成输出`,
          ...exported.log
        ]
      });
    }
    return outputs;
  } finally {
    [background, logo, character].forEach(item => URL.revokeObjectURL(item.url));
  }
}

function drawBannerCanvas(ctx, canvas, variant, assets) {
  const { background, logo, character, characterType, baseColor, backgroundOpacity } = assets;
  configureCanvasContext(ctx);

  ctx.fillStyle = baseColor.hex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = backgroundOpacity;
  drawCover(ctx, background, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  const leftGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  leftGradient.addColorStop(0, 'rgba(0,0,0,0.24)');
  leftGradient.addColorStop(0.48, 'rgba(0,0,0,0.06)');
  leftGradient.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = leftGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const logoZone = getZone(variant, 'LOGO') || { left: 16, top: 16, width: 120, height: 40 };
  const roleZone = getZone(variant, 'IP') || {
    left: Math.round(canvas.width / 2),
    top: 0,
    width: Math.round(canvas.width / 2),
    height: canvas.height
  };

  drawCharacter(ctx, character, roleZone, characterType);
  drawLogo(ctx, logo, logoZone);
}

function drawLogo(ctx, img, zone) {
  const padding = 0;
  const target = snapRect(containRect(img, {
    x: zone.left + padding,
    y: zone.top + padding,
    width: zone.width - padding * 2,
    height: zone.height - padding * 2
  }, { alignX: 'left', alignY: 'top', maxScale: 1.2 }));

  ctx.drawImage(img, target.x, target.y, target.width, target.height);
}

function drawCharacter(ctx, img, zone, characterType) {
  const source = getVisibleImageBounds(img);
  const safeZone = insetZoneY(zone, getCharacterInsets(characterType));
  const target = snapRect(fillHeightRect(source, safeZone));
  const layer = createSharpScaledLayer(img, source, target.width, target.height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(safeZone.left, safeZone.top, safeZone.width, safeZone.height);
  ctx.clip();
  ctx.drawImage(layer, target.x, target.y);
  ctx.restore();
}

function createSharpScaledLayer(img, source, width, height) {
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const layerCtx = layer.getContext('2d', { willReadFrequently: true });
  configureCanvasContext(layerCtx);
  layerCtx.drawImage(
    img,
    source.x, source.y, source.width, source.height,
    0, 0, width, height
  );
  sharpenCanvas(layer, CHARACTER_SHARPEN_AMOUNT, CHARACTER_SHARPEN_THRESHOLD);
  return layer;
}

function drawCover(ctx, img, x, y, width, height) {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = x + (width - drawW) / 2;
  const dy = y + (height - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

function fillHeightRect(source, zone) {
  const scale = zone.height / source.height;
  const width = source.width * scale;
  const height = zone.height;
  const x = width > zone.width
    ? zone.left
    : zone.left + (zone.width - width) / 2;
  const y = zone.top + (zone.height - height) / 2;
  return { x, y, width, height };
}

function snapRect(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}

function configureCanvasContext(ctx) {
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

function sharpenCanvas(canvas, amount, threshold) {
  const width = canvas.width;
  const height = canvas.height;
  if (width < 3 || height < 3) return;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch (_) {
    return;
  }

  const data = imageData.data;
  const source = new Uint8ClampedArray(data);
  const stride = width * 4;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * stride + x * 4;
      if (source[i + 3] < 16) continue;

      for (let c = 0; c < 3; c++) {
        const center = source[i + c];
        const blur = (
          source[i - stride + c] +
          source[i + stride + c] +
          source[i - 4 + c] +
          source[i + 4 + c]
        ) / 4;
        const diff = center - blur;
        if (Math.abs(diff) < threshold) continue;
        data[i + c] = clampByte(center + diff * amount);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function insetZoneY(zone, insets) {
  const top = Math.min(insets.top, Math.floor(zone.height / 2));
  const bottom = Math.min(insets.bottom, Math.max(0, zone.height - top - 1));
  return {
    left: zone.left,
    top: zone.top + top,
    width: zone.width,
    height: Math.max(1, zone.height - top - bottom)
  };
}

function getCharacterInsets(characterType) {
  return characterType === 'half'
    ? { top: CHARACTER_VERTICAL_PADDING, bottom: 0 }
    : { top: CHARACTER_VERTICAL_PADDING, bottom: CHARACTER_VERTICAL_PADDING };
}

function getCharacterLayoutLog(characterType) {
  return characterType === 'half'
    ? `IP 顶部预留 ${CHARACTER_VERTICAL_PADDING}px，按剩余安全区高度适配，超宽时裁切右侧`
    : `IP 上下各预留 ${CHARACTER_VERTICAL_PADDING}px，按剩余安全区高度适配，超宽时裁切右侧`;
}

function getVisibleImageBounds(img) {
  if (VISIBLE_BOUNDS_CACHE.has(img)) return VISIBLE_BOUNDS_CACHE.get(img);

  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const fallback = { x: 0, y: 0, width, height };

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    configureCanvasContext(ctx);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha <= 8) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    const bounds = maxX >= minX && maxY >= minY
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : fallback;
    VISIBLE_BOUNDS_CACHE.set(img, bounds);
    return bounds;
  } catch (_) {
    VISIBLE_BOUNDS_CACHE.set(img, fallback);
    return fallback;
  }
}

function containRect(img, box, options = {}) {
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight, options.maxScale ?? Infinity);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  const x = options.alignX === 'left'
    ? box.x
    : options.alignX === 'right'
      ? box.x + box.width - width
      : box.x + (box.width - width) / 2;
  const y = options.alignY === 'top'
    ? box.y
    : options.alignY === 'bottom'
      ? box.y + box.height - height
      : box.y + (box.height - height) / 2;
  return { x, y, width, height };
}

function normalizeBannerColor(color, palette) {
  const forbidden = isInForbiddenZone(color.r, color.g, color.b, { maxS: 40, minB: 60 });
  if (!forbidden.inZone) return color;

  const sourceHue = rgbToHsb(color.r, color.g, color.b).h;
  const candidates = palette.map(hexToRgb).filter(Boolean);
  const nearest = candidates.sort((a, b) => hueDistance(sourceHue, rgbToHsb(a.r, a.g, a.b).h) - hueDistance(sourceHue, rgbToHsb(b.r, b.g, b.b).h))[0];
  return nearest || { r: 49, g: 71, b: 51, hex: '#314733' };
}

function hueDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function getZone(variant, keyword) {
  return variant.layoutZones?.find(zone => String(zone.name).toUpperCase().includes(keyword));
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取图片：${file.name}`));
    };
    img.src = url;
  });
}

async function exportBannerCanvas(canvas, baseName, variant, spec) {
  const maxSize = getMaxSize(spec);
  const pngBlob = await canvasToBlob(canvas, 'image/png');
  const pngFilename = `${baseName}_${variant.id}_banner.png`;

  if (!Number.isFinite(maxSize) || pngBlob.size <= maxSize) {
    return {
      blob: pngBlob,
      filename: pngFilename,
      format: 'png',
      mime: 'image/png',
      log: [Number.isFinite(maxSize)
        ? `PNG 无损输出 ${formatBytes(pngBlob.size)}，未超过 ${formatBytes(maxSize)}`
        : `PNG 无损输出 ${formatBytes(pngBlob.size)}`]
    };
  }

  const compressed = await canvasToBestFitPng(canvas, maxSize);
  return {
    blob: compressed.blob,
    filename: pngFilename,
    format: 'png',
    mime: 'image/png',
    log: [compressed.blob.size <= maxSize
      ? `PNG ${formatBytes(pngBlob.size)} 超过 ${formatBytes(maxSize)}，已压缩为 PNG ${formatBytes(compressed.blob.size)}（色彩精度 ${compressed.bits}bit）`
      : `已压缩为 PNG ${formatBytes(compressed.blob.size)}（色彩精度 ${compressed.bits}bit），仍超过 ${formatBytes(maxSize)}`]
  };
}

async function canvasToBestFitPng(canvas, maxSize) {
  let smallest = null;

  for (const bits of [7, 6, 5, 4, 3, 2]) {
    const compressedCanvas = quantizeCanvas(canvas, bits);
    const blob = await canvasToBlob(compressedCanvas, 'image/png');
    const candidate = { blob, bits };

    if (!smallest || blob.size < smallest.blob.size) smallest = candidate;
    if (blob.size <= maxSize) return candidate;
  }

  return smallest;
}

function quantizeCanvas(canvas, bits) {
  const output = document.createElement('canvas');
  output.width = canvas.width;
  output.height = canvas.height;
  const ctx = output.getContext('2d', { willReadFrequently: true });
  configureCanvasContext(ctx);
  ctx.drawImage(canvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, output.width, output.height);
  const data = imageData.data;
  const levels = (1 << bits) - 1;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = quantizeByte(data[i], levels);
    data[i + 1] = quantizeByte(data[i + 1], levels);
    data[i + 2] = quantizeByte(data[i + 2], levels);
  }

  ctx.putImageData(imageData, 0, 0);
  return output;
}

function quantizeByte(value, levels) {
  return Math.round(Math.round((value / 255) * levels) * (255 / levels));
}

function getMaxSize(spec) {
  const max = spec?.rules?.find(rule => rule.field === 'size')?.max;
  return Number.isFinite(max) && max > 0 ? max : Infinity;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function hexToRgb(hex) {
  const normalized = String(hex).replace('#', '').trim();
  if (!/^[\da-f]{6}$/i.test(normalized)) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b, hex: rgbToHex(r, g, b) };
}

function safeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_\u4e00-\u9fa5]/g, '')
    .slice(0, 40) || 'game';
}
