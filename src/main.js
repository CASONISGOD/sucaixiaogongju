/**
 * Compliance Hub · SaaS Dark Admin
 */

import { getSpecById, getSpecTree, specs } from './data/specs.js';
import { readFileMeta, formatSize, extractAverageColorFromRegion } from './validators/meta.js';
import { validate } from './validators/engine.js';
import { fixImage, canAutoFix } from './fixers/image.js';
import { fixImageWithGptImage2, identifyImageTextsWithGptImage2 } from './fixers/ai.js';
import { fixVideo, canAutoFixVideo } from './fixers/video.js';
import { renderMarkdown } from './utils/markdown.js';
import { clearGalleryRecords, deleteGalleryRecord, listGalleryRecords, saveGalleryRecord } from './services/gallery.js';

/* ===== State ===== */
const state = {
  selectedSpecId: null,
  expandedCats: new Set(),
  items: [],
  galleryItems: [],
  templateMockups: {},
  templateMockupColors: {},
  templateMockupLoading: {},
  specBottomColors: {},
  detectingAllStartedAt: 0,
  detectingAllEstimateSeconds: 0
};

const DEFAULT_TEMPLATE_MOCKUP_COLOR = '#205AEF';
const GAME_CENTER_MOCKUP_SLOTS = {
  large: {
    title: '大尺寸标注图样机',
    mockupSrc: 'assets/image/4-9/biaozhu-1-样机.png',
    left: 24,
    top: 810,
    width: 660,
    height: 220
  },
  small: {
    title: '小尺寸标注图样机',
    mockupSrc: 'assets/image/4-9/biaozhu-2-样机.png',
    left: 24,
    top: 1040,
    width: 380,
    height: 220
  }
};

getSpecTree().forEach(cat => {
  if (!cat.empty) state.expandedCats.add(cat.id);
});

/* ===== Util ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function getAiOperationEstimateSeconds(meta, baseSeconds = 75) {
  const pixels = Number(meta?.width) * Number(meta?.height);
  const megapixels = Number.isFinite(pixels) && pixels > 0 ? pixels / 1_000_000 : 0;
  const sizeMb = Number(meta?.size) > 0 ? Number(meta.size) / (1024 * 1024) : 0;
  const estimate = baseSeconds + Math.ceil(megapixels) * 8 + Math.ceil(sizeMb) * 3;
  return Math.max(45, Math.min(180, estimate));
}

function formatCountdownTime(seconds) {
  if (seconds <= 0) return '即将完成';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs ? `${mins}分${secs}s` : `${mins}分钟`;
}

function startButtonCountdown(btn, label, seconds) {
  let remaining = Math.max(1, Math.round(seconds));
  let stopped = false;

  btn.innerHTML = `<span class="loading"></span><span>${esc(label)}</span><span class="btn__countdown"></span>`;
  const countdownEl = btn.querySelector('.btn__countdown');

  const render = () => {
    const countdown = remaining > 0 ? `预计 ${formatCountdownTime(remaining)}` : `预计${formatCountdownTime(0)}`;
    if (countdownEl) countdownEl.textContent = countdown;
  };
  render();

  const timer = window.setInterval(() => {
    if (stopped || !document.body.contains(btn)) {
      window.clearInterval(timer);
      return;
    }
    remaining -= 1;
    render();
  }, 1000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

function getDetectionEstimateSeconds(meta, spec) {
  const needsAiText = spec?.fileType === 'image' && meta?.type === 'image' && meta.file;
  const pixels = Number(meta?.width) * Number(meta?.height);
  const megapixels = Number.isFinite(pixels) && pixels > 0 ? pixels / 1_000_000 : 0;
  const sizeMb = Number(meta?.size) > 0 ? Number(meta.size) / (1024 * 1024) : 0;
  const estimate = (needsAiText ? 35 : 8) + Math.ceil(megapixels) * 4 + Math.ceil(sizeMb) * 2;
  return needsAiText ? Math.max(20, Math.min(90, estimate)) : Math.max(5, Math.min(30, estimate));
}

function getRemainingSeconds(startedAt, estimateSeconds) {
  const started = Number(startedAt);
  const estimate = Math.max(1, Math.round(Number(estimateSeconds) || 1));
  if (!started) return estimate;
  const elapsed = Math.floor((Date.now() - started) / 1000);
  return Math.max(0, estimate - elapsed);
}

function renderCountdownSuffix(startedAt, estimateSeconds) {
  const remaining = getRemainingSeconds(startedAt, estimateSeconds);
  return `<span class="btn__countdown">预计 ${formatCountdownTime(remaining)}</span>`;
}

let detectionCountdownTimer = null;

function syncDetectionCountdownTimer() {
  const active = state.detectingAll || state.items.some(item => item.status === 'detecting');
  if (active && !detectionCountdownTimer) {
    detectionCountdownTimer = window.setInterval(renderCheckerBody, 1000);
  } else if (!active && detectionCountdownTimer) {
    window.clearInterval(detectionCountdownTimer);
    detectionCountdownTimer = null;
  }
}

const I = {
  check: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  warn: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><line x1="12" y1="5.5" x2="12" y2="14.5"/><line x1="12" y1="19" x2="12.01" y2="19"/></svg>',
  cross: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  wrench: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  chevron: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>',
  sparkles: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.7a2 2 0 0 1-1.3 1.3L3 12l5.7 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.7a2 2 0 0 1 1.3-1.3L21 12l-5.7-1.9a2 2 0 0 1-1.3-1.3z"/></svg>',
  upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  back: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>'
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
  renderCheckerBody();
}

function updateSpecName() {
  const spec = getSpecById(state.selectedSpecId);
  const title = state.items.length ? '素材检测与修改' : (spec ? spec.name : '');
  const t1 = $('#specSelectText');
  if (t1) t1.textContent = title;
  $('.panel__head')?.classList.toggle('is-empty', !title);
}

function getDefaultDisplaySpec() {
  for (const cat of getSpecTree()) {
    for (const group of cat.subGroups) {
      if (group.specs.length) return group.specs[0];
    }
  }
  return null;
}

function getSpecPaneSpec() {
  return getSpecById(state.selectedSpecId) || getDefaultDisplaySpec();
}

/* ===== Spec Pane（下方规范区） ===== */
function renderSpecPane() {
  const spec = getSpecPaneSpec();
  const pane = $('#specPane');
  pane.innerHTML = spec?.markdown
    ? `<div class="md md--spec" data-spec-id="${esc(spec.id || '')}">${renderMarkdown(spec.markdown)}</div>`
    : '';
  groupSpecExampleRows(pane);
  groupSpecSections(pane);
  applySpecOutputDemoScale(pane, spec);
  groupSpecAnnotationMockupRows(pane);
  groupSpecTemplateMockupRows(pane);
  applySpecTemplateMockupPreviewAsset(pane, spec);
  bindSpecTemplateMockups(pane, spec?.id);
  bindSpecImagePreview(pane);
  applyDetectedBottomColorToSpecPane(pane, spec?.id);
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

function applySpecOutputDemoScale(pane, spec) {
  const sections = Array.from(pane.querySelectorAll('.md-section'));
  sections.forEach(section => {
    const heading = Array.from(section.children).find(node => node.tagName === 'H1');
    const title = heading?.textContent.trim() || '';
    const shouldScale = title === '输出示意'
      || (spec?.id === 'platform-new-home-hero' && /^输出[一二三四五六七八九十]/.test(title));
    if (!shouldScale) return;

    section.classList.add('md-section--half-size-media');
    section.querySelectorAll('figure img, figure video').forEach(media => {
      applyMediaDisplayScale(media, 0.5);
      if (media.tagName === 'IMG' && !media.complete) {
        media.addEventListener('load', () => applyMediaDisplayScale(media, 0.5), { once: true });
      }
      if (media.tagName === 'VIDEO' && !media.videoWidth) {
        media.addEventListener('loadedmetadata', () => applyMediaDisplayScale(media, 0.5), { once: true });
      }
    });
  });
}

function applyMediaDisplayScale(media, scale) {
  const width = media.naturalWidth || media.videoWidth;
  if (!width || !Number.isFinite(scale)) return;
  media.style.width = `${Math.round(width * scale)}px`;
  media.style.height = 'auto';
  media.style.maxWidth = '100%';
}

function groupSpecExampleRows(pane) {
  const headings = Array.from(pane.querySelectorAll('h2'));
  headings.forEach(heading => {
    if (!heading.textContent.includes('banner') && !heading.textContent.includes('首页头图')) return;
    const row = document.createElement('div');
    row.className = 'md-example-row';
    let node = heading.nextElementSibling;
    while (node && !/^H[12]$/.test(node.tagName)) {
      const next = node.nextElementSibling;
      if (node.tagName === 'FIGURE') {
        node.classList.add('md-figure--example');
        row.appendChild(node);
      }
      node = next;
    }
    if (row.children.length) heading.after(row);
  });
}

function groupSpecAnnotationMockupRows(pane) {
  pane.querySelectorAll('.md-section').forEach(section => {
    const figure = Array.from(section.children).find(node => (
      node.tagName === 'FIGURE'
      && node.querySelector('figcaption')?.textContent.trim() === '标注图'
    ));
    const mockup = Array.from(section.children).find(node => (
      node.classList?.contains('template-mockup')
      && getTemplateMockupTitle(node).includes('标注图样机')
    ));
    if (!figure || !mockup) return;

    const row = document.createElement('div');
    const head = mockup.querySelector('.template-mockup__head');
    const upload = head?.querySelector('.template-mockup__upload');
    const download = figure.querySelector('.md-download-link');
    const actions = document.createElement('div');

    row.className = 'md-annotation-mockup-row';
    actions.className = 'template-mockup__actions';
    mockup.classList.add('template-mockup--annotation');
    if (figure.classList.contains('md-figure--annotation-large')) {
      mockup.classList.add('template-mockup--annotation-large');
    }
    if (figure.classList.contains('md-figure--annotation-small')) {
      mockup.classList.add('template-mockup--annotation-small');
    }
    if (download) {
      download.classList.remove('md-download-link--caption');
      download.classList.add('template-mockup__download');
      actions.appendChild(download);
    }
    if (upload) actions.appendChild(upload);
    if (head && actions.children.length) head.appendChild(actions);

    figure.before(row);
    row.append(mockup);
    figure.remove();
  });
}

function groupSpecTemplateMockupRows(pane) {
  pane.querySelectorAll('.md-section').forEach(section => {
    const heading = Array.from(section.children).find(node => node.tagName === 'H1');
    if (!heading?.textContent.includes('模板样机')) return;

    const mockups = Array.from(section.children).filter(node => node.classList?.contains('template-mockup'));
    if (!mockups.length) return;

    const row = document.createElement('div');
    row.className = 'template-mockup-row';
    mockups[0].before(row);
    mockups.forEach((mockup, index) => {
      mockup.classList.toggle('template-mockup--synced', index > 0);
      row.appendChild(mockup);
    });
  });
}

function applySpecTemplateMockupPreviewAsset(pane, spec) {
  const config = spec?.templateMockupPreviewAsset;
  if (!config) return;
  pane.querySelectorAll('[data-template-mode="image"], [data-template-mode="game-center"]').forEach(block => {
    if (block.dataset.templateMode === 'game-center') {
      const largeSrc = resolveTemplateMockupPreviewAsset(config, '大尺寸');
      const smallSrc = resolveTemplateMockupPreviewAsset(config, '小尺寸');
      if (largeSrc) block.dataset.defaultLargeAssetSrc = largeSrc;
      if (smallSrc) block.dataset.defaultSmallAssetSrc = smallSrc;
      return;
    }

    const src = resolveTemplateMockupPreviewAsset(config, block);
    if (src) block.dataset.defaultAssetSrc = src;
  });
}

function resolveTemplateMockupPreviewAsset(config, blockOrTitle) {
  if (typeof config === 'string') return config;
  const title = typeof blockOrTitle === 'string' ? blockOrTitle : getTemplateMockupTitle(blockOrTitle);
  const matched = config.byTitle?.find(item => title.includes(item.includes));
  return matched?.src || config.default || '';
}

function getTemplateMockupTitle(block) {
  return block?.dataset.mockupTitle || block?.querySelector('.template-mockup__title')?.textContent?.trim() || '模板样机';
}

function normalizeTemplateMockupColor(value) {
  const raw = String(value || '').trim().toUpperCase();
  const color = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9A-F]{6}$/.test(color) ? color : '';
}

