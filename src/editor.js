const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const canvasWrap = document.getElementById('canvasWrap');
const empty = document.getElementById('empty');
const statusEl = document.getElementById('status');
const dimensionsEl = document.getElementById('dimensions');
const colorInput = document.getElementById('color');
const strokeInput = document.getElementById('stroke');
const strokeOut = document.getElementById('strokeOut');
const strokePreview = document.getElementById('strokePreview');
const strokePresets = document.getElementById('strokePresets');
const colorPalette = document.getElementById('colorPalette');
const arrowStylesEl = document.getElementById('arrowStyles');
const fontSizeInput = document.getElementById('fontSize');
const fillInput = document.getElementById('fill');
const textBgInput = document.getElementById('textBg');
const zoomInput = document.getElementById('zoom');
const cropActions = document.getElementById('cropActions');
const captureTitleEl = document.getElementById('captureTitle');
const inspectorTitleEl = document.getElementById('inspectorTitle');
const inspectorHintEl = document.getElementById('inspectorHint');
const styleSection = document.getElementById('styleSection');
const colorOut = document.getElementById('colorOut');
const undoButton = document.getElementById('undo');
const redoButton = document.getElementById('redo');
const copyButton = document.getElementById('copy');
const saveButton = document.getElementById('save');
const deleteSelectedButton = document.getElementById('deleteSelected');
const clearAllButton = document.getElementById('clearAll');
const textDialog = document.getElementById('textDialog');
const textForm = document.getElementById('textForm');
const textValueInput = document.getElementById('textValue');

let capture = null;
let backgroundImage = null;
let backgroundDataUrl = '';
let annotations = [];
let undoStack = [];
let redoStack = [];
let cropBackup = null;
let cropRect = null;
let selectedIndex = -1;
let tool = 'select';
let draft = null;
let interaction = null;
let zoomScale = 1;
let pendingTextPoint = null;
let arrowStyle = 'open';
let styleEditActive = false;
const DEFAULT_STROKE_WIDTH = 8;

const tools = new Set(['select', 'rect', 'ellipse', 'arrow', 'line', 'pen', 'text', 'highlight', 'blur', 'mosaic', 'crop']);
const arrowStyles = new Set(['open', 'solid', 'curved', 'double']);
const toolMetadata = {
  select: { title: '選択', hint: '右下のハンドルをドラッグ。Shiftで元の縦横比を保ちます。', controls: [] },
  rect: { title: '矩形', hint: 'ドラッグして囲みます。Shiftで正方形になります。', controls: ['color', 'stroke', 'fill'] },
  ellipse: { title: '楕円', hint: 'ドラッグして描きます。Shiftで正円になります。', controls: ['color', 'stroke', 'fill'] },
  arrow: { title: '矢印', hint: 'ドラッグして描きます。Shiftで45°ごとに固定します。', controls: ['arrow-style', 'color', 'stroke'] },
  line: { title: '線', hint: 'ドラッグして描きます。Shiftで45°ごとに固定します。', controls: ['color', 'stroke'] },
  pen: { title: 'ペン', hint: 'ドラッグして自由に描きます。', controls: ['color', 'stroke'] },
  text: { title: 'テキスト', hint: '配置する位置をクリックします。', controls: ['color', 'font', 'text-bg'] },
  highlight: { title: 'ハイライト', hint: '強調したい範囲をドラッグします。', controls: ['color'] },
  blur: { title: 'ぼかし', hint: '隠したい範囲をドラッグします。', controls: [] },
  mosaic: { title: 'モザイク', hint: '隠したい範囲をドラッグします。', controls: [] },
  crop: { title: 'クロップ', hint: '残したい範囲をドラッグして適用します。', controls: [] },
};

init().catch((error) => {
  console.error(error);
  statusEl.textContent = error instanceof Error ? error.message : String(error);
  empty.hidden = false;
  canvasWrap.hidden = true;
});

async function init() {
  const stored = await chrome.storage.local.get('lastCapture');
  capture = stored.lastCapture;
  if (!capture?.dataUrl) {
    empty.hidden = false;
    canvasWrap.hidden = true;
    statusEl.textContent = '撮影データがありません';
    return;
  }

  backgroundDataUrl = capture.dataUrl;
  backgroundImage = await loadImage(backgroundDataUrl);
  canvas.width = capture.width || backgroundImage.naturalWidth;
  canvas.height = capture.height || backgroundImage.naturalHeight;
  setTool('select');
  bindEvents();
  applyZoom();
  render();
  dimensionsEl.textContent = `${canvas.width} × ${canvas.height}px`;
  statusEl.textContent = `${modeLabel(capture.mode)} / ${capture.title || 'Untitled'}`;
  captureTitleEl.textContent = capture.title || '名称未設定のスクリーンショット';
  document.title = `${capture.title || 'スクリーンショット'} — LocalShot`;
  syncEditorUi();
}

