/**
 * 图片/视频元信息提取
 */

/**
 * 读取图片元信息
 * @param {File} file
 * @returns {Promise<{type: 'image', width, height, size, format, objectUrl, file, dominantColor, layoutAnalysis, backgroundTexture}>}
 */
export function readImageMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let dominantColor = null;
      let bottomCenterAverageColor = null;
      let layoutAnalysis = null;
      let backgroundTexture = null;
      try {
        dominantColor = extractDominantColor(img);
        bottomCenterAverageColor = extractAverageColorFromRegion(img, {
          left: 0.25,
          top: 0.6,
          width: 0.5,
          height: 0.3
        });
        layoutAnalysis = analyzeImageLayout(img, dominantColor);
        backgroundTexture = analyzeBackgroundTexture(img, dominantColor);
      } catch (_) { /* 提取失败不影响主流程 */ }
      resolve({
        type: 'image',
        width: img.naturalWidth,
        height: img.naturalHeight,
        size: file.size,
        format: getFormat(file),
        objectUrl: url,
        file,
        name: file.name,
        dominantColor,
        bottomCenterAverageColor,
        layoutAnalysis,
        backgroundTexture
      });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片：' + file.name));
    };
    img.src = url;
  });
}

/**
 * 提取整图主色
 * 做法：缩采样到最多 64px 的边长，遍历像素并把 RGB 各通道量化到 32 档（5bit）
 * 统计出现次数最多的"桶"，再取桶内像素的平均值作为主色。
 *
 * @param {HTMLImageElement} img
 * @returns {{ r:number, g:number, b:number, hex:string }|null}
 */
export function extractDominantColor(img) {
  const maxSide = 64;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cw, ch);

  let data;
  try {
    data = ctx.getImageData(0, 0, cw, ch).data;
  } catch (_) {
    return null; // 跨域图片会抛错
  }

  // 颜色桶：key = (R>>3)<<10 | (G>>3)<<5 | (B>>3)
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 10) continue; // 忽略透明像素
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += r; bucket.g += g; bucket.b += b;
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

/**
 * 提取图片中下区域的平均色值，用于“头图底色色值”的自动回填。
 * 默认取水平居中的 50% 宽度、从 60% 高度开始的 30% 高度区域。
 *
 * @param {HTMLImageElement} img
 * @param {{left?:number, top?:number, width?:number, height?:number}} [region]
 * @returns {{ r:number, g:number, b:number, hex:string, region:{left:number, top:number, width:number, height:number} }|null}
 */
export function extractAverageColorFromRegion(img, region = {}) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;

  const leftRatio = clampRatio(region.left ?? 0.25);
  const topRatio = clampRatio(region.top ?? 0.6);
  const widthRatio = clampRatio(region.width ?? 0.5);
  const heightRatio = clampRatio(region.height ?? 0.3);
  const sx = Math.min(w - 1, Math.max(0, Math.round(w * leftRatio)));
  const sy = Math.min(h - 1, Math.max(0, Math.round(h * topRatio)));
  const sw = Math.max(1, Math.min(w - sx, Math.round(w * widthRatio)));
  const sh = Math.max(1, Math.min(h - sy, Math.round(h * heightRatio)));
  const maxPixels = 40000;
  const scale = Math.min(1, Math.sqrt(maxPixels / (sw * sh)));
  const cw = Math.max(1, Math.round(sw * scale));
  const ch = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);

  let data;
  try {
    data = ctx.getImageData(0, 0, cw, ch).data;
  } catch (_) {
    return null;
  }

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let weightSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 10) continue;
    const weight = alpha / 255;
    rSum += data[i] * weight;
    gSum += data[i + 1] * weight;
    bSum += data[i + 2] * weight;
    weightSum += weight;
  }
  if (!weightSum) return null;

  const r = Math.round(rSum / weightSum);
  const g = Math.round(gSum / weightSum);
  const b = Math.round(bSum / weightSum);
  return { r, g, b, hex: rgbToHex(r, g, b), region: { left: sx, top: sy, width: sw, height: sh } };
}

function clampRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function analyzeImageLayoutFromCanvas(canvas, dominantColor = null) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const width = canvas.width;
  const height = canvas.height;
  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch (_) {
    return null;
  }
  const bg = dominantColor || extractDominantColorFromImageData(imageData.data);
  return analyzeImageData(imageData.data, width, height, bg, 1);
}

