/**
 * Compliance Hub · SaaS Dark Admin
 */

import { specs, getSpecById, getSpecTree } from './data/specs.js';
import { readFileMeta, formatSize } from './validators/meta.js';
import { validate } from './validators/engine.js';
import { fixImage, canAutoFix } from './fixers/image.js';
import { fixImageWithHunyuan } from './fixers/ai.js';
import { fixVideo, canAutoFixVideo } from './fixers/video.js';
import { renderMarkdown } from './utils/markdown.js';
import { generateBannerSet } from './generators/banner.js';
import { clearGalleryRecords, deleteGalleryRecord, listGalleryRecords, saveGalleryRecord } from './services/gallery.js';

/* ===== State ===== */
const state = {
  selectedSpecId: specs[0]?.id || null,
  expandedCats: new Set(),
  items: [],
  galleryItems: []
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
const supportsBannerMaker = (spec) => spec?.generator?.type === 'newGameBanner';

const I = {
  check: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  warn: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><line x1="12" y1="5.5" x2="12" y2="14.5"/><line x1="12" y1="19" x2="12.01" y2="19"/></svg>',
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
  pane.innerHTML = spec?.markdown
    ? `<div class="md md--spec">${renderMarkdown(spec.markdown)}</div>`
    : '';
  groupSpecExampleRows(pane);
  groupSpecSections(pane);
  bindSpecImagePreview(pane);
  bindSpecColorCopy(pane);
}

function groupSpecSections(pane) {
  const root = pane.querySelector('.md--spec');
  if (!root) return;

  const headings = Array.from(root.children).filter(node => node.tagName === 'H1');
  headings.forEach(heading => {
    const section = document.createElement('section');
    section.className = 'md-section';
    root.insertBefore(section, heading);

    let node = heading;
    while (node && (node === heading || node.tagName !== 'H1')) {
      const next = node.nextElementSibling;
      section.appendChild(node);
      node = next;
    }
  });
}

function groupSpecExampleRows(pane) {
  const headings = Array.from(pane.querySelectorAll('h2'));
  headings.forEach(heading => {
    if (!heading.textContent.includes('banner')) return;
    const row = document.createElement('div');
    row.className = 'md-example-row';
    let node = heading.nextElementSibling;
    while (node && !/^H[12]$/.test(node.tagName)) {
      const next = node.nextElementSibling;
      if (node.tagName === 'FIGURE' && !node.classList.contains('md-figure--captioned')) {
        row.appendChild(node);
      }
      node = next;
    }
    if (row.children.length) heading.after(row);
  });
}

function bindSpecImagePreview(pane) {
  pane.querySelectorAll('.md figure img').forEach(img => {
    img.classList.add('is-previewable');
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', '点击放大查看图片');
    img.addEventListener('click', () => openImageLightbox(img));
    img.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openImageLightbox(img);
    });
  });
}

function bindSpecColorCopy(pane) {
  pane.querySelectorAll('[data-copy-color]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const color = btn.dataset.copyColor;
      if (!color) return;
      const ok = await copyText(color);
      btn.classList.add('is-copied');
      btn.setAttribute('aria-label', ok ? `已复制 ${color}` : `复制失败 ${color}`);
      showCopyToast(ok ? `已复制 ${color}` : '复制失败，请手动复制');
      window.setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.setAttribute('aria-label', `复制色值 ${color}`);
      }, 1200);
    });
  });
}

async function copyText(text) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

function showCopyToast(message) {
  let toast = $('#copyToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copyToast';
    toast.className = 'copy-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(showCopyToast.timer);
  showCopyToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 1400);
}

function openImageLightbox(img) {
  openImageLightboxFromSrc(img.currentSrc || img.src, img.alt || '图片预览');
}

function openImageLightboxFromSrc(src, alt = '图片预览') {
  const lightbox = $('#imageLightbox');
  const preview = $('#imageLightboxImg');
  if (!lightbox || !preview || !src) return;

  preview.src = src;
  preview.alt = alt;
  lightbox.hidden = false;
}

/* ===== Gallery ===== */
function initGallery() {
  $('#galleryOpenBtn')?.addEventListener('click', openGalleryModal);
  $('#galleryClearBtn')?.addEventListener('click', clearGallery);
  refreshGallery().catch(err => console.warn('读取本地图库失败', err));
}

async function refreshGallery({ render = false } = {}) {
  revokeGalleryObjectUrls();
  const records = await listGalleryRecords();
  state.galleryItems = records.map(record => ({
    ...record,
    objectUrl: URL.createObjectURL(record.blob)
  }));
  updateGalleryCount();
  if (render || !$('#galleryModal')?.hidden) renderGalleryModal();
}

function revokeGalleryObjectUrls() {
  state.galleryItems.forEach(item => {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  });
}

function updateGalleryCount() {
  const count = $('#galleryCount');
  if (count) count.textContent = String(state.galleryItems.length);
}

async function openGalleryModal() {
  await refreshGallery({ render: true });
  $('#galleryModal').hidden = false;
}

function renderGalleryModal() {
  const body = $('#galleryModalBody');
  if (!body) return;
  const total = state.galleryItems.length;
  $('#galleryClearBtn').disabled = !total;

  if (!total) {
    body.innerHTML = `
      <div class="gallery-empty">
        <div class="gallery-empty__icon">${I.upload}</div>
        <div class="gallery-empty__title">还没有生成历史</div>
        <div class="gallery-empty__hint">生成 banner 后会自动保存到这里，刷新页面也能找回。</div>
      </div>`;
    return;
  }

  body.innerHTML = `
    <div class="gallery-summary">
      <div>已保存 <strong>${total}</strong> 张生成图</div>
      <button class="btn btn--ghost btn--sm" data-gallery-action="download-all">${I.download} 全部下载</button>
    </div>
    <div class="gallery-grid">
      ${state.galleryItems.map(renderGalleryCard).join('')}
    </div>`;
  bindGalleryActions();
}

