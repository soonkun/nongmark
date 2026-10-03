// 농막 마크다운 → HTML. 외부 라이브러리 없이 직접 쓴다(검토할 수 있는 크기로).
// 안전 원칙: 원문 글자는 전부 esc()를 거친 뒤에만 HTML에 들어간다. 태그는 이 파일이 만든 것뿐이다.
// 원문의 HTML 태그는 그대로 글자로 보인다(<script>도 "&lt;script&gt;"로). 링크는 http·https·mailto·상대 경로만.

"use strict";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 링크 주소 검사: 허용하지 않는 스킴(javascript:, data:, vbscript:, file: …)이면 null. */
function safeUrl(url) {
  const u = String(url).trim();
  // 제어 문자·공백을 끼워 스킴을 숨기는 수법("java\tscript:")을 막으려고 먼저 지운 꼴로 검사한다
  // 브라우저는 \를 /로 읽는다 - "/\서버\공유"가 "//서버/공유"(외부·SMB)가 되지 않게 바꿔서 본다(독립 검토 지적)
  const probe = u.replace(/[\u0000- \u007f-\u009f]/g, "").replace(/\\/g, "/").toLowerCase();
  if (/^(https?:|mailto:)/.test(probe)) return u;
  if (/^[a-z][a-z0-9+.-]*:/.test(probe)) return null;
  if (probe.startsWith("/")) return null; // 프로토콜 상대 주소(외부)·절대 경로
  return u;
}

/** 그림 주소 검사: 상대 경로(작업 폴더 안의 그림)와 래스터 data URI만. SVG는 스크립트를 품을 수 있어 뺀다. */
function safeImage(src) {
  const s = String(src).trim();
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(s)) return { kind: "data", src: s };
  const probe = s.replace(/[\u0000- \u007f-\u009f]/g, "").replace(/\\/g, "/").toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:/.test(probe) || probe.startsWith("/")) return null; // 외부 그림은 불러오지 않는다(내부망·추적 방지)
  return { kind: "file", src: s };
}

// 코드 표시는 백틱 1~3개·내용 2000자로 묶는다 - 묶지 않으면 닫히지 않은 긴 백틱 줄에서 세제곱 시간(ReDoS, 실측 2천 자에 0.7초).
const INLINE =
  /(`{1,3})([^`][\s\S]{0,2000}?)\1(?!`)|!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__|~~(?=\S)([\s\S]*?\S)~~|\*(?=[^\s*])([^*]*?[^\s*])\*|(?<![\w/])_(?=[^\s_])([^_]*?[^\s_])_(?![\w])|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** 한 줄(또는 단락) 안의 꾸밈. */
const MAX_INLINE = 10000; // 이보다 긴 한 줄은 꾸밈 없이 글자로만 - 링크 패턴이 긴 줄에서 제곱 시간(독립 검토, 10만 자 4초)

function inline(src, depth = 0) {
  if (depth > 8 || src.length > MAX_INLINE) return esc(src); // 지나친 중첩·긴 줄 방지
  let out = "";
  let last = 0;
  INLINE.lastIndex = 0;
  const re = new RegExp(INLINE.source, "g");
  let m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) out += `<code>${esc(m[2])}</code>`;
    else if (m[4] !== undefined) {
      const img = safeImage(m[4]);
      if (!img) out += `<span class="blocked" title="외부 그림은 불러오지 않습니다">[그림: ${esc(m[3] || m[4])}]</span>`;
      else if (img.kind === "data") out += `<img alt="${esc(m[3])}" src="${esc(img.src)}">`;
      else out += `<img alt="${esc(m[3])}" data-src="${esc(img.src)}">`;
    } else if (m[6] !== undefined) {
      const url = safeUrl(m[6]);
      // 상대 링크는 href 없이 - 가운데 단추·새 탭으로 열려 원래 주소가 새어 나가지 않게. 화면이 data-href로 연다
      const external = url && /^(https?:|mailto:)/i.test(url.trim());
      out += !url ? esc(m[0]) : external ? `<a href="${esc(url)}" data-href="${esc(url)}" rel="noopener noreferrer">${inline(m[5], depth + 1)}</a>` : `<a data-href="${esc(url)}">${inline(m[5], depth + 1)}</a>`;
    } else if (m[7] !== undefined) out += `<strong>${inline(m[7], depth + 1)}</strong>`;
    else if (m[8] !== undefined) out += `<strong>${inline(m[8], depth + 1)}</strong>`;
    else if (m[9] !== undefined) out += `<del>${inline(m[9], depth + 1)}</del>`;
    else if (m[10] !== undefined) out += `<em>${inline(m[10], depth + 1)}</em>`;
    else if (m[11] !== undefined) out += `<em>${inline(m[11], depth + 1)}</em>`;
    else if (m[12] !== undefined) out += `<a href="${esc(m[12])}" data-href="${esc(m[12])}">${esc(m[12])}</a>`;
    if (m[0].length === 0) re.lastIndex++;
  }
  return out + esc(src.slice(last));
}

const RE = {
  fence: /^(\s*)(```+|~~~+)(.*)$/,
  heading: /^(#{1,6})\s+(.*)$/, // 끝의 # 은 headingText()가 지운다 - 정규식으로 하면 공백이 긴 줄에서 세제곱 시간(독립 검토)
  hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
  list: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
  quote: /^\s*>/,
  table: /^\s*\|/,
};

