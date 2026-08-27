// Functions in this file are injected with chrome.scripting.executeScript.
// Keep every exported function self-contained: injected functions lose module closures.

export function measurePage() {
  const marker = 'data-localshot-scroller';
  for (const old of document.querySelectorAll(`[${marker}]`)) old.removeAttribute(marker);

  const dpr = window.devicePixelRatio || 1;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const root = document.scrollingElement || document.documentElement;
  const body = document.body;
  const docScrollHeight = Math.max(
    root?.scrollHeight || 0,
    document.documentElement.scrollHeight || 0,
    body?.scrollHeight || 0,
  );

  let scroller = null;
  if (docScrollHeight <= viewportHeight + 4) {
    let bestOverflow = viewportHeight * 0.4;
    for (const el of document.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= bestOverflow) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < viewportWidth * 0.45 || rect.height < viewportHeight * 0.45) continue;
      bestOverflow = overflow;
      scroller = el;
    }
  }

  if (scroller) {
    scroller.setAttribute(marker, '1');
    const rect = scroller.getBoundingClientRect();
    return {
      scrollHeight: scroller.scrollHeight,
      viewportHeight: scroller.clientHeight,
      viewportWidth: scroller.clientWidth,
      devicePixelRatio: dpr,
      originalWindowY: window.scrollY,
      originalScrollerY: scroller.scrollTop,
      container: {
        x: rect.left,
        y: rect.top,
        width: scroller.clientWidth,
        height: scroller.clientHeight,
      },
    };
  }

  return {
    scrollHeight: docScrollHeight,
    viewportHeight,
    viewportWidth,
    devicePixelRatio: dpr,
    originalWindowY: window.scrollY,
    originalScrollerY: null,
    container: null,
  };
}

export function prepareCapture() {
  const id = 'localshot-capture-style';
  document.getElementById(id)?.remove();
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    html { scroll-behavior: auto !important; }
    [data-localshot-scroller="1"] { scroll-behavior: auto !important; }
    [data-localshot-hidden="1"] { visibility: hidden !important; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

export function hideFixedAndSticky() {
  for (const el of document.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement)) continue;
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') el.setAttribute('data-localshot-hidden', '1');
  }
}

export function scrollCaptureTo(y) {
  const scroller = document.querySelector('[data-localshot-scroller="1"]');
  if (scroller instanceof HTMLElement) {
    scroller.scrollTop = y;
    return scroller.scrollTop;
  }
  window.scrollTo(0, y);
  return window.scrollY;
}

export function restoreCapture(originalWindowY, originalScrollerY) {
  document.getElementById('localshot-capture-style')?.remove();
  for (const el of document.querySelectorAll('[data-localshot-hidden="1"]')) {
    el.removeAttribute('data-localshot-hidden');
  }
  const scroller = document.querySelector('[data-localshot-scroller="1"]');
  if (scroller instanceof HTMLElement && typeof originalScrollerY === 'number') {
    scroller.scrollTop = originalScrollerY;
  }
  scroller?.removeAttribute('data-localshot-scroller');
  window.scrollTo(0, originalWindowY || 0);
}

export async function cropDataUrl(dataUrl, x, y, width, height) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを初期化できません');
  ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export async function stitchTiles(tiles, width, height, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを初期化できません');

  const load = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('撮影タイルの読み込みに失敗しました'));
    image.src = src;
  });

  for (const tile of tiles) {
    const image = await load(tile.dataUrl);
    if (crop) {
      ctx.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        tile.y,
        crop.width,
        crop.height,
      );
    } else {
      ctx.drawImage(image, 0, tile.y, image.naturalWidth, image.naturalHeight);
    }
  }
  return canvas.toDataURL('image/png');
}

