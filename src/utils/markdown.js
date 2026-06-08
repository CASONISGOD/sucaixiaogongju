/**
 * 极简 Markdown 渲染器
 *
 * 支持子集：
 *  - # / ## / ### 标题
 *  - **bold** / *italic*
 *  - `code`
 *  - [link](url)
 *  - ![alt](url)
 *  - ::color-palette::#A50000,#5B6919:: / ::color-palette::标题::#A50000:: 可复制色值卡片
 *  - ![alt](assets/video.mp4) 视频预览
 *  - ::download::按钮文案::assets/image/example.png::filename.png:: 下载按钮
 *  - ::template-mockup::assets/image/2-1/首页样机.png:: / ::template-mockup::标题::assets/image/2-1/首页样机.png:: 模板样机上传预览；标题为“头部底色”时渲染 HEX 色值样机
 *  - :::gray-box ... ::: 灰色信息框
 *  - 有序/无序列表
 *  - 表格（GFM）
 *  - > 引用
 *  - --- 水平线
 *  - ``` 代码块
 *  - 段落
 *
 * 不支持：嵌套列表、HTML 注入
 */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderInline(text) {
  // 先处理 code，避免下面的正则吃掉里面的符号
  const codeSlots = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeSlots.push(code);
    return `\u0000CODE${codeSlots.length - 1}\u0000`;
  });

  // escape
  text = escapeHtml(text);

  // 还原 code
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => {
    return `<code>${escapeHtml(codeSlots[+i])}</code>`;
  });

  // bold / italic / link / highlight
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\{\{red:([^}]+)\}\}/g, '<span class="md-text-danger">$1</span>');

  return text;
}

function normalizeHexColor(color) {
  const value = color.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(value) ? value : '';
}

