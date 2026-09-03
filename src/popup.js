const errorBox = document.getElementById('error');
const desktopButton = document.getElementById('desktopCapture');
const localFileInput = document.getElementById('localFile');
const MAX_CANVAS_DIMENSION = 32767;
const MAX_IMAGE_PIXELS = 100_000_000;

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', async () => {
    errorBox.hidden = true;
    const mode = button.dataset.mode;
    try {
      chrome.runtime.sendMessage({ type: 'capture', mode }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && !response.ok) showError(response.error || '撮影に失敗しました');
      });
      if (mode === 'region') window.close();
      else window.setTimeout(() => window.close(), 80);
    } catch (error) {
      showError(error);
    }
  });
}

desktopButton.addEventListener('click', async () => {
  errorBox.hidden = true;
  try {
    const originWindow = await chrome.windows.getCurrent();
    const url = new URL(chrome.runtime.getURL('src/desktop-capture.html'));
    if (Number.isInteger(originWindow?.id)) url.searchParams.set('originWindowId', String(originWindow.id));
    await chrome.windows.create({
      url: url.href,
      type: 'popup',
      width: 460,
      height: 390,
      focused: true,
    });
    window.close();
  } catch (error) {
    showError(error);
  }
});

localFileInput.addEventListener('change', () => {
  const [file] = localFileInput.files || [];
  if (file) void importLocalFile(file);
  localFileInput.value = '';
});

async function importLocalFile(file) {
  errorBox.hidden = true;
  try {
    if (file.name.toLowerCase().endsWith('.localshot')) {
      const project = JSON.parse(await file.text());
      const response = await sendMessage({ type: 'import-project', project });
      if (!response?.ok) throw new Error(response?.error || '編集データを開けませんでした');
      window.close();
      return;
    }

    if (!file.type.startsWith('image/')) throw new Error('画像ファイルまたは .localshot を選択してください');
    const bitmap = await createImageBitmap(file);
    try {
      const width = bitmap.width;
      const height = bitmap.height;
      if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
        throw new Error(`画像が大きすぎます (${width}×${height}px)`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      const response = await sendMessage({
        type: 'import-capture',
        capture: {
          dataUrl,
          width,
          height,
          mode: 'local-image',
          title: file.name,
          url: '',
          capturedAt: Date.now(),
        },
      });
      if (!response?.ok) throw new Error(response?.error || '画像を開けませんでした');
      window.close();
    } finally {
      bitmap.close();
    }
  } catch (error) {
    showError(error);
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function showError(error) {
  errorBox.textContent = error instanceof Error ? error.message : String(error);
  errorBox.hidden = false;
}
