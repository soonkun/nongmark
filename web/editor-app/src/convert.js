// 마크다운 ⇄ 편집기 문서(ProseMirror JSON) 변환. 파일은 언제나 마크다운이고, 편집기는 이 변환을 거쳐 열고 저장한다.
// 읽기는 markdown.js(화면·한글 내보내기와 같은 해석기)를 그대로 써서, 편집기에 보이는 것과 인쇄·hwpx가 어긋나지 않게 한다.
// 마크다운에 없는 것은 이렇게 적는다(Obsidian·Typora가 읽는 꼴이거나 다른 뷰어에서 보이지 않는 주석):
//   글자색·바탕색·글꼴·크기  <span style="color:#c00000;background-color:#ffff00;font-family:바탕;font-size:14pt">…</span>
//   밑줄 <u>…</u>   줄바꿈 <br>   쪽 나눔 <!-- pagebreak -->   표 열 너비 <!-- cols: 120,240,80 -->(표 바로 앞 줄)
//   그림 너비·정렬 ![설명|480|center](그림.png)   콜아웃 > [!NOTE] 제목

import MD from "../../markdown.js";

/* ---------------- 마크다운 → 문서 ---------------- */

const text = (t, marks = []) => ({ type: "text", text: t, ...(marks.length ? { marks } : {}) });

/** markdown.js의 inlineRuns 조각 → 인라인 노드(text·hardBreak). 이어지는 같은 링크 조각은 한 link 표시로. */
export function inlineFromMd(src) {
  const out = [];
  for (const r of MD.inlineRuns(src)) {
    if (r.image) { if (r.image.alt) out.push(text(r.image.alt.split("|")[0])); continue; } // 줄 안의 그림은 글로만(블록 그림이 정식)
    if (r.text === "\n") { out.push({ type: "hardBreak" }); continue; }
    if (!r.text) continue;
    const marks = [];
    if (r.b) marks.push({ type: "bold" });
    if (r.i) marks.push({ type: "italic" });
    if (r.s) marks.push({ type: "strike" });
    if (r.u) marks.push({ type: "underline" });
    if (r.code) marks.push({ type: "code" });
    if (r.link) marks.push({ type: "link", attrs: { href: r.link } });
    const st = {};
    if (r.color) st.color = r.color;
    if (r.bg) st.backgroundColor = r.bg;
    if (r.font) st.fontFamily = r.font;
    if (r.size) st.fontSize = r.size;
    if (Object.keys(st).length) marks.push({ type: "textStyle", attrs: st });
    out.push(text(r.text, marks));
  }
  return out;
}

const para = (content) => ({ type: "paragraph", ...(content && content.length ? { content } : {}) });
const paraFromLines = (lines) => para(inlineFromMd(lines.join("\n").replace(/\n/g, "<br>")));

const IMAGE_ONLY = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*$/;
const COLS = /^\s*<!--\s*cols:\s*([\d,\s]*)-->\s*$/i;
const COMMENT = /^\s*<!--[\s\S]*?-->\s*$/;

function imageNode(alt, src) {
  const parts = alt.split("|").map((s) => s.trim());
  const attrs = { src, alt: parts[0] || null, width: null, align: null };
  for (const p of parts.slice(1)) {
    if (/^\d+$/.test(p)) attrs.width = Number(p);
    else if (/^(left|center|right)$/.test(p)) attrs.align = p;
  }
  return { type: "image", attrs };
}

function listFromMd(lines) {
  const items = [];
  lines.forEach((line) => {
    const m = line.match(MD.RE.list);
    if (m) items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10), text: m[3] });
    else if (items.length) items[items.length - 1].text += "\n" + line.trim();
  });
  let pos = 0;
  const task = (t) => t.match(/^\[([ xX])\]\s+([\s\S]*)$/);
  const kindOf = (it) => (task(it.text) ? "taskList" : it.ordered ? "orderedList" : "bulletList");
  // 같은 들여쓰기의 항목들을 목록으로 묶는다. 종류(글머리·번호·할 일)가 바뀌면 목록을 나눈다 - 편집기 모델은 한 목록에 한 종류다.
  const buildAll = (indent, depth = 0) => {
    const lists = [];
    while (pos < items.length && items[pos].indent >= indent) {
      const first = items[pos];
      const kind = kindOf(first);
      const node = { type: kind, content: [] };
      if (kind === "orderedList" && first.start !== 1) node.attrs = { start: first.start };
      while (pos < items.length && items[pos].indent >= indent) {
        const it = items[pos];
        if (it.indent > indent && depth < 20 && node.content.length) {
          node.content[node.content.length - 1].content.push(...buildAll(it.indent, depth + 1));
          continue;
        }
        if (it.indent > indent) { it.indent = indent; } // 첫 항목부터 들여쓴 목록은 이 단계로 올린다
        if (kindOf(it) !== kind) break;
        pos++;
        const tk = task(it.text);
        const body = paraFromLines((tk ? tk[2] : it.text).split("\n"));
        node.content.push(kind === "taskList" ? { type: "taskItem", attrs: { checked: !!tk && tk[1] !== " " }, content: [body] } : { type: "listItem", content: [body] });
      }
      lists.push(node);
    }
    return lists;
  };
  return buildAll(items.length ? items[0].indent : 0);
}

