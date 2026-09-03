const startButton = document.getElementById('startCapture');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const params = new URLSearchParams(location.search);
const parsedOriginWindowId = Number(params.get('originWindowId'));
const originWindowId = Number.isInteger(parsedOriginWindowId) ? parsedOriginWindowId : null;

startButton.addEventListener('click', () => {
  void captureDesktop();
});

async function captureDesktop() {
  startButton.disabled = true;
  errorEl.hidden = true;
  let stream = null;
  let captureWindowId = null;
  let originWindowState = null;
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('このChromeでは画面キャプチャAPIを利用できません');
    }

    statusEl.textContent = '撮影する画面またはウィンドウを選択してください…';
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        displaySurface: 'monitor',
      },
      audio: false,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      monitorTypeSurfaces: 'include',
    });

    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('画面映像を取得できませんでした');

    statusEl.textContent = '撮影中…';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await waitForVideoFrame(video);

    const captureWindow = await chrome.windows.getCurrent();
    captureWindowId = Number.isInteger(captureWindow?.id) ? captureWindow.id : null;
    const displaySurface = track.getSettings().displaySurface;

    if (displaySurface === 'monitor' && Number.isInteger(originWindowId) && originWindowId !== captureWindowId) {
      try {
        const originWindow = await chrome.windows.get(originWindowId);
        originWindowState = originWindow.state;
        if (originWindow.state !== 'minimized') {
          await chrome.windows.update(originWindowId, { state: 'minimized' });
        }
      } catch {
        originWindowState = null;
      }
    }

    if (Number.isInteger(captureWindowId)) {
      try { await chrome.windows.update(captureWindowId, { state: 'minimized' }); } catch { /* best effort */ }
    }

    await sleep(250);
    await waitForVideoFrame(video);

    const width = video.videoWidth || track.getSettings().width || 1;
    const height = video.videoHeight || track.getSettings().height || 1;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');

    for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
    stream = null;

    await restoreOriginWindow(originWindowState);

    const response = await sendMessage({
      type: 'import-capture',
      targetWindowId: originWindowId,
      capture: {
        dataUrl,
        width,
        height,
        mode: 'desktop',
        title: `PC画面 ${new Date().toLocaleString('ja-JP')}`,
        url: '',
        capturedAt: Date.now(),
      },
    });
    if (!response?.ok) throw new Error(response?.error || 'Editorを開けませんでした');

    window.close();
  } catch (error) {
    await restoreOriginWindow(originWindowState);
    if (error?.name === 'NotAllowedError') {
      statusEl.textContent = '撮影をキャンセルしました';
    } else {
      console.error(error);
      errorEl.textContent = error instanceof Error ? error.message : String(error);
      errorEl.hidden = false;
      statusEl.textContent = '撮影できませんでした';
    }
    startButton.disabled = false;
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
  }
}

async function restoreOriginWindow(previousState) {
  if (!Number.isInteger(originWindowId)) return;
  try {
    const state = previousState && previousState !== 'minimized' ? previousState : 'normal';
    await chrome.windows.update(originWindowId, { state, focused: true });
  } catch { /* best effort */ }
}

function waitForVideoFrame(video) {
  return new Promise((resolve) => {
    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(() => resolve());
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
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

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