function renderGalleryCard(item) {
  const time = item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间';
  const specText = [item.specName, item.variantName].filter(Boolean).join(' / ') || '生成素材';
  const fileText = [
    (item.format || '').toUpperCase(),
    item.width && item.height ? `${item.width}×${item.height}` : '',
    item.size ? formatSize(item.size) : ''
  ].filter(Boolean).join(' · ');
  const colorTag = item.generatedInfo?.colorHex
    ? `<span class="tag tag--subtle">底色 ${esc(item.generatedInfo.colorHex)}</span>`
    : '';
  const detailsId = `gallery-card-details-${item.id}`;

  return `
    <article class="gallery-card" data-gallery-id="${esc(item.id)}">
      <button class="gallery-card__image" type="button" data-gallery-action="preview" aria-label="预览 ${esc(item.name)}">
        <img src="${item.objectUrl}" alt="${esc(item.name)}">
      </button>
      <div class="gallery-card__body">
        <div class="gallery-card__head">
          <div class="gallery-card__name" title="${esc(item.name)}">${esc(item.name)}</div>
          <button class="gallery-card__toggle" type="button" data-gallery-action="toggle-details" aria-expanded="false" aria-controls="${esc(detailsId)}" aria-label="展开详细信息">
            ${I.chevron}
          </button>
        </div>
        <div class="gallery-card__details" id="${esc(detailsId)}" hidden>
          <div class="gallery-card__meta" title="${esc(specText)}">${esc(specText)}</div>
          <div class="gallery-card__meta">${esc(fileText)}</div>
          <div class="gallery-card__foot">
            <span>${esc(time)}</span>
            ${colorTag}
          </div>
        </div>
        <div class="gallery-card__actions">
          <button class="btn btn--ghost btn--xs" data-gallery-action="add-checker">加入检测</button>
          <button class="btn btn--ghost btn--xs" data-gallery-action="download">${I.download} 下载</button>
          <button class="btn btn--ghost btn--xs" data-gallery-action="delete">删除</button>
        </div>
      </div>
    </article>`;
}

function toggleGalleryCardDetails(card, btn) {
  if (!card || !btn) return;
  const details = card.querySelector('.gallery-card__details');
  const expanded = !card.classList.contains('is-expanded');
  card.classList.toggle('is-expanded', expanded);
  btn.setAttribute('aria-expanded', String(expanded));
  btn.setAttribute('aria-label', expanded ? '收起详细信息' : '展开详细信息');
  if (details) details.hidden = !expanded;
}

function bindGalleryActions() {
  $('[data-gallery-action="download-all"]')?.addEventListener('click', downloadAllGalleryItems);
  $$('.gallery-card [data-gallery-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.gallery-card');
      const item = state.galleryItems.find(i => i.id === card?.dataset.galleryId);
      if (!item) return;

      const action = btn.dataset.galleryAction;
      if (action === 'toggle-details') toggleGalleryCardDetails(card, btn);
      if (action === 'preview') openImageLightboxFromSrc(item.objectUrl, item.name || '图片预览');
      if (action === 'download') downloadBlob(item.blob, item.name || 'generated.jpg');
      if (action === 'delete') await deleteGalleryItem(item.id);
      if (action === 'add-checker') addGalleryItemToChecker(item);
    });
  });
}

async function deleteGalleryItem(id) {
  if (!confirm('确定删除这张生成历史吗？')) return;
  await deleteGalleryRecord(id);
  await refreshGallery({ render: true });
}

async function clearGallery() {
  if (!state.galleryItems.length) return;
  if (!confirm('确定清空全部生成历史吗？')) return;
  await clearGalleryRecords();
  await refreshGallery({ render: true });
}

function downloadAllGalleryItems() {
  state.galleryItems.forEach((item, index) => {
    window.setTimeout(() => downloadBlob(item.blob, item.name || `generated-${index + 1}.jpg`), index * 120);
  });
}

function addGalleryItemToChecker(item) {
  const spec = getSpecById(item.specId) || getSpecById(state.selectedSpecId);
  if (!spec) {
    alert('未找到可用于检测的规范');
    return;
  }
  const file = new File([item.blob], item.name || 'generated.jpg', { type: item.mimeType || 'image/jpeg', lastModified: item.createdAt || Date.now() });
  const meta = {
    type: 'image',
    width: item.width,
    height: item.height,
    size: item.size,
    format: item.format || 'jpg',
    objectUrl: URL.createObjectURL(item.blob),
    file,
    name: file.name,
    dominantColor: item.dominantColor || null,
    backgroundTexture: item.backgroundTexture || null
  };
  state.items.push({
    id: uid(),
    meta,
    validation: validate(meta, spec),
    fixed: null,
    specId: spec.id,
    generated: true,
    generatedInfo: item.generatedInfo || null
  });
  renderCheckerBody();
  showCopyToast('已加入检测列表');
}

