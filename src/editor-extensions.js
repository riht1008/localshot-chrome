const localshotProjectButton = localshotCreateActionButton('saveProject', '編集データ', 'あとでLocalShotで編集できる .localshot を保存');
const localshotPptxButton = localshotCreateActionButton('savePptx', 'PPTX', '編集可能なPowerPointを保存');
saveButton.before(localshotProjectButton, localshotPptxButton);

localshotProjectButton.addEventListener('click', () => { void localshotSaveProject(); });
localshotPptxButton.addEventListener('click', () => { void localshotSavePptx(); });

void localshotInstallExtensions().catch((error) => {
  console.error('[LocalShot] editor extension failed', error);
  statusEl.textContent = error instanceof Error ? error.message : String(error);
});

async function localshotInstallExtensions() {
  const stored = await chrome.storage.local.get('pendingProject');
  if (stored.pendingProject) {
    await localshotWaitForEditorReady();
    await localshotRestoreProject(stored.pendingProject);
    await chrome.storage.local.remove('pendingProject');
  } else {
    await localshotWaitForEditorReady();
    statusEl.textContent = `${localshotModeLabel(capture?.mode)} / ${capture?.title || 'Untitled'}`;
  }
}

function localshotCreateActionButton(id, label, ariaLabel) {
  const button = document.createElement('button');
  button.id = id;
  button.className = 'action-button';
  button.type = 'button';
  button.title = ariaLabel;
  button.setAttribute('aria-label', ariaLabel);
  button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-download"></use></svg><span class="button-label">${label}</span>`;
  return button;
}

async function localshotRestoreProject(project) {
  if (!project?.backgroundDataUrl || !Number.isFinite(project.width) || !Number.isFinite(project.height)) {
    throw new Error('LocalShot編集データの形式が不正です');
  }

  backgroundDataUrl = project.backgroundDataUrl;
  backgroundImage = await loadImage(backgroundDataUrl);
  annotations = clone(Array.isArray(project.annotations) ? project.annotations : []);
  canvas.width = Math.max(1, Math.round(project.width));
  canvas.height = Math.max(1, Math.round(project.height));
  capture = {
    ...(project.capture || capture || {}),
    dataUrl: backgroundDataUrl,
    width: canvas.width,
    height: canvas.height,
    mode: project.capture?.mode || 'project',
    title: project.capture?.title || project.title || 'LocalShot編集データ',
  };

  undoStack = [];
  redoStack = [];
  cropBackup = null;
  cropRect = null;
  selectedIndex = -1;
  draft = null;
  interaction = null;

  dimensionsEl.textContent = `${canvas.width} × ${canvas.height}px`;
  captureTitleEl.textContent = capture.title;
  document.title = `${capture.title} — LocalShot`;
  applyZoom();
  render();
  syncEditorUi();
  statusEl.textContent = `編集データ / ${capture.title}`;
}

async function localshotSaveProject() {
  setActionButtonState(localshotProjectButton, 'loading', '保存中…');
  let objectUrl = '';
  try {
    const captureMeta = { ...(capture || {}), width: canvas.width, height: canvas.height };
    delete captureMeta.dataUrl;
    const project = {
      version: 1,
      kind: 'localshot-editable',
      title: capture?.title || 'LocalShot編集データ',
      capture: captureMeta,
      backgroundDataUrl,
      width: canvas.width,
      height: canvas.height,
      annotations: clone(annotations),
      savedAt: Date.now(),
    };
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
    objectUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url: objectUrl,
      filename: localshotBuildFilename('localshot'),
      saveAs: false,
    });
    statusEl.textContent = '編集データ (.localshot) を保存しました。「画像 / 編集データを開く」から再編集できます';
    setActionButtonState(localshotProjectButton, 'success', '保存済み', 2600);
  } catch (error) {
    console.error(error);
    statusEl.textContent = '編集データを保存できませんでした';
    setActionButtonState(localshotProjectButton, 'error', '保存失敗', 2800);
  } finally {
    if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}

async function localshotSavePptx() {
  setActionButtonState(localshotPptxButton, 'loading', '生成中…');
  let objectUrl = '';
  try {
    const pptxBackground = localshotExportPptxBackground();
    const editableAnnotations = annotations
      .filter((object) => object.type !== 'blur' && object.type !== 'mosaic')
      .map((object) => object.type === 'arrow' && object.arrowStyle === 'solid'
        ? { ...object, arrowStyle: 'open' }
        : object);
    const blob = await window.__localshotExportEditablePptx({
      backgroundDataUrl: pptxBackground,
      width: canvas.width,
      height: canvas.height,
      annotations: clone(editableAnnotations),
      title: capture?.title || 'LocalShot',
    });
    objectUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url: objectUrl,
      filename: localshotBuildFilename('pptx'),
      saveAs: false,
    });
    statusEl.textContent = '編集可能なPPTXを保存しました';
    setActionButtonState(localshotPptxButton, 'success', '保存済み', 2200);
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'PPTXを生成できませんでした';
    setActionButtonState(localshotPptxButton, 'error', '生成失敗', 2800);
  } finally {
    if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}

function localshotExportPptxBackground() {
  const privacyObjects = annotations.filter((object) => object.type === 'blur' || object.type === 'mosaic');
  if (!privacyObjects.length) return backgroundDataUrl;

  const output = document.createElement('canvas');
  output.width = canvas.width;
  output.height = canvas.height;
  const outputCtx = output.getContext('2d');
  outputCtx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
  for (const object of privacyObjects) drawObject(outputCtx, object, backgroundImage, canvas.width, canvas.height);
  return output.toDataURL('image/png');
}

function localshotBuildFilename(extension) {
  let base = 'localshot';
  try { base = new URL(capture?.url || '').hostname || base; } catch { /* local image */ }
  if (base === 'localshot' && capture?.title) base = capture.title;

  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeBase = String(base)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'localshot';
  return `${safeBase}_${stamp}.${extension}`;
}

function localshotModeLabel(value) {
  return ({
    visible: '表示部分',
    region: '選択範囲',
    'full-page': 'フルページ',
    desktop: 'PC画面',
    'local-image': 'ローカル画像',
    project: '編集データ',
  })[value] || value || '画像';
}

function localshotWaitForEditorReady() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (backgroundImage && canvas.width > 0 && canvas.height > 0 && dimensionsEl.textContent.includes('×')) {
        window.setTimeout(resolve, 0);
        return;
      }
      if (Date.now() - startedAt > 10000) {
        reject(new Error('Editorの初期化を完了できませんでした'));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  });
}