function setDetectedBottomColor(specId, colorInfo) {
  const color = normalizeTemplateMockupColor(colorInfo?.hex);
  if (!specId || !color) return;
  state.specBottomColors[specId] = { ...colorInfo, hex: color };
  applyDetectedBottomColorToSpecPane($('#specPane'), specId);
}

function applyDetectedBottomColorToSpecPane(pane, specId) {
  const color = normalizeTemplateMockupColor(state.specBottomColors[specId]?.hex);
  if (!pane || !color) return;

  const palette = findHeadBottomColorPalette(pane);
  const chip = palette?.querySelector('[data-copy-color]');
  if (!chip) return;

  chip.dataset.copyColor = color;
  chip.setAttribute('aria-label', `复制色值 ${color}`);
  chip.setAttribute('title', `点击复制 ${color}`);
  const swatch = chip.querySelector('.md-color-chip__swatch');
  const value = chip.querySelector('.md-color-chip__value');
  if (swatch) swatch.style.background = color;
  if (value) value.textContent = color;
}

function findHeadBottomColorPalette(pane) {
  const sections = Array.from(pane.querySelectorAll('.md-section'));
  const targetSection = sections.find(section => {
    const heading = Array.from(section.children).find(node => node.tagName === 'H1');
    const text = heading?.textContent || '';
    return text.includes('输出二') && text.includes('色值');
  });
  return targetSection?.querySelector('.md-color-palette') || pane.querySelector('.md-color-palette');
}

function getTemplateMockupColor(specId) {
  return state.templateMockupColors[specId] || DEFAULT_TEMPLATE_MOCKUP_COLOR;
}

function applyTemplateMockupColor(block, color, syncInput = false) {
  const fill = block.querySelector('[data-template-color-fill]');
  const input = block.querySelector('[data-template-color-input]');
  block.dataset.mockupColor = color;
  if (fill) fill.style.background = color;
  if (syncInput && input && input.value !== color) input.value = color;
}

function bindTemplateColorMockup(block, specId) {
  const input = block.querySelector('[data-template-color-input]');
  const hasCustomColor = Boolean(state.templateMockupColors[specId]);
  const color = getTemplateMockupColor(specId);
  applyTemplateMockupColor(block, color, hasCustomColor);
  if (input && !hasCustomColor) input.value = '';

  input?.addEventListener('input', () => {
    const nextColor = normalizeTemplateMockupColor(input.value);
    input.classList.toggle('is-invalid', Boolean(input.value.trim()) && !nextColor);
    if (!nextColor) return;

    state.templateMockupColors[specId] = nextColor;
    document.querySelectorAll('[data-template-mode="color"]').forEach(item => applyTemplateMockupColor(item, nextColor, true));
  });

  input?.addEventListener('blur', () => {
    const nextColor = normalizeTemplateMockupColor(input.value);
    input.classList.remove('is-invalid');
    if (nextColor) {
      state.templateMockupColors[specId] = nextColor;
      document.querySelectorAll('[data-template-mode="color"]').forEach(item => applyTemplateMockupColor(item, nextColor, true));
      return;
    }

    delete state.templateMockupColors[specId];
    input.value = '';
    applyTemplateMockupColor(block, getTemplateMockupColor(specId));
  });

  const canvas = block.querySelector('.template-mockup__canvas');
  if (canvas) {
    const title = getTemplateMockupTitle(block);
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('aria-label', `点击放大查看${title}`);
    canvas.addEventListener('click', () => openTemplateMockupPreview(block));
    canvas.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openTemplateMockupPreview(block);
    });
  }
}

function bindGameCenterMockup(block, specId) {
  const assets = {};
  let loadingFileName = '';

  Object.keys(GAME_CENTER_MOCKUP_SLOTS).forEach(slot => {
    const assetKey = getGameCenterMockupAssetKey(specId, slot);
    const current = assetKey ? state.templateMockups[assetKey] : null;
    const loading = assetKey ? state.templateMockupLoading[assetKey] : null;
    const defaultSrc = slot === 'large' ? block.dataset.defaultLargeAssetSrc : block.dataset.defaultSmallAssetSrc;
    const previewAsset = current?.url
      ? current
      : defaultSrc
        ? { url: defaultSrc, fileName: defaultSrc.split('/').pop() || '默认预览素材' }
        : null;
    const img = block.querySelector(`[data-template-asset="${slot}"]`);
    const input = block.querySelector(`[data-template-slot-input="${slot}"]`);

    assets[slot] = previewAsset;
    if (previewAsset?.url && img) {
      img.src = previewAsset.url;
      img.hidden = false;
    } else if (img) {
      img.removeAttribute('src');
      img.hidden = true;
    }
    if (input) input.disabled = Boolean(loading);
    if (loading?.fileName) loadingFileName = loading.fileName;

    input?.addEventListener('change', e => {
      setTemplateMockupAsset(specId, assetKey, e.target.files?.[0]);
      e.target.value = '';
    });
  });

  const loadingBox = block.querySelector('[data-template-loading]');
  const loadingText = block.querySelector('[data-template-loading-text]');
  block.classList.toggle('is-loading', Boolean(loadingFileName));
  if (loadingBox) loadingBox.hidden = !loadingFileName;
  if (loadingText && loadingFileName) loadingText.textContent = `正在加载 ${loadingFileName}…`;

  const canvas = block.querySelector('.template-mockup__canvas');
  if (canvas) {
    const title = getTemplateMockupTitle(block);
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('aria-label', `点击放大查看${title}`);
    canvas.addEventListener('click', () => openGameCenterMockupPreview(block, assets));
    canvas.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openGameCenterMockupPreview(block, assets);
    });
  }
}

function bindSpecTemplateMockups(pane, specId = state.selectedSpecId) {
  pane.querySelectorAll('[data-template-mockup]').forEach(block => {
    if (block.dataset.templateMode === 'color') {
      bindTemplateColorMockup(block, specId);
      return;
    }
    if (block.dataset.templateMode === 'game-center') {
      bindGameCenterMockup(block, specId);
      return;
    }

    const assetKey = getTemplateMockupAssetKey(specId, block);
    const current = assetKey ? state.templateMockups[assetKey] : null;
    const loading = block.dataset.templateMode === 'image' && assetKey ? state.templateMockupLoading[assetKey] : null;
    const defaultAssetSrc = block.dataset.defaultAssetSrc || '';
    const previewAsset = current?.url
      ? current
      : defaultAssetSrc
        ? { url: defaultAssetSrc, fileName: defaultAssetSrc.split('/').pop() || '默认预览素材' }
        : null;
    const input = block.querySelector('.template-mockup__input');
    const asset = block.querySelector('[data-template-asset]');
    const empty = block.querySelector('[data-template-empty]');
    const fileLabel = block.querySelector('[data-template-file]');
    const loadingBox = block.querySelector('[data-template-loading]');
    const loadingText = block.querySelector('[data-template-loading-text]');

    if (previewAsset?.url && asset) {
      asset.src = previewAsset.url;
      asset.hidden = false;
      if (empty) empty.hidden = true;
      if (fileLabel) fileLabel.textContent = current?.url ? `当前素材：${current.fileName}` : `预览素材：${previewAsset.fileName}`;
      block.classList.add('has-asset');
      block.classList.toggle('has-default-asset', !current?.url);
    } else {
      if (asset) {
        asset.removeAttribute('src');
        asset.hidden = true;
      }
      if (empty) empty.hidden = Boolean(loading);
      if (fileLabel) fileLabel.textContent = '尚未上传素材';
      block.classList.remove('has-asset', 'has-default-asset');
    }

    block.classList.toggle('is-loading', Boolean(loading));
    if (input) input.disabled = Boolean(loading);
    if (loadingBox) loadingBox.hidden = !loading;
    if (loadingText && loading?.fileName) loadingText.textContent = `正在加载 ${loading.fileName}…`;

    const canvas = block.querySelector('.template-mockup__canvas');
    if (canvas) {
      const title = getTemplateMockupTitle(block);
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'button');
      canvas.setAttribute('aria-label', `点击放大查看${title}`);
      canvas.addEventListener('click', () => openTemplateMockupPreview(block, previewAsset));
      canvas.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openTemplateMockupPreview(block, previewAsset);
      });
    }

    input?.addEventListener('change', e => {
      setTemplateMockupAsset(specId, assetKey, e.target.files?.[0]);
      e.target.value = '';
    });
  });
}

function getGameCenterMockupAssetKey(specId, slot) {
  const config = GAME_CENTER_MOCKUP_SLOTS[slot];
  if (!specId || !config) return '';
  return `${specId}:${config.title}:${config.mockupSrc}`;
}

function getTemplateMockupAssetKey(specId, block) {
  if (!specId) return '';
  const title = getTemplateMockupTitle(block);
  if (block?.classList.contains('template-mockup--annotation') && title !== '标注图样机') {
    return `${specId}:${title}:${block.dataset.mockupSrc || ''}`;
  }
  return specId;
}

async function setTemplateMockupAsset(specId, assetKey, file) {
  if (!specId || !assetKey || !file) return;
  if (!file.type.startsWith('image/')) {
    alert('请上传图片文件');
    return;
  }

  const token = uid();
  const nextUrl = URL.createObjectURL(file);
  state.templateMockupLoading[assetKey] = { token, fileName: file.name };
  renderSpecPane();

  try {
    const img = await loadTemplateMockupImage(nextUrl);
    if (state.templateMockupLoading[assetKey]?.token !== token) {
      URL.revokeObjectURL(nextUrl);
      return;
    }

    const previous = state.templateMockups[assetKey];
    if (previous?.url) URL.revokeObjectURL(previous.url);

    state.templateMockups[assetKey] = {
      fileName: file.name,
      url: nextUrl
    };
    setDetectedBottomColor(specId, extractAverageColorFromRegion(img));
    showCopyToast(assetKey === specId ? '已同步到全部模板样机' : '已应用到当前标注图样机');
  } catch (err) {
    URL.revokeObjectURL(nextUrl);
    alert('无法读取图片：' + file.name);
  } finally {
    if (state.templateMockupLoading[assetKey]?.token === token) {
      delete state.templateMockupLoading[assetKey];
      renderSpecPane();
    }
  }
}

async function openTemplateMockupPreview(block, current) {
  const frame = block.querySelector('.template-mockup__frame');
  const frameSrc = frame?.currentSrc || frame?.src;
  const title = getTemplateMockupTitle(block);
  if (!frameSrc) return;

  if (block.dataset.templateMode === 'color') {
    openTemplateColorMockupPreview(block, frameSrc, title);
    return;
  }

  if (!current?.url) {
    openImageLightboxFromSrc(frameSrc, title);
    return;
  }

  try {
    const [frameImg, assetImg] = await Promise.all([
      loadTemplateMockupImage(frameSrc),
      loadTemplateMockupImage(current.url)
    ]);
    const canvas = document.createElement('canvas');
    const width = frameImg.naturalWidth || frameImg.width;
    const height = frameImg.naturalHeight || frameImg.height;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (block.classList.contains('template-mockup--annotation')) {
      drawContainedImage(ctx, assetImg, 0, 0, width, height);
    } else {
      ctx.drawImage(assetImg, 0, 0, width, assetImg.height * (width / assetImg.width));
    }
    ctx.drawImage(frameImg, 0, 0, width, height);
    openImageLightboxFromSrc(canvas.toDataURL('image/png'), `${title}预览`);
  } catch (err) {
    console.warn('模板样机放大预览失败', err);
    openImageLightboxFromSrc(frameSrc, title);
  }
}

function drawContainedImage(ctx, img, x, y, width, height) {
  const imgWidth = img.naturalWidth || img.width;
  const imgHeight = img.naturalHeight || img.height;
  if (!imgWidth || !imgHeight || !width || !height) return;
  const scale = Math.min(width / imgWidth, height / imgHeight);
  const drawWidth = imgWidth * scale;
  const drawHeight = imgHeight * scale;
  ctx.drawImage(img, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('无法生成标注示意图'));
    }, 'image/png');
  });
}