function parseColorEntry(rawColor) {
  const label = rawColor.trim();
  const hex = normalizeHexColor(label.match(/#[0-9A-Fa-f]{6}/)?.[0] || '');
  if (!label || !hex) return null;

  const alphaMatch = label.match(/\ba\s*(\d+(?:\.\d+)?)%\s*$/i);
  const alpha = alphaMatch ? Math.max(0, Math.min(1, Number(alphaMatch[1]) / 100)) : null;
  const swatch = alpha === null ? hex : hexToRgba(hex, alpha);
  return { label, swatch };
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function splitColorEntries(rawColors) {
  const hasComma = /[,，]/.test(rawColors);
  return rawColors
    .split(hasComma ? /[,，]+/ : /\s+/)
    .map(parseColorEntry)
    .filter(Boolean);
}

function renderColorPalette(rawColors, rawTitle = '推荐底色（点击复制）') {
  const colors = splitColorEntries(rawColors);
  const title = rawTitle.trim();

  if (!colors.length) return '';

  return `
<div class="md-color-palette" aria-label="${escapeHtml(title || '色值')}，点击复制">
  ${title ? `<div class="md-color-palette__title">${renderInline(title)}</div>` : ''}
  <div class="md-color-palette__chips">
    ${colors.map(color => `
      <button type="button" class="md-color-chip" data-copy-color="${escapeHtml(color.label)}" aria-label="复制色值 ${escapeHtml(color.label)}" title="点击复制 ${escapeHtml(color.label)}">
        <span class="md-color-chip__swatch" style="background:${escapeHtml(color.swatch)}"></span>
        <span class="md-color-chip__value">${escapeHtml(color.label)}</span>
      </button>
    `).join('')}
  </div>
</div>`;
}

function renderTemplateMockup(rawSrc, rawTitle = '模板样机') {
  const src = rawSrc.trim();
  const title = rawTitle.trim() || '模板样机';
  if (!src) return '';
  const safeSrc = escapeHtml(src);
  const safeTitle = escapeHtml(title);
  const isColorMockup = title === '头部底色';

  if (isColorMockup) {
    return `
<div class="template-mockup template-mockup--color" data-template-mockup data-template-mode="color" data-mockup-src="${safeSrc}" data-mockup-title="${safeTitle}">
  <div class="template-mockup__head">
    <div class="template-mockup__title">${safeTitle}</div>
    <input class="template-mockup__hex-input" data-template-color-input type="text" inputmode="text" maxlength="7" spellcheck="false" placeholder="请填写底色色值" aria-label="输入${safeTitle} HEX 色值">
  </div>
  <div class="template-mockup__stage" aria-label="${safeTitle}预览">
    <div class="template-mockup__canvas">
      <div class="template-mockup__color-fill" data-template-color-fill style="background:#205AEF"></div>
      <img class="template-mockup__frame" src="${safeSrc}" alt="${safeTitle}">
    </div>
  </div>
</div>`;
  }

  if (title === '游戏中心样机') {
    return `
<div class="template-mockup template-mockup--game-center" data-template-mockup data-template-mode="game-center" data-mockup-src="${safeSrc}" data-mockup-title="${safeTitle}">
  <div class="template-mockup__head">
    <div class="template-mockup__title">${safeTitle}</div>
    <div class="template-mockup__actions">
      <label class="template-mockup__upload">
        <input class="template-mockup__input" data-template-slot-input="large" type="file" accept="image/*" hidden>
        <span>上传大banner</span>
      </label>
      <label class="template-mockup__upload">
        <input class="template-mockup__input" data-template-slot-input="small" type="file" accept="image/*" hidden>
        <span>上传小banner</span>
      </label>
    </div>
  </div>
  <div class="template-mockup__stage" aria-label="${safeTitle}预览">
    <div class="template-mockup__canvas">
      <img class="template-mockup__asset template-mockup__asset--game-center-large" data-template-asset="large" alt="大banner预览" hidden>
      <img class="template-mockup__asset template-mockup__asset--game-center-small" data-template-asset="small" alt="小banner预览" hidden>
      <div class="template-mockup__loading" data-template-loading hidden><span class="loading"></span><span data-template-loading-text>图片加载中…</span></div>
      <img class="template-mockup__frame" src="${safeSrc}" alt="${safeTitle}">
    </div>
  </div>
</div>`;
  }

  return `
<div class="template-mockup" data-template-mockup data-template-mode="image" data-mockup-src="${safeSrc}" data-mockup-title="${safeTitle}">
  <div class="template-mockup__head">
    <div class="template-mockup__title">${safeTitle}</div>
    <label class="template-mockup__upload">
      <input class="template-mockup__input" type="file" accept="image/*" hidden>
      <span>上传素材</span>
    </label>
  </div>
  <div class="template-mockup__stage" aria-label="${safeTitle}预览">
    <div class="template-mockup__canvas">
      <div class="template-mockup__empty" data-template-empty>上传素材后将在这里叠加到样机底层</div>
      <img class="template-mockup__asset" data-template-asset alt="上传素材预览" hidden>
      <div class="template-mockup__loading" data-template-loading hidden><span class="loading"></span><span data-template-loading-text>图片加载中…</span></div>
      <img class="template-mockup__frame" src="${safeSrc}" alt="${safeTitle}">
    </div>
  </div>
</div>`;
}

function parseTemplateMockupLine(line) {
  const match = line.trim().match(/^::template-mockup::(.+)::$/);
  if (!match) return null;
  const parts = match[1].split('::').map(part => part.trim());
  if (parts.length >= 2) {
    return { title: parts[0] || '模板样机', src: parts.slice(1).join('::') };
  }
  return { title: '模板样机', src: parts[0] };
}

function parseDownloadLine(line) {
  return line.trim().match(/^::download::(.+?)::(.+?)(?:::(.*?))?::$/);
}

function renderDownloadLink(rawLabel, rawSrc, rawFilename = '', extraClass = '') {
  const label = rawLabel.trim() || '下载';
  const src = rawSrc.trim();
  if (!src) return '';
  const filename = rawFilename.trim();
  const cls = ['md-download-link', extraClass].filter(Boolean).join(' ');

  return `<a class="${cls}" href="${escapeHtml(src)}" download="${escapeHtml(filename || src.split('/').pop() || 'download')}"><span>${renderInline(label)}</span></a>`;
}

function renderDownloadButton(rawLabel, rawSrc, rawFilename = '') {
  const link = renderDownloadLink(rawLabel, rawSrc, rawFilename);
  return link ? `<div class="md-download-row">${link}</div>` : '';
}

export function renderMarkdown(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let out = '';
  let i = 0;

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    out += `<p>${renderInline(buf.join(' '))}</p>\n`;
  };

  let paraBuf = [];

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (!line.trim()) {
      flushParagraph(paraBuf);
      paraBuf = [];
      i++;
      continue;
    }

    // 代码块
    if (/^```/.test(line)) {
      flushParagraph(paraBuf); paraBuf = [];
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      out += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>\n`;
      i++;
      continue;
    }

    // 灰色信息框
    if (line.trim() === ':::gray-box') {
      flushParagraph(paraBuf); paraBuf = [];
      const boxLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') {
        boxLines.push(lines[i]);
        i++;
      }
      out += `<div class="md-info-box">${renderMarkdown(boxLines.join('\n'))}</div>\n`;
      if (i < lines.length) i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushParagraph(paraBuf); paraBuf = [];
      const level = h[1].length;
      out += `<h${level}>${renderInline(h[2].trim())}</h${level}>\n`;
      i++;
      continue;
    }

    // 可复制色值卡片
    const colorPalette = line.trim().match(/^::color-palette(?:::([^:]+))?::(.+)::$/);
    if (colorPalette) {
      flushParagraph(paraBuf); paraBuf = [];
      out += renderColorPalette(colorPalette[2], colorPalette[1] || undefined) + '\n';
      i++;
      continue;
    }

    // 下载按钮
    const downloadButton = parseDownloadLine(line);
    if (downloadButton) {
      flushParagraph(paraBuf); paraBuf = [];
      out += renderDownloadButton(downloadButton[1], downloadButton[2], downloadButton[3]) + '\n';
      i++;
      continue;
    }

    // 模板样机上传预览
    const templateMockup = parseTemplateMockupLine(line);
    if (templateMockup) {
      flushParagraph(paraBuf); paraBuf = [];
      out += renderTemplateMockup(templateMockup.src, templateMockup.title) + '\n';
      i++;
      continue;
    }

    // 图片
    const img = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      flushParagraph(paraBuf); paraBuf = [];
      const rawSrc = img[2];
      const alt = escapeHtml(img[1]);
      let caption = alt ? `<figcaption>${alt}</figcaption>` : '';
      const figureClasses = [];
      let downloadLink = '';
      let nextLineIndex = i + 1;
      while (nextLineIndex < lines.length && !lines[nextLineIndex].trim()) nextLineIndex++;
      const inlineDownload = nextLineIndex < lines.length ? parseDownloadLine(lines[nextLineIndex]) : null;
      if (inlineDownload) {
        downloadLink = renderDownloadLink(inlineDownload[1], inlineDownload[2], inlineDownload[3], 'md-download-link--caption');
        if (downloadLink) {
          figureClasses.push('md-figure--with-download');
          caption = `<div class="md-figure__head">${caption}${downloadLink}</div>`;
        }
        i = nextLineIndex;
      }
      if (alt) figureClasses.push('md-figure--captioned');
      if (/biaozhu-1(?:-样机)?\.png$/i.test(rawSrc)) figureClasses.push('md-figure--annotation-large');
      if (/biaozhu-2(?:-样机)?\.png$/i.test(rawSrc)) figureClasses.push('md-figure--annotation-small');
      const isVideo = /\.(mp4|mov|webm)(?:[?#].*)?$/i.test(rawSrc);
      if (isVideo) figureClasses.push('md-figure--video');
      const cls = figureClasses.length ? ` class="${figureClasses.join(' ')}"` : '';
      const media = isVideo
        ? `<video src="${escapeHtml(rawSrc)}" controls muted playsinline preload="metadata"></video>`
        : `<img src="${escapeHtml(rawSrc)}" alt="${alt}">`;
      out += `<figure${cls}>${caption}${media}</figure>\n`;
      i++;
      continue;
    }

    // 水平线
    if (/^---+$/.test(line.trim())) {
      flushParagraph(paraBuf); paraBuf = [];
      out += '<hr>\n';
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      flushParagraph(paraBuf); paraBuf = [];
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out += `<blockquote><p>${renderInline(quoteLines.join(' '))}</p></blockquote>\n`;
      continue;
    }

    // 表格（GFM）
    if (/^\|.+\|$/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1])) {
      flushParagraph(paraBuf); paraBuf = [];
      const parseRow = (l) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const header = parseRow(line);
      i += 2; // 跳过分隔行
      const rows = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      out += '<table>';
      out += '<thead><tr>' + header.map(h => `<th>${renderInline(h)}</th>`).join('') + '</tr></thead>';
      out += '<tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody>';
      out += '</table>\n';
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(paraBuf); paraBuf = [];
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out += '<ol>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ol>\n';
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(paraBuf); paraBuf = [];
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out += '<ul>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ul>\n';
      continue;
    }

    // 普通段落
    paraBuf.push(line.trim());
    i++;
  }

  flushParagraph(paraBuf);
  return out;
}
