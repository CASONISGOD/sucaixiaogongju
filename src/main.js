/**
 * Compliance Hub · SaaS Dark Admin
 */

import { getSpecById, getSpecTree, specs } from './data/specs.js';
import { readFileMeta, formatSize, extractAverageColorFromRegion } from './validators/meta.js';
import { validate } from './validators/engine.js';
import { fixImage, canAutoFix } from './fixers/image.js';
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

function getDetectionEstimateSeconds(meta) {
  const pixels = Number(meta?.width) * Number(meta?.height);
  const megapixels = Number.isFinite(pixels) && pixels > 0 ? pixels / 1_000_000 : 0;
  const sizeMb = Number(meta?.size) > 0 ? Number(meta.size) / (1024 * 1024) : 0;
  const estimate = 8 + Math.ceil(megapixels) * 4 + Math.ceil(sizeMb) * 2;
  return Math.max(5, Math.min(30, estimate));
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
  if (spec?.id !== 'platform-new-home-hero') return;
  const sections = Array.from(pane.querySelectorAll('.md-section'));
  const outputDemo = sections.find(section => {
    const heading = Array.from(section.children).find(node => node.tagName === 'H1');
    return heading?.textContent.trim() === '输出示意';
  });
  if (!outputDemo) return;

  outputDemo.classList.add('md-section--half-size-media');
  outputDemo.querySelectorAll('figure img, figure video').forEach(media => {
    applyMediaDisplayScale(media, 0.5);
    if (media.tagName === 'IMG' && !media.complete) {
      media.addEventListener('load', () => applyMediaDisplayScale(media, 0.5), { once: true });
    }
    if (media.tagName === 'VIDEO' && !media.videoWidth) {
      media.addEventListener('loadedmetadata', () => applyMediaDisplayScale(media, 0.5), { once: true });
    }
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
  const canCopyEdit = false;
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
  const canCopyEdit = false;
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
let manualCropEditor = null;

function openFixModal(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  const spec = getSpecById(item.specId);
  if (!spec) return;

  const failed = getAllFixFailures(item);
  if (!failed.length) {
    showUnfixableModal([{ rule: { label: '素材检测', current: '无不通过项', required: '存在可修复问题' }, reason: '当前素材没有需要修复的不通过项' }]);
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

function showUnfixableModal(reasons) {
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
  if (regenerateBtn) regenerateBtn.hidden = true;
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
  renderCheckerBody();
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
  initGallery();
  initModals();
  updateSpecName();
  renderSpecPane();
}

init();
