/**
 * 极简 Markdown 渲染器
 *
 * 支持子集：
 *  - # / ## / ### 标题
 *  - **bold** / *italic*
 *  - `code`
 *  - [link](url)
 *  - ![alt](url)
 *  - ::color-palette::#A50000,#5B6919:: 可复制色值卡片
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

  // bold / italic / link
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  return text;
}

function normalizeHexColor(color) {
  const value = color.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(value) ? value : '';
}

function renderColorPalette(rawColors) {
  const colors = rawColors
    .split(/[\s,，]+/)
    .map(normalizeHexColor)
    .filter(Boolean);

  if (!colors.length) return '';

  return `
<div class="md-color-palette" aria-label="推荐底色，点击复制">
  <div class="md-color-palette__title">推荐底色（点击复制）</div>
  <div class="md-color-palette__chips">
    ${colors.map(color => `
      <button type="button" class="md-color-chip" data-copy-color="${escapeHtml(color)}" aria-label="复制色值 ${escapeHtml(color)}" title="点击复制 ${escapeHtml(color)}">
        <span class="md-color-chip__swatch" style="background:${escapeHtml(color)}"></span>
        <span class="md-color-chip__value">${escapeHtml(color)}</span>
      </button>
    `).join('')}
  </div>
</div>`;
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
    const colorPalette = line.trim().match(/^::color-palette::(.+)::$/);
    if (colorPalette) {
      flushParagraph(paraBuf); paraBuf = [];
      out += renderColorPalette(colorPalette[1]) + '\n';
      i++;
      continue;
    }

    // 图片
    const img = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      flushParagraph(paraBuf); paraBuf = [];
      const rawSrc = img[2];
      const alt = escapeHtml(img[1]);
      const caption = alt ? `<figcaption>${alt}</figcaption>` : '';
      const figureClasses = [];
      if (alt) figureClasses.push('md-figure--captioned');
      if (/biaozhu-1\.png$/i.test(rawSrc)) figureClasses.push('md-figure--annotation-large');
      if (/biaozhu-2\.png$/i.test(rawSrc)) figureClasses.push('md-figure--annotation-small');
      const cls = figureClasses.length ? ` class="${figureClasses.join(' ')}"` : '';
      out += `<figure${cls}>${caption}<img src="${escapeHtml(rawSrc)}" alt="${alt}"></figure>\n`;
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
