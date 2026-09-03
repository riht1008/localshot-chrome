const XMLNS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const XMLNS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const XMLNS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export async function exportEditablePptx({
  backgroundDataUrl,
  width,
  height,
  annotations = [],
  title = 'LocalShot',
}) {
  if (!backgroundDataUrl || !width || !height) throw new Error('PPTXに書き出す画像がありません');

  const { slideCx, slideCy, scaleX, scaleY } = getSlideMetrics(width, height);
  const backgroundBytes = dataUrlToBytes(backgroundDataUrl);
  const shapeXml = annotations
    .map((object, index) => annotationToXml(object, index + 3, scaleX, scaleY))
    .filter(Boolean)
    .join('\n');

  const now = new Date().toISOString();
  const files = [
    ['[Content_Types].xml', contentTypesXml()],
    ['_rels/.rels', rootRelsXml()],
    ['docProps/app.xml', appXml()],
    ['docProps/core.xml', coreXml(title, now)],
    ['ppt/presentation.xml', presentationXml(slideCx, slideCy)],
    ['ppt/_rels/presentation.xml.rels', presentationRelsXml()],
    ['ppt/slideMasters/slideMaster1.xml', slideMasterXml()],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRelsXml()],
    ['ppt/slideLayouts/slideLayout1.xml', slideLayoutXml()],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRelsXml()],
    ['ppt/theme/theme1.xml', themeXml()],
    ['ppt/slides/slide1.xml', slideXml(slideCx, slideCy, shapeXml)],
    ['ppt/slides/_rels/slide1.xml.rels', slideRelsXml()],
    ['ppt/media/image1.png', backgroundBytes],
  ];

  return zipStore(files, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
}

function getSlideMetrics(width, height) {
  const MAX = 12192000;
  let slideCx;
  let slideCy;
  if (width >= height) {
    slideCx = MAX;
    slideCy = Math.max(914400, Math.round(MAX * (height / width)));
  } else {
    slideCy = MAX;
    slideCx = Math.max(914400, Math.round(MAX * (width / height)));
  }
  return {
    slideCx,
    slideCy,
    scaleX: slideCx / width,
    scaleY: slideCy / height,
  };
}

function annotationToXml(object, id, sx, sy) {
  if (!object?.type) return '';
  if (object.type === 'rect') return rectLikeXml(object, id, 'rect', sx, sy);
  if (object.type === 'ellipse') return rectLikeXml(object, id, 'ellipse', sx, sy);
  if (object.type === 'highlight') {
    return rectLikeXml({ ...object, fill: true, _fillAlpha: 28000, _noLine: true }, id, 'rect', sx, sy);
  }
  if (object.type === 'text') return textXml(object, id, sx, sy);
  if (object.type === 'line') return lineXml(object, id, sx, sy, false);
  if (object.type === 'arrow') {
    if (object.arrowStyle === 'solid') return solidArrowXml(object, id, sx, sy);
    if (object.arrowStyle === 'curved') return curvedArrowXml(object, id, sx, sy);
    return lineXml(object, id, sx, sy, true);
  }
  if (object.type === 'pen') return penXml(object, id, sx, sy);
  return '';
}

function rectLikeXml(object, id, preset, sx, sy) {
  const x = emu(object.x, sx);
  const y = emu(object.y, sy);
  const cx = emu(Math.max(1, object.w), sx);
  const cy = emu(Math.max(1, object.h), sy);
  const color = hex(object.color || '#ef4444');
  const alpha = object._fillAlpha ?? (object.fill ? 16000 : 100000);
  const fill = object.fill || object._fillAlpha
    ? solidFillXml(color, alpha)
    : '<a:noFill/>';
  const line = object._noLine
    ? '<a:ln><a:noFill/></a:ln>'
    : lineStyleXml(color, object.strokeWidth || 8, Math.min(sx, sy));

  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(object.type || preset)} ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
      <a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>
      ${fill}
      ${line}
    </p:spPr>
  </p:sp>`;
}

function textXml(object, id, sx, sy) {
  const fontPx = Math.max(10, object.fontSize || 32);
  const x = emu(object.x - (object.background ? 5 : 0), sx);
  const y = emu(object.y - fontPx - (object.background ? 4 : 0), sy);
  const widthPx = Math.max(fontPx * 2, estimateTextWidth(object.text || '', fontPx) + (object.background ? 10 : 0));
  const heightPx = fontPx + (object.background ? 10 : 4);
  const cx = emu(widthPx, sx);
  const cy = emu(heightPx, sy);
  const color = hex(object.color || '#ef4444');
  const fontSize100 = Math.max(800, Math.round(fontPx * (sx / 12700) * 100));
  const fill = object.background ? solidFillXml('FFFFFF', 90000) : '<a:noFill/>';

  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      ${fill}
      <a:ln><a:noFill/></a:ln>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"/>
      <a:lstStyle/>
      <a:p><a:r><a:rPr lang="ja-JP" sz="${fontSize100}" b="1">${solidFillXml(color)}</a:rPr><a:t>${xmlEscape(object.text || '')}</a:t></a:r><a:endParaRPr lang="ja-JP" sz="${fontSize100}"/></a:p>
    </p:txBody>
  </p:sp>`;
}

