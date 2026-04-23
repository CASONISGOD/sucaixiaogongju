/**
 * 图片/视频元信息提取
 */

/**
 * 读取图片元信息
 * @param {File} file
 * @returns {Promise<{type: 'image', width, height, size, format, objectUrl, file}>}
 */
export function readImageMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        type: 'image',
        width: img.naturalWidth,
        height: img.naturalHeight,
        size: file.size,
        format: getFormat(file),
        objectUrl: url,
        file,
        name: file.name
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