/** 문서를 블록(편집 단위)으로 나눈다. 빈 줄이 블록을 가르고, 코드 블록·제목·구분선은 혼자 한 블록. */
function headingText(t) {
  const s = t.trimEnd();
  return s.replace(/[ \t]#+$/, "").trimEnd() || s;
}

function splitBlocks(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let cur = [];
  let kind = null;
  const flush = () => {
    if (cur.length) blocks.push(cur.join("\n"));
    cur = [];
    kind = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(RE.fence);
    if (fence) {
      flush();
      const block = [line];
      const close = new RegExp("^\\s*" + fence[2][0] + "{" + fence[2].length + ",}\\s*$");
      for (i++; i < lines.length; i++) {
        block.push(lines[i]);
        if (close.test(lines[i])) break;
      }
      blocks.push(block.join("\n"));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (RE.heading.test(line) || RE.hr.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    const k = RE.list.test(line) || (kind === "list" && /^\s{2,}\S/.test(line)) ? "list" : RE.quote.test(line) ? "quote" : RE.table.test(line) ? "table" : "para";
    if (kind && k !== kind && !(kind === "list" && k === "para" && /^\s/.test(line))) flush();
    kind = k;
    cur.push(line);
  }
  flush();
  return blocks;
}

function renderList(lines, lineOffset) {
  // 들여쓰기로 중첩. 각 항목은 원문 줄 번호(data-line)를 기억한다 - 할 일 체크가 원문을 고칠 때 쓴다.
  const items = [];
  lines.forEach((line, n) => {
    const m = line.match(RE.list);
    if (m) items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10), text: m[3], line: lineOffset + n });
    else if (items.length) items[items.length - 1].text += "\n" + line.trim();
  });
  let pos = 0;
  const MAX_NEST = 20; // 들여쓰기 중첩 상한 - 수천 단계면 재귀가 스택을 넘친다(독립 검토)
  const build = (indent, level = 0) => {
    const first = items[pos];
    const tag = first.ordered ? "ol" : "ul";
    let html = first.ordered && first.start !== 1 ? `<ol start="${first.start}">` : `<${tag}>`;
    while (pos < items.length && items[pos].indent >= indent) {
      const it = items[pos];
      if (it.indent > indent && level < MAX_NEST) {
        html = html.replace(/<\/li>$/, "") + build(it.indent, level + 1) + "</li>";
        continue;
      }
      pos++;
      const task = it.text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
      const body = inline(task ? task[2] : it.text).replace(/\n/g, "<br>");
      html += task
        ? `<li class="task${task[1] !== " " ? " done" : ""}"><input type="checkbox" data-line="${it.line}"${task[1] !== " " ? " checked" : ""}> <span>${body}</span></li>`
        : `<li>${body}</li>`;
    }
    return html + `</${tag}>`;
  };
  let html = "";
  while (pos < items.length) html += build(items[pos].indent);
  return html;
}

function renderTable(lines) {
  const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  if (lines.length < 2 || !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[1])) return `<p>${lines.map((l) => inline(l)).join("<br>")}</p>`;
  const align = cells(lines[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
  const td = (tag, c, i) => `<${tag}${align[i] ? ` class="a-${align[i]}"` : ""}>${inline(c)}</${tag}>`;
  const head = cells(lines[0]).map((c, i) => td("th", c, i)).join("");
  const body = lines.slice(2).map((r) => `<tr>${cells(r).map((c, i) => td("td", c, i)).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const CALLOUT = { NOTE: "참고", TIP: "팁", IMPORTANT: "중요", WARNING: "주의", CAUTION: "경고" };

/** 블록 하나 → HTML. */
function renderBlock(md, depth = 0) {
  const lines = md.split("\n");
  const first = lines[0];
  const fence = first.match(RE.fence);
  if (fence) {
    const closed = lines.length > 1 && /^\s*(```+|~~~+)\s*$/.test(lines[lines.length - 1]);
    const code = lines.slice(1, closed ? -1 : undefined).join("\n");
    const lang = fence[3].trim().split(/\s/)[0];
    return `<pre${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(code)}</code></pre>`;
  }
  const h = first.match(RE.heading);
  if (h && lines.length === 1) return `<h${h[1].length}>${inline(headingText(h[2]))}</h${h[1].length}>`;
  if (RE.hr.test(first) && lines.length === 1) return "<hr>";
  if (RE.list.test(first)) return renderList(lines, 0);
  if (RE.table.test(first)) return renderTable(lines);
  if (RE.quote.test(first) && depth < 5) {
    const inner = lines.map((l) => l.replace(/^\s*>\s?/, ""));
    const c = inner[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
    if (c) {
      const type = c[1].toUpperCase();
      const title = c[2] ? inline(c[2]) : CALLOUT[type];
      return `<div class="callout c-${type.toLowerCase()}"><div class="callout-title">${title}</div>${renderDoc(inner.slice(1).join("\n"), depth + 1)}</div>`;
    }
    return `<blockquote>${renderDoc(inner.join("\n"), depth + 1)}</blockquote>`;
  }
  return `<p>${lines.map((l) => inline(l)).join("<br>")}</p>`;
}

function renderDoc(text, depth = 0) {
  return splitBlocks(text).map((b) => renderBlock(b, depth)).join("");
}

/** 할 일 체크: 블록 원문의 n번째 줄의 [ ]/[x]를 뒤집는다. */
function toggleTask(md, line) {
  const lines = md.split("\n");
  if (lines[line] === undefined) return md;
  lines[line] = lines[line].replace(/^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\]/, (_, pre, mark) => `${pre}[${mark === " " ? "x" : " "}]`);
  return lines.join("\n");
}

/** 첫 제목(없으면 첫 줄) - 페이지 이름 후보. */
function titleOf(text) {
  const m = String(text).match(/^#{1,6}\s+(.+)$/m);
  return (m ? m[1] : String(text).split("\n").find((l) => l.trim()) || "").trim().slice(0, 80);
}

if (typeof module !== "undefined") module.exports = { esc, safeUrl, safeImage, inline, splitBlocks, renderBlock, renderDoc, toggleTask, titleOf };