function bindEvents() {
  document.getElementById('tools').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tool]');
    if (button) setTool(button.dataset.tool);
  });

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  saveButton.addEventListener('click', savePng);
  copyButton.addEventListener('click', copyPng);
  deleteSelectedButton.addEventListener('click', deleteSelected);
  clearAllButton.addEventListener('click', clearAll);
  document.getElementById('applyCrop').addEventListener('click', applyCrop);
  document.getElementById('cancelCrop').addEventListener('click', cancelCrop);
  document.getElementById('cancelText').addEventListener('click', () => textDialog.close());
  textForm.addEventListener('submit', addTextAnnotation);
  textDialog.addEventListener('click', (event) => { if (event.target === textDialog) textDialog.close(); });
  textDialog.addEventListener('close', () => { pendingTextPoint = null; });

  strokeInput.addEventListener('input', () => {
    updateStrokeReadout();
    beginStyleEdit();
    updateSelectedStyle(false);
  });
  strokeInput.addEventListener('change', endStyleEdit);
  strokeInput.addEventListener('keyup', endStyleEdit);
  strokePresets.addEventListener('click', (event) => {
    const button = event.target.closest('[data-stroke]');
    if (!button) return;
    strokeInput.value = button.dataset.stroke;
    updateStrokeReadout();
    updateSelectedStyle(true);
  });

  colorInput.addEventListener('input', () => {
    updateColorReadout();
    beginStyleEdit();
    updateSelectedStyle(false);
  });
  colorInput.addEventListener('change', endStyleEdit);
  colorPalette.addEventListener('click', (event) => {
    const swatch = event.target.closest('[data-color]');
    if (!swatch) return;
    colorInput.value = swatch.dataset.color;
    updateColorReadout();
    updateSelectedStyle(true);
  });

  arrowStylesEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-arrow-style]');
    if (!button || !arrowStyles.has(button.dataset.arrowStyle)) return;
    arrowStyle = button.dataset.arrowStyle;
    updateSelectedStyle(true);
    updateArrowStyleButtons();
  });

  fontSizeInput.addEventListener('change', () => updateSelectedStyle(true));
  fillInput.addEventListener('change', () => updateSelectedStyle(true));
  textBgInput.addEventListener('change', () => updateSelectedStyle(true));
  zoomInput.addEventListener('change', applyZoom);
  window.addEventListener('resize', () => { if (zoomInput.value === 'fit') applyZoom(); });
  document.addEventListener('keydown', onKeyDown);
}

function setTool(next) {
  if (!tools.has(next)) return;
  styleEditActive = false;
  tool = next;
  selectedIndex = next === 'select' ? selectedIndex : -1;
  if (next !== 'crop') cancelCrop(false);
  for (const button of document.querySelectorAll('[data-tool]')) {
    const active = button.dataset.tool === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  canvas.style.cursor = next === 'select' ? 'default' : next === 'text' ? 'text' : 'crosshair';
  statusEl.textContent = `${toolLabel(next)}ツール`;
  syncEditorUi();
  render();
}

function syncEditorUi() {
  const selected = selectedIndex >= 0 ? annotations[selectedIndex] : null;
  const contextType = tool === 'select' && selected ? selected.type : tool;
  const meta = toolMetadata[contextType] || toolMetadata.select;

  inspectorTitleEl.textContent = tool === 'select' && selected ? `${meta.title}を選択中` : meta.title;
  if (tool === 'select' && selected?.type === 'arrow' && selected.arrowStyle === 'curved') {
    inspectorHintEl.textContent = '両端の丸ハンドルで始点・終点、中央の丸ハンドルで曲がり具合を調整します。';
  } else {
    inspectorHintEl.textContent = tool === 'select' && selected
      ? 'ドラッグで移動。右下のハンドルはShiftで元の縦横比を保ちます。'
      : meta.hint;
  }

  let visibleControls = 0;
  for (const control of document.querySelectorAll('[data-control]')) {
    const visible = meta.controls.includes(control.dataset.control);
    control.hidden = !visible;
    if (visible) visibleControls += 1;
  }
  styleSection.hidden = visibleControls === 0;

  if (selected) {
    if (selected.color) colorInput.value = selected.color;
    if (selected.strokeWidth) strokeInput.value = selected.strokeWidth;
    if (selected.type === 'arrow') arrowStyle = arrowStyles.has(selected.arrowStyle) ? selected.arrowStyle : 'open';
    if (selected.fontSize) fontSizeInput.value = selected.fontSize;
    if ('fill' in selected) fillInput.checked = Boolean(selected.fill);
    if (selected.type === 'text') textBgInput.checked = Boolean(selected.background);
  }

  updateColorReadout();
  updateStrokeReadout();
  updateArrowStyleButtons();
  undoButton.disabled = undoStack.length === 0 && !cropBackup;
  redoButton.disabled = redoStack.length === 0;
  deleteSelectedButton.disabled = !selected;
  clearAllButton.disabled = annotations.length === 0;
}

function updateColorReadout() {
  colorOut.value = colorInput.value.toUpperCase();
  const current = colorInput.value.toLowerCase();
  for (const swatch of colorPalette.querySelectorAll('[data-color]')) {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.color.toLowerCase() === current));
  }
}

