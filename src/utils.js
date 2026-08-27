export const CAPTURE_THROTTLE_MS = 550;
export const PAINT_SETTLE_MS = 120;
export const MAX_CANVAS_DIMENSION = 32760;

export function computeScrollPositions(scrollHeight, viewportHeight) {
  const total = Math.max(1, Math.round(scrollHeight));
  const view = Math.max(1, Math.round(viewportHeight));
  if (total <= view) return [0];

  const maxScroll = total - view;
  const positions = [];
  for (let y = 0; y < maxScroll; y += view) positions.push(y);
  if (positions.at(-1) !== maxScroll) positions.push(maxScroll);
  return positions;
}

export function isProtectedUrl(url = '') {
  return /^(chrome|edge|brave|opera|vivaldi|devtools|about|view-source|chrome-extension):/i.test(url);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeFilename(value) {
  return String(value || 'screenshot')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'screenshot';
}
