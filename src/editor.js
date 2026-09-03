import { exportEditablePptx } from './pptx-export.js';

window.__localshotExportEditablePptx = exportEditablePptx;
await loadClassicScript('editor-base.js');
await loadClassicScript('editor-extensions.js');

function loadClassicScript(filename) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(`src/${filename}`);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`${filename}を読み込めませんでした`));
    document.head.append(script);
  });
}
