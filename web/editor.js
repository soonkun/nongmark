// 서식 편집기: 그려진 블록을 contenteditable로 직접 고치고(굵게·색·글꼴·표…), 끝나면 그 DOM을 마크다운으로 되돌린다.
// 마크다운에 없는 글자색·바탕색·글꼴·크기는 <span style="…">로 적는다(markdown.js의 parseStyle이 읽는 꼴과 같다).
// 안전: 여기서 HTML 문자열을 조립해 넣는 일은 없다 - 요소는 createElement로만 만들고, 색·글꼴 값은 parseStyle 검사를 거친 것만 쓴다.
// 브라우저의 execCommand는 style 속성을 만들지 않는 꼴(styleWithCSS=false → <b>·<i>·<font face>)로만 쓴다 - CSP가 style 속성을 막는다.
// 색·바탕·글꼴·크기는 모두 fontName 명령에 "__종류_값" 표식을 실어 넣은 뒤 우리 <span class="st" data-…>로 바꾼다(normalizeMarks).

"use strict";

const Editor = (() => {
  const FONT_SIZES = ["8pt", "9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt", "28pt", "36pt"];
  const FONTS = ["맑은 고딕", "바탕", "돋움", "굴림", "궁서", "나눔고딕", "나눔명조", "HY헤드라인M", "Arial", "Times New Roman", "Consolas"];
  const COLORS = ["#000000", "#5c5c5c", "#9a9a9a", "#c00000", "#e36c09", "#d9a300", "#1f7a42", "#2e75b6", "#1f3864", "#7030a0", "#c55a9d", "#843c0c"];
  const HILITES = ["#ffff00", "#ffd966", "#f4b183", "#c6e0b4", "#bdd7ee", "#d9c3e9", "#f8cbad", "#ededed"];
  const FONT_SIZE_LEGACY = { 1: "8pt", 2: "10pt", 3: "12pt", 4: "14pt", 5: "18pt", 6: "24pt", 7: "36pt" }; // <font size="1~7">
  const INLINE_TAGS = new Set(["A", "B", "STRONG", "I", "EM", "U", "S", "DEL", "STRIKE", "CODE", "SPAN", "FONT", "IMG", "BR", "SUB", "SUP", "MARK", "INPUT", "LABEL", "SMALL", "BIG", "TT", "KBD"]);

  /* ---------------- 꾸밈 읽기·입히기 ---------------- */

  /** 요소 하나가 가진 글자 꾸밈 {color, bg, font, size}. "none"은 "부모 것을 지운다"(null). */
  function stylesOf(e) {
    const out = {};
    const take = (k, v) => { if (v === undefined || v === "") return; out[k] = v === "none" || v === "inherit" ? null : v; };
    if (e.tagName === "FONT") {
      const face = e.getAttribute("face") || "";
      const m = face.match(/^__(color|bg|font|size)_(.*)$/);
      if (m) take(m[1], m[2]);
      else if (face) take("font", (MD.parseStyle("font-family:" + face) || {}).font);
      const c = e.getAttribute("color");
      if (c) take("color", c === "inherit" ? "none" : (MD.parseStyle("color:" + c) || {}).color);
      const sz = e.getAttribute("size");
      if (sz && FONT_SIZE_LEGACY[sz]) take("size", FONT_SIZE_LEGACY[sz]);
    }
    for (const k of ["color", "bg", "font", "size"]) if (e.dataset && e.dataset[k] !== undefined) take(k, e.dataset[k]);
    if (e.tagName === "MARK" && !out.bg) out.bg = "#ffff00";
    // 검사된 값만: 글꼴·색 이름이 꼴에 안 맞으면 버린다
    const ok = MD.parseStyle(`color:${out.color || ""};background-color:${out.bg || ""};font-family:${out.font || ""};font-size:${out.size || ""}`) || {};
    for (const k of ["color", "bg", "font", "size"]) if (out[k] && !ok[k]) delete out[k];
    return out;
  }

  /** <span class="st" data-…>에 실제 색을 CSSOM으로 입힌다(렌더 뒤 한 번, 조각을 복제한 뒤에도). */
  function applyStyles(root) {
    for (const s of root.querySelectorAll(".st")) applyStyle(s);
  }
  function applyStyle(s) {
    const d = s.dataset;
    s.style.color = d.color && d.color !== "none" ? d.color : "";
    s.style.backgroundColor = d.bg && d.bg !== "none" ? d.bg : "";
    s.style.fontFamily = d.font && d.font !== "none" ? `"${d.font}"` : "";
    s.style.fontSize = d.size && d.size !== "none" ? d.size : "";
  }

  /* ---------------- DOM → 마크다운 ---------------- */

  const escText = (t) => t.replace(/ /g, " ").replace(/([\\`*_~\[<])/g, "\\$1");
  // 줄 머리가 제목·목록·인용·표·주석으로 읽힐 글자면 역슬래시를 붙인다
  const escLineStart = (line) => (/^\s*(#{1,6}(\s|$)|>|\||[-*+](\s|$)|\d{1,9}[.)](\s|$)|<!--|```|~~~)/.test(line) ? line.replace(/^(\s*)(.)/, "$1\\$2") : line);
  // **굵게 ** 처럼 표시 안쪽에 공백이 붙으면 마크다운이 읽지 않는다 - 공백은 표시 바깥으로 낸다
  const wrapMark = (open, text, close = open) => {
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? m[1] + open + m[2] + close + m[3] : text;
  };

  function wrapStyle(text, ctx) {
    if (!text) return "";
    const props = [ctx.color && `color:${ctx.color}`, ctx.bg && `background-color:${ctx.bg}`, ctx.font && `font-family:${ctx.font}`, ctx.size && `font-size:${ctx.size}`].filter(Boolean);
    return props.length ? `<span style="${props.join(";")}">${text}</span>` : text;
  }

  function inlineOf(nodes, ctx = {}) {
    let out = "";
    for (const n of nodes) {
      if (n.nodeType === Node.TEXT_NODE) { out += wrapStyle(escText(n.nodeValue), ctx); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = n.tagName;
      const inner = () => inlineOf(n.childNodes, { ...ctx, ...stylesOf(n) });
      if (tag === "BR") out += "\n";
      else if (tag === "IMG") {
        const src = n.dataset.src || ((n.getAttribute("src") || "").startsWith("data:") ? n.getAttribute("src") : "");
        out += src ? `![${(n.getAttribute("alt") || "").replace(/[\[\]]/g, "")}](${src})` : "";
      }
      else if (tag === "A") { const href = n.dataset.href || n.getAttribute("href") || ""; const t = inner(); out += href ? `[${t || href}](${href})` : t; }
      else if (tag === "STRONG" || tag === "B") out += wrapMark("**", inner());
      else if (tag === "EM" || tag === "I") out += wrapMark("*", inner());
      else if (tag === "DEL" || tag === "S" || tag === "STRIKE") out += wrapMark("~~", inner());
      else if (tag === "U") out += wrapMark("<u>", inner(), "</u>");
      else if (tag === "CODE") { const t = n.textContent.replace(/ /g, " "); out += t ? "`" + t.replace(/`/g, "'") + "`" : ""; }
      else if (tag === "INPUT") { /* 할 일 상자는 목록 쪽에서 */ }
      else if (INLINE_TAGS.has(tag)) out += inner();
      else out += inner() + "\n"; // 칸·문단 안에 끼어든 블록 요소(Enter가 만든 div 등)는 줄로
    }
    return out;
  }

  const lines = (text) => text.replace(/ /g, " ").split("\n").map((l) => l.replace(/\s+$/, ""));
  const prefixLines = (md, first, rest) => md.split("\n").map((l, k) => (k ? rest : first) + l).join("\n");

  function listOf(list, indent = 0) {
    const ordered = list.tagName === "OL";
    let n = Number(list.getAttribute("start") || 1);
    const out = [];
    for (const li of list.children) {
      if (li.tagName === "UL" || li.tagName === "OL") { out.push(listOf(li, indent + 2)); continue; } // 브라우저가 들여쓸 때 만드는 꼴
      if (li.tagName !== "LI") continue;
      const box = [...li.children].find((c) => c.matches("input[type=checkbox]"));
      const nested = [...li.children].filter((c) => c.tagName === "UL" || c.tagName === "OL");
      const content = [...li.childNodes].filter((c) => c !== box && !nested.includes(c));
      const text = lines(inlineOf(content)).map((l) => l.trim()).join("\n").replace(/^\n+|\n+$/g, "").replace(/\n{2,}/g, "\n");
      const marker = ordered ? `${n++}.` : "-";
      const task = box ? (box.checked ? "[x] " : "[ ] ") : "";
      const pad = " ".repeat(indent);
      out.push(prefixLines(text || "", pad + marker + " " + task, pad + " ".repeat(marker.length + 1)));
      for (const sub of nested) out.push(listOf(sub, indent + 2));
    }
    return out.join("\n");
  }

  function tableOf(table) {
    const rows = [...table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr")];
    if (!rows.length) return "";
    const cell = (c) => lines(inlineOf(c.childNodes)).join(" ").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
    const width = Math.max(...rows.map((r) => r.children.length));
    const row = (r) => "| " + [...Array(width)].map((_, k) => (r.children[k] ? cell(r.children[k]) : "")).join(" | ") + " |";
    const head = rows[0];
    const align = [...Array(width)].map((_, k) => { const c = head.children[k]; return c?.classList.contains("a-center") ? ":---:" : c?.classList.contains("a-right") ? "---:" : "---"; });
    return [row(head), "| " + align.join(" | ") + " |", ...rows.slice(1).map(row)].join("\n");
  }

  function blockOf(e) {
    const tag = e.tagName;
    if (/^H[1-6]$/.test(tag)) return "#".repeat(Number(tag[1])) + " " + lines(inlineOf(e.childNodes)).join(" ").trim();
    if (tag === "UL" || tag === "OL") return listOf(e);
    if (tag === "PRE") { const lang = e.dataset.lang || ""; return "```" + lang + "\n" + e.textContent.replace(/\n$/, "") + "\n```"; }
    if (tag === "TABLE") return tableOf(e);
    if (tag === "HR") return "---";
    if (tag === "IMG") return inlineOf([e]);
    if (e.classList.contains("pagebreak")) return "<!-- pagebreak -->";
    if (e.classList.contains("callout")) {
      const type = ([...e.classList].find((c) => /^c-/.test(c)) || "c-note").slice(2).toUpperCase();
      const title = e.querySelector(":scope > .callout-title");
      const titleText = title ? lines(inlineOf(title.childNodes)).join(" ").trim() : "";
      const defaults = { NOTE: "참고", TIP: "팁", IMPORTANT: "중요", WARNING: "주의", CAUTION: "경고" };
      const body = blocksOf([...e.childNodes].filter((c) => c !== title));
      return prefixLines(`[!${type}]${titleText && titleText !== defaults[type] ? " " + titleText : ""}` + (body ? "\n" + body : ""), "> ", "> ");
    }
    if (tag === "BLOCKQUOTE") return prefixLines(blocksOf(e.childNodes) || "", "> ", "> ");
    // 문단(p·div·그 밖의 것): 줄 단위로 줄 머리 기호를 피한다
    return lines(inlineOf(e.childNodes)).map(escLineStart).join("\n").replace(/^\n+|\n+$/g, "");
  }

  /** 노드 목록 → 마크다운(블록은 빈 줄로 띄운다). 이어지는 인라인 노드들은 한 문단으로 묶는다. */
  function blocksOf(nodes) {
    const out = [];
    let run = [];
    const flushRun = () => { if (run.length) { const md = lines(inlineOf(run)).map(escLineStart).join("\n").trim(); if (md) out.push(md); run = []; } };
    for (const n of nodes) {
      if (n.nodeType === Node.TEXT_NODE) { if (n.nodeValue.trim() || run.length) run.push(n); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      if (INLINE_TAGS.has(n.tagName) && n.tagName !== "IMG") { run.push(n); continue; }
      flushRun();
      const md = blockOf(n);
      if (md || n.tagName === "P" || n.tagName === "DIV") out.push(md);
    }
    flushRun();
    return out.filter((b, k, arr) => b || (k > 0 && arr[k - 1])).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const serialize = (body) => blocksOf(body.childNodes);

  /* ---------------- 커서 ---------------- */

  /** 블록 안 글자 위치(선택이면 {a: 시작, f: 끝}). 블록 밖이면 null. */
  function caretOffset(body) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !body.contains(sel.focusNode) || !body.contains(sel.anchorNode)) return null;
    const at = (node, off) => {
      const r = document.createRange();
      r.selectNodeContents(body);
      r.setEnd(node, off);
      return r.toString().length;
    };
    const a = at(sel.anchorNode, sel.anchorOffset);
    const f = at(sel.focusNode, sel.focusOffset);
    return a === f ? f : { a, f };
  }

  /** 글자 위치 n → (노드, 오프셋). 글이 없으면 블록 끝. */
  function pointAt(body, n) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let acc = 0, node, last = null;
    while ((node = walker.nextNode())) {
      last = node;
      if (acc + node.nodeValue.length >= n) return [node, n - acc];
      acc += node.nodeValue.length;
    }
    return last ? [last, last.nodeValue.length] : [body, body.childNodes.length];
  }

  /** 커서를 놓는다. n: 0|"start", Infinity|"end", 글자 위치, {a, f}(선택). 표 블록은 첫 칸·마지막 칸 안으로. */
  function setCaret(body, n) {
    body.focus({ preventScroll: true });
    const sel = window.getSelection();
    const r = document.createRange();
    const start = n === 0 || n === "start";
    const table = body.firstElementChild?.tagName === "TABLE" ? body.firstElementChild : null;
    if (n && typeof n === "object") { sel.setBaseAndExtent(...pointAt(body, n.a), ...pointAt(body, n.f)); return; }
    if (table && (start || n === Infinity || n === "end")) {
      const cells = table.querySelectorAll("th, td");
      r.selectNodeContents(cells[start ? 0 : cells.length - 1]); // 첫 칸은 글을 통째로 골라 두어 바로 덮어쓸 수 있게(엑셀처럼)
      if (!start) r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    if (start) { r.setStart(body, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return; }
    const [node, off] = pointAt(body, typeof n === "number" ? n : Infinity);
    r.setStart(node, off);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function selectionIn(body, selector) {
    const sel = window.getSelection();
    const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const e = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const hit = e && e.closest(selector);
    return hit && body.contains(hit) ? hit : null;
  }

  /* ---------------- 꾸밈 명령 ---------------- */

  function exec(cmd, value) {
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(cmd, false, value);
  }

  /** 색·바탕·글꼴·크기: "__종류_값" 글꼴 이름으로 넣은 뒤 우리 span으로 바꾼다. 값 "none"은 꾸밈 지우기.
   * 글꼴 이름에서 브라우저가 #을 지우므로 색은 # 없이 싣고 normalizeMarks가 되돌린다. */
  function mark(body, kind, value) {
    exec("fontName", `__${kind}_${String(value).replace("#", "")}`);
    normalizeMarks(body);
  }

  function normalizeMarks(body) {
    for (const f of body.querySelectorAll("font")) {
      const face = f.getAttribute("face") || "";
      const m = face.match(/^__(color|bg|font|size)_(.*)$/);
      const decoded = m && /^[0-9a-f]{6}$/i.test(m[2]) ? "#" + m[2] : m && m[2];
      const st = m ? { [m[1]]: decoded } : stylesOf(f);
      const span = document.createElement("span");
      span.className = "st";
      for (const [k, v] of Object.entries(st)) if (v !== undefined) span.dataset[k] = v === null ? "none" : v;
      applyStyle(span);
      span.append(...f.childNodes);
      f.replaceWith(span);
    }
  }

  /** 선택 범위에 걸친 꾸밈을 모두 지운다(굵게·기울임·색·글꼴…). */
  function clearFormat(body) {
    exec("removeFormat");
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    for (const s of [...body.querySelectorAll(".st, font, u")]) if (r.intersectsNode(s)) s.replaceWith(...s.childNodes);
    body.normalize();
  }

  /* ---------------- 표 ---------------- */

  function makeTable(rows, cols) {
    const t = document.createElement("table");
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    const tr = (tag) => { const r = document.createElement("tr"); for (let k = 0; k < cols; k++) r.append(document.createElement(tag)); return r; };
    thead.append(tr("th"));
    for (let k = 1; k < rows; k++) tbody.append(tr("td"));
    t.append(thead, tbody);
    return t;
  }

  function addRow(table, after) {
    const ref = after || [...table.querySelectorAll("tr")].pop();
    const cols = ref ? ref.children.length : 2;
    const r = document.createElement("tr");
    for (let k = 0; k < cols; k++) r.append(document.createElement("td"));
    const tbody = table.querySelector("tbody") || table.appendChild(document.createElement("tbody"));
    if (after && after.parentElement.tagName !== "THEAD") after.after(r);
    else if (after) tbody.prepend(r); // 머리 줄 아래 = 첫 몸 줄
    else tbody.append(r);
    return r;
  }

  function addCol(table, cell) {
    const idx = cell ? [...cell.parentElement.children].indexOf(cell) : -1;
    for (const r of table.querySelectorAll("tr")) {
      const c = document.createElement(r.parentElement.tagName === "THEAD" ? "th" : "td");
      const ref = r.children[idx];
      if (ref) ref.after(c); else r.append(c);
    }
  }

  function delRow(table, cell) {
    const r = cell.parentElement;
    if (r.parentElement.tagName === "THEAD" || table.querySelectorAll("tbody tr").length <= 1) return false;
    r.remove();
    return true;
  }

  function delCol(table, cell) {
    const idx = [...cell.parentElement.children].indexOf(cell);
    const rows = [...table.querySelectorAll("tr")];
    if (rows[0].children.length <= 1) return false;
    for (const r of rows) r.children[idx]?.remove();
    return true;
  }

  /** Tab·Enter로 칸 사이 이동. dir: 1 다음 칸, -1 앞 칸, "down" 아래 칸. 끝이면 줄을 더한다. */
  function tableMove(cell, dir) {
    const table = cell.closest("table");
    const row = cell.parentElement;
    const cells = [...row.children];
    const col = cells.indexOf(cell);
    const rows = [...table.querySelectorAll("tr")];
    const ri = rows.indexOf(row);
    let target;
    if (dir === 1) target = cells[col + 1] || rows[ri + 1]?.children[0] || addRow(table).children[0];
    else if (dir === -1) target = cells[col - 1] || rows[ri - 1]?.lastElementChild;
    else target = rows[ri + 1]?.children[col] || addRow(table).children[col];
    if (!target) return;
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(target); // 칸의 글을 통째로 골라 둔다 - 그대로 치면 덮어쓰고, 화살표를 누르면 풀린다
    sel.removeAllRanges();
    sel.addRange(r);
  }

  return { FONTS, FONT_SIZES, COLORS, HILITES, stylesOf, applyStyles, applyStyle, serialize, inlineOf, caretOffset, setCaret, selectionIn, exec, mark, normalizeMarks, clearFormat, makeTable, addRow, addCol, delRow, delCol, tableMove };
})();

if (typeof module !== "undefined") module.exports = Editor;
