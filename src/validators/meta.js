/**
 * 图片/视频元信息提取
 */

/**
 * 读取图片元信息
 * @param {File} file
 * @returns {Promise<{type: 'image', width, height, size, format, objectUrl, file, dominantColor}>}
 */
export function readImageMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let dominantColor = null;
      try {
        dominantColor = extractDominantColor(img);
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
        dominantColor
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
  const hex = '#' + [r, g, b]
    .map(n => n.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return { r, g, b, hex };
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
  if (file.type.startsWith('image/')) {
    return readImageMeta(file);
  }
  if (file.type.startsWith('video/')) {
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