async function openGameCenterMockupPreview(block, assets) {
  const frame = block.querySelector('.template-mockup__frame');
  const frameSrc = frame?.currentSrc || frame?.src;
  const title = getTemplateMockupTitle(block);
  if (!frameSrc) return;

  try {
    const entries = Object.entries(GAME_CENTER_MOCKUP_SLOTS);
    const [frameImg, ...bannerImgs] = await Promise.all([
      loadTemplateMockupImage(frameSrc),
      ...entries.map(([slot]) => assets[slot]?.url ? loadTemplateMockupImage(assets[slot].url) : Promise.resolve(null))
    ]);
    const canvas = document.createElement('canvas');
    const width = frameImg.naturalWidth || frameImg.width;
    const height = frameImg.naturalHeight || frameImg.height;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    entries.forEach(([slot, config], index) => {
      const img = bannerImgs[index];
      if (!img) return;
      ctx.drawImage(img, config.left, config.top, config.width, config.height);
    });
    ctx.drawImage(frameImg, 0, 0, width, height);
    openImageLightboxFromSrc(canvas.toDataURL('image/png'), `${title}预览`);
  } catch (err) {
    console.warn('游戏中心样机放大预览失败', err);
    openImageLightboxFromSrc(frameSrc, title);
  }
}

async function openTemplateColorMockupPreview(block, frameSrc, title) {
  try {
    const frameImg = await loadTemplateMockupImage(frameSrc);
    const canvas = document.createElement('canvas');
    const width = frameImg.naturalWidth || frameImg.width;
    const height = frameImg.naturalHeight || frameImg.height;
    const topHeight = width * (216 / 750);
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = normalizeTemplateMockupColor(block.dataset.mockupColor) || DEFAULT_TEMPLATE_MOCKUP_COLOR;
    ctx.fillRect(0, 0, width, topHeight);
    ctx.drawImage(frameImg, 0, 0, width, height);
    openImageLightboxFromSrc(canvas.toDataURL('image/png'), `${title}预览`);
  } catch (err) {
    console.warn('头部底色样机放大预览失败', err);
    openImageLightboxFromSrc(frameSrc, title);
  }
}

function loadTemplateMockupImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
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

async function openCheckVisualPreview(el) {
  if (el.classList.contains('check-marker-preview')) {
    await openCheckMarkerPreview(el);
    return true;
  }
  if (el.classList.contains('check-annotation-preview')) {
    await openCheckAnnotationPreview(el);
    return true;
  }
  return false;
}

async function openCheckAnnotationPreview(el) {
  const assetSrc = getImageSrc(el.querySelector('.check-annotation-preview__asset'));
  const overlaySrc = getImageSrc(el.querySelector('.check-annotation-preview__overlay')) || el.dataset.src;
  if (!assetSrc || !overlaySrc) {
    openImageLightboxFromSrc(overlaySrc || assetSrc, '安全区标注图预览');
    return;
  }

  try {
    const [assetImg, overlayImg] = await Promise.all([
      loadTemplateMockupImage(assetSrc),
      loadTemplateMockupImage(overlaySrc)
    ]);
    const width = assetImg.naturalWidth || assetImg.width;
    const height = assetImg.naturalHeight || assetImg.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(assetImg, 0, 0, width, height);
    drawContainedImage(ctx, overlayImg, 0, 0, width, height);
    openImageLightboxFromSrc(canvas.toDataURL('image/png'), '安全区标注图预览');
  } catch (err) {
    console.warn('安全区预览放大失败', err);
    openImageLightboxFromSrc(overlaySrc || assetSrc, '安全区标注图预览');
  }
}

async function openCheckMarkerPreview(el) {
  const src = getImageSrc(el.querySelector('img')) || el.dataset.src;
  if (!src) return;

  try {
    const img = await loadTemplateMockupImage(src);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    el.querySelectorAll('.check-marker-preview__rect').forEach(rect => drawCheckMarker(ctx, rect, width, height));
    openImageLightboxFromSrc(canvas.toDataURL('image/png'), '标注位置预览');
  } catch (err) {
    console.warn('标注位置预览放大失败', err);
    openImageLightboxFromSrc(src, '标注位置预览');
  }
}

function getImageSrc(img) {
  return img?.currentSrc || img?.src || '';
}

function drawCheckMarker(ctx, rect, canvasWidth, canvasHeight) {
  const left = parsePercent(rect.style.left) / 100 * canvasWidth;
  const top = parsePercent(rect.style.top) / 100 * canvasHeight;
  const width = Math.max(1, parsePercent(rect.style.width) / 100 * canvasWidth);
  const height = Math.max(1, parsePercent(rect.style.height) / 100 * canvasHeight);

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(0, 0, canvasWidth, top);
  ctx.fillRect(0, top + height, canvasWidth, canvasHeight - top - height);
  ctx.fillRect(0, top, left, height);
  ctx.fillRect(left + width, top, canvasWidth - left - width, height);

  const lineWidth = Math.max(2, Math.round(canvasWidth / 360));
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = 'rgba(255, 82, 82, 0.95)';
  ctx.fillStyle = 'rgba(255, 82, 82, 0.32)';
  ctx.fillRect(left, top, width, height);
  ctx.strokeRect(left + lineWidth / 2, top + lineWidth / 2, Math.max(0, width - lineWidth), Math.max(0, height - lineWidth));

  const label = rect.textContent.trim();
  if (label) drawCheckMarkerLabel(ctx, label, left, top, canvasWidth);
  ctx.restore();
}

function drawCheckMarkerLabel(ctx, label, left, top, canvasWidth) {
  const fontSize = Math.max(12, Math.round(canvasWidth * 0.025));
  const padX = Math.round(fontSize * 0.5);
  const padY = Math.round(fontSize * 0.25);
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const labelWidth = Math.ceil(ctx.measureText(label).width + padX * 2);
  const labelHeight = fontSize + padY * 2;
  const x = Math.min(Math.max(0, left), Math.max(0, canvasWidth - labelWidth));
  const y = top >= labelHeight + 3 ? top - labelHeight - 3 : top + 3;
  ctx.fillStyle = 'rgba(255, 82, 82, 0.95)';
  ctx.fillRect(x, y, labelWidth, labelHeight);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX, y + labelHeight / 2);
}

function parsePercent(value) {
  const n = Number.parseFloat(String(value || '').replace('%', ''));
  return Number.isFinite(n) ? n : 0;
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

async function saveAiFixResultToGallery(item, spec, result, { mode = 'ai-fix', prompt = '' } = {}) {
  if (!result?.blob || !result?.meta) return;
  const meta = result.meta;
  const variant = result.validation?.matchedVariant || item.validation?.matchedVariant || null;
  const createdAt = Date.now();
  const record = {
    id: uid(),
    name: result.filename || meta.name || buildAiGalleryFilename(item.meta?.name, mode, meta.format),
    blob: result.blob,
    mimeType: result.blob.type || `image/${meta.format === 'jpg' ? 'jpeg' : meta.format || 'png'}`,
    width: meta.width,
    height: meta.height,
    size: result.blob.size || meta.size,
    format: meta.format || 'png',
    specId: spec?.id || item.specId || state.selectedSpecId,
    specName: spec?.shortName || spec?.name || '',
    variantName: variant?.name || '',
    dominantColor: meta.dominantColor || null,
    backgroundTexture: meta.backgroundTexture || null,
    createdAt,
    generatedInfo: {
      source: mode,
      prompt,
      sourceName: item.meta?.name || '',
      model: 'GPT Image2'
    }
  };
  const records = [record];
  const mockup = result.complianceMockup;
  if (mockup?.blob && mockup?.meta) {
    records.push({
      id: uid(),
      name: mockup.filename || buildComplianceMockupFilename(record.name, mode),
      blob: mockup.blob,
      mimeType: mockup.blob.type || 'image/png',
      width: mockup.meta.width,
      height: mockup.meta.height,
      size: mockup.blob.size || mockup.meta.size,
      format: mockup.meta.format || 'png',
      specId: record.specId,
      specName: record.specName,
      variantName: record.variantName,
      dominantColor: mockup.meta.dominantColor || null,
      backgroundTexture: mockup.meta.backgroundTexture || null,
      createdAt: createdAt - 1,
      generatedInfo: {
        source: `${mode}-annotation`,
        prompt: `叠加标注图示意：${prompt}`,
        sourceName: record.name,
        model: 'Canvas',
        relatedImageId: record.id,
        annotationSrc: mockup.annotationSrc || ''
      }
    });
  }
  await Promise.all(records.map(saveGalleryRecord));
  await refreshGallery({ render: !$('#galleryModal')?.hidden });
}

function buildAiGalleryFilename(sourceName = 'source.png', mode = 'ai-fix', format = 'png') {
  const base = String(sourceName || 'source').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
  const suffix = mode === 'copy-edit' ? 'ai_copy' : 'ai_fix';
  return `${base}_${suffix}_${Date.now()}.${format || 'png'}`;
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
  const sourceTag = String(item.generatedInfo?.source || '').endsWith('-annotation')
    ? '<span class="tag tag--ok">标注示意</span>'
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
            ${sourceTag}
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
  const spec = getSpecById(item.specId) || findSpecMatchForMeta(meta)?.spec;
  state.items.push({
    id: uid(),
    meta,
    validation: spec ? validate(meta, spec) : createAutoMatchFailure(meta),
    fixed: null,
    specId: spec?.id || null,
    generated: true,
    generatedInfo: item.generatedInfo || null
  });
  renderCheckerBody();
  showCopyToast('已加入检测列表');
}

/* ===== Checker ===== */
function initChecker() {
  renderCheckerBody();
  bindDropzoneGlobal();
  bindPasteUploadGlobal();

  $('#fileInput').addEventListener('change', (e) => {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
  });
}

function openFilePicker() {
  const input = $('#fileInput');
  if (!input) return;
  input.value = '';
  input.click();
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

function bindPasteUploadGlobal() {
  document.addEventListener('paste', (e) => {
    if (isTypingTarget(e.target)) return;
    const files = getClipboardFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    handleFiles(files);
  });
}

function isTypingTarget(target) {
  const el = target instanceof Element ? target : null;
  return !!el?.closest('input, textarea, [contenteditable="true"]');
}

function getClipboardFiles(clipboardData) {
  if (!clipboardData) return [];
  const directFiles = Array.from(clipboardData.files || []).filter(Boolean);
  const itemFiles = Array.from(clipboardData.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter(Boolean);
  return (directFiles.length ? directFiles : itemFiles).map(normalizePastedFile);
}

function normalizePastedFile(file, index = 0) {
  const hasName = file.name && !/^image\.(png|jpe?g|webp|gif)$/i.test(file.name);
  if (hasName) return file;
  const ext = getFileExtensionFromMime(file.type) || 'png';
  const name = `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}${index ? `-${index + 1}` : ''}.${ext}`;
  return new File([file], name, { type: file.type || `image/${ext}`, lastModified: Date.now() });
}

function getFileExtensionFromMime(mime = '') {
  const type = String(mime).toLowerCase();
  if (type.includes('jpeg')) return 'jpg';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('quicktime')) return 'mov';
  return '';
}

function getUploadFileKind(file) {
  const mime = String(file?.type || '').toLowerCase();
  const ext = String(file?.name || '').split('.').pop()?.toLowerCase() || '';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif', 'heic', 'heif'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v', 'avi'].includes(ext)) return 'video';
  return '';
}

