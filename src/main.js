/**
 * Compliance Hub · SaaS Dark Admin
 */

import { specs, categories, getSpecById, getSpecTree } from './data/specs.js';
import { readFileMeta, formatSize } from './validators/meta.js';
import { validate } from './validators/engine.js';
import { fixImage, canAutoFix } from './fixers/image.js';
import { fixVideo, canAutoFixVideo } from './fixers/video.js';
import { renderMarkdown } from './utils/markdown.js';

/* ===== State ===== */
const state = {
  selectedSpecId: specs[0]?.id || null,
  expandedCats: new Set(),
  items: []
};

if (state.selectedSpecId) {
  const spec = getSpecById(state.selectedSpecId);
  if (spec) state.expandedCats.add(spec.category);
}

/* ===== Util ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const I = {
  check: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  warn: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  cross: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  wrench: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  chevron: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>',
  sparkles: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.7a2 2 0 0 1-1.3 1.3L3 12l5.7 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.7a2 2 0 0 1 1.3-1.3L21 12l-5.7-1.9a2 2 0 0 1-1.3-1.3z"/></svg>',
  upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
};

/* ===== Sidebar Tree ===== */
function initSidebarTree() { renderSidebarTree(); }

function renderSidebarTree() {
  const tree = getSpecTree();
  const box = $('#sidebarTree');
  box.innerHTML = tree.map(renderTreeCategory).join('');

  box.querySelectorAll('.tree-cat__head').forEach(head => {
    head.addEventListener('click', () => {
      const catId = head.dataset.cat;
      const cat = tree.find(c => c.id === catId);
      if (!cat || cat.empty) return;
      if (state.expandedCats.has(catId)) state.expandedCats.delete(catId);
      else state.expandedCats.add(catId);
      renderSidebarTree();
    });
  });

  box.querySelectorAll('.tree-spec').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectSpec(btn.dataset.id);
    });
  });
}

