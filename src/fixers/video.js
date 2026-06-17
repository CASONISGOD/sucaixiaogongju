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
let classWorkerUrlPromise = null;

const OUTPUT_ONE_WIDTH = 2400;
const OUTPUT_ONE_HEIGHT = 600;
const OUTPUT_ONE_SOURCE_WIDTH = 1200;
const OUTPUT_ONE_SOURCE_HEIGHT = 600;
const OUTPUT_ONE_DURATION = 5;
const OUTPUT_ONE_FPS = 25;

function makeFsSafeName(prefix, ext) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${id}.${ext}`;
}

async function fetchMaskAsPngBytes(maskPath) {
  const res = await fetch(maskPath, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`蒙版读取失败：${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_ONE_SOURCE_WIDTH;
    canvas.height = OUTPUT_ONE_SOURCE_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建蒙版画布');
    ctx.drawImage(img, 0, 0, OUTPUT_ONE_SOURCE_WIDTH, OUTPUT_ONE_SOURCE_HEIGHT);
    const pngBlob = await canvasToBlob(canvas, 'image/png');
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('蒙版图片加载失败'));
    img.src = src;
  });
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('蒙版转换失败')), type);
  });
}

function getOutputOneBitrateKbps(maxSize) {
  const defaultKbps = 8000;
  if (!maxSize) return defaultKbps;
  const estimated = Math.floor((maxSize * 8) / OUTPUT_ONE_DURATION / 1024 * 0.72);
  return Math.max(2500, Math.min(defaultKbps, estimated));
}

function getErrorMessage(err) {
  if (typeof err === 'string') return err;
  return err?.message || err?.toString?.() || '未知错误';
}