function updateStrokeReadout() {
  const width = Number(strokeInput.value) || 1;
  strokeOut.value = `${width} px`;
  strokePreview.style.borderBlockStartWidth = `${Math.min(width, 16)}px`;
  for (const button of strokePresets.querySelectorAll('[data-stroke]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.stroke) === width));
  }
}

function updateArrowStyleButtons() {
  for (const button of arrowStylesEl.querySelectorAll('[data-arrow-style]')) {
    button.setAttribute('aria-pressed', String(button.dataset.arrowStyle === arrowStyle));
  }
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function onPointerDown(event) {
  if (!backgroundImage || event.button !== 0) return;
  const p = getPoint(event);
  canvas.setPointerCapture(event.pointerId);

  if (tool === 'select') {
    const selected = selectedIndex >= 0 ? annotations[selectedIndex] : null;
    const curveHandle = getCurveHandleAtPoint(p, selected);
    if (curveHandle) {
      pushHistory();
      interaction = {
        type: 'curve-handle',
        handle: curveHandle,
        index: selectedIndex,
        original: materializeCurveControl(selected),
        changed: false,
      };
      canvas.style.cursor = 'grabbing';
      return;
    }

    const handleIndex = selectedIndex >= 0 && isOnResizeHandle(p, annotations[selectedIndex]) ? selectedIndex : -1;
    if (handleIndex >= 0) {
      pushHistory();
      interaction = {
        type: 'resize',
        index: handleIndex,
        start: p,
        original: clone(annotations[handleIndex]),
        bbox: getBBox(annotations[handleIndex]),
        changed: false,
      };
      return;
    }

    const hit = findHit(p);
    selectedIndex = hit;
    if (hit >= 0) {
      pushHistory();
      interaction = { type: 'move', index: hit, start: p, original: clone(annotations[hit]), changed: false };
    } else {
      interaction = null;
    }
    syncEditorUi();
    render();
    return;
  }

  if (tool === 'text') {
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    pendingTextPoint = p;
    textValueInput.value = '';
    textDialog.showModal();
    textValueInput.focus();
    return;
  }

  if (tool === 'pen') {
    draft = { type: 'pen', points: [p], color: colorInput.value, strokeWidth: Number(strokeInput.value) };
    return;
  }

  if (tool === 'crop') {
    cropRect = null;
    cropActions.hidden = true;
    draft = { type: 'crop', x: p.x, y: p.y, w: 0, h: 0, start: p };
    render();
    return;
  }

  if (['line', 'arrow'].includes(tool)) {
    draft = {
      type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
      color: colorInput.value, strokeWidth: Number(strokeInput.value),
    };
    if (tool === 'arrow') draft.arrowStyle = arrowStyle;
    return;
  }

  draft = {
    type: tool, x: p.x, y: p.y, w: 0, h: 0, start: p,
    color: colorInput.value, strokeWidth: Number(strokeInput.value), fill: fillInput.checked,
  };
}

function onPointerMove(event) {
  if (!backgroundImage) return;
  const p = getPoint(event);

  if (interaction) {
    if (interaction.type === 'move') {
      const dx = p.x - interaction.start.x;
      const dy = p.y - interaction.start.y;
      annotations[interaction.index] = clone(interaction.original);
      moveObject(annotations[interaction.index], dx, dy);
      interaction.changed ||= Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1;
    } else if (interaction.type === 'resize') {
      annotations[interaction.index] = resizeObject(interaction.original, interaction.bbox, p, event.shiftKey);
      interaction.changed = true;
    } else if (interaction.type === 'curve-handle') {
      const object = clone(interaction.original);
      if (interaction.handle === 'start') {
        object.x1 = p.x;
        object.y1 = p.y;
      } else if (interaction.handle === 'end') {
        object.x2 = p.x;
        object.y2 = p.y;
      } else {
        object.curveControlX = p.x;
        object.curveControlY = p.y;
      }
      annotations[interaction.index] = object;
      interaction.changed = true;
    }
    render();
    return;
  }

  if (tool === 'select') {
    const selected = selectedIndex >= 0 ? annotations[selectedIndex] : null;
    if (getCurveHandleAtPoint(p, selected)) canvas.style.cursor = 'grab';
    else if (selected && isOnResizeHandle(p, selected)) canvas.style.cursor = 'nwse-resize';
    else canvas.style.cursor = findHit(p) >= 0 ? 'move' : 'default';
    return;
  }

  if (!draft) return;
  if (draft.type === 'pen') {
    draft.points.push(p);
  } else if (draft.type === 'line' || draft.type === 'arrow') {
    const endpoint = event.shiftKey ? snapPointToAngles(draft, p) : p;
    draft.x2 = endpoint.x;
    draft.y2 = endpoint.y;
  } else {
    const r = event.shiftKey ? normalizeSquare(draft.start, p) : normalizeRect(draft.start, p);
    draft.x = r.x;
    draft.y = r.y;
    draft.w = r.w;
    draft.h = r.h;
  }
  render();
}

function onPointerUp(event) {
  try { canvas.releasePointerCapture(event.pointerId); } catch { /* no-op */ }

  if (interaction) {
    const completedInteraction = interaction;
    if (!interaction.changed) undoStack.pop();
    interaction = null;
    canvas.style.cursor = 'default';
    if (completedInteraction.changed && completedInteraction.type === 'curve-handle') {
      const adjustment = completedInteraction.handle === 'start'
        ? '始点'
        : completedInteraction.handle === 'end'
          ? '終点'
          : '曲がり具合';
      statusEl.textContent = `矢印の${adjustment}を更新しました — 元に戻せます`;
    }
    syncEditorUi();
    render();
    return;
  }
  if (!draft) return;

  if (draft.type === 'crop') {
    if (draft.w >= 4 && draft.h >= 4) {
      cropRect = { x: draft.x, y: draft.y, w: draft.w, h: draft.h };
      cropActions.hidden = false;
    }
    draft = null;
    syncEditorUi();
    render();
    return;
  }

  let object = draft;
  draft = null;
  if (object.type === 'pen' && object.points.length < 2) return;
  if (['rect', 'ellipse', 'highlight', 'blur', 'mosaic'].includes(object.type) && (object.w < 2 || object.h < 2)) return;
  if (['line', 'arrow'].includes(object.type) && Math.hypot(object.x2 - object.x1, object.y2 - object.y1) < 2) return;

  delete object.start;
  pushHistory();
  annotations.push(object);
  selectedIndex = annotations.length - 1;
  selectCreatedAnnotation(object.type);
}

function addTextAnnotation(event) {
  event.preventDefault();
  const text = textValueInput.value.trim();
  if (!pendingTextPoint || !text) return;

  pushHistory();
  annotations.push({
    type: 'text',
    x: pendingTextPoint.x,
    y: pendingTextPoint.y,
    text,
    color: colorInput.value,
    fontSize: Number(fontSizeInput.value) || 32,
    background: textBgInput.checked,
  });
  selectedIndex = annotations.length - 1;
  textDialog.close();
  selectCreatedAnnotation('text');
}

function selectCreatedAnnotation(type) {
  setTool('select');
  statusEl.textContent = `${toolLabel(type)}を追加しました。すぐに移動・調整できます`;
}

function render(targetCtx = ctx, includeSelection = true) {
  if (!backgroundImage) return;
  const width = targetCtx.canvas.width;
  const height = targetCtx.canvas.height;
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.drawImage(backgroundImage, 0, 0, width, height);
  for (const object of annotations) drawObject(targetCtx, object, backgroundImage, width, height);
  if (draft && draft.type !== 'crop') drawObject(targetCtx, draft, backgroundImage, width, height);
  if (draft?.type === 'crop') drawCropOverlay(targetCtx, draft);
  else if (cropRect) drawCropOverlay(targetCtx, cropRect);
  if (includeSelection && selectedIndex >= 0 && annotations[selectedIndex]) drawSelection(targetCtx, annotations[selectedIndex]);
  targetCtx.restore();
}

function drawObject(context, object, baseImage, width, height) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = object.color || '#ef4444';
  context.lineWidth = object.strokeWidth || DEFAULT_STROKE_WIDTH;

  if (object.type === 'rect') {
    if (object.fill) {
      context.fillStyle = withAlpha(object.color, 0.16);
      context.fillRect(object.x, object.y, object.w, object.h);
    }
    context.strokeRect(object.x, object.y, object.w, object.h);
  } else if (object.type === 'ellipse') {
    context.beginPath();
    context.ellipse(object.x + object.w / 2, object.y + object.h / 2, Math.abs(object.w / 2), Math.abs(object.h / 2), 0, 0, Math.PI * 2);
    if (object.fill) {
      context.fillStyle = withAlpha(object.color, 0.16);
      context.fill();
    }
    context.stroke();
  } else if (object.type === 'line') {
    context.beginPath();
    context.moveTo(object.x1, object.y1);
    context.lineTo(object.x2, object.y2);
    context.stroke();
  } else if (object.type === 'arrow') {
    drawArrow(context, object);
  } else if (object.type === 'pen') {
    if (!object.points?.length) return context.restore();
    context.beginPath();
    context.moveTo(object.points[0].x, object.points[0].y);
    for (let i = 1; i < object.points.length; i += 1) context.lineTo(object.points[i].x, object.points[i].y);
    context.stroke();
  } else if (object.type === 'text') {
    const size = object.fontSize || 32;
    context.font = `600 ${size}px system-ui,-apple-system,Segoe UI,sans-serif`;
    context.textBaseline = 'alphabetic';
    const metrics = context.measureText(object.text);
    if (object.background) {
      context.fillStyle = 'rgba(255,255,255,.9)';
      context.fillRect(object.x - 5, object.y - size - 4, metrics.width + 10, size + 10);
    }
    context.fillStyle = object.color || '#ef4444';
    context.fillText(object.text, object.x, object.y);
  } else if (object.type === 'highlight') {
    context.fillStyle = withAlpha(object.color || '#fde047', 0.28);
    context.fillRect(object.x, object.y, object.w, object.h);
  } else if (object.type === 'blur') {
    context.save();
    context.beginPath();
    context.rect(object.x, object.y, object.w, object.h);
    context.clip();
    context.filter = 'blur(12px)';
    context.drawImage(baseImage, 0, 0, width, height);
    context.filter = 'none';
    context.restore();
    context.strokeStyle = 'rgba(15,23,42,.2)';
    context.lineWidth = 1;
    context.strokeRect(object.x, object.y, object.w, object.h);
  } else if (object.type === 'mosaic') {
    const block = Math.max(8, Math.round(Math.min(object.w, object.h) / 18));
    context.save();
    context.beginPath();
    context.rect(object.x, object.y, object.w, object.h);
    context.clip();
    context.imageSmoothingEnabled = false;
    const sw = Math.max(1, Math.ceil(object.w / block));
    const sh = Math.max(1, Math.ceil(object.h / block));
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(baseImage, object.x, object.y, object.w, object.h, 0, 0, sw, sh);
    context.drawImage(tmp, 0, 0, sw, sh, object.x, object.y, object.w, object.h);
    context.restore();
    context.strokeStyle = 'rgba(15,23,42,.2)';
    context.lineWidth = 1;
    context.strokeRect(object.x, object.y, object.w, object.h);
  }
  context.restore();
}

function drawArrow(context, object) {
  const style = arrowStyles.has(object.arrowStyle) ? object.arrowStyle : 'open';
  const angle = Math.atan2(object.y2 - object.y1, object.x2 - object.x1);

  if (style === 'solid') {
    drawSolidArrow(context, object);
    return;
  }

  context.beginPath();
  context.moveTo(object.x1, object.y1);
  if (style === 'curved') {
    const control = getArrowCurveControl(object);
    context.quadraticCurveTo(control.x, control.y, object.x2, object.y2);
  } else {
    context.lineTo(object.x2, object.y2);
  }
  context.stroke();

  if (style === 'curved') {
    const control = getArrowCurveControl(object);
    drawArrowHeadAt(context, object.x2, object.y2, Math.atan2(object.y2 - control.y, object.x2 - control.x), object.strokeWidth);
  } else {
    drawArrowHeadAt(context, object.x2, object.y2, angle, object.strokeWidth);
  }
  if (style === 'double') drawArrowHeadAt(context, object.x1, object.y1, angle + Math.PI, object.strokeWidth);
}

function drawArrowHeadAt(context, x, y, angle, strokeWidth = DEFAULT_STROKE_WIDTH) {
  const length = Math.max(12, strokeWidth * 4);
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - length * Math.cos(angle - Math.PI / 6), y - length * Math.sin(angle - Math.PI / 6));
  context.moveTo(x, y);
  context.lineTo(x - length * Math.cos(angle + Math.PI / 6), y - length * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

function drawSolidArrow(context, object) {
  const points = getSolidArrowPoints(object);
  if (!points.length) return;

  context.fillStyle = object.color || '#ef4444';
  context.strokeStyle = object.color || '#ef4444';
  context.lineWidth = Math.max(1, (object.strokeWidth || DEFAULT_STROKE_WIDTH) * 0.3);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) context.lineTo(points[i].x, points[i].y);
  context.closePath();
  context.fill();
  context.stroke();
}

function getSolidArrowPoints(object) {
  const dx = object.x2 - object.x1;
  const dy = object.y2 - object.y1;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return [];

  const ux = dx / distance;
  const uy = dy / distance;
  const px = -uy;
  const py = ux;
  const strokeWidth = object.strokeWidth || DEFAULT_STROKE_WIDTH;
  const headLength = Math.min(Math.max(40, strokeWidth * 9), distance * 0.42);
  const tailLength = Math.min(Math.max(4, strokeWidth * 0.7), distance * 0.08);
  const shaftStartHalf = Math.max(2, strokeWidth * 0.38);
  const headHalf = Math.min(Math.max(18, strokeWidth * 5), distance * 0.24);
  const shaftEndHalf = Math.min(Math.max(6, strokeWidth * 1.5), headHalf * 0.42);
  const tailX = object.x1 + ux * tailLength;
  const tailY = object.y1 + uy * tailLength;
  const baseX = object.x2 - ux * headLength;
  const baseY = object.y2 - uy * headLength;

  return [
    { x: object.x1, y: object.y1 },
    { x: tailX + px * shaftStartHalf, y: tailY + py * shaftStartHalf },
    { x: baseX + px * shaftEndHalf, y: baseY + py * shaftEndHalf },
    { x: baseX + px * headHalf, y: baseY + py * headHalf },
    { x: object.x2, y: object.y2 },
    { x: baseX - px * headHalf, y: baseY - py * headHalf },
    { x: baseX - px * shaftEndHalf, y: baseY - py * shaftEndHalf },
    { x: tailX - px * shaftStartHalf, y: tailY - py * shaftStartHalf },
  ];
}

function getArrowCurveControl(object) {
  if (Number.isFinite(object.curveControlX) && Number.isFinite(object.curveControlY)) {
    return { x: object.curveControlX, y: object.curveControlY };
  }
  const dx = object.x2 - object.x1;
  const dy = object.y2 - object.y1;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: object.x1, y: object.y1 };
  const bend = Number.isFinite(object.curveBend)
    ? object.curveBend
    : Math.min(96, Math.max(24, distance * 0.28));
  return {
    x: (object.x1 + object.x2) / 2 - (dy / distance) * bend,
    y: (object.y1 + object.y2) / 2 + (dx / distance) * bend,
  };
}