function lineXml(object, id, sx, sy, arrow) {
  const x1 = emu(object.x1, sx);
  const y1 = emu(object.y1, sy);
  const x2 = emu(object.x2, sx);
  const y2 = emu(object.y2, sy);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const cx = Math.max(1, Math.abs(x2 - x1));
  const cy = Math.max(1, Math.abs(y2 - y1));
  const flipH = x2 < x1 ? ' flipH="1"' : '';
  const flipV = y2 < y1 ? ' flipV="1"' : '';
  const color = hex(object.color || '#ef4444');
  const lineWidth = Math.max(12700, Math.round((object.strokeWidth || 8) * Math.min(sx, sy)));
  let endings = '';
  if (arrow) {
    const double = object.arrowStyle === 'double';
    endings = `${double ? '<a:headEnd type="triangle"/>' : ''}<a:tailEnd type="triangle"/>`;
  }

  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="${arrow ? 'Arrow' : 'Line'} ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm${flipH}${flipV}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
      <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
      <a:ln w="${lineWidth}" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${endings}</a:ln>
    </p:spPr>
  </p:sp>`;
}

function curvedArrowXml(object, id, sx, sy) {
  const control = getCurveControl(object);
  const points = [
    { x: object.x1, y: object.y1 },
    control,
    { x: object.x2, y: object.y2 },
  ];
  const bbox = bboxOf(points);
  const color = hex(object.color || '#ef4444');
  const lineWidth = Math.max(12700, Math.round((object.strokeWidth || 8) * Math.min(sx, sy)));
  const w = Math.max(1, Math.round(bbox.w * 1000));
  const h = Math.max(1, Math.round(bbox.h * 1000));
  const p1 = localPoint(points[0], bbox, w, h);
  const pc = localPoint(points[1], bbox, w, h);
  const p2 = localPoint(points[2], bbox, w, h);

  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Curved Arrow ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${emu(bbox.x, sx)}" y="${emu(bbox.y, sy)}"/><a:ext cx="${emu(Math.max(1, bbox.w), sx)}" cy="${emu(Math.max(1, bbox.h), sy)}"/></a:xfrm>
      ${customPathGeometry(w, h, `<a:moveTo><a:pt x="${p1.x}" y="${p1.y}"/></a:moveTo><a:quadBezTo><a:pt x="${pc.x}" y="${pc.y}"/><a:pt x="${p2.x}" y="${p2.y}"/></a:quadBezTo>`)}
      <a:noFill/>
      <a:ln w="${lineWidth}" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>
    </p:spPr>
  </p:sp>`;
}

function penXml(object, id, sx, sy) {
  const points = Array.isArray(object.points) ? object.points : [];
  if (points.length < 2) return '';
  const bbox = bboxOf(points);
  const w = Math.max(1, Math.round(Math.max(1, bbox.w) * 1000));
  const h = Math.max(1, Math.round(Math.max(1, bbox.h) * 1000));
  const [first, ...rest] = points.map((point) => localPoint(point, bbox, w, h));
  const path = `<a:moveTo><a:pt x="${first.x}" y="${first.y}"/></a:moveTo>${rest.map((p) => `<a:lnTo><a:pt x="${p.x}" y="${p.y}"/></a:lnTo>`).join('')}`;
  const color = hex(object.color || '#ef4444');
  const lineWidth = Math.max(12700, Math.round((object.strokeWidth || 8) * Math.min(sx, sy)));

  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Pen ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${emu(bbox.x, sx)}" y="${emu(bbox.y, sy)}"/><a:ext cx="${emu(Math.max(1, bbox.w), sx)}" cy="${emu(Math.max(1, bbox.h), sy)}"/></a:xfrm>
      ${customPathGeometry(w, h, path)}
      <a:noFill/>
      <a:ln w="${lineWidth}" cap="rnd" cmpd="sng"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>
    </p:spPr>
  </p:sp>`;
}

function solidArrowXml(object, id, sx, sy) {
  const points = getSolidArrowPoints(object);
  if (!points.length) return lineXml(object, id, sx, sy, true);
  const bbox = bboxOf(points);
  const w = Math.max(1, Math.round(Math.max(1, bbox.w) * 1000));
  const h = Math.max(1, Math.round(Math.max(1, bbox.h) * 1000));
  const mapped = points.map((point) => localPoint(point, bbox, w, h));
  const first = mapped[0];
  const path = `<a:moveTo><a:pt x="${first.x}" y="${first.y}"/></a:moveTo>${mapped.slice(1).map((p) => `<a:lnTo><a:pt x="${p.x}" y="${p.y}"/></a:lnTo>`).join('')}<a:close/>`;
  const color = hex(object.color || '#ef4444');

  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Solid Arrow ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${emu(bbox.x, sx)}" y="${emu(bbox.y, sy)}"/><a:ext cx="${emu(Math.max(1, bbox.w), sx)}" cy="${emu(Math.max(1, bbox.h), sy)}"/></a:xfrm>
      ${customPathGeometry(w, h, path)}
      <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
      <a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>
    </p:spPr>
  </p:sp>`;
}