async function saveGeneratedOutputToGallery(output, spec) {
  const createdAt = Date.now();
  await saveGalleryRecord({
    id: uid(),
    name: output.filename,
    blob: output.blob,
    mimeType: output.blob?.type || 'image/jpeg',
    width: output.width,
    height: output.height,
    size: output.size,
    format: output.format,
    specId: spec.id,
    specName: spec.name,
    variantName: output.variant?.name || '',
    dominantColor: output.dominantColor,
    detectedColor: output.detectedColor,
    backgroundTexture: output.backgroundTexture,
    generatedInfo: {
      colorHex: output.dominantColor?.hex,
      detectedColorHex: output.detectedColor?.hex,
      variantName: output.variant?.name || '',
      log: output.log || []
    },
    createdAt
  });
  return true;
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

function syncResultMode() {
  $('.panel__body--flow')?.classList.toggle('is-result-mode', state.items.length > 0);
}

function renderCheckerBody() {
  syncResultMode();
  const body = $('#checkerBody');
  const spec = getSpecById(state.selectedSpecId);
  const canGenerateBanner = supportsBannerMaker(spec);

  if (!state.items.length) {
    body.innerHTML = `
      <div class="empty-zone">
        <div class="empty-zone__box" id="emptyBox">
          <div class="empty-zone__icon">${I.upload}</div>
          <div class="empty-zone__title">拖拽文件到此处</div>
          <div class="empty-zone__desc">支持成品检测；也可以上传背景、LOGO、游戏形象自动生成规范 banner</div>
          <div class="empty-zone__kbd">
            <span>JPG</span><span>PNG</span><span>WEBP</span><span>MP4</span><span>MOV</span>
          </div>
          <div class="empty-zone__actions">
            <button class="btn btn--primary empty-zone__upload empty-zone__upload--lg" id="inlineUploadBtn">
              ${I.plus} 上传素材检测
            </button>
            ${canGenerateBanner ? `<button class="btn btn--ghost empty-zone__upload empty-zone__upload--lg" id="inlineBannerMakerBtn">${I.sparkles} 智能生成素材</button>` : ''}
          </div>
        </div>
      </div>`;
    $('#inlineUploadBtn')?.addEventListener('click', openFilePicker);
    $('#inlineBannerMakerBtn')?.addEventListener('click', openBannerMaker);
    return;
  }

  const identifying = state.items.filter(i => i.status === 'identifying').length;
  const pass = state.items.filter(i => i.validation?.status === 'pass').length;
  const warn = state.items.filter(i => i.validation?.status === 'warn').length;
  const fail = state.items.filter(i => i.validation?.status === 'fail').length;
  const generatedCount = state.items.filter(i => i.generated).length;

  const identifyingBadge = identifying
    ? `<span class="identifying-badge"><span class="loading"></span>识别中 ${identifying}</span>`
    : '';

  body.innerHTML = `
    <div class="result-toolbar">
      <div class="result-toolbar__left">已检测 <strong style="color:var(--fg-1)">${state.items.length}</strong> 个文件${identifyingBadge}</div>
      <div class="result-toolbar__right">
        ${canGenerateBanner ? `<button class="btn btn--primary btn--sm" id="bannerMakerBtn">${I.sparkles} 智能生成素材</button>` : ''}
        ${generatedCount ? `<button class="btn btn--ghost btn--sm" id="downloadGeneratedBtn">${I.download} 下载生成图</button>` : ''}
        <button class="btn btn--ghost btn--sm" id="uploadMoreBtn">${I.plus} 继续上传</button>
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
        <div></div><div>文件</div><div>文件规格</div><div>状态</div><div></div>
      </div>
      ${state.items.map(renderRow).join('')}
    </div>`;
  bindRowActions();
  $('#bannerMakerBtn')?.addEventListener('click', openBannerMaker);
  $('#downloadGeneratedBtn')?.addEventListener('click', downloadGeneratedItems);
  $('#uploadMoreBtn')?.addEventListener('click', openFilePicker);
  $('#clearBtn')?.addEventListener('click', clearResults);
}

const FILE_SPEC_FIELDS = ['format', 'dimensions', 'size'];
const FILE_SPEC_FIELD_LABELS = {
  format: '格式',
  dimensions: '尺寸',
  size: '大小'
};

function getFileSpecText(meta) {
  const parts = [];
  const format = (meta?.format || '').toUpperCase();
  if (format) parts.push(format);
  if (meta?.width && meta?.height) parts.push(`${meta.width}×${meta.height}`);
  if (meta?.size) parts.push(formatSize(meta.size));
  return parts.length ? parts.join(' · ') : '—';
}

function getMergedStatus(results) {
  if (results.some(r => r.status === 'fail')) return 'fail';
  if (results.some(r => r.status === 'warn')) return 'warn';
  return 'pass';
}

function mergeFileSpecResults(results) {
  const fileSpecResults = results.filter(r => FILE_SPEC_FIELDS.includes(r.field));
  if (!fileSpecResults.length) return results;

  const formatValue = (r, key) => `${FILE_SPEC_FIELD_LABELS[r.field] || r.label} ${r[key]}`;
  const merged = {
    field: 'fileSpec',
    label: '文件规格',
    status: getMergedStatus(fileSpecResults),
    current: fileSpecResults.map(r => formatValue(r, 'current')).join('；'),
    required: fileSpecResults.map(r => formatValue(r, 'required')).join('；'),
    tip: fileSpecResults
      .filter(r => r.status !== 'pass' && r.tip)
      .map(r => `${FILE_SPEC_FIELD_LABELS[r.field] || r.label}：${r.tip}`)
      .join('；')
  };

  const displayResults = [];
  let inserted = false;
  for (const r of results) {
    if (FILE_SPEC_FIELDS.includes(r.field)) {
      if (!inserted) {
        displayResults.push(merged);
        inserted = true;
      }
      continue;
    }
    displayResults.push(r);
  }
  return displayResults;
}

function renderCheckItem(r) {
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
          <span class="table-row__filename">${esc(meta?.name || '未知文件')}</span>
          <span class="tag tag--identifying">
            <span class="loading"></span>识别中
          </span>
        </div>
        <div class="table-row__cell table-row__cell--spec"><span class="skeleton-bar"></span></div>
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
    ? (isImg
      ? `<button type="button" class="thumb-preview" data-action="preview" data-id="${id}" aria-label="预览 ${esc(meta?.name || '图片')}"><img src="${meta.objectUrl}" alt=""></button>`
      : isVid ? `<video src="${meta.objectUrl}" muted></video>` : '')
    : '';
  const canNormalFix = validation.status !== 'pass' && !item.error && validation.spec && canNormalFixItem(item);
  const canAiFix = validation.status !== 'pass' && !item.error && validation.spec && canAiFixItem(item);
  const canDownload = item.generated && meta?.file;

  const matchedSpecTagText = getMatchedSpecTagText(validation);
  const matchedSpecTag = matchedSpecTagText
    ? ` <span class="tag tag--brand tag--match" title="${esc(matchedSpecTagText)}">${esc(matchedSpecTagText)}</span>`
    : '';
  const generatedTag = item.generatedInfo?.colorHex
    ? ` <span class="tag tag--subtle tag--match">自动生成 · 底色 ${esc(item.generatedInfo.colorHex)}</span>`
    : '';

  const checkItems = mergeFileSpecResults(validation.results).map(renderCheckItem).join('');

  return `
    <div class="table-row" data-id="${id}">
      <div class="table-row__thumb">${thumb}</div>
      <div class="table-row__name" title="${esc(meta?.name || '')}">
        <span class="table-row__filename">${esc(meta?.name || '未知文件')}</span>${matchedSpecTag}${generatedTag}
      </div>
      <div class="table-row__cell table-row__cell--spec">${esc(getFileSpecText(meta))}</div>
      <div><span class="tag tag--${st.cls}">${st.icon} ${st.text}</span></div>
      <div class="table-row__actions">
        ${canDownload ? `<button class="btn btn--ghost btn--xs" data-action="download" data-id="${id}">${I.download} 下载</button>` : ''}
        ${canAiFix ? `<button class="btn btn--primary btn--xs" data-action="ai-fix" data-id="${id}">${I.sparkles} AI修复</button>` : ''}
        ${canNormalFix ? `<button class="btn btn--primary btn--xs" data-action="fix" data-id="${id}">${I.wrench} 普通修复</button>` : ''}
      </div>
      <div class="table-row__detail">
        <ul class="check-list">${checkItems}</ul>
      </div>
    </div>`;
}

function getMatchedSpecTagText(validation) {
  const spec = validation?.spec;
  if (!spec) return '';

  const specName = spec.shortName || spec.name || '未命名规范';
  const variant = validation.matchedVariant;
  if (!variant) {
    return Array.isArray(spec.variants) && spec.variants.length ? '' : `规范：${specName}`;
  }

  const rawVariantName = String(variant.name || variant.id || '未命名素材');
  const variantName = rawVariantName.endsWith('素材') ? rawVariantName : `${rawVariantName}素材`;
  const size = variant.width && variant.height ? `（${variant.width}×${variant.height}）` : '';
  return `规范：${specName} / 素材：${variantName}${size}`;
}

const FILE_SPEC_FIX_FIELDS = new Set(['format', 'size', 'dimensions']);

function isFileSpecFixField(field) {
  return FILE_SPEC_FIX_FIELDS.has(field);
}

function getNormalFixFailures(item) {
  if (!item?.validation?.results?.length) return [];
  return item.validation.results.filter(r => r.status !== 'pass' && isFileSpecFixField(r.field));
}

function canNormalFixItem(item) {
  return getNormalFixFailures(item).some(r => {
    const check = item.meta.type === 'video' ? canAutoFixVideo(r) : canAutoFix(r);
    return check.fixable;
  });
}

function canAiFixItem(item) {
  if (item?.meta?.type !== 'image' || !item.meta.file) return false;
  return item.validation?.results?.some(r => r.status !== 'pass');
}

function bindRowActions() {
  $$('.table-row[data-id]').forEach(row => {
    if (row.classList.contains('table-row--loading')) return;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      row.classList.toggle('is-expanded');
    });
  });
  $$('[data-action="fix"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openFixModal(el.dataset.id);
    });
  });
  $$('[data-action="ai-fix"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      startAiFix(el.dataset.id, el);
    });
  });
  $$('[data-action="download"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadItem(el.dataset.id);
    });
  });
  $$('[data-action="preview"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = state.items.find(i => i.id === el.dataset.id);
      if (item?.meta?.type === 'image' && item.meta.objectUrl) {
        openImageLightboxFromSrc(item.meta.objectUrl, item.meta.name || '图片预览');
      }
    });
  });
}

