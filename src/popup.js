const errorBox = document.getElementById('error');

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', async () => {
    errorBox.hidden = true;
    const mode = button.dataset.mode;
    try {
      chrome.runtime.sendMessage({ type: 'capture', mode }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && !response.ok) {
          errorBox.textContent = response.error || '撮影に失敗しました';
          errorBox.hidden = false;
        }
      });
      if (mode === 'region') window.close();
      else window.setTimeout(() => window.close(), 80);
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : String(error);
      errorBox.hidden = false;
    }
  });
}