function tableFromMd(lines, cols) {
  const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const align = cells(lines[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : null));
  const row = (line, head) => {
    const cs = cells(line);
    return {
      type: "tableRow",
      content: align.map((a, k) => ({
        type: head ? "tableHeader" : "tableCell",
        attrs: { colspan: 1, rowspan: 1, colwidth: cols && cols[k] ? [cols[k]] : null, textAlign: a },
        content: [para(inlineFromMd(cs[k] || ""))],
      })),
    };
  };
  return { type: "table", content: [row(lines[0], true), ...lines.slice(2).map((l) => row(l, false))] };
}

const CALLOUT_KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

export function blocksFromMd(md, depth = 0) {
  const out = [];
  let cols = null; // 바로 다음 표의 열 너비
  for (const b of MD.splitBlocks(md)) {
    const lines = b.split("\n");
    const first = lines[0];
    const colsM = b.match(COLS);
    if (colsM) { cols = colsM[1].split(",").map((s) => Number(s.trim()) || 0); continue; }
    if (MD.RE.pagebreak.test(b)) { out.push({ type: "pageBreak" }); continue; }
    if (lines.length === 1 && COMMENT.test(b)) continue; // 다른 주석은 버린다(보이지 않는 글)
    const fence = first.match(MD.RE.fence);
    if (fence) {
      const closed = lines.length > 1 && /^\s*(```+|~~~+)\s*$/.test(lines[lines.length - 1]);
      const code = lines.slice(1, closed ? -1 : undefined).join("\n");
      const lang = fence[3].trim().split(/\s/)[0] || null;
      out.push({ type: "codeBlock", attrs: { language: lang }, ...(code ? { content: [text(code)] } : {}) });
      continue;
    }
    const h = lines.length === 1 && first.match(MD.RE.heading);
    if (h) { out.push({ type: "heading", attrs: { level: h[1].length }, content: inlineFromMd(MD.headingText(h[2])) }); continue; }
    if (lines.length === 1 && MD.RE.hr.test(first)) { out.push({ type: "horizontalRule" }); continue; }
    if (MD.RE.list.test(first)) { out.push(...listFromMd(lines)); continue; }
    if (MD.RE.table.test(first) && lines.length >= 2 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[1])) { out.push(tableFromMd(lines, cols)); cols = null; continue; }
    if (MD.RE.quote.test(first) && depth < 5) {
      const inner = lines.map((l) => l.replace(/^\s*>\s?/, ""));
      const c = inner[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
      if (c) {
        const body = (c[2] ? `**${c[2]}**\n` : "") + inner.slice(1).join("\n");
        const content = blocksFromMd(body, depth + 1);
        out.push({ type: "callout", attrs: { kind: c[1].toUpperCase() }, content: content.length ? content : [para()] });
      } else {
        const content = blocksFromMd(inner.join("\n"), depth + 1);
        out.push({ type: "blockquote", content: content.length ? content : [para()] });
      }
      continue;
    }
    const img = lines.length === 1 && first.match(IMAGE_ONLY);
    if (img && MD.safeImage(img[2])) { out.push(imageNode(img[1], img[2])); continue; }
    out.push(paraFromLines(lines));
  }
  return out;
}

export function docFromMd(md) {
  const content = blocksFromMd(String(md || ""));
  return { type: "doc", content: content.length ? content : [para()] };
}

/* ---------------- 문서 → 마크다운 ---------------- */

const escText = (t) => t.replace(/ /g, " ").replace(/([\\`*_~\[<])/g, "\\$1");
const escLineStart = (line) => (/^\s*(#{1,6}(\s|$)|>|\||[-*+](\s|$)|\d{1,9}[.)](\s|$)|<!--|```|~~~)/.test(line) ? line.replace(/^(\s*)(.)/, "$1\\$2") : line);
// **굵게 ** 처럼 표시 안쪽에 공백이 붙으면 마크다운이 읽지 않는다 - 공백은 표시 바깥으로 낸다
const wrap = (open, t, close = open) => {
  const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return m[2] ? m[1] + open + m[2] + close + m[3] : t;
};

function textToMd(node) {
  const marks = Object.fromEntries((node.marks || []).map((m) => [m.type, m.attrs || {}]));
  if (marks.code) return "`" + node.text.replace(/`/g, "'") + "`";
  let t = escText(node.text);
  if (marks.bold) t = wrap("**", t);
  if (marks.italic) t = wrap("*", t);
  if (marks.strike) t = wrap("~~", t);
  if (marks.underline) t = wrap("<u>", t, "</u>");
  const st = marks.textStyle;
  if (st) {
    const props = [st.color && `color:${st.color}`, st.backgroundColor && `background-color:${st.backgroundColor}`, st.fontFamily && `font-family:${st.fontFamily}`, st.fontSize && `font-size:${st.fontSize}`].filter(Boolean);
    if (props.length) t = wrap(`<span style="${props.join(";")}">`, t, "</span>");
  }
  if (marks.link && marks.link.href) t = `[${t || marks.link.href}](${marks.link.href})`;
  return t;
}

export function inlineToMd(content) {
  return (content || []).map((n) => (n.type === "text" ? textToMd(n) : n.type === "hardBreak" ? "\n" : "")).join("");
}

const prefixLines = (md, first, rest) => md.split("\n").map((l, k) => (k ? rest : first) + l).join("\n");

function listToMd(node) {
  const ordered = node.type === "orderedList";
  let n = (node.attrs && node.attrs.start) || 1;
  const out = [];
  for (const item of node.content || []) {
    const marker = ordered ? `${n++}.` : "-";
    const task = node.type === "taskList" ? (item.attrs && item.attrs.checked ? "[x] " : "[ ] ") : "";
    const pad = " ".repeat(marker.length + 1);
    const parts = [];
    for (const child of item.content || []) parts.push(blockToMd(child)); // 하위 목록은 아래에서 pad만큼 들여쓴다
    const body = parts.filter((p) => p !== "").join("\n") || "";
    out.push(prefixLines(body, marker + " " + task, pad));
  }
  return out.join("\n");
}

function tableToMd(node) {
  const rows = node.content || [];
  if (!rows.length) return "";
  const cellMd = (c) => (c.content || []).map((p) => inlineToMd(p.content)).join(" ").replace(/\n/g, " ").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
  const width = Math.max(...rows.map((r) => (r.content || []).length));
  const line = (r) => "| " + [...Array(width)].map((_, k) => (r.content && r.content[k] ? cellMd(r.content[k]) : "")).join(" | ") + " |";
  const head = rows[0];
  const align = [...Array(width)].map((_, k) => { const a = head.content && head.content[k] && head.content[k].attrs && head.content[k].attrs.textAlign; return a === "center" ? ":---:" : a === "right" ? "---:" : "---"; });
  const cols = [...Array(width)].map((_, k) => { const c = head.content && head.content[k]; const w = c && c.attrs && c.attrs.colwidth; return w && w[0] ? Math.round(w[0]) : 0; });
  const colsLine = cols.some(Boolean) ? `<!-- cols: ${cols.join(",")} -->\n\n` : "";
  return colsLine + [line(head), "| " + align.join(" | ") + " |", ...rows.slice(1).map(line)].join("\n");
}

export function blockToMd(node) {
  const a = node.attrs || {};
  switch (node.type) {
    case "paragraph": return inlineToMd(node.content).split("\n").map((l) => escLineStart(l.replace(/\s+$/, ""))).join("\n").trim();
    case "heading": return "#".repeat(a.level || 1) + " " + inlineToMd(node.content).replace(/\n/g, " ").trim();
    case "bulletList": case "orderedList": case "taskList": return listToMd(node);
    case "blockquote": return prefixLines(blocksToMd(node.content) || "", "> ", "> ");
    case "callout": return prefixLines(`[!${a.kind || "NOTE"}]` + (blocksToMd(node.content) ? "\n" + blocksToMd(node.content) : ""), "> ", "> ");
    case "codeBlock": return "```" + (a.language || "") + "\n" + (node.content || []).map((t) => t.text || "").join("") + "\n```";
    case "horizontalRule": return "---";
    case "pageBreak": return "<!-- pagebreak -->";
    case "table": return tableToMd(node);
    case "image": {
      const extra = [a.width ? String(Math.round(a.width)) : null, a.align && a.align !== "left" ? a.align : null].filter(Boolean);
      return `![${[(a.alt || "").replace(/[\[\]|]/g, ""), ...extra].join("|")}](${a.src || ""})`;
    }
    default: return node.content ? blocksToMd(node.content) : "";
  }
}

export function blocksToMd(nodes) {
  return (nodes || []).map(blockToMd).filter((b) => b !== "").join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const mdFromDoc = (doc) => (blocksToMd(doc.content) + "\n").replace(/^\n+$/, "");