/* ===== Banner Maker ===== */
const bannerMakerState = {
  files: { background: null, logo: null, character: null },
  previews: { background: null, logo: null, character: null },
  dimensions: { background: null, logo: null, character: null },
  dimensionTasks: { background: null, logo: null, character: null },
  characterType: 'full'
};

const bannerAssetConfig = [
  { role: 'background', title: '背景 / 海报图', desc: '自动识别主色，并以 20% 透明度作为底纹' },
  { role: 'logo', title: '游戏 LOGO', desc: '自动放入左上角 120×40 LOGO 区' },
  { role: 'character', title: '游戏形象 / IP', desc: '自动放入右侧主元素区，大/小尺寸分别适配' }
];

function openBannerMaker() {
  const spec = getSpecById(state.selectedSpecId);
  if (!supportsBannerMaker(spec)) {
    alert('当前规范暂不支持一键生成 banner');
    return;
  }
  renderBannerMakerModal();
  $('#bannerMakerModal').hidden = false;
}

function renderBannerMakerModal() {
  const body = $('#bannerMakerBody');
  const spec = getSpecById(state.selectedSpecId);
  const ready = bannerAssetConfig.every(item => bannerMakerState.files[item.role]);
  const blurWarnings = getBannerAssetWarnings(spec);

  body.innerHTML = `
    <div class="banner-maker-intro">
      上传三类素材后，会自动识别背景主色，按当前规范生成 <strong>660×220</strong> 和 <strong>380×220</strong> 两张 banner；优先 PNG 无损，超过规范体积时自动压缩到上限内。
    </div>
    <div class="banner-maker-grid">
      ${bannerAssetConfig.map(renderBannerUploadCard).join('')}
    </div>
    ${renderCharacterTypeOptions()}
    ${blurWarnings.length ? `
      <div class="banner-maker-warning">
        <strong>清晰度提示</strong>
        <ul>${blurWarnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>` : ''}`;

  $('#bannerGenerateBtn').disabled = !ready;
  bindBannerUploadCards();
  bindCharacterTypeOptions();
}

function renderCharacterTypeOptions() {
  const type = bannerMakerState.characterType;
  return `
    <div class="banner-character-type">
      <div class="banner-character-type__title">IP 类型</div>
      <div class="banner-character-type__options">
        <label class="banner-character-type__option ${type === 'full' ? 'is-selected' : ''}">
          <input type="radio" name="bannerCharacterType" value="full" ${type === 'full' ? 'checked' : ''}>
          <span>完整身体</span>
          <small>上下各预留 16px</small>
        </label>
        <label class="banner-character-type__option ${type === 'half' ? 'is-selected' : ''}">
          <input type="radio" name="bannerCharacterType" value="half" ${type === 'half' ? 'checked' : ''}>
          <span>半身</span>
          <small>仅顶部预留 16px</small>
        </label>
      </div>
    </div>`;
}

function bindCharacterTypeOptions() {
  $$('input[name="bannerCharacterType"]').forEach(input => {
    input.addEventListener('change', () => {
      bannerMakerState.characterType = input.value === 'half' ? 'half' : 'full';
      renderBannerMakerModal();
    });
  });
}

function getBannerAssetWarnings(spec) {
  return bannerAssetConfig.flatMap(item => {
    const dim = bannerMakerState.dimensions[item.role];
    const requirement = getBannerAssetRequirement(spec, item.role);
    if (!dim || !requirement) return [];
    if (dim.width >= requirement.width && dim.height >= requirement.height) return [];
    return `${item.title} ${dim.width}×${dim.height} 小于建议 ${requirement.width}×${requirement.height}，生成的素材可能会模糊`;
  });
}

function getBannerAssetRequirement(spec, role) {
  const variants = Array.isArray(spec?.variants) ? spec.variants : [];
  if (!variants.length) return null;

  if (role === 'background') {
    return {
      width: Math.max(...variants.map(v => v.width || 0)),
      height: Math.max(...variants.map(v => v.height || 0))
    };
  }

  const keyword = role === 'logo' ? 'LOGO' : 'IP';
  const zones = variants.map(v => getBannerLayoutZone(v, keyword)).filter(Boolean);
  if (!zones.length) return null;
  return {
    width: Math.max(...zones.map(z => z.width || 0)),
    height: Math.max(...zones.map(z => role === 'character' ? Math.max(1, (z.height || 0) - getCharacterVerticalPaddingTotal()) : (z.height || 0)))
  };
}

function getBannerLayoutZone(variant, keyword) {
  return variant.layoutZones?.find(zone => String(zone.name || '').toUpperCase().includes(keyword));
}

function getCharacterVerticalPaddingTotal() {
  return bannerMakerState.characterType === 'half' ? 16 : 32;
}

function renderBannerUploadCard(item) {
  const file = bannerMakerState.files[item.role];
  const preview = bannerMakerState.previews[item.role];
  const previewHtml = preview
    ? `<div class="banner-upload-card__preview banner-upload-card__preview--has-image">
        <button type="button" class="banner-upload-card__preview-button" data-banner-preview="${item.role}" aria-label="预览 ${esc(item.title)}">
          <img src="${preview}" alt="${esc(item.title)}">
          <span class="banner-upload-card__preview-hint">点击预览</span>
        </button>
        <button type="button" class="banner-upload-card__replace" data-banner-replace="${item.role}" aria-label="替换 ${esc(item.title)}">替换图片</button>
      </div>`
    : `<div class="banner-upload-card__preview"><span>${I.upload}</span></div>`;

  return `
    <div class="banner-upload-card ${file ? 'has-file' : ''}" data-banner-role="${item.role}" role="button" tabindex="0" aria-label="上传 ${esc(item.title)}">
      <input type="file" accept="image/*" hidden />
      ${previewHtml}
      <div class="banner-upload-card__content">
        <div class="banner-upload-card__title">${esc(item.title)}</div>
        <div class="banner-upload-card__desc">${esc(item.desc)}</div>
        <div class="banner-upload-card__file">${file ? esc(file.name) : '点击或拖拽上传图片'}</div>
      </div>
    </div>`;
}

function bindBannerUploadCards() {
  $$('.banner-upload-card').forEach(card => {
    const role = card.dataset.bannerRole;
    const input = card.querySelector('input[type="file"]');
    input.addEventListener('change', () => {
      setBannerAsset(role, input.files?.[0]);
      input.value = '';
    });
    card.addEventListener('click', e => {
      if (e.target.closest('[data-banner-preview], [data-banner-replace]')) return;
      input.click();
    });
    card.addEventListener('keydown', e => {
      if (e.target.closest('[data-banner-preview], [data-banner-replace]')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      input.click();
    });
    card.querySelector('[data-banner-preview]')?.addEventListener('click', e => {
      e.stopPropagation();
      const src = bannerMakerState.previews[role];
      if (src) openImageLightboxFromSrc(src, bannerMakerState.files[role]?.name || '图片预览');
    });
    card.querySelector('[data-banner-replace]')?.addEventListener('click', e => {
      e.stopPropagation();
      input.click();
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      card.classList.add('is-drag');
    });
    card.addEventListener('dragleave', () => card.classList.remove('is-drag'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('is-drag');
      setBannerAsset(role, e.dataTransfer.files?.[0]);
    });
  });
}

function setBannerAsset(role, file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('请上传图片文件');
    return;
  }
  if (bannerMakerState.previews[role]) URL.revokeObjectURL(bannerMakerState.previews[role]);
  const previewUrl = URL.createObjectURL(file);
  bannerMakerState.files[role] = file;
  bannerMakerState.previews[role] = previewUrl;
  bannerMakerState.dimensions[role] = null;
  bannerMakerState.dimensionTasks[role] = loadImageDimensions(previewUrl)
    .then(dimensions => {
      if (bannerMakerState.previews[role] !== previewUrl) return null;
      bannerMakerState.dimensions[role] = dimensions;
      renderBannerMakerModal();
      return dimensions;
    })
    .catch(() => null);
  renderBannerMakerModal();
}

function loadImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

async function startBannerGenerate() {
  const spec = getSpecById(state.selectedSpecId);
  if (!supportsBannerMaker(spec)) return;

  const btn = $('#bannerGenerateBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> 生成中…';

  try {
    await Promise.all(Object.values(bannerMakerState.dimensionTasks).filter(Boolean));
    const blurWarnings = getBannerAssetWarnings(spec);
    if (blurWarnings.length) {
      alert(`提示：\n${blurWarnings.join('\n')}`);
    }

    const outputs = await generateBannerSet({
      backgroundFile: bannerMakerState.files.background,
      logoFile: bannerMakerState.files.logo,
      characterFile: bannerMakerState.files.character,
      spec,
      characterType: bannerMakerState.characterType
    });
    const gallerySaves = [];
    for (const output of outputs) {
      const meta = {
        type: 'image',
        width: output.width,
        height: output.height,
        size: output.size,
        format: output.format,
        objectUrl: output.objectUrl,
        file: output.file,
        name: output.filename,
        dominantColor: output.dominantColor,
        layoutAnalysis: output.layoutAnalysis,
        backgroundTexture: output.backgroundTexture
      };
      state.items.push({
        id: uid(),
        meta,
        validation: validate(meta, spec),
        fixed: null,
        specId: spec.id,
        generated: true,
        generatedInfo: {
          colorHex: output.dominantColor.hex,
          detectedColorHex: output.detectedColor.hex,
          variantName: output.variant.name,
          log: output.log
        }
      });
      gallerySaves.push(saveGeneratedOutputToGallery(output, spec).catch(err => {
        console.warn('保存到我的图库失败', err);
        return null;
      }));
    }
    const saved = (await Promise.all(gallerySaves)).filter(Boolean).length;
    await refreshGallery();
    if (saved) showCopyToast('已保存到我的图库');
    $('#bannerMakerModal').hidden = true;
    renderCheckerBody();
  } catch (err) {
    alert('生成失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '智能生成素材';
  }
}

function downloadItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item?.meta?.file) return;
  downloadBlob(item.meta.file, item.meta.name || item.meta.file.name);
}

function downloadGeneratedItems() {
  const generated = state.items.filter(item => item.generated && item.meta?.file);
  generated.forEach((item, index) => {
    window.setTimeout(() => downloadBlob(item.meta.file, item.meta.name || item.meta.file.name), index * 120);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===== Fix Flow ===== */
let currentFixContext = null;
let manualCropEditor = null;

function openFixModal(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  const spec = getSpecById(item.specId);
  if (!spec) return;

  const failed = getNormalFixFailures(item);
  const unfixable = [];
  for (const r of failed) {
    const check = item.meta.type === 'video' ? canAutoFixVideo(r) : canAutoFix(r);
    if (!check.fixable) unfixable.push({ rule: r, ...check });
  }

  if (!failed.length) {
    showUnfixableModal([{ rule: { label: '文件规格', current: '无可修复项', required: '格式 / 尺寸 / 体积需不通过' }, reason: '普通修复仅处理文件规格问题，请使用 AI 修复处理底色、底纹、LOGO / IP 位置等问题' }]);
    return;
  }

  if (unfixable.length === failed.length) {
    showUnfixableModal(unfixable);
    return;
  }

  currentFixContext = { item, spec, unfixable, fixResults: failed };
  renderFixModal(item, spec, unfixable, failed);
  $('#fixModal').hidden = false;
}

function showUnfixableModal(reasons) {
  manualCropEditor = null;
  $('#fixModal .modal__dialog')?.classList.remove('modal__dialog--wide');
  $('#fixModal .modal__title').textContent = '普通修复文件规格';
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

function renderFixModal(item, spec, unfixable, fixResults = getNormalFixFailures(item)) {
  const failed = fixResults;
  const dimFail = failed.find(r => r.field === 'dimensions');
  const sizeFail = failed.find(r => r.field === 'size');
  const formatFail = failed.find(r => r.field === 'format');
  const useManualCrop = dimFail && item.meta.type === 'image';

  manualCropEditor = null;
  $('#fixModal .modal__dialog')?.classList.toggle('modal__dialog--wide', !!useManualCrop);
  $('#fixModal .modal__title').textContent = useManualCrop ? '普通修复尺寸' : '普通修复文件规格';

  let html = `
    <div style="padding:10px 12px;background:var(--brand-soft);border:1px solid var(--brand-ring);border-radius:var(--r-sm);margin-bottom:14px;font-size:11.5px;color:var(--fg-2);">
      普通修复仅处理文件规格问题（格式、尺寸、体积）。底色、背景底纹、LOGO / IP 位置等请使用 AI 修复。
    </div>`;

  if (item.meta.type === 'video') {
    html += `
      <div style="padding:10px 12px;background:var(--brand-soft);border:1px solid var(--brand-ring);border-radius:var(--r-sm);margin-bottom:14px;font-size:11.5px;color:var(--fg-2);">
        首次修复视频需下载 FFmpeg.wasm（约 30MB），处理时间取决于视频大小。
      </div>`;
  }

  if (dimFail && Array.isArray(spec.variants) && spec.variants.length > 1) {
    html += `
      <div class="fix-group">
        <div class="fix-group__title">${useManualCrop ? '1. ' : ''}目标规格</div>
        <div class="fix-group__desc">${useManualCrop ? '先选择要裁剪输出的规格：' : '该素材位有多种尺寸，请选择要修复到哪一种：'}</div>
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
  } else if (useManualCrop) {
    const target = getFixTarget(spec, item.meta);
    html += `
      <div class="fix-group">
        <div class="fix-group__title">1. 目标规格</div>
        <div class="fix-option is-selected" style="cursor:default;">
          <div class="fix-option__text">
            <div class="fix-option__name">${target.width}×${target.height}</div>
          </div>
        </div>
      </div>`;
  }

  if (dimFail && useManualCrop) {
    html += renderManualCropEditor();
  } else if (dimFail) {
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
  $('#fixStartBtn').textContent = useManualCrop ? '确定裁剪' : '开始普通修复';
  $('#fixStartBtn').disabled = false;

  $$('.fix-option input[type="radio"]').forEach(input => {
    input.addEventListener('change', () => {
      const group = input.closest('.fix-options');
      group.querySelectorAll('.fix-option').forEach(o => o.classList.remove('is-selected'));
      input.closest('.fix-option').classList.add('is-selected');
      if (input.name === 'targetVariantId' && manualCropEditor?.ready) {
        updateManualCropTarget(true);
      }
    });
  });

  if (useManualCrop) initManualCropEditor(item, spec);
}

function renderManualCropEditor() {
  return `
    <div class="fix-group fix-crop-editor">
      <div class="fix-group__title">2. 裁剪调整</div>
      <div class="fix-group__desc">拖动画面调整位置，用滑杆缩放素材；蓝色为 LOGO 区，绿色为 IP / 主元素区。</div>
      <div class="crop-editor">
        <div class="crop-editor__stage">
          <canvas class="crop-editor__canvas" id="fixCropCanvas" aria-label="尺寸裁剪预览"></canvas>
        </div>
        <div class="crop-editor__controls">
          <label class="crop-editor__range">
            <span>缩放</span>
            <input type="range" id="fixCropScale" min="1" max="4" step="0.001" value="1" disabled />
          </label>
          <button class="btn btn--ghost btn--sm" type="button" id="fixCropReset">重置</button>
        </div>
        <div class="crop-editor__meta" id="fixCropMeta">正在加载素材…</div>
      </div>
    </div>`;
}

function initManualCropEditor(item, spec) {
  const canvas = $('#fixCropCanvas');
  const scaleInput = $('#fixCropScale');
  const resetBtn = $('#fixCropReset');
  const meta = $('#fixCropMeta');
  const startBtn = $('#fixStartBtn');
  if (!canvas || !scaleInput || !resetBtn || !meta) return;

  const editor = {
    item,
    spec,
    canvas,
    ctx: canvas.getContext('2d'),
    scaleInput,
    meta,
    img: null,
    target: null,
    ready: false,
    dragging: false,
    lastPoint: null,
    minScale: 1,
    maxScale: 4,
    scale: 1,
    x: 0,
    y: 0
  };
  manualCropEditor = editor;
  startBtn.disabled = true;

  loadImageElement(item.meta.objectUrl)
    .then(img => {
      if (manualCropEditor !== editor) return;
      editor.img = img;
      editor.ready = true;
      updateManualCropTarget(true);
      startBtn.disabled = false;
    })
    .catch(() => {
      if (manualCropEditor !== editor) return;
      meta.textContent = '素材加载失败，请重新上传后再试';
    });

  canvas.addEventListener('pointerdown', (e) => {
    if (!editor.ready) return;
    editor.dragging = true;
    editor.lastPoint = getCanvasPoint(canvas, e);
    canvas.classList.add('is-dragging');
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!editor.ready || !editor.dragging) return;
    const point = getCanvasPoint(canvas, e);
    editor.x += point.x - editor.lastPoint.x;
    editor.y += point.y - editor.lastPoint.y;
    editor.lastPoint = point;
    clampManualCropPosition();
    drawManualCropCanvas();
  });
  canvas.addEventListener('pointerup', (e) => endManualCropDrag(canvas, e));
  canvas.addEventListener('pointercancel', (e) => endManualCropDrag(canvas, e));
  canvas.addEventListener('wheel', (e) => {
    if (!editor.ready) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.94 : 1.06;
    setManualCropScale(editor.scale * factor, getCanvasPoint(canvas, e));
  }, { passive: false });

  scaleInput.addEventListener('input', () => {
    setManualCropScale(Number(scaleInput.value), {
      x: editor.target.width / 2,
      y: editor.target.height / 2
    });
  });
  resetBtn.addEventListener('click', () => updateManualCropTarget(true));
}

function endManualCropDrag(canvas, e) {
  if (!manualCropEditor) return;
  manualCropEditor.dragging = false;
  manualCropEditor.lastPoint = null;
  canvas.classList.remove('is-dragging');
  canvas.releasePointerCapture?.(e.pointerId);
}

function updateManualCropTarget(resetTransform = false) {
  const editor = manualCropEditor;
  if (!editor?.ready) return;

  const variantId = getSelectedTargetVariantId();
  const target = getFixTarget(editor.spec, editor.item.meta, variantId);
  const targetChanged = !editor.target || editor.target.width !== target.width || editor.target.height !== target.height;
  editor.target = target;
  editor.canvas.width = target.width;
  editor.canvas.height = target.height;

  editor.minScale = Math.max(target.width / editor.img.naturalWidth, target.height / editor.img.naturalHeight);
  editor.maxScale = Math.max(editor.minScale * 4, editor.minScale + 0.01, 1);
  editor.scaleInput.min = String(editor.minScale);
  editor.scaleInput.max = String(editor.maxScale);
  editor.scaleInput.disabled = false;

  if (resetTransform || targetChanged) {
    editor.scale = editor.minScale;
    editor.x = (target.width - editor.img.naturalWidth * editor.scale) / 2;
    editor.y = (target.height - editor.img.naturalHeight * editor.scale) / 2;
  } else {
    editor.scale = Math.min(editor.maxScale, Math.max(editor.minScale, editor.scale));
  }

  editor.scaleInput.value = String(editor.scale);
  clampManualCropPosition();
  drawManualCropCanvas();
  editor.meta.textContent = `目标 ${target.width}×${target.height} · 原图 ${editor.img.naturalWidth}×${editor.img.naturalHeight} · 可拖拽移动，滚轮或滑杆缩放`;
}

function getFixTarget(spec, meta, variantId) {
  if (Array.isArray(spec.variants) && spec.variants.length) {
    const variant = spec.variants.find(v => v.id === variantId) || spec.variants[0];
    return {
      width: variant.width,
      height: variant.height,
      variant,
      layoutZones: variant.layoutZones || []
    };
  }

  const dimRule = spec.rules.find(r => r.field === 'dimensions');
  return {
    width: dimRule?.width || meta.width,
    height: dimRule?.height || meta.height,
    variant: null,
    layoutZones: dimRule?.layoutZones || []
  };
}

function getSelectedTargetVariantId() {
  return $('input[name="targetVariantId"]:checked')?.value;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function getCanvasPoint(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * canvas.width / rect.width,
    y: (e.clientY - rect.top) * canvas.height / rect.height
  };
}

function setManualCropScale(nextScale, pivot) {
  const editor = manualCropEditor;
  if (!editor?.ready) return;
  const scale = Math.min(editor.maxScale, Math.max(editor.minScale, nextScale));
  const ratio = scale / editor.scale;
  editor.x = pivot.x - (pivot.x - editor.x) * ratio;
  editor.y = pivot.y - (pivot.y - editor.y) * ratio;
  editor.scale = scale;
  editor.scaleInput.value = String(scale);
  clampManualCropPosition();
  drawManualCropCanvas();
}

function clampManualCropPosition() {
  const editor = manualCropEditor;
  if (!editor?.ready) return;
  const drawW = editor.img.naturalWidth * editor.scale;
  const drawH = editor.img.naturalHeight * editor.scale;
  editor.x = drawW <= editor.target.width
    ? (editor.target.width - drawW) / 2
    : Math.min(0, Math.max(editor.target.width - drawW, editor.x));
  editor.y = drawH <= editor.target.height
    ? (editor.target.height - drawH) / 2
    : Math.min(0, Math.max(editor.target.height - drawH, editor.y));
}

function drawManualCropCanvas() {
  const editor = manualCropEditor;
  if (!editor?.ready) return;
  const { ctx, canvas, img, target } = editor;
  const drawW = img.naturalWidth * editor.scale;
  const drawH = img.naturalHeight * editor.scale;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, editor.x, editor.y, drawW, drawH);
  drawManualCropZones(ctx, target.layoutZones || []);
  ctx.save();
  ctx.strokeStyle = 'rgba(79, 124, 255, 0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  ctx.restore();
}

function drawManualCropZones(ctx, zones) {
  zones.forEach(zone => {
    const isLogo = /logo/i.test(zone.name);
    const color = isLogo ? '79, 124, 255' : '61, 203, 126';

    ctx.save();
    ctx.strokeStyle = `rgba(${color}, 0.95)`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(zone.left + 0.75, zone.top + 0.75, Math.max(1, zone.width - 1.5), Math.max(1, zone.height - 1.5));
    ctx.restore();
  });
}

function getManualCropPayload() {
  const editor = manualCropEditor;
  if (!editor?.ready) return null;
  return {
    x: editor.x,
    y: editor.y,
    width: editor.img.naturalWidth * editor.scale,
    height: editor.img.naturalHeight * editor.scale
  };
}

async function startFix() {
  if (!currentFixContext) return;
  const { item, spec, fixResults } = currentFixContext;
  const btn = $('#fixStartBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> 修复中…';

  try {
    const options = collectFixOptions();
    let result;
    const normalFixResults = fixResults || getNormalFixFailures(item);
    if (item.meta.type === 'image') {
      result = await fixImage(item.meta, spec, normalFixResults, options);
    } else if (item.meta.type === 'video') {
      result = await fixVideo(item.meta, spec, normalFixResults, options, (p) => {
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
    btn.textContent = manualCropEditor ? '确定裁剪' : '开始普通修复';
  }
}

async function startAiFix(itemId, trigger) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  const spec = getSpecById(item.specId);
  if (!spec) return;
  if (item.meta?.type !== 'image') {
    alert('AI 修复当前仅支持图片素材');
    return;
  }

  const btn = trigger;
  const originalHtml = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> AI修复中…';
  }

  try {
    const result = await fixImageWithHunyuan(item.meta, spec, item.validation.results, {
      matchedVariant: item.validation.matchedVariant
    });
    item.fixed = result;
    result.validation = validate(result.meta, spec);
    openPreviewModal(item);
  } catch (err) {
    alert('AI 修复失败：' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

function collectFixOptions() {
  const opts = {};
  $$('.fix-options').forEach(g => {
    const checked = g.querySelector('input[type="radio"]:checked');
    if (checked) opts[g.dataset.group] = checked.value;
  });
  $$('[data-fix-option]').forEach(input => {
    opts[input.dataset.fixOption] = input.value.trim();
  });
  const manualCrop = getManualCropPayload();
  if (manualCrop) {
    opts.dimensionMethod = 'manualCrop';
    opts.manualCrop = manualCrop;
    if (manualCropEditor.target?.variant?.id) opts.targetVariantId = manualCropEditor.target.variant.id;
  }
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
  const remainingIssues = renderRemainingValidationIssues(fixed.validation?.results || []);

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
    ${remainingIssues}
    ${fixed.warnings?.length ? `
      <div class="fix-log" style="background:var(--warn-soft);border-color:var(--warn-ring);">
        <div class="fix-log__title" style="color:var(--warn)">注意</div>
        <ul class="fix-log__list">${fixed.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>` : ''}`;
  $('#previewModal').hidden = false;
}

function renderRemainingValidationIssues(results) {
  const issues = results.filter(r => r.status !== 'pass');
  if (!issues.length) return '';
  return `
    <div class="fix-log" style="background:var(--bad-soft);border-color:var(--bad-ring);">
      <div class="fix-log__title" style="color:var(--bad)">${I.cross} 仍未通过的校验项</div>
      <ul class="fix-log__list">
        ${issues.map(r => `
          <li>
            <strong>${esc(r.label)}</strong>：当前 ${esc(r.current)}；要求 ${esc(r.required)}${r.tip ? `；${esc(r.tip)}` : ''}
          </li>
        `).join('')}
      </ul>
    </div>`;
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

/* ===== Modals ===== */
function initModals() {
  $$('[data-close]').forEach(el => {
    el.addEventListener('click', () => el.closest('.modal').hidden = true);
  });
  $('#fixStartBtn')?.addEventListener('click', startFix);
  $('#downloadFixedBtn')?.addEventListener('click', downloadFixed);
  $('#bannerGenerateBtn')?.addEventListener('click', startBannerGenerate);
}

/* ===== Init ===== */
function init() {
  initSidebarTree();
  initChecker();
  initGallery();
  initModals();
  updateSpecName();
  renderSpecPane();
}

init();