export function analyzeBackgroundTextureFromCanvas(canvas, dominantColor = null) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const width = canvas.width;
  const height = canvas.height;
  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch (_) {
    return null;
  }
  const bg = dominantColor || extractDominantColorFromImageData(imageData.data);
  return analyzeBackgroundTextureData(imageData.data, width, height, bg);
}

function analyzeImageLayout(img, dominantColor = null) {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) return null;

  const maxPixels = 500000;
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (_) {
    return null;
  }

  const bg = dominantColor || extractDominantColorFromImageData(imageData.data);
  return analyzeImageData(imageData.data, canvas.width, canvas.height, bg, scale);
}

function analyzeBackgroundTexture(img, dominantColor = null) {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) return null;

  const maxPixels = 180000;
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (_) {
    return null;
  }

  const bg = dominantColor || extractDominantColorFromImageData(imageData.data);
  return analyzeBackgroundTextureData(imageData.data, canvas.width, canvas.height, bg);
}

function analyzeImageData(data, width, height, dominantColor, scale) {
  if (!dominantColor) return null;

  const mask = new Uint8Array(width * height);
  const threshold = 88;
  for (let pos = 0; pos < width * height; pos++) {
    const i = pos * 4;
    if (data[i + 3] < 10) continue;
    if (colorDistance(data[i], data[i + 1], data[i + 2], dominantColor.r, dominantColor.g, dominantColor.b) >= threshold) {
      mask[pos] = 1;
    }
  }

  const minArea = Math.max(16, Math.round(width * height * 0.00012));
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let pos = 0; pos < mask.length; pos++) {
    if (!mask[pos] || visited[pos]) continue;
    const queue = [pos];
    visited[pos] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const x = current % width;
      const y = Math.floor(current / width);
      area++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      enqueueForeground(mask, visited, queue, width, height, x + 1, y);
      enqueueForeground(mask, visited, queue, width, height, x - 1, y);
      enqueueForeground(mask, visited, queue, width, height, x, y + 1);
      enqueueForeground(mask, visited, queue, width, height, x, y - 1);
    }

    if (area < minArea) continue;
    const left = Math.floor(minX / scale);
    const top = Math.floor(minY / scale);
    const right = Math.ceil((maxX + 1) / scale) - 1;
    const bottom = Math.ceil((maxY + 1) / scale) - 1;
    const componentArea = Math.round(area / (scale * scale));
    const boxArea = Math.max(1, (right - left + 1) * (bottom - top + 1));
    components.push({
      left,
      top,
      right,
      bottom,
      width: right - left + 1,
      height: bottom - top + 1,
      area: componentArea,
      density: componentArea / boxArea,
      centerX: Math.round((left + right) / 2),
      centerY: Math.round((top + bottom) / 2)
    });
  }

  components.sort((a, b) => b.area - a.area);
  return { dominantColor, components, colorGrid: analyzeColorGrid(data, width, height, scale) };
}

function analyzeColorGrid(data, width, height, scale, cols = 12, rows = 8) {
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx0 = Math.floor(col * width / cols);
      const sx1 = Math.min(width, Math.ceil((col + 1) * width / cols));
      const sy0 = Math.floor(row * height / rows);
      const sy1 = Math.min(height, Math.ceil((row + 1) * height / rows));
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let weightSum = 0;
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = (y * width + x) * 4;
          const alpha = data[i + 3];
          if (alpha < 10) continue;
          const weight = alpha / 255;
          rSum += data[i] * weight;
          gSum += data[i + 1] * weight;
          bSum += data[i + 2] * weight;
          weightSum += weight;
        }
      }
      if (!weightSum) continue;
      const r = Math.round(rSum / weightSum);
      const g = Math.round(gSum / weightSum);
      const b = Math.round(bSum / weightSum);
      const left = Math.floor(sx0 / scale);
      const top = Math.floor(sy0 / scale);
      const right = Math.ceil(sx1 / scale) - 1;
      const bottom = Math.ceil(sy1 / scale) - 1;
      cells.push({
        left,
        top,
        right,
        bottom,
        width: right - left + 1,
        height: bottom - top + 1,
        r,
        g,
        b,
        hex: rgbToHex(r, g, b)
      });
    }
  }
  return { cols, rows, cells };
}