function customPathGeometry(w, h, path) {
  return `<a:custGeom>
    <a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>
    <a:rect l="0" t="0" r="r" b="b"/>
    <a:pathLst><a:path w="${w}" h="${h}" fill="none" stroke="1">${path}</a:path></a:pathLst>
  </a:custGeom>`;
}

function localPoint(point, bbox, w, h) {
  return {
    x: Math.max(0, Math.round(((point.x - bbox.x) / Math.max(1, bbox.w)) * w)),
    y: Math.max(0, Math.round(((point.y - bbox.y) / Math.max(1, bbox.h)) * h)),
  };
}

function bboxOf(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function getCurveControl(object) {
  if (Number.isFinite(object.curveControlX) && Number.isFinite(object.curveControlY)) {
    return { x: object.curveControlX, y: object.curveControlY };
  }
  const dx = object.x2 - object.x1;
  const dy = object.y2 - object.y1;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: object.x1, y: object.y1 };
  const bend = Number.isFinite(object.curveBend) ? object.curveBend : Math.min(96, Math.max(24, distance * 0.28));
  return {
    x: (object.x1 + object.x2) / 2 - (dy / distance) * bend,
    y: (object.y1 + object.y2) / 2 + (dx / distance) * bend,
  };
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
  const strokeWidth = object.strokeWidth || 8;
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

function lineStyleXml(color, strokeWidth, scale) {
  const width = Math.max(12700, Math.round(strokeWidth * scale));
  return `<a:ln w="${width}" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>`;
}

function solidFillXml(color, alpha = 100000) {
  const alphaXml = alpha < 100000 ? `<a:alpha val="${Math.max(0, Math.min(100000, Math.round(alpha)))}"/>` : '';
  return `<a:solidFill><a:srgbClr val="${color}">${alphaXml}</a:srgbClr></a:solidFill>`;
}

function estimateTextWidth(text, fontPx) {
  let units = 0;
  for (const ch of text) units += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.58;
  return Math.max(fontPx, units * fontPx);
}

function emu(value, scale) {
  return Math.round(Math.max(0, Number(value) || 0) * scale);
}

function hex(value) {
  const cleaned = String(value || '').replace('#', '').trim();
  return /^[0-9a-f]{6}$/i.test(cleaned) ? cleaned.toUpperCase() : 'EF4444';
}

function xmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function slideXml(slideCx, slideCy, shapes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${XMLNS_A}" xmlns:r="${XMLNS_R}" xmlns:p="${XMLNS_P}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="2" name="LocalShot background"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${slideCx}" cy="${slideCy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
      ${shapes}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function presentationXml(cx, cy) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${XMLNS_A}" xmlns:r="${XMLNS_R}" xmlns:p="${XMLNS_P}" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="${cx}" cy="${cy}" type="custom"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>`;
}

function presentationRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`;
}

function slideRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;
}

function slideMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${XMLNS_A}" xmlns:r="${XMLNS_R}" xmlns:p="${XMLNS_P}">
  <p:cSld name="LocalShot">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;
}

function slideMasterRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${XMLNS_A}" xmlns:r="${XMLNS_R}" xmlns:p="${XMLNS_P}" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

function slideLayoutRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${XMLNS_A}" name="LocalShot">
  <a:themeElements>
    <a:clrScheme name="LocalShot">
      <a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="EF4444"/></a:accent2>
      <a:accent3><a:srgbClr val="22C55E"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="06B6D4"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="LocalShot">
      <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="LocalShot">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;
}

function coreXml(title, now) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title><dc:creator>LocalShot</dc:creator><cp:lastModifiedBy>LocalShot</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>LocalShot</Application><PresentationFormat>Custom</PresentationFormat><Slides>1</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides>
</Properties>`;
}

function dataUrlToBytes(dataUrl) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('背景画像の形式が不正です');
  const encoded = match[3];
  if (match[2]) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(encoded));
}

function zipStore(entries, mimeType) {
  const encoder = new TextEncoder();
  const files = entries.map(([name, value]) => ({
    nameBytes: encoder.encode(name),
    data: value instanceof Uint8Array ? value : encoder.encode(value),
  }));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const file of files) {
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + file.nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, file.nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(file.nameBytes, 30);
    localParts.push(local, file.data);

    const central = new Uint8Array(46 + file.nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, file.nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(file.nameBytes, 46);
    centralParts.push(central);

    offset += local.length + file.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, end], { type: mimeType });
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