function drawSelection(context, object) {
  const bbox = getBBox(object);
  const isCurvedArrow = object.type === 'arrow' && object.arrowStyle === 'curved';
  const handleSize = Math.max(8, 10 / Math.max(zoomScale, 0.1));
  context.save();
  context.setLineDash([6 / zoomScale, 4 / zoomScale]);
  context.lineWidth = Math.max(1, 1 / zoomScale);
  context.strokeStyle = '#2563eb';
  context.strokeRect(bbox.x - 4 / zoomScale, bbox.y - 4 / zoomScale, bbox.w + 8 / zoomScale, bbox.h + 8 / zoomScale);
  context.setLineDash([]);
  context.fillStyle = '#fff';
  context.strokeStyle = '#2563eb';
  if (!isCurvedArrow) {
    context.fillRect(bbox.x + bbox.w - handleSize / 2, bbox.y + bbox.h - handleSize / 2, handleSize, handleSize);
    context.strokeRect(bbox.x + bbox.w - handleSize / 2, bbox.y + bbox.h - handleSize / 2, handleSize, handleSize);
  }

  if (isCurvedArrow) {
    const control = getArrowCurveControl(object);
    const endpointRadius = Math.max(5, 6 / Math.max(zoomScale, 0.1));
    const controlRadius = Math.max(6, 7 / Math.max(zoomScale, 0.1));
    context.setLineDash([3 / zoomScale, 3 / zoomScale]);
    context.beginPath();
    context.moveTo(object.x1, object.y1);
    context.lineTo(control.x, control.y);
    context.lineTo(object.x2, object.y2);
    context.stroke();
    context.setLineDash([]);
    const handles = [
      { x: object.x1, y: object.y1, radius: endpointRadius, fill: '#fff' },
      { x: control.x, y: control.y, radius: controlRadius, fill: '#2563eb' },
      { x: object.x2, y: object.y2, radius: endpointRadius, fill: '#fff' },
    ];
    for (const handle of handles) {
      context.beginPath();
      context.arc(handle.x, handle.y, handle.radius, 0, Math.PI * 2);
      context.fillStyle = handle.fill;
      context.fill();
      context.stroke();
    }
  }
  context.restore();
}

