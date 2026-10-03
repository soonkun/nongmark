// 한글(hwpx) 내보내기 - 마크다운을 한글 문서로. 표는 한글의 진짜 표(hp:tbl)로, 그림은 문서 안에 넣는다(BinData).
// 바탕은 assets/hwpx-template(python-hwpx의 빈 문서 골격, Apache-2.0)이고, 글자·문단 모양과 본문(section0.xml)을 여기서 만든다.
// 쪽: A4(210×297mm), 여백 좌우 20mm·위아래 30mm. 마크다운의 <!-- pagebreak --> 는 쪽 나눔이 된다.
// 바깥과 통신하지 않는다 - 결과는 바이트 배열(Uint8Array)로 돌려주고 저장은 부르는 쪽이 한다.

"use strict";

const HWPX = (() => {
  const MM = 283.465; // 1mm = 283.465 HWPUNIT
  const PAGE = { width: 59528, height: 84186, left: Math.round(20 * MM), right: Math.round(20 * MM), top: Math.round(30 * MM), bottom: Math.round(30 * MM) };
  const TEXT_WIDTH = PAGE.width - PAGE.left - PAGE.right;
  const GREEN = "#1F7A42";
  const FONT_BODY = 2; // 맑은 고딕(머리에 덧붙인다)
  const FONT_CODE = 3; // 굴림체

  const xml = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let seq = 1000;
  const nid = () => String(++seq);

  /* ---- 글자 모양·문단 모양·테두리: 필요한 것만 만들어 머리(header.xml)에 덧붙인다 ---- */
  function Styles(header) {
    const count = (tag) => Number(header.match(new RegExp(`<hh:${tag} itemCnt="(\\d+)"`))[1]);
    const char = new Map();
    const para = new Map();
    const border = new Map();
    let nextChar = count("charProperties");
    let nextPara = count("paraProperties");
    let nextBorder = count("borderFills") + 1; // borderFill id는 1부터
    const out = { char: [], para: [], border: [] };

    function charPr({ size = 1100, b = false, i = false, s = false, u = false, color = "#000000", font = FONT_BODY } = {}) {
      const key = [size, b, i, s, u, color, font].join("|");
      if (!char.has(key)) {
        const id = nextChar++;
        char.set(key, id);
        const f = `hangul="${font}" latin="${font}" hanja="${font}" japanese="${font}" other="${font}" symbol="${font}" user="${font}"`;
        const all = (v) => `hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"`;
        out.char.push(
          `<hh:charPr id="${id}" height="${size}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">` +
            `<hh:fontRef ${f}/><hh:ratio ${all(100)}/><hh:spacing ${all(0)}/><hh:relSz ${all(100)}/><hh:offset ${all(0)}/>` +
            (i ? "<hh:italic/>" : "") + (b ? "<hh:bold/>" : "") +
            `<hh:underline type="${u ? "BOTTOM" : "NONE"}" shape="SOLID" color="${color}"/>` +
            `<hh:strikeout shape="${s ? "SOLID" : "NONE"}" color="#000000"/><hh:outline type="NONE"/>` +
            `<hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>`,
        );
      }
      return char.get(key);
    }

    function borderFill({ left = "NONE", right = "NONE", top = "NONE", bottom = "NONE", width = "0.12 mm", color = "#000000", fill = null } = {}) {
      const key = [left, right, top, bottom, width, color, fill].join("|");
      if (!border.has(key)) {
        const id = nextBorder++;
        border.set(key, id);
        const side = (tag, type) => `<hh:${tag} type="${type}" width="${width}" color="${color}"/>`;
        out.border.push(
          `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
            `<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
            side("leftBorder", left) + side("rightBorder", right) + side("topBorder", top) + side("bottomBorder", bottom) +
            `<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>` +
            (fill ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#000000" alpha="0"/></hc:fillBrush>` : "") +
            `</hh:borderFill>`,
        );
      }
      return border.get(key);
    }

    function paraPr({ align = "JUSTIFY", left = 0, indent = 0, prev = 0, next = 300, line = 160, keepNext = false, borderId = 2, borderOffset = 0 } = {}) {
      const key = [align, left, indent, prev, next, line, keepNext, borderId, borderOffset].join("|");
      if (!para.has(key)) {
        const id = nextPara++;
        para.set(key, id);
        const margin = `<hh:margin><hc:intent value="${indent}" unit="HWPUNIT"/><hc:left value="${left}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${prev}" unit="HWPUNIT"/><hc:next value="${next}" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="${line}" unit="HWPUNIT"/>`;
        out.para.push(
          `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="LTR">` +
            `<hh:align horizontal="${align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>` +
            `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="1" keepWithNext="${keepNext ? 1 : 0}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
            `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
            `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}</hp:case><hp:default>${margin}</hp:default></hp:switch>` +
            `<hh:border borderFillIDRef="${borderId}" offsetLeft="${borderOffset}" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`,
        );
      }
      return para.get(key);
    }

    function apply(h) {
      // 글꼴 둘(맑은 고딕, 굴림체)을 모든 언어 묶음에 더한다
      h = h.replace(/<hh:fontface lang="([A-Z]+)" fontCnt="(\d+)">([\s\S]*?)<\/hh:fontface>/g, (_, lang, n, body) =>
        `<hh:fontface lang="${lang}" fontCnt="${Number(n) + 2}">${body}` +
        `<hh:font id="${FONT_BODY}" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>` +
        `<hh:font id="${FONT_CODE}" face="굴림체" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="9" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface>`);
      const add = (tag, items) => {
        h = h.replace(new RegExp(`<hh:${tag} itemCnt="(\\d+)">`), (_, n) => `<hh:${tag} itemCnt="${Number(n) + items.length}">`);
        h = h.replace(`</hh:${tag}>`, items.join("") + `</hh:${tag}>`);
      };
      add("borderFills", out.border);
      add("charProperties", out.char);
      add("paraProperties", out.para);
      return h;
    }
    return { charPr, paraPr, borderFill, apply };
  }

  /* ---- 그림 크기 읽기(png·jpg·gif·webp 머리) ---- */
  function imageSize(b) {
    const u32 = (o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    if (b[0] === 0x89 && b[1] === 0x50) return { w: u32(16), h: u32(20), ext: "png" };
    if (b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8), ext: "gif" };
    if (b[0] === 0x52 && b[8] === 0x57) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), ext: "webp" };
      if (kind === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, ext: "webp" }; }
      return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff, ext: "webp" };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (let o = 2; o + 9 < b.length; ) {
        if (b[o] !== 0xff) { o++; continue; }
        const marker = b[o + 1];
        const len = (b[o + 2] << 8) | b[o + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: (b[o + 5] << 8) | b[o + 6], w: (b[o + 7] << 8) | b[o + 8], ext: "jpg" };
        o += 2 + len;
      }
    }
    return null;
  }

  /* ---- 본문 만들기 ---- */
  async function build(markdown, opts = {}) {
    const tpl = opts.template; // {header, version, settings, container, containerRdf, manifest}
    const st = Styles(tpl.header);
    const images = []; // {id, ext, bytes}
    const body = [];
    let pendingBreak = false;

    const para = (inner, pr) => {
      const pb = pendingBreak ? "1" : "0";
      pendingBreak = false;
      return `<hp:p id="${nid()}" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="${pb}" columnBreak="0" merged="0">${inner}</hp:p>`;
    };
    const run = (text, charId) => {
      const parts = String(text).split("\n");
      return `<hp:run charPrIDRef="${charId}"><hp:t>${parts.map(xml).join("<hp:lineBreak/>")}</hp:t></hp:run>`;
    };
    const runsFor = (src, base = {}) =>
      MDX.inlineRuns(src).map((r) => {
        if (r.image) return "";
        const look = { ...base };
        if (r.b) look.b = true;
        if (r.i) look.i = true;
        if (r.s) look.s = true;
        if (r.code) look.font = FONT_CODE;
        if (r.code) look.color = "#B4472D";
        if (r.link) { look.u = true; look.color = GREEN; }
        return run(r.text, st.charPr(look));
      }).join("") || run("", st.charPr(base));
    const imagesIn = (src) => MDX.inlineRuns(src).filter((r) => r.image).map((r) => r.image);

    async function picture(src) {
      if (!opts.readImage) return null;
      let bytes;
      try { bytes = await opts.readImage(src); } catch { return null; }
      const size = bytes && imageSize(bytes);
      if (!size || !size.w || !size.h) return null;
      const id = `BIN${String(images.length + 1).padStart(4, "0")}`;
      images.push({ id, ext: size.ext, bytes });
      // 96dpi 기준 크기, 본문 폭·쪽 높이의 절반을 넘지 않게
      let w = Math.round(size.w * 7200 / 96);
      let h = Math.round(size.h * 7200 / 96);
      const scale = Math.min(1, TEXT_WIDTH / w, (PAGE.height - PAGE.top - PAGE.bottom) * 0.6 / h);
      w = Math.round(w * scale); h = Math.round(h * scale);
      const pid = nid();
      return `<hp:run charPrIDRef="${st.charPr()}"><hp:pic textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" reverse="0" id="${pid}" zOrder="0" numberingType="PICTURE" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${pid}">` +
        `<hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/>` +
        `<hp:rotationInfo angle="0" centerX="${w >> 1}" centerY="${h >> 1}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
        `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect><hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/>` +
        `<hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${w}" dimheight="${h}"/><hc:img binaryItemIDRef="${id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>` +
        `<hp:sz width="${w}" height="${h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic></hp:run>`;
    }

    // 표(진짜 한글 표): 열 너비는 글자 수 비례(최소 8%), 머리 줄은 굵게·연초록 바탕, 표 머리 줄 반복
    function table(rows, align, opt = {}) {
      const cols = Math.max(...rows.map((r) => r.length));
      const len = Array.from({ length: cols }, (_, c) => Math.max(2, ...rows.map((r) => [...(r[c] || "")].length)));
      const total = len.reduce((a, b) => a + b, 0);
      let widths = len.map((n) => Math.max(0.08, n / total));
      const sum = widths.reduce((a, b) => a + b, 0);
      widths = widths.map((w) => Math.round((w / sum) * TEXT_WIDTH));
      widths[cols - 1] += TEXT_WIDTH - widths.reduce((a, b) => a + b, 0);
      const line = st.borderFill({ left: "SOLID", right: "SOLID", top: "SOLID", bottom: "SOLID", color: "#7F7F7F" });
      const headFill = st.borderFill({ left: "SOLID", right: "SOLID", top: "SOLID", bottom: "SOLID", color: "#7F7F7F", fill: opt.headFill || "#E8F1E9" });
      const cellH = 1700;
      let trs = "";
      rows.forEach((row, r) => {
        let tds = "";
        for (let c = 0; c < cols; c++) {
          const head = r === 0 && !opt.noHead;
          const a = align[c] === "right" ? "RIGHT" : align[c] === "center" || head ? "CENTER" : "LEFT";
          const pr = st.paraPr({ align: a, next: 0, line: 150 });
          const cellText = (row[c] ?? "").split(/<br\s*\/?>/i).join("\n");
          const content = opt.raw ? cellText.split("\n").map((l) => para(run(l, st.charPr({ size: 950, font: FONT_CODE })), pr)).join("") : para(runsFor(cellText, { size: 1000, b: head }), pr);
          tds += `<hp:tc name="" header="${head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="1" borderFillIDRef="${opt.fill ? opt.fill : head ? headFill : line}">` +
            `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${content}</hp:subList>` +
            `<hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${widths[c]}" height="${cellH}"/><hp:cellMargin left="510" right="510" top="283" bottom="283"/></hp:tc>`;
        }
        trs += `<hp:tr>${tds}</hp:tr>`;
      });
      const tid = nid();
      const tbl = `<hp:tbl id="${tid}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${opt.noHead ? 0 : 1}" rowCnt="${rows.length}" colCnt="${cols}" cellSpacing="0" borderFillIDRef="${line}" noAdjust="0">` +
        `<hp:sz width="${TEXT_WIDTH}" widthRelTo="ABSOLUTE" height="${cellH * rows.length}" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="283" bottom="283"/>${trs}</hp:tbl>`;
      return para(`<hp:run charPrIDRef="${st.charPr()}">${tbl}</hp:run><hp:run charPrIDRef="${st.charPr()}"><hp:t/></hp:run>`, st.paraPr({ next: 400 }));
    }

    const cellsOf = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    const HEAD = { 1: 1800, 2: 1500, 3: 1300, 4: 1150, 5: 1100, 6: 1100 };

    async function block(md, depth = 0) {
      const lines = md.split("\n");
      const first = lines[0];
      if (MDX.RE.pagebreak.test(first)) { pendingBreak = true; return; }
      const fence = first.match(MDX.RE.fence);
      if (fence) {
        const closed = lines.length > 1 && /^\s*(```+|~~~+)\s*$/.test(lines[lines.length - 1]);
        const code = lines.slice(1, closed ? -1 : undefined).join("\n");
        body.push(table([[code]], [], { noHead: true, raw: true, fill: st.borderFill({ left: "SOLID", right: "SOLID", top: "SOLID", bottom: "SOLID", color: "#D9D2BF", fill: "#F6F3EA" }) }));
        return;
      }
      const h = first.match(MDX.RE.heading);
      if (h && lines.length === 1) {
        const level = h[1].length;
        body.push(para(runsFor(MDX.headingText(h[2]), { size: HEAD[level], b: true, color: level === 1 ? "#000000" : "#1A1A1A" }), st.paraPr({ align: "LEFT", prev: level === 1 ? 0 : 900, next: level === 1 ? 600 : 300, keepNext: true, line: 150 })));
        return;
      }
      if (MDX.RE.hr.test(first) && lines.length === 1) {
        body.push(para(run("", st.charPr({ size: 600 })), st.paraPr({ next: 400, borderId: st.borderFill({ bottom: "SOLID", color: "#B5AD98" }) })));
        return;
      }
      if (MDX.RE.table.test(first) && lines.length >= 2 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[1])) {
        const align = cellsOf(lines[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
        body.push(table([cellsOf(lines[0]), ...lines.slice(2).map(cellsOf)], align));
        return;
      }
      if (MDX.RE.list.test(first)) {
        const counters = [];
        for (const line of lines) {
          const m = line.match(MDX.RE.list);
          if (!m) { // 이어지는 줄
            body.push(para(runsFor(line.trim()), st.paraPr({ left: 1200 * (counters.length || 1), next: 100 })));
            continue;
          }
          const level = Math.min(6, Math.floor(m[1].replace(/\t/g, "    ").length / 2));
          counters.length = level + 1;
          let text = m[3];
          let mark;
          const task = text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
          if (task) { mark = task[1] === " " ? "☐ " : "☑ "; text = task[2]; }
          else if (/\d/.test(m[2])) { counters[level] = counters[level] ? counters[level] + 1 : parseInt(m[2], 10); mark = `${counters[level]}. `; }
          else mark = ["• ", "◦ ", "▪ "][level % 3];
          const left = 1000 + level * 1200;
          body.push(para(run(mark, st.charPr({ color: GREEN })) + runsFor(text), st.paraPr({ left, indent: -800, next: 120 })));
        }
        body.push(para(run("", st.charPr({ size: 400 })), st.paraPr({ next: 0, line: 100 })));
        return;
      }
      if (MDX.RE.quote.test(first) && depth < 5) {
        const inner = lines.map((l) => l.replace(/^\s*>\s?/, ""));
        const c = inner[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
        if (c) {
          const kind = c[1].toUpperCase();
          const fill = { NOTE: "#E8F2F6", TIP: "#E7F3E6", IMPORTANT: "#F1ECF7", WARNING: "#FBF2DC", CAUTION: "#FBE9E6" }[kind];
          const title = c[2] || { NOTE: "참고", TIP: "팁", IMPORTANT: "중요", WARNING: "주의", CAUTION: "경고" }[kind];
          const text = [`**${title}**`, ...inner.slice(1)].join("\n");
          body.push(table([[text.replace(/\n/g, "<br>")]], [], { noHead: true, fill: st.borderFill({ left: "SOLID", width: "0.7 mm", color: "#8FA89A", fill }) }));
          return;
        }
        const pr = st.paraPr({ left: 1400, next: 150, borderId: st.borderFill({ left: "SOLID", width: "0.5 mm", color: "#CDB98F" }), borderOffset: 600 });
        for (const b of MDX.splitBlocks(inner.join("\n"))) body.push(para(runsFor(b, { color: "#555555" }), pr));
        return;
      }
      // 문단(+그 안의 그림은 따로 한 줄씩)
      const text = lines.join("\n");
      const onlyImage = MDX.inlineRuns(text).every((r) => r.image || !r.text.trim());
      if (!onlyImage) body.push(para(runsFor(text), st.paraPr()));
      for (const img of imagesIn(text)) {
        const pic = await picture(img.src);
        body.push(para(pic || run(`[그림: ${img.alt || img.src}]`, st.charPr({ color: "#888888" })), st.paraPr({ align: "CENTER" })));
      }
    }

    for (const b of MDX.splitBlocks(markdown)) await block(b);

    // 첫 문단의 쪽 설정(secPr): 템플릿 문단을 그대로 쓰고 쪽 크기·여백만 바꾼다
    const sec0 = opts.template.section
      .replace(/<hp:pagePr [^>]*>/, `<hp:pagePr landscape="WIDELY" width="${PAGE.width}" height="${PAGE.height}" gutterType="LEFT_ONLY">`)
      .replace(/<hp:margin [^>]*\/>/, `<hp:margin header="0" footer="0" gutter="0" left="${PAGE.left}" right="${PAGE.right}" top="${PAGE.top}" bottom="${PAGE.bottom}"/>`)
      .replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, "");
    const section = sec0.replace("</hs:sec>", body.join("") + "</hs:sec>");

    let header = st.apply(opts.template.header);
    if (images.length) {
      const items = images.map((im, i) => `<hh:binItem id="${i}" Type="Embedding" BinData="${im.id}.${im.ext}" Format="${im.ext}"/>`).join("");
      header = header.replace("</hh:refList>", `<hh:binDataList itemCnt="${images.length}">${items}</hh:binDataList></hh:refList>`);
    }
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const title = xml(opts.title || "");
    const mime = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
    const hpf = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:dc="http://purl.org/dc/elements/1.1/" version="" unique-identifier="" id="">` +
      `<opf:metadata><opf:title>${title}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">새싹이의 농막</opf:meta>` +
      `<opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta></opf:metadata>` +
      `<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/>` +
      images.map((im) => `<opf:item id="${im.id}" href="BinData/${im.id}.${im.ext}" media-type="${mime[im.ext]}" isEmbeded="1"/>`).join("") +
      `</opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
    const enc = (s) => new TextEncoder().encode(s);
    const files = [
      ["mimetype", enc("application/hwp+zip")],
      ["version.xml", enc(opts.template.version)],
      ["Contents/header.xml", enc(header)],
      ["Contents/section0.xml", enc(section)],
      ["settings.xml", enc(opts.template.settings)],
      ["Contents/content.hpf", enc(hpf)],
      ["META-INF/container.xml", enc(opts.template.container)],
      ["META-INF/container.rdf", enc(opts.template.containerRdf)],
      ["META-INF/manifest.xml", enc(opts.template.manifest)],
      ["Preview/PrvText.txt", enc(markdown.slice(0, 1000))],
      ...images.map((im) => [`BinData/${im.id}.${im.ext}`, im.bytes]),
    ];
    return zip(files);
  }

  /* ---- ZIP(무압축) - mimetype이 첫 항목이어야 한글이 연다 ---- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const le = (n, size) => { const a = new Uint8Array(size); for (let i = 0; i < size; i++) a[i] = (n >>> (8 * i)) & 0xff; return a; };
    for (const [name, data] of files) {
      const nameBytes = new TextEncoder().encode(name);
      const crc = crc32(data);
      const local = [le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(nameBytes.length, 2), le(0, 2), nameBytes];
      const localLen = local.reduce((a, p) => a + p.length, 0);
      parts.push(...local, data);
      central.push(le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(nameBytes.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), nameBytes);
      offset += localLen + data.length;
    }
    const cenLen = central.reduce((a, p) => a + p.length, 0);
    const end = [le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(cenLen, 4), le(offset, 4), le(0, 2)];
    const all = [...parts, ...central, ...end];
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  return { build, imageSize, PAGE };
})();

if (typeof module !== "undefined") module.exports = { HWPX, setMDX: (m) => (global.MDX = m) };