function analyzeBackgroundTextureData(data, width, height, dominantColor) {
  if (!dominantColor) return null;

  const pixelCount = width * height;
  const backgroundDistanceMax = 90;
  const textureDistanceMin = 10;
  const candidate = new Uint8Array(pixelCount);
  let opaquePixels = 0;

  for (let pos = 0; pos < pixelCount; pos++) {
    const i = pos * 4;
    const alpha = data[i + 3];
    if (alpha < 10) {
      candidate[pos] = 1;
      continue;
    }
    opaquePixels++;
    const distance = colorDistance(data[i], data[i + 1], data[i + 2], dominantColor.r, dominantColor.g, dominantColor.b);
    if (distance <= backgroundDistanceMax) candidate[pos] = 1;
  }

  const backgroundMask = getConnectedBackgroundMask(candidate, width, height);
  const bins = new Uint32Array(backgroundDistanceMax + 1);
  let backgroundPixels = 0;
  let variedPixels = 0;
  let distanceSum = 0;
  let maxDistance = 0;

  for (let pos = 0; pos < pixelCount; pos++) {
    if (!backgroundMask[pos]) continue;
    const i = pos * 4;
    if (data[i + 3] < 10) continue;
    const distance = colorDistance(data[i], data[i + 1], data[i + 2], dominantColor.r, dominantColor.g, dominantColor.b);
    if (distance > backgroundDistanceMax) continue;
    const roundedDistance = Math.min(backgroundDistanceMax, Math.round(distance));
    bins[roundedDistance]++;
    backgroundPixels++;
    distanceSum += distance;
    if (distance >= textureDistanceMin) variedPixels++;
    if (distance > maxDistance) maxDistance = distance;
  }

  if (!backgroundPixels || !opaquePixels) {
    return {
      dominantColor,
      hasTexture: false,
      backgroundPixelRatio: 0,
      variedRatio: 0,
      averageDistance: 0,
      p90Distance: 0,
      maxDistance: 0,
      backgroundPixels,
      opaquePixels
    };
  }

  const averageDistance = distanceSum / backgroundPixels;
  const variedRatio = variedPixels / backgroundPixels;
  const p90Distance = getHistogramPercentile(bins, backgroundPixels, 0.9);
  const backgroundPixelRatio = backgroundPixels / opaquePixels;
  const hasTexture = backgroundPixelRatio >= 0.2
    && variedRatio >= 0.035
    && (averageDistance >= 4 || p90Distance >= 12);

  return {
    dominantColor,
    hasTexture,
    backgroundPixelRatio,
    variedRatio,
    averageDistance,
    p90Distance,
    maxDistance,
    backgroundPixels,
    opaquePixels
  };
}

function getConnectedBackgroundMask(candidate, width, height) {
  const visited = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  const queue = [];

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pos = y * width + x;
    if (visited[pos] || !candidate[pos]) return;
    visited[pos] = 1;
    queue.push(pos);
  };

  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let head = 0; head < queue.length; head++) {
    const pos = queue[head];
    mask[pos] = 1;
    const x = pos % width;
    const y = Math.floor(pos / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return mask;
}

function getHistogramPercentile(bins, total, percentile) {
  const target = Math.max(1, Math.ceil(total * percentile));
  let count = 0;
  for (let i = 0; i < bins.length; i++) {
    count += bins[i];
    if (count >= target) return i;
  }
  return bins.length - 1;
}

function enqueueForeground(mask, visited, queue, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const pos = y * width + x;
  if (visited[pos] || !mask[pos]) return;
  visited[pos] = 1;
  queue.push(pos);
}

function extractDominantColorFromImageData(data) {
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
  const hex = '#' + [r, g, b]
    .map(n => n.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return { r, g, b, hex };
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 读取视频元信息
 */
export function readVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({
        type: 'video',
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        size: file.size,
        format: getFormat(file),
        objectUrl: url,
        file,
        name: file.name
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取视频：' + file.name));
    };
    video.src = url;
  });
}

function getFormat(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return ext;
}

/**
 * 统一入口：根据文件类型自动走对应解析器
 */
export async function readFileMeta(file) {
  const mime = String(file?.type || '').toLowerCase();
  const format = getFormat(file);
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif', 'heic', 'heif'].includes(format)) {
    return readImageMeta(file);
  }
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v', 'avi'].includes(format)) {
    return readVideoMeta(file);
  }
  throw new Error(`暂不支持的文件类型：${file.type || file.name}`);
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