async function handleFiles(files) {
  const pending = [];
  for (const file of files) {
    const kind = getUploadFileKind(file);
    if (!kind) { addErrorItem(file, '暂不支持的文件类型'); continue; }

    const id = uid();
    state.items.push({
      id,
      status: 'loading',
      meta: { name: file.name, size: file.size, type: kind },
      validation: null,
      fixed: null,
      specId: null
    });
    pending.push({ id, file });
  }
  renderCheckerBody();

  await Promise.all(pending.map(async ({ id, file }) => {
    try {
      const meta = await readFileMeta(file);
      const match = findSpecMatchForMeta(meta);
      const idx = state.items.findIndex(i => i.id === id);
      if (idx === -1) return;

      state.items[idx] = {
        id,
        status: 'uploaded',
        meta,
        validation: null,
        fixed: null,
        specId: match?.spec?.id || null,
        autoMatchedSpecId: match?.spec?.id || null,
        autoMatchedVariantId: match?.variant?.id || null,
        autoMatchFailed: !match
      };
      if (match?.spec && meta.type === 'image') {
        setDetectedBottomColor(match.spec.id, meta.bottomCenterAverageColor);
      }
    } catch (err) {
      const idx = state.items.findIndex(i => i.id === id);
      if (idx !== -1) {
        state.items[idx] = {
          id,
          status: 'error',
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

function findSpecMatchForMeta(meta) {
  if (!meta?.width || !meta?.height || !meta?.type) return null;
  const candidates = specs
    .filter(spec => spec.fileType === meta.type)
    .flatMap(spec => getSpecDimensionTargets(spec).map(target => ({ spec, variant: target.variant, target })));
  return candidates.find(({ target }) => target.width === meta.width && target.height === meta.height) || null;
}

function getSpecDimensionTargets(spec) {
  if (Array.isArray(spec?.variants) && spec.variants.length) {
    return spec.variants
      .filter(variant => variant.width && variant.height)
      .map(variant => ({ width: variant.width, height: variant.height, variant }));
  }
  const dimRule = spec?.rules?.find(rule => rule.field === 'dimensions');
  if (Array.isArray(dimRule?.options) && dimRule.options.length) {
    return dimRule.options
      .filter(option => option.width && option.height)
      .map(option => ({ width: option.width, height: option.height, variant: null }));
  }
  if (dimRule?.width && dimRule?.height) return [{ width: dimRule.width, height: dimRule.height, variant: null }];
  return [];
}

function createAutoMatchFailure(meta) {
  const current = meta?.width && meta?.height ? `${meta.width}×${meta.height}` : '未知尺寸';
  return {
    status: 'fail',
    results: [{
      field: 'autoSpecMatch',
      label: '规范识别',
      status: 'fail',
      current,
      required: '匹配素材库中已配置的尺寸规范',
      tip: '未找到与该素材尺寸完全一致的规范，请检查尺寸或补充规范配置'
    }],
    meta,
    spec: null,
    matchedVariant: null,
    autoMatchFailed: true
  };
}

function addErrorItem(file, reason) {
  state.items.push({
    id: uid(),
    status: 'error',
    meta: { name: file.name, size: file.size, type: 'unknown' },
    validation: {
      status: 'fail',
      results: [{ label: '文件读取', status: 'fail', current: '—', required: '—', tip: reason }],
      meta: null, spec: null
    },
    fixed: null, error: reason
  });
}

async function detectItem(itemId) {
  const idx = state.items.findIndex(it => it.id === itemId);
  const item = state.items[idx];
  if (idx === -1 || !item || item.error || !item.meta || item.status === 'loading') return;
  const match = getSpecById(item.specId) ? { spec: getSpecById(item.specId) } : findSpecMatchForMeta(item.meta);
  if (!match?.spec) {
    state.items[idx] = { ...item, status: 'detected', validation: createAutoMatchFailure(item.meta), specId: null, fixed: null };
    renderCheckerBody();
    return;
  }

  const spec = match.spec;
  if (spec.fileType !== item.meta.type) return;
  state.items[idx] = { ...item, status: 'detecting', specId: spec.id };
  renderCheckerBody();

  await nextFrame();
  const currentIdx = state.items.findIndex(it => it.id === itemId);
  const current = state.items[currentIdx];
  if (currentIdx === -1 || !current || current.error || !current.meta) return;

  const meta = await prepareMetaForDetection(current.meta, spec);
  const latestIdx = state.items.findIndex(it => it.id === itemId);
  const latest = state.items[latestIdx];
  if (latestIdx === -1 || !latest || latest.error) return;
  const { detectStartedAt, detectEstimateSeconds, ...finishedItem } = latest;
  state.items[latestIdx] = {
    ...finishedItem,
    meta,
    status: 'detected',
    specId: spec.id,
    validation: validate(meta, spec),
    fixed: null,
    autoMatchedSpecId: spec.id
  };
  renderCheckerBody();
}

async function detectAllItems() {
  if (state.detectingAll) return;
  const ids = state.items
    .filter(it => it.status !== 'loading' && it.status !== 'detecting' && !it.error && it.meta)
    .map(it => it.id);
  if (!ids.length) return;

  const estimateSeconds = ids.reduce((total, id) => {
    const item = state.items.find(it => it.id === id);
    const spec = getSpecById(item?.specId) || findSpecMatchForMeta(item?.meta)?.spec || getSpecById(state.selectedSpecId);
    return total + getDetectionEstimateSeconds(item?.meta, spec);
  }, 0);
  state.detectingAll = true;
  state.detectingAllStartedAt = Date.now();
  state.detectingAllEstimateSeconds = Math.max(5, Math.min(600, estimateSeconds));
  renderCheckerBody();
  try {
    for (const id of ids) {
      await detectItem(id);
    }
  } finally {
    state.detectingAll = false;
    state.detectingAllStartedAt = 0;
    state.detectingAllEstimateSeconds = 0;
    renderCheckerBody();
  }
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function prepareMetaForDetection(meta, spec) {
  if (spec?.fileType !== 'image' || meta?.type !== 'image' || !meta.file) return meta;
  try {
    const texts = await identifyImageTextsWithGptImage2(meta);
    return {
      ...meta,
      aiTextAnalysis: {
        texts,
        error: '',
        identifiedAt: Date.now()
      }
    };
  } catch (err) {
    console.warn('AI 文案识别失败，已回退到本地图像检测', err);
    return {
      ...meta,
      aiTextAnalysis: null
    };
  }
}

function revalidateAll() {
  state.items = state.items.map(it => {
    if (it.status === 'loading' || it.status === 'detecting') return it;
    if (!it.meta || it.error) return it;
    const spec = getSpecById(it.specId) || findSpecMatchForMeta(it.meta)?.spec;
    if (!spec) return { ...it, status: 'detected', specId: null, validation: createAutoMatchFailure(it.meta), fixed: null };
    return { ...it, status: 'detected', specId: spec.id, validation: validate(it.meta, spec), fixed: null };
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

function renderUploadSpecOptions() {
  return getSpecTree()
    .filter(cat => !cat.empty)
    .map(cat => {
      const options = cat.subGroups
        .flatMap(sg => sg.specs)
        .map(spec => {
          const selected = spec.id === state.selectedSpecId ? ' selected' : '';
          const fileType = spec.fileType === 'video' ? '视频' : '图片';
          return `<option value="${esc(spec.id)}"${selected}>${esc(spec.shortName || spec.name)} · ${fileType}</option>`;
        })
        .join('');
      return `<optgroup label="${esc(cat.name)}">${options}</optgroup>`;
    })
    .join('');
}

function renderCheckerBody() {
  syncResultMode();
  updateSpecName();
  const body = $('#checkerBody');

  if (!state.items.length) {
    body.innerHTML = `
      <div class="empty-zone">
        <div class="empty-zone__box" id="emptyBox">
          <div class="empty-zone__icon">${I.upload}</div>
          <div class="empty-zone__title">拖拽文件到此处，或按 Ctrl/⌘ + V 粘贴</div>
          <div class="empty-zone__desc">上传后会按素材尺寸自动识别对应规范；点击“开始检测”后按识别到的规范检测。</div>
          <div class="empty-zone__kbd">
            <span>JPG</span><span>PNG</span><span>WEBP</span><span>MP4</span><span>MOV</span>
          </div>
          <div class="empty-zone__actions">
            <button class="btn btn--primary empty-zone__upload empty-zone__upload--lg" id="inlineUploadBtn" type="button">
              ${I.plus} 上传素材
            </button>
          </div>
        </div>
      </div>`;
    $('#inlineUploadBtn')?.addEventListener('click', openFilePicker);
    return;
  }

  const loading = state.items.filter(i => i.status === 'loading' || i.status === 'detecting').length;
  const detected = state.items.filter(i => i.validation).length;
  const pending = state.items.filter(i => !i.validation && !i.error).length;
  const pass = state.items.filter(i => i.validation?.status === 'pass').length;
  const warn = state.items.filter(i => i.validation?.status === 'warn').length;
  const fail = state.items.filter(i => i.validation?.status === 'fail').length;
  const generatedCount = state.items.filter(i => i.generated).length;

  const loadingBadge = loading
    ? `<span class="identifying-badge"><span class="loading"></span>处理中 ${loading}</span>`
    : '';
  const detectAllButtonText = state.detectingAll
    ? `<span class="loading"></span> 检测中… ${renderCountdownSuffix(state.detectingAllStartedAt, state.detectingAllEstimateSeconds)}`
    : `${I.check} 检测全部`;

  body.innerHTML = `
    <div class="result-toolbar">
      <div class="result-toolbar__left">
        <button class="btn btn--ghost btn--sm result-toolbar__back" id="resultBackBtn" type="button" title="返回当前规范初始页" aria-label="返回当前规范初始页">${I.back}</button>
        <span>已上传 <strong style="color:var(--fg-1)">${state.items.length}</strong> 个素材${loadingBadge}</span>
      </div>
      <div class="result-toolbar__right">
        <button class="btn btn--primary btn--sm" id="detectAllBtn" ${state.detectingAll || !(pending || detected) ? 'disabled' : ''}>${detectAllButtonText}</button>
        ${generatedCount ? `<button class="btn btn--ghost btn--sm" id="downloadGeneratedBtn">${I.download} 下载生成图</button>` : ''}
        <button class="btn btn--ghost btn--sm" id="uploadMoreBtn">${I.plus} 继续上传</button>
        <button class="btn btn--ghost btn--sm" id="clearBtn">清空</button>
      </div>
    </div>
    <div class="stats-bar">
      <div class="stats-bar__item">
        <span class="stats-bar__dot stats-bar__dot--total"></span>
        <span class="stats-bar__num">${state.items.length}</span>
        <span class="stats-bar__label">已上传</span>
      </div>
      <div class="stats-bar__item">
        <span class="stats-bar__dot stats-bar__dot--total"></span>
        <span class="stats-bar__num">${detected}</span>
        <span class="stats-bar__label">已检测</span>
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
        <div></div>
        <div>素材名称</div>
        <div>文件规格</div>
        <div>状态</div>
        <div>操作</div>
      </div>
      ${state.items.map(renderRow).join('')}
    </div>`;
  bindRowActions();
  $('#resultBackBtn')?.addEventListener('click', clearResults);
  $('#detectAllBtn')?.addEventListener('click', detectAllItems);
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
  const swatch = r.dominantColor
    ? `<span class="color-swatch-inline" style="background:${esc(r.dominantColor.hex)}" title="${esc(r.dominantColor.hex)}"></span>`
    : '';
  const markerPreview = !isOk ? renderCheckMarkerPreview(r) : '';
  const annotationPreview = renderSafetyAnnotationPreview(r);
  const visuals = markerPreview || annotationPreview
    ? `<div class="check-item__visuals">${markerPreview}${annotationPreview}</div>`
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
        ${visuals}
        ${r.tip && !isOk ? `<div class="check-item__tip">${esc(r.tip)}</div>` : ''}
      </div>
    </li>`;
}

function renderCheckMarkerPreview(result) {
  const meta = result?.meta;
  const markers = Array.isArray(result?.markers) ? result.markers.filter(Boolean) : [];
  if (!markers.length || meta?.type !== 'image' || !meta.objectUrl || !meta.width || !meta.height) return '';

  return `
    <button class="check-marker-preview" type="button" data-action="preview" data-src="${esc(meta.objectUrl)}" aria-label="查看标注位置" style="aspect-ratio:${meta.width}/${meta.height}">
      <img src="${esc(meta.objectUrl)}" alt="">
      ${markers.map(marker => renderCheckMarker(marker, meta)).join('')}
    </button>`;
}

function renderSafetyAnnotationPreview(result) {
  const meta = result?.meta;
  const annotationSrc = getSafetyAnnotationAsset(result);
  if (!isSafetyCheck(result) || !annotationSrc || meta?.type !== 'image' || !meta.objectUrl || !meta.width || !meta.height) return '';
  return `
    <button class="check-annotation-preview" type="button" data-action="preview" data-src="${esc(annotationSrc)}" aria-label="查看安全区标注图" style="aspect-ratio:${meta.width}/${meta.height}">
      <img class="check-annotation-preview__asset" src="${esc(meta.objectUrl)}" alt="">
      <img class="check-annotation-preview__overlay" src="${esc(annotationSrc)}" alt="">
    </button>`;
}

function isSafetyCheck(result) {
  const field = String(result?.field || '');
  const label = String(result?.label || '');
  return ['safeZone', 'titleButtonSafeZone', 'textSafety', 'dangerZone', 'logoPosition', 'ipPosition'].includes(field)
    || label.includes('安全区');
}

function getSafetyAnnotationAsset(result) {
  const specId = result?.spec?.id;
  const variantId = result?.matchedVariant?.id;
  if (specId === 'home-static-hero') return 'assets/image/2-1/2-1静态首页头图标注图.png';
  if (specId === 'game-center-new-banner') {
    return variantId === 'small'
      ? 'assets/image/4-9/biaozhu-2-样机.png'
      : 'assets/image/4-9/biaozhu-1-样机.png';
  }
  return extractAnnotationAssetFromMarkdown(result?.spec?.markdown, result?.matchedVariant?.name);
}

function extractAnnotationAssetFromMarkdown(markdown = '', variantName = '') {
  const lines = String(markdown || '').split(/\r?\n/);
  const candidates = lines
    .map(line => line.match(/::(?:download|template-mockup)::[^\n]*?(assets\/image\/[^:：\s]+?标注图[^:：\s]*?\.(?:png|jpg|jpeg|webp))/i)?.[1])
    .filter(Boolean);
  if (!candidates.length) return '';
  const name = String(variantName || '');
  if (name.includes('小')) return candidates.find(src => /biaozhu-2|小/.test(src)) || candidates.at(-1) || '';
  if (name.includes('大')) return candidates.find(src => /biaozhu-1|大/.test(src)) || candidates[0] || '';
  return candidates[0] || '';
}

async function attachComplianceAnnotationMockup(spec, result, mode = 'ai-fix') {
  if (result?.meta?.type !== 'image' || !result?.meta?.objectUrl) return result;
  const validation = result.validation || validate(result.meta, spec);
  const annotationSrc = getSafetyAnnotationAsset({ spec, matchedVariant: validation?.matchedVariant });
  if (!annotationSrc) {
    result.warnings = [...(result.warnings || []), '当前规范未配置标注图，未生成规范标注示意图'];
    return result;
  }

  try {
    result.complianceMockup = await createComplianceAnnotationMockup(result, annotationSrc, spec, validation, mode);
    if (!result.log?.some(line => line.includes('规范标注示意图'))) {
      result.log = [...(result.log || []), '已生成叠加标注图的规范标注示意图'];
    }
  } catch (err) {
    console.warn('生成规范标注示意图失败', err);
    result.warnings = [...(result.warnings || []), `规范标注示意图生成失败：${err.message}`];
  }
  return result;
}

async function createComplianceAnnotationMockup(result, annotationSrc, spec, validation, mode) {
  const [assetImg, annotationImg] = await Promise.all([
    loadTemplateMockupImage(result.meta.objectUrl),
    loadTemplateMockupImage(annotationSrc)
  ]);
  const width = result.meta.width || assetImg.naturalWidth || assetImg.width;
  const height = result.meta.height || assetImg.naturalHeight || assetImg.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(assetImg, 0, 0, width, height);
  drawContainedImage(ctx, annotationImg, 0, 0, width, height);

  const blob = await canvasToPngBlob(canvas);
  const filename = buildComplianceMockupFilename(result.filename || result.meta.name, mode);
  const file = new File([blob], filename, { type: 'image/png' });
  const meta = await readFileMeta(file);
  return {
    blob,
    meta,
    filename,
    annotationSrc,
    specId: spec?.id || '',
    specName: spec?.shortName || spec?.name || '',
    variantName: validation?.matchedVariant?.name || ''
  };
}

function buildComplianceMockupFilename(sourceName = 'generated.png', mode = 'ai-fix') {
  const base = String(sourceName || 'generated').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
  const suffix = mode === 'copy-edit' ? 'copy_annotation' : 'ai_fix_annotation';
  return `${base}_${suffix}.png`;
}

function renderCheckMarker(marker, meta) {
  const left = clampPercent(marker.left / meta.width * 100);
  const top = clampPercent(marker.top / meta.height * 100);
  const right = clampPercent((marker.left + marker.width) / meta.width * 100);
  const bottom = clampPercent((marker.top + marker.height) / meta.height * 100);
  const width = Math.max(0.5, right - left);
  const height = Math.max(0.5, bottom - top);
  return `
    <span class="check-marker-preview__rect" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%">
      ${marker.label ? `<span>${esc(marker.label)}</span>` : ''}
    </span>`;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Number(value.toFixed(3))));
}

function renderAssetCard(item) {
  const { id, meta, validation } = item;
  const isImg = meta?.type === 'image';
  const isVid = meta?.type === 'video';
  const isBusy = item.status === 'loading' || item.status === 'detecting';
  const thumb = meta?.objectUrl
    ? (isImg
      ? `<button type="button" class="asset-card__preview thumb-preview" data-action="preview" data-id="${id}" aria-label="预览 ${esc(meta?.name || '图片')}"><img src="${meta.objectUrl}" alt=""></button>`
      : isVid ? `<video class="asset-card__preview" src="${meta.objectUrl}" muted controls></video>` : '')
    : `<div class="asset-card__preview asset-card__preview--placeholder"><span class="loading"></span></div>`;
  const detectionCountdown = item.status === 'detecting'
    ? renderCountdownSuffix(item.detectStartedAt, item.detectEstimateSeconds)
    : '';

  const statusMap = {
    pass: { cls: 'ok', text: '通过', icon: I.check },
    warn: { cls: 'warn', text: '警告', icon: I.warn },
    fail: { cls: 'bad', text: '不通过', icon: I.cross }
  };
  const status = validation
    ? (statusMap[validation.status] || statusMap.fail)
    : item.error
      ? { cls: 'bad', text: '上传失败', icon: I.cross }
      : isBusy
        ? { cls: 'subtle', text: item.status === 'detecting' ? '检测中' : '加载中', icon: '<span class="loading"></span>' }
        : { cls: 'subtle', text: '待检测', icon: '' };
  const matchedSpecTagText = validation ? getMatchedSpecTagText(validation) : getItemSpecMatchTagText(item);
  const matchedSpecTagClass = validation?.autoMatchFailed || item.autoMatchFailed ? 'tag--bad' : 'tag--brand';
  const matchedSpecTag = matchedSpecTagText
    ? `<span class="tag ${matchedSpecTagClass} tag--match" title="${esc(matchedSpecTagText)}">${esc(matchedSpecTagText)}</span>`
    : '';
  const generatedTag = item.generatedInfo?.colorHex
    ? `<span class="tag tag--subtle tag--match">自动生成 · 底色 ${esc(item.generatedInfo.colorHex)}</span>`
    : '';
  const checkItems = validation?.results?.length
    ? `<div class="asset-card__checks"><ul class="check-list">${mergeFileSpecResults(validation.results).map(renderCheckItem).join('')}</ul></div>`
    : item.error
      ? `<div class="asset-card__checks"><ul class="check-list">${renderCheckItem(item.validation.results[0])}</ul></div>`
      : `<div class="asset-card__hint">素材已上传，请点击“开始检测”检测当前单张素材。</div>`;
  const needsDetection = !validation;
  const canFix = validation?.status !== 'pass' && validation && !item.error && validation.spec && canFixItem(item);
  const canDownload = item.generated && meta?.file;
  const canDetect = needsDetection && !state.detectingAll && !isBusy && !item.error && meta?.objectUrl;
  const canCopyEdit = (!validation || validation.status === 'pass') && !state.detectingAll && !isBusy && !item.error && isImg && meta?.file;
  const detectAction = needsDetection
    ? item.status === 'detecting'
      ? `<button class="btn btn--primary btn--sm" data-action="detect" data-id="${id}" disabled><span class="loading"></span> 检测中… ${detectionCountdown}</button>`
      : `<button class="btn btn--primary btn--sm" data-action="detect" data-id="${id}" ${canDetect ? '' : 'disabled'}>${I.check} 开始检测</button>`
    : '';

  return `
    <article class="asset-card" data-id="${id}">
      <div class="asset-card__media">${thumb}</div>
      <div class="asset-card__body">
        <div class="asset-card__head">
          <div class="asset-card__title" title="${esc(meta?.name || '')}">${esc(meta?.name || '未知文件')}</div>
          <span class="tag tag--${status.cls}">${status.icon} ${status.text}</span>
        </div>
        <div class="asset-card__meta">${esc(getFileSpecText(meta))}</div>
        <div class="asset-card__tags">${matchedSpecTag}${generatedTag}</div>
        <div class="asset-card__primary-actions">
          ${detectAction}
          ${canCopyEdit ? `<button class="btn btn--ghost btn--sm" data-action="copy-edit" data-id="${id}">${I.sparkles} 修改图片</button>` : ''}
        </div>
        <div class="asset-card__secondary-actions">
          ${canDownload ? `<button class="btn btn--ghost btn--xs" data-action="download" data-id="${id}">${I.download} 下载</button>` : ''}
          ${canFix ? `<button class="btn btn--ghost btn--xs" data-action="fix" data-id="${id}">${I.wrench} 一键修复</button>` : ''}
        </div>
        ${checkItems}
      </div>
    </article>`;
}

function renderRow(item) {
  const { id, meta, validation } = item;
  const isImg = meta?.type === 'image';
  const isVid = meta?.type === 'video';
  const isBusy = item.status === 'loading' || item.status === 'detecting';
  const thumb = meta?.objectUrl
    ? (isImg
      ? `<button type="button" class="thumb-preview" data-action="preview" data-id="${id}" aria-label="预览 ${esc(meta?.name || '图片')}"><img src="${meta.objectUrl}" alt=""></button>`
      : isVid ? `<video src="${meta.objectUrl}" muted></video>` : '')
    : `<div class="thumb-skeleton"><span class="loading"></span></div>`;
  const detectionCountdown = item.status === 'detecting'
    ? renderCountdownSuffix(item.detectStartedAt, item.detectEstimateSeconds)
    : '';

  const map = {
    pass: { cls: 'ok', text: '通过', icon: I.check },
    warn: { cls: 'warn', text: '警告', icon: I.warn },
    fail: { cls: 'bad', text: '不通过', icon: I.cross }
  };
  const st = validation
    ? (map[validation.status] || map.fail)
    : item.error
      ? { cls: 'bad', text: '上传失败', icon: I.cross }
      : isBusy
        ? { cls: 'identifying', text: item.status === 'detecting' ? '检测中' : '加载中', icon: '<span class="loading"></span>' }
        : { cls: 'subtle', text: '待检测', icon: '' };

  const matchedSpecTagText = validation ? getMatchedSpecTagText(validation) : getItemSpecMatchTagText(item);
  const matchedSpecTagClass = validation?.autoMatchFailed || item.autoMatchFailed ? 'tag--bad' : 'tag--brand';
  const matchedSpecTag = matchedSpecTagText
    ? ` <span class="tag ${matchedSpecTagClass} tag--match" title="${esc(matchedSpecTagText)}">${esc(matchedSpecTagText)}</span>`
    : '';
  const generatedTag = item.generatedInfo?.colorHex
    ? ` <span class="tag tag--subtle tag--match">自动生成 · 底色 ${esc(item.generatedInfo.colorHex)}</span>`
    : '';

  const needsDetection = !validation;
  const canFix = validation?.status !== 'pass' && validation && !item.error && validation.spec && canFixItem(item);
  const canDownload = item.generated && meta?.file;
  const canDetect = needsDetection && !state.detectingAll && !isBusy && !item.error && meta?.objectUrl;
  const canCopyEdit = (!validation || validation.status === 'pass') && !state.detectingAll && !isBusy && !item.error && isImg && meta?.file;
  const detectAction = needsDetection
    ? item.status === 'detecting'
      ? `<button class="btn btn--primary btn--xs" data-action="detect" data-id="${id}" disabled><span class="loading"></span> 检测中… ${detectionCountdown}</button>`
      : `<button class="btn btn--primary btn--xs" data-action="detect" data-id="${id}" ${canDetect ? '' : 'disabled'}>${I.check} 开始检测</button>`
    : '';
  const checkItems = validation?.results?.length
    ? mergeFileSpecResults(validation.results).map(renderCheckItem).join('')
    : '';
  const detail = checkItems
    ? `<ul class="check-list">${checkItems}</ul>`
    : `<div class="table-row__hint">${isBusy ? '素材正在处理中，请稍候。' : '素材已上传，请点击“开始检测”检测当前单张素材。'}</div>`;

  return `
    <div class="table-row${isBusy ? ' table-row--loading' : ''}" data-id="${id}">
      <div class="table-row__thumb">${thumb}</div>
      <div class="table-row__name" title="${esc(meta?.name || '')}">
        <span class="table-row__filename">${esc(meta?.name || '未知文件')}</span>${matchedSpecTag}${generatedTag}
      </div>
      <div class="table-row__cell table-row__cell--spec">${esc(getFileSpecText(meta))}</div>
      <div><span class="tag tag--${st.cls}">${st.icon} ${st.text}</span></div>
      <div class="table-row__actions">
        ${detectAction}
        ${canCopyEdit ? `<button class="btn btn--ghost btn--xs" data-action="copy-edit" data-id="${id}">${I.sparkles} 修改图片</button>` : ''}
        ${canDownload ? `<button class="btn btn--ghost btn--xs" data-action="download" data-id="${id}">${I.download} 下载</button>` : ''}
        ${canFix ? `<button class="btn btn--primary btn--xs" data-action="fix" data-id="${id}">${I.wrench} 一键修复</button>` : ''}
      </div>
      <div class="table-row__detail">
        ${detail}
      </div>
    </div>`;
}

function getItemSpecMatchTagText(item) {
  if (item?.autoMatchFailed) return `未匹配规范：${item.meta?.width || '?'}×${item.meta?.height || '?'}`;
  const spec = getSpecById(item?.specId);
  if (!spec) return '';
  const variant = Array.isArray(spec.variants)
    ? spec.variants.find(v => v.id === item.autoMatchedVariantId || (v.width === item.meta?.width && v.height === item.meta?.height))
    : null;
  return getSpecTagText(spec, variant);
}

function getMatchedSpecTagText(validation) {
  if (validation?.autoMatchFailed) return `未匹配规范：${validation.meta?.width || '?'}×${validation.meta?.height || '?'}`;
  const spec = validation?.spec;
  if (!spec) return '';
  return getSpecTagText(spec, validation.matchedVariant);
}

function getSpecTagText(spec, variant) {
  const specName = spec.shortName || spec.name || '未命名规范';
  if (!variant) return Array.isArray(spec.variants) && spec.variants.length ? '' : `规范：${specName}`;
  const rawVariantName = String(variant.name || variant.id || '未命名素材');
  const variantName = rawVariantName.endsWith('素材') ? rawVariantName : `${rawVariantName}素材`;
  const size = variant.width && variant.height ? `（${variant.width}×${variant.height}）` : '';
  return `规范：${specName} / 素材：${variantName}${size}`;
}

const FILE_SPEC_FIX_FIELDS = new Set(['format', 'size', 'dimensions']);

function isFileSpecFixField(field) {
  return FILE_SPEC_FIX_FIELDS.has(field);
}

function getAllFixFailures(item) {
  if (!item?.validation?.results?.length) return [];
  return item.validation.results.filter(r => r.status !== 'pass');
}

function getNormalFixFailures(item) {
  return getAllFixFailures(item).filter(r => isFileSpecFixField(r.field));
}

function getNativeFixCheck(item, result) {
  return item.meta.type === 'video' ? canAutoFixVideo(result) : canAutoFix(result);
}

function canNativeFixItem(item) {
  return getNormalFixFailures(item).some(r => getNativeFixCheck(item, r).fixable);
}

function canFixItem(item) {
  const failed = getAllFixFailures(item);
  if (!failed.length) return false;
  if (item?.meta?.type === 'image' && item.meta.file) return true;
  return canNativeFixItem(item);
}

function bindRowActions() {
  $$('.table-row[data-id]').forEach(row => {
    if (row.classList.contains('table-row--loading')) return;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      row.classList.toggle('is-expanded');
    });
  });
  $$('[data-action="detect"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      detectItem(el.dataset.id);
    });
  });
  $$('[data-action="copy-edit"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      startCopyEdit(el.dataset.id);
    });
  });
  $$('[data-action="fix"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openFixModal(el.dataset.id);
    });
  });
  $$('[data-action="download"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadItem(el.dataset.id);
    });
  });
  $$('[data-action="preview"]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await openCheckVisualPreview(el)) return;
      if (el.dataset.src) {
        openImageLightboxFromSrc(el.dataset.src, '标注位置预览');
        return;
      }
      const item = state.items.find(i => i.id === el.dataset.id);
      if (item?.meta?.type === 'image' && item.meta.objectUrl) {
        openImageLightboxFromSrc(item.meta.objectUrl, item.meta.name || '图片预览');
      }
    });
  });
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
let currentAiFixContext = null;
let lastAiFixContext = null;
let currentCopyEditContext = null;
let manualCropEditor = null;

function openFixModal(itemId) {
  currentAiFixContext = null;
  currentCopyEditContext = null;
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  const spec = getSpecById(item.specId);
  if (!spec) return;

  const failed = getAllFixFailures(item);
  if (!failed.length) {
    showUnfixableModal([{ rule: { label: '素材检测', current: '无不通过项', required: '存在可修复问题' }, reason: '当前素材没有需要修复的不通过项' }]);
    return;
  }

  if (shouldUseSmartImageFix(item, failed)) {
    startAiFix(itemId);
    return;
  }

  const nativeFixResults = getNormalFixFailures(item);
  const unfixable = failed
    .filter(r => !isFileSpecFixField(r.field))
    .map(rule => ({ rule, reason: '该项暂不支持自动修复' }));
  for (const r of nativeFixResults) {
    const check = getNativeFixCheck(item, r);
    if (!check.fixable) unfixable.push({ rule: r, ...check });
  }

  if (!nativeFixResults.length || unfixable.length === failed.length) {
    showUnfixableModal(nativeFixResults.length ? unfixable : failed.map(rule => ({ rule, reason: '该项暂不支持自动修复' })));
    return;
  }

  currentFixContext = { item, spec, unfixable, fixResults: nativeFixResults };
  renderFixModal(item, spec, unfixable, nativeFixResults);
  $('#fixModal').hidden = false;
}

function shouldUseSmartImageFix(item, failed) {
  if (item?.meta?.type !== 'image' || !item.meta.file) return false;
  return failed.some(r => !isFileSpecFixField(r.field) || !canAutoFix(r).fixable);
}

function showUnfixableModal(reasons) {
  currentAiFixContext = null;
  currentCopyEditContext = null;
  manualCropEditor = null;
  $('#fixModal .modal__dialog')?.classList.remove('modal__dialog--wide');
  $('#fixModal .modal__title').textContent = '一键修复';
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
  $('#fixModal .modal__title').textContent = '一键修复';

  let html = `
    <div style="padding:10px 12px;background:var(--brand-soft);border:1px solid var(--brand-ring);border-radius:var(--r-sm);margin-bottom:14px;font-size:11.5px;color:var(--fg-2);">
      已自动识别为可本地处理的文件规格问题（格式、尺寸、体积），请确认输出参数后开始修复。
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
  $('#fixStartBtn').textContent = useManualCrop ? '确定裁剪并修复' : '开始一键修复';
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
    await validateFixedResult(result, spec);
    $('#fixModal').hidden = true;
    openPreviewModal(item);
  } catch (err) {
    alert('修复失败：' + err.message);
    btn.disabled = false;
    btn.textContent = manualCropEditor ? '确定裁剪并修复' : '开始一键修复';
  }
}

async function validateFixedResult(result, spec) {
  if (!result?.meta) return null;
  if (spec?.fileType === 'image' && result.meta.type === 'image' && result.meta.file) {
    result.meta = await prepareMetaForDetection(result.meta, spec);
  }
  result.validation = validate(result.meta, spec);
  return result.validation;
}

function getValidationFailures(validation) {
  return Array.isArray(validation?.results)
    ? validation.results.filter(result => result.status !== 'pass')
    : [];
}

function startCopyEdit(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  const spec = getSpecById(item.specId || state.selectedSpecId);
  if (!spec) return;
  if (item.meta?.type !== 'image' || !item.meta.file) {
    alert('修改图片当前仅支持图片素材');
    return;
  }

  currentFixContext = null;
  currentAiFixContext = null;
  currentCopyEditContext = { item, spec, texts: [], mode: 'copy' };
  renderCopyEditModal();
  $('#fixModal').hidden = false;
}

function renderCopyEditModal() {
  manualCropEditor = null;
  const item = currentCopyEditContext?.item;
  const spec = currentCopyEditContext?.spec;
  const sourceUrl = item?.meta?.objectUrl || '';
  const annotationSrc = getSafetyAnnotationAsset({ spec, matchedVariant: item?.validation?.matchedVariant });
  $('#fixModal .modal__dialog')?.classList.toggle('modal__dialog--wide', !!sourceUrl || !!annotationSrc);
  $('#fixModal .modal__title').textContent = '修改图片';

  let imagesHtml = '';
  if (sourceUrl) {
    imagesHtml += `
      <div class="ai-fix-image-card">
        <div class="ai-fix-image-label">原素材图</div>
        <div class="ai-fix-image-frame">
          <img src="${esc(sourceUrl)}" alt="原素材图" />
        </div>
      </div>`;
  }
  if (annotationSrc) {
    imagesHtml += `
      <div class="ai-fix-image-card">
        <div class="ai-fix-image-label">标注图</div>
        <div class="ai-fix-image-frame">
          <img src="${esc(annotationSrc)}" alt="标注图" />
        </div>
      </div>`;
  }

  $('#fixModalBody').innerHTML = `
    <div class="fix-group">
      <div class="fix-group__title">选择修改方式</div>
      <div class="fix-group__desc">基于原素材图和标注图进行图生图修改；选择修改文案或输入其他修改要求。</div>
      ${imagesHtml ? `<div class="ai-fix-images">${imagesHtml}</div>` : ''}
      <div class="image-edit-tabs" role="tablist" aria-label="修改图片方式">
        <button type="button" class="image-edit-tab is-active" data-image-edit-tab="copy" role="tab" aria-selected="true">修改文案</button>
        <button type="button" class="image-edit-tab" data-image-edit-tab="other" role="tab" aria-selected="false">修改其他</button>
      </div>
      <div class="image-edit-panel" data-image-edit-panel="copy">
        <label class="copy-edit-field">
          <span>需要修改的文案</span>
          <input type="text" id="copySourceManual" placeholder="请输入图片中要替换的原文">
        </label>
        <label class="copy-edit-field">
          <span>修改后的文案</span>
          <textarea id="copyTargetText" rows="3" placeholder="请输入新的文案"></textarea>
        </label>
      </div>
      <div class="image-edit-panel" data-image-edit-panel="other" hidden>
        <label class="copy-edit-field">
          <span>修改要求</span>
          <textarea id="imageEditPromptInput" rows="5" placeholder="请填写你希望修改的内容"></textarea>
        </label>
      </div>
    </div>`;
  bindImageEditTabs();
  $('#fixStartBtn').style.display = '';
  $('#fixStartBtn').textContent = '确认修改文案';
  $('#fixStartBtn').disabled = false;
}

function bindImageEditTabs() {
  $$('[data-image-edit-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.imageEditTab || 'copy';
      currentCopyEditContext.mode = mode;
      $$('[data-image-edit-tab]').forEach(item => {
        const active = item.dataset.imageEditTab === mode;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      $$('[data-image-edit-panel]').forEach(panel => {
        panel.hidden = panel.dataset.imageEditPanel !== mode;
      });
      $('#fixStartBtn').textContent = mode === 'copy' ? '确认修改文案' : '确认修改图片';
    });
  });
}

async function submitCopyEditPrompt() {
  if (!currentCopyEditContext) return;
  const { item, spec } = currentCopyEditContext;
  const mode = currentCopyEditContext.mode || 'copy';
  const sourceText = ($('#copySourceManual')?.value || '').trim();
  const targetText = ($('#copyTargetText')?.value || '').trim();
  const otherPrompt = $('#imageEditPromptInput')?.value || '';

  if (mode === 'copy' && !sourceText) {
    alert('请填写需要修改的文案');
    return;
  }
  if (mode === 'copy' && !targetText) {
    alert('请填写修改后的文案');
    return;
  }
  if (mode === 'other' && !otherPrompt.trim()) {
    alert('请填写修改要求');
    return;
  }

  const btn = $('#fixStartBtn');
  btn.disabled = true;
  const stopCountdown = startButtonCountdown(btn, mode === 'copy' ? '正在修改文案…' : '正在修改图片…', getAiOperationEstimateSeconds(item.meta, 80));

  try {
    const annotationSrc = getSafetyAnnotationAsset({ spec, matchedVariant: item.validation?.matchedVariant });
    const instruction = mode === 'copy'
      ? `将图片中的文案【${sourceText}】修改为【${targetText}】。`
      : otherPrompt;
    const result = await fixImageWithGptImage2(item.meta, spec, [], {
      mode: 'generic-image-edit',
      editType: mode === 'copy' ? 'copy' : 'other',
      useSourceDimensions: true,
      instruction,
      filenameSuffix: mode === 'copy' ? 'copy_edited' : 'ai_img2img',
      referenceImages: annotationSrc ? [{
        src: annotationSrc,
        filename: annotationSrc.split('/').pop() || 'reference.png',
        role: 'reference'
      }] : []
    });
    const promptLog = mode === 'copy'
      ? `文案替换：“${sourceText}” → “${targetText}”`
      : `修改要求：${otherPrompt}`;
    result.log = [promptLog, ...(result.log || [])];
    item.fixed = result;
    await validateFixedResult(result, spec);
    await attachComplianceAnnotationMockup(spec, result, mode === 'copy' ? 'copy-edit' : 'ai-fix');
    await saveAiFixResultToGallery(item, spec, result, {
      mode: mode === 'copy' ? 'copy-edit' : 'ai-fix',
      prompt: promptLog
    });
    currentCopyEditContext = null;
    $('#fixModal').hidden = true;
    openPreviewModal(item);
  } catch (err) {
    alert((mode === 'copy' ? '修改文案失败：' : '修改图片失败：') + err.message);
    btn.disabled = false;
    btn.textContent = mode === 'copy' ? '确认修改文案' : '确认修改图片';
  } finally {
    stopCountdown();
  }
}

function startAiFix(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  const spec = getSpecById(item.specId);
  if (!spec) return;
  if (item.meta?.type !== 'image') {
    alert('一键修复当前仅支持图片素材调用智能修图能力');
    return;
  }

  const failed = getAllFixFailures(item);
  if (!failed.length) {
    alert('当前素材没有需要修复的不通过项');
    return;
  }

  currentFixContext = null;
  currentCopyEditContext = null;
  currentAiFixContext = { item, spec, failed };
  renderAiFixPromptModal(item, spec, failed);
  $('#fixModal').hidden = false;
}

function renderAiFixPromptModal(item, spec, failed, presetSelectedFields) {
  manualCropEditor = null;
  $('#fixModal .modal__dialog')?.classList.add('modal__dialog--wide');
  $('#fixModal .modal__title').textContent = '一键修复';

  const sourceUrl = item?.meta?.objectUrl || '';
  const preset = Array.isArray(presetSelectedFields) && presetSelectedFields.length
    ? new Set(presetSelectedFields)
    : null;
  const imagesHtml = sourceUrl ? `
    <div class="ai-fix-image-card">
      <div class="ai-fix-image-label">素材图</div>
      <div class="ai-fix-image-frame">
        <img src="${esc(sourceUrl)}" alt="素材图" />
      </div>
    </div>` : '';

  $('#fixModalBody').innerHTML = `
    <div class="fix-group">
      <div class="fix-group__title">选择需要修复的不合规项</div>
      <div class="fix-group__desc">勾选后直接开始修复；后台会根据所选项和规范安全区自动生成精简生图描述语。仅上传当前素材图，不上传标注图。</div>
      ${imagesHtml ? `<div class="ai-fix-images ai-fix-images--single">${imagesHtml}</div>` : ''}
      <div class="fix-options ai-fix-issues" data-group="aiFixIssues">
        ${failed.map((rule, index) => {
          const fieldKey = getAiFixRuleKey(rule);
          const checked = !preset || preset.has(fieldKey);
          return `
            <label class="fix-option ${checked ? 'is-selected' : ''}">
              <input type="checkbox" data-ai-fix-issue="${index}" value="${esc(fieldKey)}" ${checked ? 'checked' : ''} />
              <div class="fix-option__text">
                <div class="fix-option__name">${esc(rule.label || rule.field || '不合规项')}</div>
                <div class="fix-option__hint">当前 ${esc(rule.current || '不符合')}；要求 ${esc(rule.required || getAiFixIssueRequired(rule))}</div>
              </div>
            </label>`;
        }).join('')}
      </div>
      <div class="ai-fix-selected-count" id="aiFixSelectedCount"></div>
    </div>`;
  bindAiFixIssueSelection();
  $('#fixStartBtn').style.display = '';
  $('#fixStartBtn').textContent = '开始一键修复';
  $('#fixStartBtn').disabled = !collectSelectedAiFixFailures(failed).length;
}

function getAiFixRuleKey(rule) {
  return String(rule?.field || rule?.label || 'issue');
}

function bindAiFixIssueSelection() {
  const update = () => {
    const selectedCount = collectSelectedAiFixFailures(currentAiFixContext?.failed || []).length;
    const countEl = $('#aiFixSelectedCount');
    if (countEl) countEl.textContent = selectedCount ? `已选择 ${selectedCount} 项` : '请至少选择 1 项需要修复的问题';
    const btn = $('#fixStartBtn');
    if (btn) btn.disabled = selectedCount === 0;
  };
  $$('[data-ai-fix-issue]').forEach(input => {
    input.addEventListener('change', () => {
      input.closest('.fix-option')?.classList.toggle('is-selected', input.checked);
      update();
    });
  });
  update();
}

function collectSelectedAiFixFailures(failed) {
  const source = Array.isArray(failed) ? failed : [];
  return $$('[data-ai-fix-issue]:checked')
    .map(input => source[Number(input.dataset.aiFixIssue)])
    .filter(Boolean);
}

function getAiFixIssueRequired(rule) {
  if (rule.field === 'titleButtonSafeZone') return '把标题与按钮整体平移到提示词写明的安全区内';
  if (['safeZone', 'logoPosition', 'ipPosition', 'dangerZone', 'textSafety', 'logoQuality', 'ipCoverage'].includes(rule.field)) {
    return '把对应元素整体平移到提示词写明的安全区内';
  }
  return rule.required || '按规范修复';
}

function buildAiFixPrompt(failed, spec, matchedVariant) {
  const variant = matchedVariant || spec?.variants?.[0] || null;
  const dimRule = spec?.rules?.find(r => r.field === 'dimensions');
  const w = variant?.width || dimRule?.width || dimRule?.options?.[0]?.width;
  const h = variant?.height || dimRule?.height || dimRule?.options?.[0]?.height;
  const targetSize = w && h ? `${w}×${h}` : '';
  const hasAnnotation = !!getSafetyAnnotationAsset({ spec, matchedVariant });

  const zones = buildAiPromptSafeZoneDescriptions(variant, w, h);
  const safeZoneSection = buildAiPromptSafeZoneSection(zones, failed);

  const lines = [];
  lines.push('这是一个素材规范自动修复任务，不是自由创作任务。请把 gpt-image-2 当成“基于原图的局部编辑 / 修复模型”，不要重新生成一张全新的图。');
  lines.push('输入说明：第1张图是必须被编辑的原始素材；第2张图（如有）是安全区 / 危险区规范参考图，只用于理解合规区域，不是最终图的一部分。');
  if (targetSize) {
    lines.push(`最终输出必须是 ${targetSize}，保持原始素材比例、清晰度和设计风格，不要拉伸变形，不要附加任何说明文字。`);
    lines.push(`以下坐标均基于最终输出 ${targetSize} 的像素坐标系，左上角为 (0,0)，x 向右，y 向下。`);
  }
  lines.push('核心目标：保持原图背景、人物 / 商品 / 主视觉、光影、色调、整体构图不变，只移动或等比缩放不符合规范的标题、按钮、LOGO、主文案、角色脸部或商品关键信息。');
  lines.push('禁止事项：不要改变标题/按钮/LOGO/主文案的文字内容；不要改变字体风格、描边、阴影、颜色、按钮圆角和质感；不要添加无关元素；不要把安全区标注线、红区、绿区、参考框或辅助线画进最终图。');
  lines.push('如果移动元素后原位置露出空白，请只用周围背景补全。');

  if (failed?.length) {
    lines.push('');
    lines.push('当前检测到的不合规项：');
    failed.forEach(rule => {
      lines.push(`- ${rule.label || rule.field}：当前 ${rule.current || '不符合'}；要求 ${getAiFixIssueRequired(rule)}`);
    });
  }

  if (safeZoneSection) {
    lines.push('');
    lines.push('安全区修复要求：');
    if (hasAnnotation) lines.push('- 优先参考第2张安全区 / 危险区规范图：红色区域为危险区，不能放置标题、按钮、核心文案、LOGO、重要角色脸部、关键商品信息；绿色 / 透明区域为安全区。');
    lines.push('- 下方为精确像素坐标：');
    lines.push(safeZoneSection);
    lines.push('- 如果标题、按钮、LOGO、主文案、关键角色或商品信息与危险区相交，或外接矩形越过安全区边界，请将它们整体移动到安全区内。');
    lines.push('- 使用“移动 / 等比缩放 / 重排 UI 元素”完成修复，不要重绘整个画面；其它像素保持不变。');
  }

  const otherProblems = failed.filter(rule => !['safeZone', 'titleButtonSafeZone', 'logoPosition', 'ipPosition', 'dangerZone', 'textSafety', 'logoQuality', 'ipCoverage', 'dimensions', 'size', 'format'].includes(rule.field));
  if (otherProblems.length) {
    lines.push('');
    lines.push('其它需要修复的项：');
    otherProblems.forEach(rule => {
      lines.push(`- ${buildAiFixPromptForRule(rule, spec, { hasDimensionIssue: false })}`);
    });
  }

  lines.push('');
  lines.push('输出要求：只输出修复后的最终图片；不要输出分析文字；不要输出规范图；不要输出任何参考线或辅助标注。');

  return lines.join('\n');
}

function buildAiPromptSafeZoneDescriptions(variant, width, height) {
  const zones = Array.isArray(variant?.layoutZones) ? variant.layoutZones : [];
  if (!zones.length || !width || !height) return [];
  return zones.map(zone => {
    const left = toAiPromptPixelNumber(zone.left);
    const top = toAiPromptPixelNumber(zone.top);
    const zoneWidth = toAiPromptPixelNumber(zone.width);
    const zoneHeight = toAiPromptPixelNumber(zone.height);
    const right = left + zoneWidth;
    const bottom = top + zoneHeight;
    const isDanger = /危险|禁/.test(String(zone.name || ''));
    return {
      name: String(zone.name || '').trim() || '布局区',
      tip: String(zone.tip || '').trim(),
      left, top, width: zoneWidth, height: zoneHeight, right, bottom,
      isDanger,
      humanPosition: describeAiPromptRegion(left, top, zoneWidth, zoneHeight)
    };
  });
}

function toAiPromptPixelNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function describeAiPromptRegion(left, top, width, height) {
  const right = left + width;
  const bottom = top + height;
  return `左边界 x=${left}px，上边界 y=${top}px，右边界 x=${right}px，下边界 y=${bottom}px，宽 ${width}px，高 ${height}px`;
}

function buildAiPromptSafeZoneSection(zones, failed) {
  if (!zones.length) return '';
  const safetyFields = ['safeZone', 'titleButtonSafeZone', 'logoPosition', 'ipPosition', 'dangerZone', 'textSafety', 'logoQuality', 'ipCoverage'];
  if (!failed?.some(rule => safetyFields.includes(rule.field))) return '';
  const allowed = zones.filter(z => !z.isDanger);
  const danger = zones.filter(z => z.isDanger);
  const lines = [];
  if (allowed.length) {
    lines.push('安全区（必须把对应元素完整放进去）：');
    allowed.forEach(z => lines.push(`- ${z.name}：${z.humanPosition}${z.tip ? `；${z.tip}` : ''}`));
  }
  if (danger.length) {
    lines.push('危险区（除背景外，禁止出现 LOGO / IP / 文字 / 按钮等关键元素）：');
    danger.forEach(z => lines.push(`- ${z.name}：${z.humanPosition}${z.tip ? `；${z.tip}` : ''}`));
  }
  return lines.join('\n');
}

function buildAiFixPromptForRule(rule, spec, context = {}) {
  const config = getRuleConfig(rule, spec);
  const required = rule.required ? `，规范要求：${rule.required}` : '';
  const sizePreserve = context.hasDimensionIssue ? '尺寸只按尺寸不符合项单独处理' : '维持原图尺寸不变';
  switch (rule.field) {
    case 'safeZone': return '保留现有 LOGO 和 IP / 主元素内容、样式不变，仅将它们整体平移或等比缩放到上面写明的对应安全区内，禁止进入危险区';
    case 'titleButtonSafeZone': return '把标题文字和按钮作为一个整体保留原文字、字体和样式不变，平移到上面写明的安全区内，元素外接矩形不得越过安全区边界；不要在最终图里画出参考色块或框线';
    case 'logoPosition': return '保留 LOGO 内容、样式不变，仅将 LOGO 整体平移到上面写明的 LOGO 安全区内，并与该区域左边缘对齐';
    case 'ipPosition': return '保留 IP / 主元素内容和样式不变，仅将其整体平移或等比缩放到上面写明的主元素安全区内';
    case 'backgroundTexture': return `仅在现有背景上补充规范要求的底纹，不新增可识别物体，主体、文案和 LOGO 不变${formatBackgroundTextureRequirement(config)}`;
    case 'colorZone': return `识别元素主色调，仅修改底色至规范区域内（${formatColorZoneRequirement(rule, config)}），${sizePreserve}，其他设计全部都不改变`;
    case 'whiteTextContrast': return `仅加深白色文字承载区域或底色，使白字对比度达到规范（${formatContrastRequirement(rule, config)}），${sizePreserve}，文字内容、字体、主体和其他设计全部不变`;
    case 'localWhiteTextContrast': return `仅加深局部白色文字承载区域，使白字对比度达到规范（${formatContrastRequirement(rule, config)}），${sizePreserve}，文字内容、字体、主体和其他设计全部不变`;
    case 'dangerZone': return '保留现有元素内容和样式不变，仅将进入危险区的关键元素整体平移或等比缩放到上面写明的安全区内';
    case 'textSafety': return '保留文字内容、字体、颜色、样式不变，仅将文字和按钮整体平移到安全区内，禁止进入危险区';
    case 'logoQuality': return '保留 LOGO 内容和样式不变，仅调整 LOGO 大小和清晰度，使其在 LOGO 安全区内保持清晰且不越界';
    case 'ipCoverage': return '保留 IP / 主元素内容和样式不变，仅等比放大或调整位置，使主元素完整位于主元素安全区内';
    case 'dimensions': return `仅调整画布至规范尺寸（${rule.required || formatTargetDimensions(config, spec)}），通过裁剪或延展原背景适配，主体、文案、LOGO 和其他设计不变`;
    case 'size': return `仅通过压缩降低文件体积至规范要求（${rule.required || '符合文件大小限制'}），画面内容和设计元素不变`;
    case 'format': return `仅转换为规范要求的图片格式（${rule.required || '符合格式要求'}），画面内容不变`;
    default: return `仅修复"${rule.label || rule.field || '不符合项'}"这一项${required}，其他全部不变`;
  }
}

function getRuleConfig(result, spec) {
  return result?.rule || spec?.rules?.find(rule => rule.field === result?.field) || {};
}

function formatColorZoneRequirement(result, config = {}) {
  const maxS = config.maxS ?? extractNumber(result.required, /S≤\s*(\d+(?:\.\d+)?)%?/i) ?? 40;
  const minB = config.minB ?? extractNumber(result.required, /B≥\s*(\d+(?:\.\d+)?)%?/i) ?? 60;
  const minRatio = config.minRatio ?? config.minContrastRatio ?? extractNumber(result.required, /对比度\s*≥\s*(\d+(?:\.\d+)?)/i);
  const ranges = [`避开禁用区 S≤${maxS}% 且 B≥${minB}%`, `建议调整至 S>${maxS}% 或 B<${minB}%`];
  if (Number.isFinite(minRatio)) ranges.push(`白字对比度≥${minRatio}:1`);
  if (Array.isArray(config.recommendedColors) && config.recommendedColors.length) ranges.push(`可参考色值 ${config.recommendedColors.join(' / ')}`);
  return ranges.join('；');
}

function formatContrastRequirement(result, config = {}) {
  const minRatio = config.minRatio ?? config.minContrastRatio ?? extractNumber(result.required, /≥\s*(\d+(?:\.\d+)?):?1?/i) ?? 4.5;
  return `与白色文字对比度≥${minRatio}:1`;
}

function formatBackgroundTextureRequirement(config = {}) {
  const parts = [];
  if (Number.isFinite(config.minBackgroundPixelRatio)) parts.push(`背景占比≥${Math.round(config.minBackgroundPixelRatio * 100)}%`);
  if (Number.isFinite(config.minVariedRatio)) parts.push(`变化像素≥${(config.minVariedRatio * 100).toFixed(1)}%`);
  return parts.length ? `（${parts.join('；')}）` : '';
}

function formatTargetDimensions(config = {}, spec) {
  if (Array.isArray(spec?.variants) && spec.variants.length) return spec.variants.map(v => `${v.width}×${v.height}`).join(' 或 ');
  if (Array.isArray(config.options) && config.options.length) return config.options.map(v => `${v.width}×${v.height}`).join(' 或 ');
  return config.width && config.height ? `${config.width}×${config.height}` : '目标尺寸';
}

function extractNumber(value, pattern) {
  const match = String(value || '').match(pattern);
  return match ? Number(match[1]) : undefined;
}

async function submitAiFixPrompt() {
  if (!currentAiFixContext) return startFix();
  const { item, spec, failed } = currentAiFixContext;
  const selectedFailures = collectSelectedAiFixFailures(failed);
  if (!selectedFailures.length) {
    alert('请至少选择 1 项需要修复的问题');
    return;
  }

  const selectedFields = selectedFailures.map(getAiFixRuleKey);
  const selectedLabel = selectedFailures.map(rule => rule.label || rule.field).join('、');
  const btn = $('#fixStartBtn');
  btn.disabled = true;
  const stopCountdown = startButtonCountdown(btn, '一键修复中…', getAiOperationEstimateSeconds(item.meta, 90));

  try {
    const result = await fixImageWithGptImage2(item.meta, spec, selectedFailures, {
      matchedVariant: item.validation?.matchedVariant,
      generateInstructionOnServer: true,
      filenameSuffix: 'ai_fix',
      referenceImages: []
    });
    result.log = [`用户选择修复：${selectedLabel}`, ...(result.log || [])];
    item.fixed = result;
    const validation = await validateFixedResult(result, spec);
    const remainingFailures = getValidationFailures(validation);
    if (remainingFailures.length) {
      result.warnings = [
        ...(result.warnings || []),
        `一键修复结果仍有 ${remainingFailures.length} 项未通过，已在预览中标出，可重新选择不合规项后再次生成或人工调整`
      ];
      result.log = [
        ...(result.log || []),
        `复检仍未通过：${remainingFailures.map(r => r.label || r.field).join('、')}`
      ];
    }
    await attachComplianceAnnotationMockup(spec, result, 'ai-fix');
    await saveAiFixResultToGallery(item, spec, result, { mode: 'ai-fix', prompt: `选择修复：${selectedLabel}` });
    lastAiFixContext = { item, spec, failed, selectedFields };
    currentAiFixContext = null;
    $('#fixModal').hidden = true;
    openPreviewModal(item);
  } catch (err) {
    alert('一键修复失败：' + err.message);
    btn.disabled = false;
    btn.textContent = '开始一键修复';
  } finally {
    stopCountdown();
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
  const complianceMockup = renderComplianceMockupPreview(fixed);
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
    ${complianceMockup}
    ${remainingIssues}
    <div class="fix-log">
      <div class="fix-log__title">${I.sparkles} 已执行的修复</div>
      <ul class="fix-log__list">${fixed.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>
    ${fixed.warnings?.length ? `
      <div class="fix-log" style="background:var(--warn-soft);border-color:var(--warn-ring);">
        <div class="fix-log__title" style="color:var(--warn)">注意</div>
        <ul class="fix-log__list">${fixed.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>` : ''}`;
  $('#previewModalBody .compliance-mockup__image')?.addEventListener('click', e => {
    const src = getImageSrc(e.currentTarget.querySelector('img'));
    openImageLightboxFromSrc(src, '规范标注示意图');
  });
  const regenerateBtn = $('#regenerateAiFixBtn');
  if (regenerateBtn) {
    regenerateBtn.hidden = !(lastAiFixContext && lastAiFixContext.item === item);
  }
  $('#previewModal').hidden = false;
}

function renderComplianceMockupPreview(fixed) {
  const mockup = fixed?.complianceMockup;
  const meta = mockup?.meta;
  if (!meta?.objectUrl || meta.type !== 'image') return '';
  const statusTag = fixed.validation?.status === 'pass'
    ? `<span class="tag tag--ok">${I.check} 符合规范</span>`
    : fixed.validation?.status === 'warn'
      ? `<span class="tag tag--warn">${I.warn} 需复核</span>`
      : `<span class="tag tag--bad">${I.cross} 未通过</span>`;
  return `
    <div class="compliance-mockup">
      <div class="compliance-mockup__head">
        <div>
          <div class="compliance-mockup__title">规范标注示意图</div>
          <div class="compliance-mockup__desc">生成图已叠加当前规格标注图，用于确认画面符合规范。</div>
        </div>
        ${statusTag}
      </div>
      <button class="compliance-mockup__image" type="button" aria-label="查看规范标注示意图" style="aspect-ratio:${meta.width}/${meta.height}">
        <img src="${esc(meta.objectUrl)}" alt="规范标注示意图">
      </button>
      <div class="compare-cell__info compliance-mockup__info">
        <div title="${esc(mockup.filename || meta.name)}">${esc(mockup.filename || meta.name)}</div>
        <div>PNG</div>
        <div>${meta.width}×${meta.height}</div>
        <div>${formatSize(meta.size)}</div>
      </div>
    </div>`;
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
  item.status = item.validation ? 'detected' : 'uploaded';
  item.fixed = null;
  $('#previewModal').hidden = true;
  lastAiFixContext = null;
  renderCheckerBody();
}

function regenerateAiFix() {
  if (!lastAiFixContext) return;
  const { item, spec, failed, selectedFields } = lastAiFixContext;
  $('#previewModal').hidden = true;
  currentFixContext = null;
  currentCopyEditContext = null;
  currentAiFixContext = { item, spec, failed };
  renderAiFixPromptModal(item, spec, failed, selectedFields);
  $('#fixModal').hidden = false;
}

/* ===== Modals ===== */
function initModals() {
  $$('[data-close]').forEach(el => {
    el.addEventListener('click', () => el.closest('.modal').hidden = true);
  });
  $('#fixStartBtn')?.addEventListener('click', () => {
    if (currentCopyEditContext) return submitCopyEditPrompt();
    if (currentAiFixContext) return submitAiFixPrompt();
    return startFix();
  });
  $('#downloadFixedBtn')?.addEventListener('click', downloadFixed);
  $('#regenerateAiFixBtn')?.addEventListener('click', regenerateAiFix);
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
