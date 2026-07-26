import { pxToEmu } from '../../lib/adapters/emu.mjs';
import { writeZip } from '../../lib/adapters/zip.mjs';

function shapeXml(id, text, x, y, w, h) {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="${text}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="${pxToEmu(x)}" y="${pxToEmu(y)}"/><a:ext cx="${pxToEmu(w)}" cy="${pxToEmu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${text}</a:t></a:r></a:p></p:txBody>
  </p:sp>`;
}

function slideXml(shapes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${shapes.join('')}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

export function makeTwoSlideDeck({ fixable = false } = {}) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`;
  const presentation = `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="${pxToEmu(960)}" cy="${pxToEmu(540)}"/>
</p:presentation>`;
  const presentationRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`;
  return writeZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: presentationRels },
    {
      name: 'ppt/slides/slide1.xml',
      data: slideXml(fixable
        ? [
          shapeXml(2, 'SLIDE_ONE_A', 80, 80, 300, 80),
          shapeXml(3, 'SLIDE_ONE_B', 120, 100, 300, 80),
        ]
        : [
          shapeXml(2, 'SLIDE_ONE_ONLY', 80, 80, 300, 80),
        ]),
    },
    {
      name: 'ppt/slides/slide2.xml',
      data: slideXml(fixable
        ? [
          shapeXml(2, 'SLIDE_TWO_A', 500, 260, 300, 80),
          shapeXml(3, 'SLIDE_TWO_B', 540, 280, 300, 80),
        ]
        : [
          shapeXml(2, 'SLIDE_TWO_A', 80, 80, 300, 80),
          shapeXml(3, 'SLIDE_TWO_B', 520, 320, 300, 80),
        ]),
    },
  ]);
}