function renderTreeCategory(cat) {
  const isOpen = state.expandedCats.has(cat.id);
  const openCls = isOpen ? 'is-open' : '';
  const specCount = cat.subGroups.reduce((n, sg) => n + sg.specs.length, 0);

  if (cat.empty) {
    return `
      <div class="tree-cat">
        <div class="tree-cat__head is-disabled" data-cat="${cat.id}">
          <span class="tree-cat__arrow">${I.chevron}</span>
          <span class="tree-cat__name">${esc(cat.name)}</span>
        </div>
      </div>`;
  }

  return `
    <div class="tree-cat ${openCls}">
      <button class="tree-cat__head" data-cat="${cat.id}">
        <span class="tree-cat__arrow">${I.chevron}</span>
        <span class="tree-cat__name">${esc(cat.name)}</span>
        <span class="tree-cat__count">${specCount}</span>
      </button>
      <div class="tree-cat__body">
        ${cat.subGroups.map(sg => `
          <div class="tree-sub">
            ${sg.specs.map(spec => `
              <button class="tree-spec ${spec.id === state.selectedSpecId ? 'is-active' : ''}"
                      data-id="${spec.id}" title="${esc(spec.name)}">
                <span class="tree-spec__dot"></span>
                <span>${esc(spec.shortName || spec.name)}</span>
              </button>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>`;
}

function selectSpec(id) {
  const spec = getSpecById(id);
  if (!spec) return;
  state.selectedSpecId = id;
  state.expandedCats.add(spec.category);
  renderSidebarTree();
  updateSpecName();
  renderSpecPane();
  if (state.items.length) revalidateAll();
}

function updateSpecName() {
  const spec = getSpecById(state.selectedSpecId);
  const title = spec ? spec.name : '未选择规范';
  const t1 = $('#specSelectText');
  if (t1) t1.textContent = title;
}

/* ===== Spec Pane（下方规范区） ===== */
function renderSpecPane() {
  const spec = getSpecById(state.selectedSpecId);
  const pane = $('#specPane');
  if (!spec) {
    pane.innerHTML = '';
    return;
  }

  // 版面分区示意
  let zonesHtml = '';
  if (Array.isArray(spec.variants) && spec.variants.length) {
    zonesHtml = spec.variants.map(v => `
      <div style="margin-bottom:18px;">
        <div class="spec-preview__caption" style="margin-bottom:8px;">${esc(v.name)} — ${v.width}×${v.height}</div>
        ${renderLayoutPreview(v)}
      </div>`).join('');
  } else if (spec.canvasSize && spec.layoutZones?.length) {
    zonesHtml = renderLayoutPreview(spec);
  }

  const mdHtml = spec.markdown
    ? `<div class="md">${renderMarkdown(spec.markdown)}</div>`
    : `<div class="md"><p>${esc(spec.description || '暂无规范说明')}</p></div>`;

  const examplesHtml = Array.isArray(spec.examples) && spec.examples.length ? `
    <div class="spec-section">
      <div class="spec-section__title">正确示意</div>
      <div class="spec-examples">
        ${spec.examples.map(ex => `
          <figure class="spec-example">
            <img class="spec-example__img" src="${esc(ex.src)}" alt="${esc(ex.label || '')}" loading="lazy" />
            ${ex.label ? `<figcaption class="spec-example__label">${esc(ex.label)}</figcaption>` : ''}
          </figure>
        `).join('')}
      </div>
    </div>` : '';

  pane.innerHTML = `
    ${examplesHtml}

    ${mdHtml}

    ${zonesHtml ? `
      <div class="spec-section" style="margin-top:24px;">
        <div class="spec-section__title">版面分区示意</div>
        <div class="spec-preview">${zonesHtml}</div>
      </div>` : ''}

    ${spec.recommendedColors?.length ? `
      <div class="spec-section">
        <div class="spec-section__title">推荐底色（点击复制）</div>
        <div class="color-chip-list">
          ${spec.recommendedColors.map(c => `
            <div class="color-chip" data-copy="${c}">
              <span class="color-chip__swatch" style="background:${c}"></span>
              <span class="color-chip__code">${c}</span>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
  `;

  $$('.color-chip').forEach(el => {
    el.addEventListener('click', () => {
      const c = el.dataset.copy;
      navigator.clipboard?.writeText(c);
      const codeEl = el.querySelector('.color-chip__code');
      const orig = codeEl.textContent;
      codeEl.textContent = 'COPIED';
      codeEl.style.color = 'var(--ok)';
      setTimeout(() => { codeEl.textContent = orig; codeEl.style.color = ''; }, 900);
    });
  });
}

function renderLayoutPreview(spec) {
  const { canvasSize, layoutZones } = spec;
  if (!canvasSize || !layoutZones) return '';
  const maxW = 560;
  const ratio = Math.min(maxW / canvasSize.width, 260 / canvasSize.height);
  const dispW = canvasSize.width * ratio;
  const dispH = canvasSize.height * ratio;

  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div class="spec-banner-demo" style="width:${dispW}px;height:${dispH}px;background:linear-gradient(135deg,#253254 0%,#1a2342 100%);">
        ${layoutZones.map(z => `
          <div class="spec-banner-demo__zone"
              style="left:${z.left * ratio}px;top:${z.top * ratio}px;width:${z.width * ratio}px;height:${z.height * ratio}px;">
            ${esc(z.name)}<br>${z.width}×${z.height}
          </div>
        `).join('')}
      </div>
      <div class="zones-legend">
        ${layoutZones.map(z => `
          <div>
            <span class="zones-legend__dot"></span>
            <span><strong>${esc(z.name)}</strong> · ${z.width}×${z.height} · ${esc(z.tip || '')}</span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

/* ===== Checker ===== */
function initChecker() {
  renderCheckerBody();
  bindDropzoneGlobal();

  $('#fileInput').addEventListener('change', (e) => {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
  });
}

function openFilePicker() {
  $('#fileInput').click();
}

function bindDropzoneGlobal() {
  const body = document.body;
  ['dragenter', 'dragover'].forEach(evt => {
    body.addEventListener(evt, e => {
      e.preventDefault();
      const box = $('.empty-zone__box');
      if (box) box.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    body.addEventListener(evt, e => {
      e.preventDefault();
      const box = $('.empty-zone__box');
      if (box) box.classList.remove('is-drag');
    });
  });
  body.addEventListener('drop', (e) => {
    handleFiles(Array.from(e.dataTransfer.files));
  });
}

async function handleFiles(files) {
  if (!state.selectedSpecId) { alert('请先在左侧选择一个规范'); return; }
  const spec = getSpecById(state.selectedSpecId);
  if (!spec) return;

  // 先为每个文件创建一个"识别中"占位项，立刻渲染，让用户看到 loading 反馈
  const pending = [];
  for (const file of files) {
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    if (!isImg && !isVid) continue;
    if (spec.fileType === 'image' && !isImg) { addErrorItem(file, '当前规范要求图片，但该文件为视频'); continue; }
    if (spec.fileType === 'video' && !isVid) { addErrorItem(file, '当前规范要求视频，但该文件为图片'); continue; }

    const id = uid();
    state.items.push({
      id,
      status: 'identifying',
      meta: { name: file.name, size: file.size, type: isImg ? 'image' : 'video' },
      validation: null,
      fixed: null,
      specId: spec.id
    });
    pending.push({ id, file });
  }
  renderCheckerBody();

  // 并行解析（每个任务完成后立即更新对应 item 并局部刷新）
  await Promise.all(pending.map(async ({ id, file }) => {
    try {
      const meta = await readFileMeta(file);
      const idx = state.items.findIndex(i => i.id === id);
      if (idx === -1) return;
      state.items[idx] = { id, meta, validation: validate(meta, spec), fixed: null, specId: spec.id };
    } catch (err) {
      const idx = state.items.findIndex(i => i.id === id);
      if (idx !== -1) {
        state.items[idx] = {
          id,
          meta: { name: file.name, size: file.size, type: 'unknown' },
          validation: {
            status: 'fail',
            results: [{ label: '文件读取', status: 'fail', current: '—', required: '—', tip: err.message }],
            meta: null, spec: null
          },
          fixed: null,
          error: err.message
        };
      }
    }
    renderCheckerBody();
  }));
}

function addErrorItem(file, reason) {
  state.items.push({
    id: uid(),
    meta: { name: file.name, size: file.size, type: 'unknown' },
    validation: {
      status: 'fail',
      results: [{ label: '文件读取', status: 'fail', current: '—', required: '—', tip: reason }],
      meta: null, spec: null
    },
    fixed: null, error: reason
  });
}

function revalidateAll() {
  const spec = getSpecById(state.selectedSpecId);
  if (!spec) return;
  state.items = state.items.map(it => {
    if (it.status === 'identifying') return it;
    if (!it.meta || it.error) return it;
    if (spec.fileType === 'image' && it.meta.type !== 'image') return it;
    if (spec.fileType === 'video' && it.meta.type !== 'video') return it;
    return { ...it, specId: spec.id, validation: validate(it.meta, spec), fixed: null };
  });
  renderCheckerBody();
}

function clearResults() {
  state.items.forEach(it => {
    if (it.meta?.objectUrl) URL.revokeObjectURL(it.meta.objectUrl);
    if (it.fixed?.meta?.objectUrl) URL.revokeObjectURL(it.fixed.meta.objectUrl);
  });
  state.items = [];
  renderCheckerBody();
}

function renderCheckerBody() {
  const body = $('#checkerBody');
  if (!state.items.length) {
    body.innerHTML = `
      <div class="empty-zone">
        <div class="empty-zone__box" id="emptyBox">
          <div class="empty-zone__icon">${I.upload}</div>
          <div class="empty-zone__title">拖拽文件到此处</div>
          <div class="empty-zone__desc">支持批量 · 图片 / 视频 · 文件在本地处理</div>
          <div class="empty-zone__kbd">
            <span>JPG</span><span>PNG</span><span>WEBP</span><span>MP4</span><span>MOV</span>
          </div>
          <button class="btn btn--primary empty-zone__upload empty-zone__upload--lg" id="inlineUploadBtn">
            ${I.plus} 选择文件
          </button>
        </div>
      </div>`;
    $('#inlineUploadBtn')?.addEventListener('click', openFilePicker);
    return;
  }

  const identifying = state.items.filter(i => i.status === 'identifying').length;
  const pass = state.items.filter(i => i.validation?.status === 'pass').length;
  const warn = state.items.filter(i => i.validation?.status === 'warn').length;
  const fail = state.items.filter(i => i.validation?.status === 'fail').length;

  const identifyingBadge = identifying
    ? `<span class="identifying-badge"><span class="loading"></span>识别中 ${identifying}</span>`
    : '';

  body.innerHTML = `
    <div class="result-toolbar">
      <div class="result-toolbar__left">已检测 <strong style="color:var(--fg-1)">${state.items.length}</strong> 个文件${identifyingBadge}</div>
      <div class="result-toolbar__right">
        <button class="btn btn--ghost btn--sm" id="uploadMoreBtn">${I.plus} 继续上传</button>
        <button class="btn btn--ghost btn--sm" id="exportBtn">${I.download} 导出</button>
        <button class="btn btn--ghost btn--sm" id="clearBtn">清空</button>
      </div>
    </div>
    <div class="stats-bar">
      <div class="stats-bar__item">
        <span class="stats-bar__dot stats-bar__dot--total"></span>
        <span class="stats-bar__num">${state.items.length}</span>
        <span class="stats-bar__label">总数</span>
      </div>
      <div class="stats-bar__item">
        <span class="stats-bar__dot stats-bar__dot--pass"></span>
        <span class="stats-bar__num">${pass}</span>
        <span class="stats-bar__label">通过</span>
      </div>
      <div class="stats-bar__item">
        <span class="stats-bar__dot stats-bar__dot--warn"></span>
        <span class="stats-bar__num">${warn}</span>
        <span class="stats-bar__label">警告</span>
      </div>
      <div class="stats-bar__item">
        <span class="stats-bar__dot stats-bar__dot--fail"></span>
        <span class="stats-bar__num">${fail}</span>
        <span class="stats-bar__label">不通过</span>
      </div>
    </div>
    <div class="result-table">
      <div class="table-row table-row--head">
        <div></div><div>文件</div><div>尺寸</div><div>大小</div><div>格式</div><div>状态</div><div></div>
      </div>
      ${state.items.map(renderRow).join('')}
    </div>`;
  bindRowActions();
  $('#uploadMoreBtn')?.addEventListener('click', openFilePicker);
  $('#exportBtn')?.addEventListener('click', exportReport);
  $('#clearBtn')?.addEventListener('click', clearResults);
}

function renderRow(item) {
  const { id, meta, validation } = item;

  // 识别中占位行
  if (item.status === 'identifying') {
    return `
      <div class="table-row table-row--loading" data-id="${id}">
        <div class="table-row__thumb">
          <div class="thumb-skeleton"><span class="loading"></span></div>
        </div>
        <div class="table-row__name" title="${esc(meta?.name || '')}">
          ${esc(meta?.name || '未知文件')}
          <span class="tag tag--identifying" style="margin-left:6px;">
            <span class="loading"></span>识别中
          </span>
        </div>
        <div class="table-row__cell"><span class="skeleton-bar"></span></div>
        <div class="table-row__cell">${meta?.size ? formatSize(meta.size) : '—'}</div>
        <div class="table-row__cell table-row__cell--muted"><span class="skeleton-bar"></span></div>
        <div><span class="tag tag--identifying"><span class="loading"></span>识别中</span></div>
        <div class="table-row__actions"></div>
      </div>`;
  }

  const map = {
    pass: { cls: 'ok', text: '通过', icon: I.check },
    warn: { cls: 'warn', text: '警告', icon: I.warn },
    fail: { cls: 'bad', text: '不通过', icon: I.cross }
  };
  const st = map[validation.status] || map.fail;
  const isImg = meta?.type === 'image';
  const isVid = meta?.type === 'video';
  const thumb = meta?.objectUrl
    ? (isImg ? `<img src="${meta.objectUrl}" alt="">` : isVid ? `<video src="${meta.objectUrl}" muted></video>` : '')
    : '';
  const canFix = validation.status !== 'pass' && !item.error && validation.spec;

  // 如果匹配上 variant，在文件名后加个标记
  const variantTag = validation.matchedVariant
    ? ` <span class="tag tag--brand" style="margin-left:6px;">${esc(validation.matchedVariant.name)}</span>`
    : '';

  const checkItems = validation.results.map(r => {
    const icls = r.status;
    const ico = r.status === 'pass' ? I.check : r.status === 'warn' ? I.warn : I.cross;
    const isOk = r.status === 'pass';
    const swatch = r.field === 'colorZone' && r.dominantColor
      ? `<span class="color-swatch-inline" style="background:${esc(r.dominantColor.hex)}" title="${esc(r.dominantColor.hex)}"></span>`
      : '';
    return `
      <li class="check-item">
        <span class="check-item__icon check-item__icon--${icls}">${ico}</span>
        <div class="check-item__content">
          <div class="check-item__label">${esc(r.label)}</div>
          <div class="check-item__kv">
            <span>当前 ${swatch}<code class="${isOk ? 'is-ok' : 'is-bad'}">${esc(r.current)}</code></span>
            <span>要求 <code class="is-ok">${esc(r.required)}</code></span>
          </div>
          ${r.tip && !isOk ? `<div class="check-item__tip">${esc(r.tip)}</div>` : ''}
        </div>
      </li>`;
  }).join('');

  return `
    <div class="table-row" data-id="${id}">
      <div class="table-row__thumb">${thumb}</div>
      <div class="table-row__name" title="${esc(meta?.name || '')}">
        ${esc(meta?.name || '未知文件')}${variantTag}
      </div>
      <div class="table-row__cell">${meta?.width ? `${meta.width}×${meta.height}` : '—'}</div>
      <div class="table-row__cell">${meta?.size ? formatSize(meta.size) : '—'}</div>
      <div class="table-row__cell table-row__cell--muted">${(meta?.format || '—').toUpperCase()}</div>
      <div><span class="tag tag--${st.cls}">${st.icon} ${st.text}</span></div>
      <div class="table-row__actions">
        ${canFix ? `<button class="btn btn--primary btn--xs" data-action="fix" data-id="${id}">${I.wrench} 修复</button>` : ''}
      </div>
      <div class="table-row__detail">
        <ul class="check-list">${checkItems}</ul>
      </div>
    </div>`;
}

function bindRowActions() {
  $$('.table-row[data-id]').forEach(row => {
    if (row.classList.contains('table-row--loading')) return;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="fix"]')) return;
      row.classList.toggle('is-expanded');
    });
  });
  $$('[data-action="fix"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openFixModal(el.dataset.id);
    });
  });
}

/* ===== Fix Flow ===== */
let currentFixContext = null;

function openFixModal(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  const spec = getSpecById(item.specId);
  if (!spec) return;

  const failed = item.validation.results.filter(r => r.status !== 'pass');
  const unfixable = [];
  for (const r of failed) {
    const check = item.meta.type === 'video' ? canAutoFixVideo(r) : canAutoFix(r);
    if (!check.fixable) unfixable.push({ rule: r, ...check });
  }

  if (unfixable.length === failed.length && failed.length > 0) {
    showUnfixableModal(item, unfixable);
    return;
  }

  currentFixContext = { item, spec, unfixable };
  renderFixModal(item, spec, unfixable);
  $('#fixModal').hidden = false;
}

function showUnfixableModal(item, reasons) {
  $('#fixModalBody').innerHTML = `
    <div class="fix-group">
      <div class="fix-group__title" style="color:var(--warn)">${I.warn} 无法自动修复</div>
      <div class="fix-group__desc">以下问题需要人工处理：</div>
      ${reasons.map(r => `
        <div class="fix-option" style="cursor:default;">
          <div class="fix-option__text">
            <div class="fix-option__name">${esc(r.rule.label)}：${esc(r.rule.current)}（要求 ${esc(r.rule.required)}）</div>
            <div class="fix-option__hint">${esc(r.reason || '暂不支持该字段的自动修复')}</div>
            ${r.suggestion ? `<div class="fix-option__hint" style="margin-top:4px;color:var(--brand);">💡 ${esc(r.suggestion)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>`;
  $('#fixStartBtn').style.display = 'none';
  $('#fixModal').hidden = false;
  currentFixContext = null;
}

function renderFixModal(item, spec, unfixable) {
  const failed = item.validation.results.filter(r => r.status !== 'pass');
  const dimFail = failed.find(r => r.field === 'dimensions');
  const sizeFail = failed.find(r => r.field === 'size');
  const formatFail = failed.find(r => r.field === 'format');

  let html = '';

  if (item.meta.type === 'video') {
    html += `
      <div style="padding:10px 12px;background:var(--brand-soft);border:1px solid var(--brand-ring);border-radius:var(--r-sm);margin-bottom:14px;font-size:11.5px;color:var(--fg-2);">
        首次修复视频需下载 FFmpeg.wasm（约 30MB），处理时间取决于视频大小。
      </div>`;
  }

  // 如果规范有多个 variants，让用户选目标尺寸
  if (dimFail && Array.isArray(spec.variants) && spec.variants.length > 1) {
    html += `
      <div class="fix-group">
        <div class="fix-group__title">目标规格</div>
        <div class="fix-group__desc">该素材位有多种尺寸，请选择要修复到哪一种：</div>
        <div class="fix-options" data-group="targetVariantId">
          ${spec.variants.map((v, idx) => `
            <label class="fix-option ${idx === 0 ? 'is-selected' : ''}">
              <input type="radio" name="targetVariantId" value="${v.id}" ${idx === 0 ? 'checked' : ''} />
              <div class="fix-option__text">
                <div class="fix-option__name">${esc(v.name)} · ${v.width}×${v.height}</div>
              </div>
            </label>
          `).join('')}
        </div>
      </div>`;
  }

  if (dimFail) {
    html += `
      <div class="fix-group">
        <div class="fix-group__title">尺寸修复方式</div>
        <div class="fix-options" data-group="dimensionMethod">
          <label class="fix-option is-selected">
            <input type="radio" name="dimensionMethod" value="scale" checked />
            <div class="fix-option__text">
              <div class="fix-option__name">缩放</div>
              <div class="fix-option__hint">保留完整画面，可能造成轻微变形</div>
            </div>
          </label>
          <label class="fix-option">
            <input type="radio" name="dimensionMethod" value="crop" />
            <div class="fix-option__text">
              <div class="fix-option__name">居中裁剪</div>
              <div class="fix-option__hint">保持比例不变形，但边缘内容会被裁掉</div>
            </div>
          </label>
          <label class="fix-option">
            <input type="radio" name="dimensionMethod" value="pad" />
            <div class="fix-option__text">
              <div class="fix-option__name">加边框</div>
              <div class="fix-option__hint">保留原图完整内容，两侧补白</div>
            </div>
          </label>
        </div>
      </div>`;
  }

  if (sizeFail) {
    html += `
      <div class="fix-group">
        <div class="fix-group__title">体积压缩 <span style="color:var(--fg-4);font-weight:400;font-family:var(--font-mono);font-size:11.5px;">${esc(sizeFail.current)} → ${esc(sizeFail.required)}</span></div>
        <div class="fix-options" data-group="compressionLevel">
          <label class="fix-option">
            <input type="radio" name="compressionLevel" value="high" />
            <div class="fix-option__text">
              <div class="fix-option__name">高质量压缩</div>
              <div class="fix-option__hint">优先保证画质，可能无法达到目标体积</div>
            </div>
          </label>
          <label class="fix-option is-selected">
            <input type="radio" name="compressionLevel" value="balanced" checked />
            <div class="fix-option__text">
              <div class="fix-option__name">平衡压缩（推荐）</div>
              <div class="fix-option__hint">画质与体积的平衡</div>
            </div>
          </label>
          <label class="fix-option">
            <input type="radio" name="compressionLevel" value="low" />
            <div class="fix-option__text">
              <div class="fix-option__name">高压缩率</div>
              <div class="fix-option__hint">优先达到目标体积，画质会明显下降</div>
            </div>
          </label>
        </div>
      </div>`;
  }

  if (formatFail) {
    const allowed = spec.rules.find(r => r.field === 'format')?.allowed || [];
    html += `
      <div class="fix-group">
        <div class="fix-group__title">格式转换 <span style="color:var(--fg-4);font-weight:400;font-family:var(--font-mono);font-size:11.5px;">${esc(formatFail.current)} → 目标</span></div>
        <div class="fix-options" data-group="targetFormat">
          ${allowed.map((fmt, idx) => `
            <label class="fix-option ${idx === 0 ? 'is-selected' : ''}">
              <input type="radio" name="targetFormat" value="${fmt}" ${idx === 0 ? 'checked' : ''} />
              <div class="fix-option__text">
                <div class="fix-option__name">${fmt.toUpperCase()}</div>
                <div class="fix-option__hint">${fmt === 'jpg' ? '体积更小，不支持透明' : fmt === 'png' ? '体积较大，支持透明' : ''}</div>
              </div>
            </label>
          `).join('')}
        </div>
      </div>`;
  }

  if (unfixable.length) {
    html += `
      <div style="padding:10px 12px;background:var(--warn-soft);border:1px solid var(--warn-ring);border-radius:var(--r-sm);margin-top:12px;">
        <div style="font-weight:600;color:var(--warn);font-size:11.5px;margin-bottom:4px;">以下项无法自动修复</div>
        <ul style="margin:0;padding-left:18px;color:var(--fg-2);font-size:11px;line-height:1.6;">
          ${unfixable.map(r => `<li>${esc(r.rule.label)}：${esc(r.reason || '暂不支持')}</li>`).join('')}
        </ul>
      </div>`;
  }

  $('#fixModalBody').innerHTML = html;
  $('#fixStartBtn').style.display = '';
  $('#fixStartBtn').textContent = '开始修复';
  $('#fixStartBtn').disabled = false;

  $$('.fix-option input[type="radio"]').forEach(input => {
    input.addEventListener('change', () => {
      const group = input.closest('.fix-options');
      group.querySelectorAll('.fix-option').forEach(o => o.classList.remove('is-selected'));
      input.closest('.fix-option').classList.add('is-selected');
    });
  });
}

async function startFix() {
  if (!currentFixContext) return;
  const { item, spec } = currentFixContext;
  const btn = $('#fixStartBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> 修复中…';

  try {
    const options = collectFixOptions();
    let result;
    if (item.meta.type === 'image') {
      result = await fixImage(item.meta, spec, item.validation.results, options);
    } else if (item.meta.type === 'video') {
      result = await fixVideo(item.meta, spec, item.validation.results, options, (p) => {
        btn.innerHTML = `<span class="loading"></span> ${Math.round(p * 100)}%`;
      });
    }
    item.fixed = result;
    result.validation = validate(result.meta, spec);
    $('#fixModal').hidden = true;
    openPreviewModal(item);
  } catch (err) {
    alert('修复失败：' + err.message);
    btn.disabled = false;
    btn.textContent = '开始修复';
  }
}

function collectFixOptions() {
  const opts = {};
  $$('.fix-options').forEach(g => {
    const checked = g.querySelector('input[type="radio"]:checked');
    if (checked) opts[g.dataset.group] = checked.value;
  });
  return opts;
}

/* ===== Preview ===== */
let currentPreviewItem = null;

function openPreviewModal(item) {
  currentPreviewItem = item;
  const { meta, fixed } = item;
  const before = meta.type === 'image'
    ? `<img src="${meta.objectUrl}" alt="">`
    : `<video src="${meta.objectUrl}" controls></video>`;
  const after = fixed.meta.type === 'image'
    ? `<img src="${fixed.meta.objectUrl}" alt="">`
    : `<video src="${fixed.meta.objectUrl}" controls></video>`;

  const afterStatus = fixed.validation.status === 'pass'
    ? `<span class="tag tag--ok">${I.check} 通过</span>`
    : fixed.validation.status === 'warn'
      ? `<span class="tag tag--warn">${I.warn} 部分项不达标</span>`
      : `<span class="tag tag--bad">${I.cross} 未通过</span>`;

  $('#previewModalBody').innerHTML = `
    <div class="compare-grid">
      <div>
        <div class="compare-cell__label">
          <span style="width:5px;height:5px;border-radius:50%;background:var(--fg-4);"></span>
          原文件
        </div>
        <div class="compare-cell__preview">${before}</div>
        <div class="compare-cell__info">
          <div title="${esc(meta.name)}">${esc(meta.name)}</div>
          <div>${(meta.format || '').toUpperCase()}</div>
          <div>${meta.width}×${meta.height}</div>
          <div>${formatSize(meta.size)}</div>
        </div>
      </div>
      <div>
        <div class="compare-cell__label">
          <span style="width:5px;height:5px;border-radius:50%;background:var(--brand);"></span>
          修复后 &nbsp; ${afterStatus}
        </div>
        <div class="compare-cell__preview">${after}</div>
        <div class="compare-cell__info">
          <div title="${esc(fixed.filename)}">${esc(fixed.filename)}</div>
          <div>${(fixed.meta.format || '').toUpperCase()}</div>
          <div>${fixed.meta.width}×${fixed.meta.height}</div>
          <div>${formatSize(fixed.meta.size)}</div>
        </div>
      </div>
    </div>
    <div class="fix-log">
      <div class="fix-log__title">${I.sparkles} 已执行的修复</div>
      <ul class="fix-log__list">${fixed.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>
    ${fixed.warnings?.length ? `
      <div class="fix-log" style="background:var(--warn-soft);border-color:var(--warn-ring);">
        <div class="fix-log__title" style="color:var(--warn)">注意</div>
        <ul class="fix-log__list">${fixed.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>` : ''}`;
  $('#previewModal').hidden = false;
}

function downloadFixed() {
  if (!currentPreviewItem?.fixed) return;
  const { blob, filename } = currentPreviewItem.fixed;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);

  const item = currentPreviewItem;
  if (item.meta.objectUrl) URL.revokeObjectURL(item.meta.objectUrl);
  item.meta = item.fixed.meta;
  item.validation = item.fixed.validation;
  item.fixed = null;
  $('#previewModal').hidden = true;
  renderCheckerBody();
}

/* ===== Export ===== */
function exportReport() {
  if (!state.items.length) return;
  const rows = [['文件名', '规范', '状态', '尺寸', '体积', '格式', '不通过项']];
  for (const item of state.items) {
    if (item.status === 'identifying' || !item.validation) continue;
    const spec = getSpecById(item.specId) || {};
    const failed = item.validation.results
      .filter(r => r.status !== 'pass')
      .map(r => `${r.label}: ${r.current} (要求 ${r.required})`)
      .join(' | ');
    rows.push([
      item.meta?.name || '',
      spec.name || '',
      item.validation.status,
      item.meta?.width ? `${item.meta.width}×${item.meta.height}` : '',
      item.meta?.size ? formatSize(item.meta.size) : '',
      (item.meta?.format || '').toUpperCase(),
      failed
    ]);
  }
  const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `审核报告_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ===== Modals ===== */
function initModals() {
  $$('[data-close]').forEach(el => {
    el.addEventListener('click', () => el.closest('.modal').hidden = true);
  });
  $('#fixStartBtn')?.addEventListener('click', startFix);
  $('#downloadFixedBtn')?.addEventListener('click', downloadFixed);
}

/* ===== Init ===== */
function init() {
  initSidebarTree();
  initChecker();
  initModals();
  updateSpecName();
  renderSpecPane();
}

init();