async function getFFmpegClassWorkerURL(ffmpegBaseURL) {
  if (classWorkerUrlPromise) return classWorkerUrlPromise;
  classWorkerUrlPromise = (async () => {
    const workerURL = `${ffmpegBaseURL}/worker.js`;
    const res = await fetch(workerURL, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`FFmpeg Worker 加载失败：${res.status}`);
    const source = await res.text();
    const patched = source.replace(/from "\.\/([^"]+)"/g, `from "${ffmpegBaseURL}/$1"`);
    return URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));
  })();
  return classWorkerUrlPromise;
}

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

      const ffmpegBaseURL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm';
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      const ffmpeg = new FFmpeg();

      if (onProgress) {
        ffmpeg.on('progress', ({ progress }) => onProgress(progress));
      }

      await ffmpeg.load({
        classWorkerURL: await getFFmpegClassWorkerURL(ffmpegBaseURL),
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
      });

      ffmpegInstance = ffmpeg;
      return ffmpeg;
    } catch (err) {
      loadingPromise = null;
      throw new Error('FFmpeg 加载失败：' + getErrorMessage(err));
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

export async function generatePlatformHomeOutputOne(meta, options = {}, onProgress) {
  const ffmpeg = await loadFFmpeg();
  const progressHandler = ({ progress }) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, progress || 0)));
  };
  if (onProgress) ffmpeg.on('progress', progressHandler);

  const inputName = makeFsSafeName('output-one-input', meta.format || 'mp4');
  const maskName = makeFsSafeName('output-one-mask', 'png');
  const outputName = makeFsSafeName('output-one', 'mp4');
  const firstFrameName = makeFsSafeName('output-one-first-frame', 'png');
  const bitrateKbps = getOutputOneBitrateKbps(options.maxSize);
  const warnings = [];
  const log = [
    `创建 ${OUTPUT_ONE_WIDTH}×${OUTPUT_ONE_HEIGHT}px 输出一视频画布`,
    '左侧叠加输出一蒙版',
    '右侧视频套用黑白蒙版遮罩',
    '蒙版和视频在 4s-4.5s 执行透明度 100% → 0% 动画',
    `导出 ${OUTPUT_ONE_FPS}fps MP4`,
    `截取右侧 ${OUTPUT_ONE_SOURCE_WIDTH}×${OUTPUT_ONE_SOURCE_HEIGHT}px 输出二视频首帧图 PNG`
  ];

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await meta.file.arrayBuffer()));
    await ffmpeg.writeFile(maskName, await fetchMaskAsPngBytes(options.maskPath));

    const filter = [
      `[0:v]trim=duration=${OUTPUT_ONE_DURATION},setpts=PTS-STARTPTS,fps=${OUTPUT_ONE_FPS},scale=${OUTPUT_ONE_SOURCE_WIDTH}:${OUTPUT_ONE_SOURCE_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_ONE_SOURCE_WIDTH}:${OUTPUT_ONE_SOURCE_HEIGHT}:(ow-iw)/2:(oh-ih)/2,format=rgba[vsrc]`,
      `[1:v]trim=duration=${OUTPUT_ONE_DURATION},setpts=PTS-STARTPTS,fps=${OUTPUT_ONE_FPS},scale=${OUTPUT_ONE_SOURCE_WIDTH}:${OUTPUT_ONE_SOURCE_HEIGHT},split=2[maskvisual][maskalpha]`,
      '[maskalpha]format=gray[maskgray]',
      '[vsrc][maskgray]alphamerge,fade=t=out:st=4:d=0.5:alpha=1[vright]',
      '[maskvisual]format=rgba,fade=t=out:st=4:d=0.5:alpha=1[vleft]',
      `color=c=black:s=${OUTPUT_ONE_WIDTH}x${OUTPUT_ONE_HEIGHT}:d=${OUTPUT_ONE_DURATION}:r=${OUTPUT_ONE_FPS},format=rgba[base]`,
      '[base][vleft]overlay=0:0:format=auto[tmp]',
      '[tmp][vright]overlay=1200:0:format=auto,format=yuv420p[outv]'
    ].join(';');

    const exitCode = await ffmpeg.exec([
      '-i', inputName,
      '-loop', '1', '-t', String(OUTPUT_ONE_DURATION), '-i', maskName,
      '-filter_complex', filter,
      '-map', '[outv]',
      '-t', String(OUTPUT_ONE_DURATION),
      '-r', String(OUTPUT_ONE_FPS),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-b:v', `${bitrateKbps}k`,
      '-maxrate', `${bitrateKbps}k`,
      '-bufsize', `${bitrateKbps * 2}k`,
      '-movflags', '+faststart',
      '-an',
      '-y', outputName
    ]);
    if (exitCode !== 0) throw new Error(`FFmpeg 转码失败，退出码 ${exitCode}`);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data], { type: 'video/mp4' });
    const baseName = String(meta.name || 'output-one').replace(/\.[^.]+$/, '');
    const filename = `${baseName}_输出一.mp4`;
    const file = new File([blob], filename, { type: 'video/mp4', lastModified: Date.now() });
    const resultMeta = {
      type: 'video',
      width: OUTPUT_ONE_WIDTH,
      height: OUTPUT_ONE_HEIGHT,
      duration: OUTPUT_ONE_DURATION,
      size: blob.size,
      format: 'mp4',
      objectUrl: URL.createObjectURL(blob),
      file,
      name: filename,
      dominantColor: meta.dominantColor || null,
      backgroundPalette: meta.backgroundPalette || null
    };

    let firstFrame = null;
    try {
      const firstFrameFilter = [
        `[0:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=${OUTPUT_ONE_SOURCE_WIDTH}:${OUTPUT_ONE_SOURCE_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_ONE_SOURCE_WIDTH}:${OUTPUT_ONE_SOURCE_HEIGHT}:(ow-iw)/2:(oh-ih)/2,format=rgba[vsrc]`,
        `[1:v]scale=${OUTPUT_ONE_SOURCE_WIDTH}:${OUTPUT_ONE_SOURCE_HEIGHT},format=gray[maskgray]`,
        '[vsrc][maskgray]alphamerge[out]'
      ].join(';');
      const firstFrameExitCode = await ffmpeg.exec([
        '-i', inputName,
        '-i', maskName,
        '-filter_complex', firstFrameFilter,
        '-map', '[out]',
        '-frames:v', '1',
        '-y', firstFrameName
      ]);
      if (firstFrameExitCode !== 0) throw new Error(`FFmpeg 截帧失败，退出码 ${firstFrameExitCode}`);
      const firstFrameData = await ffmpeg.readFile(firstFrameName);
      const firstFrameBlob = new Blob([firstFrameData], { type: 'image/png' });
      const firstFrameFilename = `${baseName}_视频首帧图.png`;
      const firstFrameFile = new File([firstFrameBlob], firstFrameFilename, { type: 'image/png', lastModified: Date.now() });
      firstFrame = {
        blob: firstFrameBlob,
        filename: firstFrameFilename,
        meta: {
          type: 'image',
          width: OUTPUT_ONE_SOURCE_WIDTH,
          height: OUTPUT_ONE_SOURCE_HEIGHT,
          size: firstFrameBlob.size,
          format: 'png',
          objectUrl: URL.createObjectURL(firstFrameBlob),
          file: firstFrameFile,
          name: firstFrameFilename
        }
      };
    } catch (err) {
      warnings.push(`视频首帧图截取失败：${getErrorMessage(err)}`);
    }

    return { blob, meta: resultMeta, log, filename, warnings, firstFrame };
  } finally {
    if (onProgress && ffmpeg.off) ffmpeg.off('progress', progressHandler);
    await Promise.allSettled([inputName, maskName, outputName, firstFrameName].map(name => ffmpeg.deleteFile?.(name)));
  }
}

export function canAutoFixVideo(checkResult) {
  if (checkResult.status === 'pass') return { fixable: false };
  const fixableFields = ['format', 'size', 'dimensions'];
  if (fixableFields.includes(checkResult.field)) {
    return { fixable: true };
  }
  return { fixable: false, reason: '该项暂不支持自动修复' };
}
