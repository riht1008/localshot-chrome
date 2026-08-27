# Implementation status

## Implemented

- [x] Manifest V3
- [x] Visible capture
- [x] Full-page scroll & stitch
- [x] Dominant inner scroll-container detection
- [x] Fixed/sticky duplicate mitigation
- [x] Viewport-only region picker with resize/move/nudge
- [x] Rectangle
- [x] Ellipse
- [x] Arrow
- [x] Line
- [x] Freehand pen
- [x] Text
- [x] Highlight
- [x] Blur
- [x] Mosaic
- [x] Crop
- [x] Object select / move / resize
- [x] Undo / Redo
- [x] PNG download
- [x] Clipboard copy
- [x] Zoom / fit
- [x] Network-deny CSP
- [x] Static no-network audit
- [x] Geometry tests
- [x] Chromium unpacked-extension smoke load

## Not implemented by design

- [ ] Recording
- [ ] Cloud upload
- [ ] Share links
- [ ] Accounts
- [ ] Analytics / telemetry
- [ ] External integrations
- [ ] Remote code / CDN assets

## Follow-up hardening candidates

- Visual regression tests for the editor
- Automated browser test that drives all three capture modes in a non-headless test environment
- Split-image export for pages taller than the single-canvas safety limit
- More sophisticated lazy-load settling heuristics