function drawCropOverlay(context, rect) {
  context.save();
  context.fillStyle = 'rgba(15,23,42,.48)';
  context.beginPath();
  context.rect(0, 0, canvas.width, canvas.height);
  context.rect(rect.x, rect.y, rect.w, rect.h);
  context.fill('evenodd');
  context.strokeStyle = '#2563eb';
  context.lineWidth = Math.max(2, 2 / zoomScale);
  context.setLineDash([8 / zoomScale, 5 / zoomScale]);
  context.strokeRect(rect.x, rect.y, rect.w, rect.h);
  context.restore();
}

function getBBox(object) {
  if (!object) return { x: 0, y: 0, w: 0, h: 0 };
  if (['rect', 'ellipse', 'highlight', 'blur', 'mosaic'].includes(object.type)) {
    return { x: object.x, y: object.y, w: object.w, h: object.h };
  }
  if (object.type === 'line' || object.type === 'arrow') {
    const extraPoints = object.type === 'arrow' && object.arrowStyle === 'curved'
      ? [getArrowCurveControl(object)]
      : object.type === 'arrow' && object.arrowStyle === 'solid'
        ? getSolidArrowPoints(object)
        : [];
    const xs = [object.x1, object.x2, ...extraPoints.map((point) => point.x)];
    const ys = [object.y1, object.y2, ...extraPoints.map((point) => point.y)];
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  if (object.type === 'pen') {
    const xs = object.points.map((p) => p.x);
    const ys = object.points.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (object.type === 'text') {
    ctx.save();
    ctx.font = `600 ${object.fontSize || 32}px system-ui,-apple-system,Segoe UI,sans-serif`;
    const w = ctx.measureText(object.text).width;
    ctx.restore();
    return { x: object.x, y: object.y - (object.fontSize || 32), w, h: object.fontSize || 32 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function findHit(point) {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    if (hitTest(annotations[i], point)) return i;
  }
  return -1;
}

function hitTest(object, p) {
  const tolerance = Math.max(7, 8 / Math.max(zoomScale, 0.1));
  if (object.type === 'arrow' && object.arrowStyle === 'solid' && pointInPolygon(p, getSolidArrowPoints(object))) {
    return true;
  }
  if (object.type === 'arrow' && object.arrowStyle === 'curved') {
    return distanceToQuadratic(p, object) <= tolerance;
  }
  if (object.type === 'line' || object.type === 'arrow') {
    return distanceToSegment(p, { x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }) <= tolerance;
  }
  const bbox = getBBox(object);
  return p.x >= bbox.x - tolerance && p.x <= bbox.x + bbox.w + tolerance && p.y >= bbox.y - tolerance && p.y <= bbox.y + bbox.h + tolerance;
}

function isOnResizeHandle(point, object) {
  if (object?.type === 'arrow' && object.arrowStyle === 'curved') return false;
  const bbox = getBBox(object);
  const radius = Math.max(10, 12 / Math.max(zoomScale, 0.1));
  return Math.hypot(point.x - (bbox.x + bbox.w), point.y - (bbox.y + bbox.h)) <= radius;
}

function getCurveHandleAtPoint(point, object) {
  if (object?.type !== 'arrow' || object.arrowStyle !== 'curved') return null;
  const control = getArrowCurveControl(object);
  const radius = 22 / Math.max(zoomScale, 0.1);
  const handles = [
    ['control', control.x, control.y],
    ['start', object.x1, object.y1],
    ['end', object.x2, object.y2],
  ];
  return handles.find(([, x, y]) => Math.hypot(point.x - x, point.y - y) <= radius)?.[0] || null;
}

function materializeCurveControl(object) {
  const next = clone(object);
  const control = getArrowCurveControl(next);
  next.curveControlX = control.x;
  next.curveControlY = control.y;
  delete next.curveBend;
  return next;
}

function moveObject(object, dx, dy) {
  if (['rect', 'ellipse', 'highlight', 'blur', 'mosaic'].includes(object.type)) {
    object.x += dx; object.y += dy;
  } else if (object.type === 'line' || object.type === 'arrow') {
    object.x1 += dx; object.y1 += dy; object.x2 += dx; object.y2 += dy;
    if (Number.isFinite(object.curveControlX) && Number.isFinite(object.curveControlY)) {
      object.curveControlX += dx;
      object.curveControlY += dy;
    }
  } else if (object.type === 'pen') {
    for (const p of object.points) { p.x += dx; p.y += dy; }
  } else if (object.type === 'text') {
    object.x += dx; object.y += dy;
  }
}

function resizeObject(original, bbox, point, lockAspect = false) {
  const object = clone(original);
  let nextW = Math.max(4, point.x - bbox.x);
  let nextH = Math.max(4, point.y - bbox.y);
  if (lockAspect && bbox.w > 0 && bbox.h > 0) {
    const ratio = bbox.w / bbox.h;
    if (nextW / nextH > ratio) nextH = nextW / ratio;
    else nextW = nextH * ratio;
  }
  const sx = nextW / Math.max(1, bbox.w);
  const sy = nextH / Math.max(1, bbox.h);

  if (['rect', 'ellipse', 'highlight', 'blur', 'mosaic'].includes(object.type)) {
    object.w = nextW;
    object.h = nextH;
  } else if (object.type === 'line' || object.type === 'arrow') {
    const hasStoredControl = Number.isFinite(original.curveControlX) && Number.isFinite(original.curveControlY);
    const originalControl = object.type === 'arrow' && (object.arrowStyle === 'curved' || hasStoredControl)
      ? getArrowCurveControl(original)
      : null;
    object.x1 = bbox.x + (original.x1 - bbox.x) * sx;
    object.y1 = bbox.y + (original.y1 - bbox.y) * sy;
    object.x2 = bbox.x + (original.x2 - bbox.x) * sx;
    object.y2 = bbox.y + (original.y2 - bbox.y) * sy;
    if (originalControl) {
      const nextControl = {
        x: bbox.x + (originalControl.x - bbox.x) * sx,
        y: bbox.y + (originalControl.y - bbox.y) * sy,
      };
      object.curveControlX = nextControl.x;
      object.curveControlY = nextControl.y;
      delete object.curveBend;
    }
  } else if (object.type === 'pen') {
    object.points = original.points.map((p) => ({ x: bbox.x + (p.x - bbox.x) * sx, y: bbox.y + (p.y - bbox.y) * sy }));
  } else if (object.type === 'text') {
    const scale = Math.max(0.25, Math.max(sx, sy));
    object.fontSize = Math.max(10, Math.round((original.fontSize || 32) * scale));
    object.x = bbox.x;
    object.y = bbox.y + object.fontSize;
  }
  return object;
}

function normalizeRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function normalizeSquare(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  const endpoint = {
    x: a.x + (dx < 0 ? -size : size),
    y: a.y + (dy < 0 ? -size : size),
  };
  return normalizeRect(a, endpoint);
}

function snapPointToAngles(start, point) {
  const dx = point.x - start.x1;
  const dy = point.y - start.y1;
  const distance = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x1 + Math.cos(angle) * distance, y: start.y1 + Math.sin(angle) * distance };
}

function distanceToSegment(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function distanceToQuadratic(point, object) {
  const control = getArrowCurveControl(object);
  let minimum = Infinity;
  let previous = { x: object.x1, y: object.y1 };
  const segments = 24;
  for (let i = 1; i <= segments; i += 1) {
    const t = i / segments;
    const inverse = 1 - t;
    const current = {
      x: inverse * inverse * object.x1 + 2 * inverse * t * control.x + t * t * object.x2,
      y: inverse * inverse * object.y1 + 2 * inverse * t * control.y + t * t * object.y2,
    };
    minimum = Math.min(minimum, distanceToSegment(point, previous, current));
    previous = current;
  }
  return minimum;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pushHistory(sync = true) {
  undoStack.push(clone(annotations));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  if (sync) syncEditorUi();
}

function undo() {
  if (undoStack.length) {
    redoStack.push(clone(annotations));
    annotations = undoStack.pop();
    selectedIndex = -1;
    statusEl.textContent = '元に戻しました';
    syncEditorUi();
    render();
    return;
  }
  if (cropBackup) {
    const backup = cropBackup;
    cropBackup = null;
    annotations = clone(backup.annotations);
    selectedIndex = -1;
    backgroundDataUrl = backup.dataUrl;
    loadImage(backgroundDataUrl).then((image) => {
      backgroundImage = image;
      canvas.width = backup.width;
      canvas.height = backup.height;
      dimensionsEl.textContent = `${canvas.width} × ${canvas.height}px`;
      applyZoom();
      render();
      statusEl.textContent = 'クロップを取り消しました';
      syncEditorUi();
    });
  }
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(clone(annotations));
  annotations = redoStack.pop();
  selectedIndex = -1;
  statusEl.textContent = 'やり直しました';
  syncEditorUi();
  render();
}

function deleteSelected() {
  if (selectedIndex < 0) return;
  pushHistory();
  annotations.splice(selectedIndex, 1);
  selectedIndex = -1;
  statusEl.textContent = '選択した注釈を削除しました — 元に戻せます';
  syncEditorUi();
  render();
}

function clearAll() {
  if (!annotations.length) return;
  pushHistory();
  annotations = [];
  selectedIndex = -1;
  statusEl.textContent = 'すべての注釈を削除しました — 元に戻せます';
  syncEditorUi();
  render();
}

function beginStyleEdit() {
  if (styleEditActive || selectedIndex < 0 || !annotations[selectedIndex]) return;
  pushHistory(false);
  styleEditActive = true;
}

function endStyleEdit() {
  if (!styleEditActive) return;
  styleEditActive = false;
  const object = annotations[selectedIndex];
  if (object) statusEl.textContent = `${toolLabel(object.type)}のスタイルを更新しました — 元に戻せます`;
  syncEditorUi();
  render();
}

function updateSelectedStyle(recordHistory = true) {
  if (selectedIndex < 0 || !annotations[selectedIndex]) return;
  const nextStyle = {
    color: colorInput.value,
    strokeWidth: Number(strokeInput.value),
    fill: fillInput.checked,
    fontSize: Number(fontSizeInput.value),
    background: textBgInput.checked,
    arrowStyle,
  };
  if (recordHistory) {
    styleEditActive = false;
    pushHistory();
  }
  const object = annotations[selectedIndex];
  if ('color' in object) object.color = nextStyle.color;
  if ('strokeWidth' in object) object.strokeWidth = nextStyle.strokeWidth;
  if ('fill' in object) object.fill = nextStyle.fill;
  if (object.type === 'arrow') object.arrowStyle = nextStyle.arrowStyle;
  if (object.type === 'text') {
    object.fontSize = nextStyle.fontSize || object.fontSize;
    object.background = nextStyle.background;
  }
  statusEl.textContent = `${toolLabel(object.type)}のスタイルを更新中`;
  if (recordHistory) {
    statusEl.textContent = `${toolLabel(object.type)}のスタイルを更新しました — 元に戻せます`;
    syncEditorUi();
  }
  render();
}

async function applyCrop() {
  if (!cropRect || cropRect.w < 2 || cropRect.h < 2) return;
  const x = Math.max(0, Math.round(cropRect.x));
  const y = Math.max(0, Math.round(cropRect.y));
  const w = Math.min(canvas.width - x, Math.round(cropRect.w));
  const h = Math.min(canvas.height - y, Math.round(cropRect.h));

  cropBackup = { dataUrl: backgroundDataUrl, width: canvas.width, height: canvas.height, annotations: clone(annotations) };
  const temp = document.createElement('canvas');
  temp.width = w;
  temp.height = h;
  const tempCtx = temp.getContext('2d');
  tempCtx.drawImage(backgroundImage, x, y, w, h, 0, 0, w, h);
  backgroundDataUrl = temp.toDataURL('image/png');
  backgroundImage = await loadImage(backgroundDataUrl);

  annotations = annotations
    .filter((obj) => intersects(getBBox(obj), { x, y, w, h }))
    .map((obj) => {
      const next = clone(obj);
      moveObject(next, -x, -y);
      return next;
    });

  canvas.width = w;
  canvas.height = h;
  undoStack = [];
  redoStack = [];
  selectedIndex = -1;
  cropRect = null;
  cropActions.hidden = true;
  dimensionsEl.textContent = `${w} × ${h}px`;
  applyZoom();
  render();
  statusEl.textContent = 'クロップを適用しました';
  syncEditorUi();
}

function cancelCrop(redraw = true) {
  cropRect = null;
  if (draft?.type === 'crop') draft = null;
  cropActions.hidden = true;
  syncEditorUi();
  if (redraw) render();
}

function intersects(a, b) {
  return a.x + a.w >= b.x && a.x <= b.x + b.w && a.y + a.h >= b.y && a.y <= b.y + b.h;
}

function applyZoom() {
  if (!canvas.width || !canvas.height) return;
  if (zoomInput.value === 'fit') {
    const sx = Math.max(0.05, (stage.clientWidth - 48) / canvas.width);
    const sy = Math.max(0.05, (stage.clientHeight - 48) / canvas.height);
    zoomScale = Math.min(1, sx, sy);
  } else {
    zoomScale = Number(zoomInput.value) || 1;
  }
  canvas.style.width = `${Math.round(canvas.width * zoomScale)}px`;
  canvas.style.height = `${Math.round(canvas.height * zoomScale)}px`;
  render();
}

async function savePng() {
  setActionButtonState(saveButton, 'loading', '保存中…');
  let objectUrl = '';
  try {
    const blob = await exportBlob('image/png');
    objectUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({ url: objectUrl, filename: buildFilename(), saveAs: false });
    statusEl.textContent = 'PNGを保存しました';
    setActionButtonState(saveButton, 'success', '保存済み', 2200);
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'PNGを保存できませんでした。もう一度お試しください';
    setActionButtonState(saveButton, 'error', '保存失敗', 2800);
  } finally {
    if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}

async function copyPng() {
  setActionButtonState(copyButton, 'loading', 'コピー中…');
  try {
    const blob = await exportBlob('image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    statusEl.textContent = '画像をクリップボードへコピーしました';
    setActionButtonState(copyButton, 'success', 'コピー済み', 2200);
  } catch (error) {
    console.error(error);
    statusEl.textContent = '画像をコピーできませんでした。Chromeの権限をご確認ください';
    setActionButtonState(copyButton, 'error', 'コピー失敗', 2800);
  }
}

function setActionButtonState(button, state, label, resetAfter = 0) {
  const labelEl = button.querySelector('.button-label');
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = labelEl.textContent;
  if (button.dataset.resetTimer) window.clearTimeout(Number(button.dataset.resetTimer));

  button.dataset.state = state;
  button.disabled = state === 'loading';
  labelEl.textContent = label;
  button.setAttribute('aria-label', label);

  if (resetAfter) {
    button.dataset.resetTimer = String(window.setTimeout(() => {
      delete button.dataset.state;
      delete button.dataset.resetTimer;
      button.disabled = false;
      labelEl.textContent = button.dataset.defaultLabel;
      button.setAttribute('aria-label', button.dataset.defaultLabel);
    }, resetAfter));
  }
}

async function exportBlob(type) {
  const output = document.createElement('canvas');
  output.width = canvas.width;
  output.height = canvas.height;
  const outputCtx = output.getContext('2d');
  const oldDraft = draft;
  const oldCrop = cropRect;
  draft = null;
  cropRect = null;
  render(outputCtx, false);
  draft = oldDraft;
  cropRect = oldCrop;
  return new Promise((resolve, reject) => {
    output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画像を書き出せませんでした')), type, 0.95);
  });
}

function buildFilename() {
  let host = 'page';
  try { host = new URL(capture?.url || '').hostname || host; } catch { /* local page */ }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeHost = host.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80);
  return `${safeHost}_${stamp}.png`;
}

function onKeyDown(event) {
  const tag = event.target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void savePng();
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if (event.key === 'Escape') {
    selectedIndex = -1;
    cancelCrop();
    syncEditorUi();
    render();
    return;
  }

  const shortcuts = { v: 'select', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', p: 'pen', t: 'text', h: 'highlight', b: 'blur', m: 'mosaic', c: 'crop' };
  const next = shortcuts[event.key.toLowerCase()];
  if (next && !mod) setTool(next);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('スクリーンショットを読み込めませんでした'));
    image.src = src;
  });
}

function withAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  if (value.length !== 6) return `rgba(239,68,68,${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toolLabel(value) {
  return ({ select: '選択', rect: '矩形', ellipse: '楕円', arrow: '矢印', line: '線', pen: 'ペン', text: 'テキスト', highlight: 'ハイライト', blur: 'ぼかし', mosaic: 'モザイク', crop: 'クロップ' })[value] || value;
}

function modeLabel(value) {
  return ({ visible: '表示部分', region: '選択範囲', 'full-page': 'フルページ' })[value] || value;
}
