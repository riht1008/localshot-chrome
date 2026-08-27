import {
  measurePage,
  prepareCapture,
  hideFixedAndSticky,
  scrollCaptureTo,
  restoreCapture,
  cropDataUrl,
  stitchTiles,
  selectRegion,
} from './page-functions.js';
import {
  CAPTURE_THROTTLE_MS,
  PAINT_SETTLE_MS,
  MAX_CANVAS_DIMENSION,
  computeScrollPositions,
  isProtectedUrl,
  sleep,
} from './utils.js';

const EDITOR_URL = chrome.runtime.getURL('src/editor.html');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'capture') return false;
  handleCapture(message.mode)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error('[LocalShot] capture failed', error);
      void flashBadge('!', '#dc2626', 3000);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  const map = {
    'capture-visible': 'visible',
    'capture-full-page': 'full-page',
    'capture-region': 'region',
  };
  const mode = map[command];
  if (mode) void handleCapture(mode).catch((error) => console.error('[LocalShot]', error));
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function execInTab(tabId, func, args = []) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!result?.length) throw new Error('ページ上で処理を実行できませんでした');
  return result[0].result;
}

async function runInTab(tabId, func, args = []) {
  await chrome.scripting.executeScript({ target: { tabId }, func, args });
}

async function captureVisibleTab(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

async function handleCapture(mode) {
  const tab = await getActiveTab();
  if (!tab || tab.id == null) throw new Error('アクティブなタブが見つかりません');
  if (isProtectedUrl(tab.url || '')) {
    throw new Error('Chromeの保護ページでは撮影できません');
  }

  if (mode === 'visible') return captureVisible(tab);
  if (mode === 'region') return captureRegion(tab);
  if (mode === 'full-page') return captureFullPage(tab);
  throw new Error(`不明な撮影モードです: ${mode}`);
}

async function captureVisible(tab) {
  const metrics = await execInTab(tab.id, measurePage);
  try {
    const dataUrl = await captureVisibleTab(tab.windowId);
    const width = Math.round(metrics.viewportWidth * metrics.devicePixelRatio);
    const height = Math.round(metrics.viewportHeight * metrics.devicePixelRatio);
    await deliverCapture(tab, 'visible', dataUrl, width, height);
  } finally {
    await runInTab(tab.id, restoreCapture, [metrics.originalWindowY, metrics.originalScrollerY]);
  }
}

async function captureRegion(tab) {
  const metrics = await execInTab(tab.id, measurePage);
  try {
    const rect = await execInTab(tab.id, selectRegion);
    if (!rect) return;

    const screenshot = await captureVisibleTab(tab.windowId);
    const dpr = metrics.devicePixelRatio || 1;
    const x = Math.round(rect.x * dpr);
    const y = Math.round(rect.y * dpr);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    const dataUrl = await execInTab(tab.id, cropDataUrl, [screenshot, x, y, width, height]);
    await deliverCapture(tab, 'region', dataUrl, width, height);
  } finally {
    await runInTab(tab.id, restoreCapture, [metrics.originalWindowY, metrics.originalScrollerY]);
  }
}

async function captureFullPage(tab) {
  const metrics = await execInTab(tab.id, measurePage);
  if (metrics.viewportHeight <= 0 || metrics.scrollHeight <= 0) {
    throw new Error('撮影できるスクロール領域がありません');
  }

  const dpr = metrics.devicePixelRatio || 1;
  const positions = computeScrollPositions(metrics.scrollHeight, metrics.viewportHeight);
  const crop = metrics.container
    ? {
        x: Math.round(metrics.container.x * dpr),
        y: Math.round(metrics.container.y * dpr),
        width: Math.round(metrics.container.width * dpr),
        height: Math.round(metrics.container.height * dpr),
      }
    : null;
  const width = crop ? crop.width : Math.round(metrics.viewportWidth * dpr);
  const height = Math.round(metrics.scrollHeight * dpr);

  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
    throw new Error(`ページが大きすぎます (${width}×${height}px)。表示部分または範囲撮影を使ってください`);
  }

  const tiles = [];
  await runInTab(tab.id, prepareCapture);
  try {
    for (let index = 0; index < positions.length; index += 1) {
      if (index > 0) {
        if (index === 1) await runInTab(tab.id, hideFixedAndSticky);
        await sleep(CAPTURE_THROTTLE_MS);
      }

      const actualY = await execInTab(tab.id, scrollCaptureTo, [positions[index]]);
      await sleep(PAINT_SETTLE_MS);
      const dataUrl = await captureVisibleTab(tab.windowId);
      tiles.push({ dataUrl, y: Math.round(actualY * dpr) });
      await setProgress(index + 1, positions.length);
    }
  } finally {
    await runInTab(tab.id, restoreCapture, [metrics.originalWindowY, metrics.originalScrollerY]);
  }

  const dataUrl = await execInTab(tab.id, stitchTiles, [tiles, width, height, crop]);
  await deliverCapture(tab, 'full-page', dataUrl, width, height);
  await clearBadge();
}

async function deliverCapture(tab, mode, dataUrl, width, height) {
  const capture = {
    dataUrl,
    width,
    height,
    mode,
    title: tab.title || '',
    url: tab.url || '',
    capturedAt: Date.now(),
  };
  await chrome.storage.local.set({ lastCapture: capture });
  await chrome.tabs.create({ url: EDITOR_URL });
  await flashBadge('✓', '#16a34a', 1000);
}

async function setProgress(done, total) {
  const pct = Math.round((done / total) * 100);
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setBadgeText({ text: pct === 100 ? '99' : String(pct) });
}

async function clearBadge() {
  await chrome.action.setBadgeText({ text: '' });
}

async function flashBadge(text, color, duration) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  await sleep(duration);
  await clearBadge();
}