export function selectRegion() {
  return new Promise((resolve) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    let rect = null;
    let mode = null;
    let corner = null;
    let start = { x: 0, y: 0 };
    let origin = null;
    let finished = false;

    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif;';

    const mask = document.createElement('div');
    mask.style.cssText = 'display:none;position:absolute;box-sizing:border-box;border:2px solid #2563eb;box-shadow:0 0 0 9999px rgba(0,0,0,.48);pointer-events:none;';
    root.appendChild(mask);

    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:auto;cursor:crosshair;';
    root.appendChild(layer);

    const readout = document.createElement('div');
    readout.style.cssText = 'display:none;position:absolute;background:#111827;color:white;padding:4px 7px;border-radius:5px;font:600 12px/1.2 system-ui;pointer-events:none;';
    root.appendChild(readout);

    const bar = document.createElement('div');
    bar.style.cssText = 'display:none;position:absolute;gap:6px;pointer-events:auto;background:#111827;padding:6px;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.35);';
    const ok = document.createElement('button');
    ok.textContent = '撮影';
    ok.style.cssText = 'border:0;background:#2563eb;color:white;border-radius:6px;padding:7px 12px;font-weight:700;cursor:pointer;';
    const cancel = document.createElement('button');
    cancel.textContent = 'キャンセル';
    cancel.style.cssText = 'border:0;background:transparent;color:#e5e7eb;border-radius:6px;padding:7px 10px;cursor:pointer;';
    bar.append(ok, cancel);
    root.appendChild(bar);

    const handles = {};
    for (const name of ['nw', 'ne', 'sw', 'se']) {
      const h = document.createElement('div');
      h.dataset.corner = name;
      h.style.cssText = `display:none;position:absolute;width:12px;height:12px;background:white;border:2px solid #2563eb;border-radius:50%;box-sizing:border-box;pointer-events:auto;cursor:${name === 'nw' || name === 'se' ? 'nwse-resize' : 'nesw-resize'};`;
      handles[name] = h;
      root.appendChild(h);
    }

    document.documentElement.appendChild(root);

    function finish(value) {
      if (finished) return;
      finished = true;
      root.remove();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    }

    function normalized(x1, y1, x2, y2) {
      const x = clamp(Math.min(x1, x2), 0, vw);
      const y = clamp(Math.min(y1, y2), 0, vh);
      return {
        x,
        y,
        width: Math.min(Math.abs(x2 - x1), vw - x),
        height: Math.min(Math.abs(y2 - y1), vh - y),
      };
    }

    function inside(p) {
      return rect && p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
    }

    function render() {
      if (!rect || rect.width < 1 || rect.height < 1) {
        mask.style.display = readout.style.display = bar.style.display = 'none';
        Object.values(handles).forEach((h) => { h.style.display = 'none'; });
        return;
      }
      mask.style.display = 'block';
      mask.style.left = `${rect.x}px`;
      mask.style.top = `${rect.y}px`;
      mask.style.width = `${rect.width}px`;
      mask.style.height = `${rect.height}px`;
      readout.style.display = 'block';
      readout.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
      readout.style.left = `${clamp(rect.x, 6, vw - 100)}px`;
      readout.style.top = `${rect.y > 32 ? rect.y - 28 : rect.y + rect.height + 8}px`;

      const coords = {
        nw: [rect.x - 6, rect.y - 6],
        ne: [rect.x + rect.width - 6, rect.y - 6],
        sw: [rect.x - 6, rect.y + rect.height - 6],
        se: [rect.x + rect.width - 6, rect.y + rect.height - 6],
      };
      for (const [name, h] of Object.entries(handles)) {
        h.style.display = 'block';
        h.style.left = `${coords[name][0]}px`;
        h.style.top = `${coords[name][1]}px`;
      }

      bar.style.display = mode ? 'none' : 'flex';
      bar.style.left = `${clamp(rect.x + rect.width - 150, 6, vw - 150)}px`;
      bar.style.top = `${rect.y + rect.height + 52 < vh ? rect.y + rect.height + 10 : Math.max(6, rect.y - 48)}px`;
    }

    function onDown(event) {
      if (event.button !== 0) return;
      const p = { x: event.clientX, y: event.clientY };
      const hitCorner = event.target?.dataset?.corner;
      start = p;
      origin = rect ? { ...rect } : null;
      if (hitCorner && rect) {
        mode = 'resize';
        corner = hitCorner;
      } else if (inside(p)) {
        mode = 'move';
        layer.style.cursor = 'move';
      } else {
        mode = 'create';
        rect = { x: p.x, y: p.y, width: 0, height: 0 };
      }
      render();
      event.preventDefault();
    }

    function onMove(event) {
      if (!mode) return;
      const p = { x: event.clientX, y: event.clientY };
      if (mode === 'create') {
        rect = normalized(start.x, start.y, p.x, p.y);
      } else if (mode === 'move' && origin) {
        rect = {
          ...origin,
          x: clamp(origin.x + p.x - start.x, 0, vw - origin.width),
          y: clamp(origin.y + p.y - start.y, 0, vh - origin.height),
        };
      } else if (mode === 'resize' && origin && corner) {
        const left = corner.includes('w') ? p.x : origin.x;
        const right = corner.includes('e') ? p.x : origin.x + origin.width;
        const top = corner.includes('n') ? p.y : origin.y;
        const bottom = corner.includes('s') ? p.y : origin.y + origin.height;
        rect = normalized(left, top, right, bottom);
      }
      render();
      event.preventDefault();
    }

    function onUp() {
      mode = null;
      corner = null;
      layer.style.cursor = 'crosshair';
      render();
    }

    function confirm() {
      if (rect && rect.width >= 2 && rect.height >= 2) finish(rect);
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        confirm();
      } else if (rect && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        const step = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowLeft') rect.x = clamp(rect.x - step, 0, vw - rect.width);
        if (event.key === 'ArrowRight') rect.x = clamp(rect.x + step, 0, vw - rect.width);
        if (event.key === 'ArrowUp') rect.y = clamp(rect.y - step, 0, vh - rect.height);
        if (event.key === 'ArrowDown') rect.y = clamp(rect.y + step, 0, vh - rect.height);
        render();
        event.preventDefault();
      }
    }

    layer.addEventListener('mousedown', onDown);
    Object.values(handles).forEach((h) => h.addEventListener('mousedown', onDown));
    ok.addEventListener('mousedown', (e) => e.stopPropagation());
    cancel.addEventListener('mousedown', (e) => e.stopPropagation());
    ok.addEventListener('click', confirm);
    cancel.addEventListener('click', () => finish(null));
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  });
}
