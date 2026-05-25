/**
 * 视频修复引擎（基于 FFmpeg.wasm）
 *
 * 为避免初次加载太慢，FFmpeg 按需懒加载（用户点击修复时才下载 wasm 包）
 *
 * 支持的修复：
 *  - 分辨率不对：缩放
 *  - 文件过大：降码率重编码
 *  - 格式不对：转码（MP4 / MOV / WebM 互转）
 *
 * 当前版本：接口已搭好，实际 FFmpeg 调用作为 V2 增量实装
 * 使用 @ffmpeg/ffmpeg（0.12+），通过 CDN 懒加载
 */

let ffmpegInstance = null;
let loadingPromise = null;

/**
 * 懒加载 FFmpeg.wasm（约 30MB）
 */
export async function loadFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // 从 CDN 动态导入（避免打包时强制引入）
      const { FFmpeg } = await import(
        'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js'
      );
      const { toBlobURL } = await import(
        'https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js'
      );

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      const ffmpeg = new FFmpeg();

      if (onProgress) {
        ffmpeg.on('progress', ({ progress }) => onProgress(progress));
      }

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
      });

      ffmpegInstance = ffmpeg;
      return ffmpeg;
    } catch (err) {
      loadingPromise = null;
      throw new Error('FFmpeg 加载失败：' + err.message);
    }
  })();

  return loadingPromise;
}

/**
 * 修复视频
 * @param {Object} meta
 * @param {Object} spec
 * @param {Array} checkResults
 * @param {Object} options  修复参数（用户选择）
 * @param {Function} onProgress
 */
export async function fixVideo(meta, spec, checkResults, options = {}, onProgress) {
  const ffmpeg = await loadFFmpeg(onProgress);

  const log = [];
  const dimRule = spec.rules.find(r => r.field === 'dimensions');
  const formatRule = spec.rules.find(r => r.field === 'format');
  const sizeRule = spec.rules.find(r => r.field === 'size');

  // 目标参数
  const targetW = dimRule?.width || meta.width;
  const targetH = dimRule?.height || meta.height;
  const allowed = (formatRule?.allowed || []).map(x => x.toLowerCase());
  let outFormat = options.targetFormat;
  if (!outFormat) {
    outFormat = allowed.length && !allowed.includes(meta.format)
      ? allowed[0]
      : meta.format;
  }

  // 读入源文件
  const inputName = 'input.' + meta.format;
  const outputName = 'output.' + outFormat;
  const buffer = new Uint8Array(await meta.file.arrayBuffer());
  await ffmpeg.writeFile(inputName, buffer);

  // 构造命令
  const args = ['-i', inputName];

  // 尺寸
  if (meta.width !== targetW || meta.height !== targetH) {
    args.push('-vf', `scale=${targetW}:${targetH}`);
    log.push(`缩放分辨率 ${meta.width}×${meta.height} → ${targetW}×${targetH}`);
  }

  // 码率控制（根据目标文件大小估算）
  if (sizeRule && meta.size > sizeRule.max) {
    const targetDuration = Math.max(meta.duration || 1, 1);
    const targetBitrateKbps = Math.floor((sizeRule.max * 8) / targetDuration / 1024 * 0.9); // 预留 10%
    args.push('-b:v', `${targetBitrateKbps}k`);
    log.push(`压缩码率（目标 ${targetBitrateKbps} kbps）`);
  }

  // 编码器
  if (outFormat === 'mp4') {
    args.push('-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac');
  } else if (outFormat === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-c:a', 'libopus');
  }

  args.push('-y', outputName);

  await ffmpeg.exec(args);

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data.buffer], { type: `video/${outFormat}` });

  const baseName = meta.name.replace(/\.[^.]+$/, '');
  const filename = `${baseName}_fixed.${outFormat}`;

  const newMeta = {
    ...meta,
    width: targetW,
    height: targetH,
    size: blob.size,
    format: outFormat,
    name: filename,
    objectUrl: URL.createObjectURL(blob)
  };

  return { blob, meta: newMeta, log, filename, warnings: [] };
}

export function canAutoFixVideo(checkResult) {
  if (checkResult.status === 'pass') return { fixable: false };
  const fixableFields = ['format', 'size', 'dimensions'];
  if (fixableFields.includes(checkResult.field)) {
    return { fixable: true };
  }
  return { fixable: false, reason: '该项暂不支持自动修复' };
}
