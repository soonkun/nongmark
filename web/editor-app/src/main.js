// 새싹이의 농막 편집기(ProseMirror/Tiptap). 화면(app.js)은 여기서 내놓는 window.NMEditor만 쓴다.
//   const ed = NMEditor.create(container, { markdown, onChange, onPages, resolveImage(src)→Promise<dataURL>, saveImage(file)→Promise<상대경로>, theme })
//   ed.getMarkdown() / ed.setMarkdown(md) / ed.focus() / ed.destroy() / ed.cmd(이름, 값) / ed.state() / ed.on(이벤트, fn)
// 네트워크: 아무 데도 연결하지 않는다. 그림은 resolveImage가 준 data: 주소만 보여 준다.
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import DragHandle from "@tiptap/extension-drag-handle";
import Suggestion from "@tiptap/suggestion";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Callout, CALLOUTS, PageBreak, NmTableCell, NmTableHeader, NmImage, MoveBlock, Pages, TableResize } from "./nodes.js";
import { docFromMd, mdFromDoc } from "./convert.js";
import MD from "../../markdown.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/* ---------------- / 메뉴 ---------------- */

const SLASH_ITEMS = [
  { name: "본문", hint: "일반 문단", run: (e) => e.chain().focus().setParagraph().run() },
  { name: "제목 1", hint: "큰 제목", run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { name: "제목 2", hint: "중간 제목", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { name: "제목 3", hint: "작은 제목", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { name: "글머리 목록", hint: "• 항목", run: (e) => e.chain().focus().toggleBulletList().run() },
  { name: "번호 목록", hint: "1. 항목", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { name: "할 일", hint: "체크 상자", run: (e) => e.chain().focus().toggleTaskList().run() },
  { name: "인용", hint: "인용문", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { name: "콜아웃 · 참고", hint: "눈에 띄는 상자", run: (e) => e.chain().focus().setCallout("NOTE").run() },
  { name: "콜아웃 · 주의", hint: "경고 상자", run: (e) => e.chain().focus().setCallout("WARNING").run() },
  { name: "코드", hint: "고정폭 코드 블록", run: (e) => e.chain().focus().setCodeBlock().run() },
  { name: "표", hint: "3×3 표(머리 줄 포함)", run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { name: "그림", hint: "그림 파일 넣기", run: (e, ctx) => ctx.pickImage() },
  { name: "구분선", hint: "가로줄", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { name: "쪽 나누기", hint: "여기서 다음 쪽으로", run: (e) => e.chain().focus().setPageBreak().run() },
];

function slashExtension(ctx) {
  return Extension.create({
    name: "slashMenu",
    addProseMirrorPlugins() {
      const editor = this.editor;
      let menu = null, items = [], index = 0, range = null;
      const close = () => { if (menu) menu.remove(); menu = null; };
      const draw = (clientRect) => {
        if (!menu) { menu = el("div", "nm-slash"); document.body.append(menu); }
        menu.textContent = "";
        items.forEach((it, n) => {
          const row = el("div", "nm-slash-item" + (n === index ? " on" : ""));
          row.append(el("span", "nm-slash-name", it.name), el("span", "nm-slash-hint", it.hint));
          row.onmousedown = (ev) => { ev.preventDefault(); index = n; pick(); };
          menu.append(row);
        });
        const r = clientRect && clientRect();
        if (r) {
          menu.style.left = Math.min(r.left, window.innerWidth - 270) + "px";
          menu.style.top = (r.bottom + 6 + 330 > window.innerHeight ? r.top - 6 - menu.offsetHeight : r.bottom + 6) + "px";
        }
      };
      const pick = () => {
        const it = items[index];
        if (!it || !range) return;
        editor.chain().focus().deleteRange(range).run();
        close();
        it.run(editor, ctx);
      };
      return [
        Suggestion({
          editor,
          pluginKey: new PluginKey("nm-slash"),
          char: "/",
          startOfLine: true,
          allowSpaces: false,
          items: ({ query }) => SLASH_ITEMS.filter((it) => !query || it.name.includes(query) || it.hint.includes(query)),
          render: () => ({
            onStart: (p) => { items = p.items; index = 0; range = p.range; draw(p.clientRect); },
            onUpdate: (p) => { items = p.items; index = Math.min(index, Math.max(0, items.length - 1)); range = p.range; if (items.length) draw(p.clientRect); else close(); },
            onKeyDown: ({ event }) => {
              if (!menu) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") { index = (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; draw(); return true; }
              if (event.key === "Enter" || event.key === "Tab") { pick(); return true; }
              if (event.key === "Escape") { close(); return true; }
              return false;
            },
            onExit: close,
          }),
        }),
      ];
    },
  });
}

/* ---------------- 글을 고르면 뜨는 작은 서식 띠 ---------------- */

const COLORS = ["#000000", "#5c5c5c", "#9a9a9a", "#c00000", "#e36c09", "#d9a300", "#1f7a42", "#2e75b6", "#1f3864", "#7030a0", "#c55a9d", "#843c0c"];
const HILITES = ["#ffff00", "#ffd966", "#f4b183", "#c6e0b4", "#bdd7ee", "#d9c3e9", "#f8cbad", "#ededed"];
const FONTS = ["맑은 고딕", "바탕", "돋움", "굴림", "궁서", "나눔고딕", "나눔명조", "HY헤드라인M", "Arial", "Times New Roman", "Consolas"];
const SIZES = ["8pt", "9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt", "28pt", "36pt"];

function bubble(editor, host) {
  const bar = el("div", "nm-bubble");
  bar.hidden = true;
  host.append(bar);
  let pop = null;
  const closePop = () => { if (pop) pop.remove(); pop = null; };
  const btn = (label, title, fn, isOn) => {
    const b = el("button", "nm-bb", label);
    b.type = "button";
    b.title = title;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => { closePop(); fn(); };
    b._isOn = isOn;
    bar.append(b);
    return b;
  };
  const palette = (anchor, colors, apply, clearLabel) => {
    closePop();
    pop = el("div", "nm-pal");
    for (const c of colors) {
      const b = el("button");
      b.type = "button";
      b.style.background = c;
      b.title = c;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => { apply(c); closePop(); };
      pop.append(b);
    }
    const none = el("button", "none", clearLabel);
    none.type = "button";
    none.onmousedown = (e) => e.preventDefault();
    none.onclick = () => { apply(null); closePop(); };
    pop.append(none);
    bar.append(pop);
    pop.style.left = anchor.offsetLeft + "px";
  };
  const list = (anchor, values, labelOf, apply, clearLabel, styleOf) => {
    closePop();
    pop = el("div", "nm-pal nm-list");
    for (const v of [null, ...values]) {
      const b = el("button", "pi", v === null ? clearLabel : labelOf(v));
      b.type = "button";
      if (v !== null && styleOf) styleOf(b, v);
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => { apply(v); closePop(); };
      pop.append(b);
    }
    bar.append(pop);
    pop.style.left = anchor.offsetLeft + "px";
  };
  const bold = btn("가", "굵게 (Ctrl+B)", () => editor.chain().focus().toggleBold().run(), () => editor.isActive("bold"));
  bold.firstChild && (bold.style.fontWeight = "800");
  const italic = btn("가", "기울임 (Ctrl+I)", () => editor.chain().focus().toggleItalic().run(), () => editor.isActive("italic"));
  italic.style.fontStyle = "italic";
  const under = btn("가", "밑줄 (Ctrl+U)", () => editor.chain().focus().toggleUnderline().run(), () => editor.isActive("underline"));
  under.style.textDecoration = "underline";
  const strike = btn("가", "취소선", () => editor.chain().focus().toggleStrike().run(), () => editor.isActive("strike"));
  strike.style.textDecoration = "line-through";
  bar.append(el("span", "nm-bb-sep"));
  const font = btn("글꼴", "글꼴", () => list(font, FONTS, (f) => f, (f) => (f ? editor.chain().focus().setFontFamily(f).run() : editor.chain().focus().unsetFontFamily().run()), "기본 글꼴", (b, f) => (b.style.fontFamily = `"${f}"`)));
  const size = btn("크기", "글자 크기", () => list(size, SIZES, (z) => z, (z) => (z ? editor.chain().focus().setFontSize(z).run() : editor.chain().focus().unsetFontSize().run()), "기본 크기(11pt)"));
  const color = btn("A", "글자색", () => palette(color, COLORS, (c) => (c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run()), "기본 색으로"));
  color.classList.add("nm-bb-color");
  const hl = btn("가", "형광펜", () => palette(hl, HILITES, (c) => (c ? editor.chain().focus().setBackgroundColor(c).run() : editor.chain().focus().unsetBackgroundColor().run()), "형광펜 지우기"));
  hl.classList.add("nm-bb-hl");
  bar.append(el("span", "nm-bb-sep"));
  btn("링크", "링크 걸기", () => {
    const prev = editor.getAttributes("link").href || "";
    const url = prompt("링크 주소 (https://… 또는 다른 문서.md)", prev || "https://");
    if (url === null) return;
    if (!url || url === "https://") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, () => editor.isActive("link"));
  btn("지우기", "서식 지우기", () => editor.chain().focus().unsetAllMarks().run());

  const update = () => {
    const { from, to, empty } = editor.state.selection;
    const inCode = editor.isActive("codeBlock");
    if (empty || inCode || !editor.isFocused && !bar.contains(document.activeElement)) { bar.hidden = true; closePop(); return; }
    if (editor.state.doc.textBetween(from, to).trim() === "") { bar.hidden = true; return; }
    for (const b of bar.querySelectorAll(".nm-bb")) if (b._isOn) b.classList.toggle("on", !!b._isOn());
    bar.hidden = false;
    const a = editor.view.coordsAtPos(from), z = editor.view.coordsAtPos(to);
    const hostR = host.getBoundingClientRect();
    const zoom = Number(getComputedStyle(host).zoom) || 1;
    const left = Math.max(8, Math.min((Math.min(a.left, z.left) - hostR.left) / zoom, hostR.width / zoom - bar.offsetWidth - 8));
    const top = (a.top - hostR.top) / zoom - bar.offsetHeight - 10;
    bar.style.left = left + "px";
    bar.style.top = (top < 4 ? (z.bottom - hostR.top) / zoom + 10 : top) + "px";
  };
  editor.on("selectionUpdate", update);
  editor.on("blur", () => setTimeout(update, 150));
  editor.on("focus", update);
  return { update, destroy: () => bar.remove() };
}

/* ---------------- 편집기 만들기 ---------------- */

function create(container, opts = {}) {
  const sheet = el("div", "nm-sheet" + (opts.pages === false ? " flow" : ""));
  container.append(sheet);
  const imageCache = new Map(); // 상대 경로 → data: 주소
  const ctx = {
    pickImage() {
      const input = el("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/gif,image/webp";
      input.onchange = async () => { const f = input.files[0]; if (f) await insertImageFile(f); };
      input.click();
    },
  };
  const listeners = { change: [], pages: [], state: [] };
  const emit = (name, ...a) => listeners[name].forEach((fn) => fn(...a));
  let twoMode = false, pageCount = 1;
  const PAGE_W = Math.round(210 * 96 / 25.4), GAP_W = 24; // 쪽 한 장의 폭(px)과 쪽 사이 간격
  const fitWidth = () => { sheet.style.width = twoMode ? pageCount * (PAGE_W + GAP_W) - GAP_W + "px" : ""; };

  const editor = new Editor({
    element: sheet,
    editorProps: {
      attributes: { class: "nm-pm", spellcheck: "false" },
      handlePaste(view, event) {
        const file = [...(event.clipboardData?.files || [])].find((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
        if (file) { insertImageFile(file); return true; }
        return false;
      },
      handleDrop(view, event) {
        const file = [...(event.dataTransfer?.files || [])].find((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
        if (file) { event.preventDefault(); insertImageFile(file); return true; }
        return false;
      },
    },
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false, codeBlock: { defaultLanguage: null } }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ["http", "https", "mailto"], validate: (href) => !!MD.safeUrl(href) }),
      Table.configure({ resizable: true, cellMinWidth: 40, lastColumnResizable: true }),
      TableRow, NmTableCell, NmTableHeader,
      TaskList, TaskItem.configure({ nested: true }),
      TextStyleKit,
      NmImage.configure({ inline: false, allowBase64: false, resize: { enabled: true, minWidth: 40 }, resolve: (src) => imageCache.get(src) || (String(src || "").startsWith("data:") ? src : "") }),
      Callout, PageBreak, MoveBlock, TableResize,
      Placeholder.configure({ placeholder: ({ node, editor: e }) => (e.state.doc.childCount === 1 && node.type.name === "paragraph" ? "여기를 눌러 쓰기 시작 · / 로 블록 넣기" : "") }),
      DragHandle.configure({
        render: () => { const h = el("div", "nm-handle"); h.title = "끌어서 옮기기 · Alt+↑↓"; h.textContent = "⋮⋮"; return h; },
      }),
      slashExtension(ctx),
      Pages.configure({ onPages: (n) => { if (n !== pageCount) { pageCount = Math.max(1, n); fitWidth(); } emit("pages", n); }, enabled: opts.pages !== false }),
    ],
    content: docFromMd(""),
    onUpdate: () => emit("change"),
    onSelectionUpdate: () => emit("state"),
    onTransaction: () => emit("state"),
  });

  // 그림: 문서를 넣기 전에 그 안의 그림 주소를 data: 주소로 미리 받아 둔다(그리는 쪽은 동기라서)
  async function preload(md) {
    if (!opts.resolveImage) return;
    const srcs = new Set();
    for (const m of String(md).matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/g)) if (!imageCache.has(m[1])) srcs.add(m[1]);
    await Promise.all([...srcs].map(async (src) => { try { imageCache.set(src, (await opts.resolveImage(src)) || ""); } catch { imageCache.set(src, ""); } }));
  }

  async function insertImageFile(file) {
    if (!opts.saveImage) return;
    const rel = await opts.saveImage(file);
    if (!rel) return;
    await preload(`![](${rel})`);
    editor.chain().focus().setImage({ src: rel, alt: "" }).run();
  }

  const bb = bubble(editor, container);

  const handle = {
    editor,
    getMarkdown: () => mdFromDoc(editor.getJSON()),
    async setMarkdown(md) { await preload(md); editor.commands.setContent(docFromMd(md), { emitUpdate: false }); },
    focus: () => editor.commands.focus(),
    destroy: () => { bb.destroy(); editor.destroy(); sheet.remove(); },
    on: (name, fn) => listeners[name].push(fn),
    pickImage: ctx.pickImage,
    /** 두 쪽 나란히(다단) 보기: 쪽을 옆으로 세운다. 편집은 그대로 된다. 폭은 쪽 수에 맞춰 둔다 */
    setTwo(on) {
      sheet.classList.toggle("two", !!on);
      twoMode = !!on;
      fitWidth();
    },
    /** 쪽 나눔 보기 켜고 끄기 */
    setPages(on) {
      editor.storage.pages.enabled = !!on;
      sheet.classList.toggle("flow", !on);
      editor.view.dispatch(editor.state.tr.setMeta("nm-pages-refresh", true));
    },
    /** 도구 막대가 쓰는 명령 */
    cmd(name, value) {
      const c = editor.chain().focus();
      switch (name) {
        case "block": return value === "p" ? c.setParagraph().run() : value === "blockquote" ? c.toggleBlockquote().run() : value === "code" ? c.toggleCodeBlock().run() : c.toggleHeading({ level: Number(value.slice(1)) }).run();
        case "bold": return c.toggleBold().run();
        case "italic": return c.toggleItalic().run();
        case "underline": return c.toggleUnderline().run();
        case "strike": return c.toggleStrike().run();
        case "font": return value ? c.setFontFamily(value).run() : c.unsetFontFamily().run();
        case "size": return value ? c.setFontSize(value).run() : c.unsetFontSize().run();
        case "color": return value ? c.setColor(value).run() : c.unsetColor().run();
        case "bg": return value ? c.setBackgroundColor(value).run() : c.unsetBackgroundColor().run();
        case "bullet": return c.toggleBulletList().run();
        case "ordered": return c.toggleOrderedList().run();
        case "task": return c.toggleTaskList().run();
        case "callout": return c.setCallout(value || "NOTE").run();
        case "table": return c.insertTable({ rows: value?.rows || 3, cols: value?.cols || 3, withHeaderRow: true }).run();
        case "rowAdd": return c.addRowAfter().run();
        case "colAdd": return c.addColumnAfter().run();
        case "rowDel": return c.deleteRow().run();
        case "colDel": return c.deleteColumn().run();
        case "tableDel": return c.deleteTable().run();
        case "headerRow": return c.toggleHeaderRow().run();
        case "cellAlign": return c.updateAttributes("tableCell", { textAlign: value }).updateAttributes("tableHeader", { textAlign: value }).run();
        case "image": return ctx.pickImage();
        case "imageAlign": return c.updateAttributes("image", { align: value }).run();
        case "imageWidth": return c.updateAttributes("image", { width: value }).run();
        case "imageAlt": return c.updateAttributes("image", { alt: value }).run();
        case "imageDel": return c.deleteSelection().run();
        case "link": { const prev = editor.getAttributes("link").href || ""; const url = prompt("링크 주소 (https://… 또는 다른 문서.md)", prev || "https://"); if (url === null) return false; return !url || url === "https://" ? c.extendMarkRange("link").unsetLink().run() : c.extendMarkRange("link").setLink({ href: url }).run(); }
        case "hr": return c.setHorizontalRule().run();
        case "pagebreak": return c.setPageBreak().run();
        case "clear": return c.unsetAllMarks().run();
        case "moveUp": return c.moveBlock(-1).run();
        case "moveDown": return c.moveBlock(1).run();
        case "undo": return c.undo().run();
        case "redo": return c.redo().run();
        default: return false;
      }
    },
    /** 도구 막대 표시용 상태 */
    state() {
      const a = (n, at) => editor.isActive(n, at);
      const img = editor.isActive("image") ? editor.getAttributes("image") : null;
      return {
        block: a("heading", { level: 1 }) ? "h1" : a("heading", { level: 2 }) ? "h2" : a("heading", { level: 3 }) ? "h3" : a("heading") ? "h3" : a("codeBlock") ? "code" : a("blockquote") ? "blockquote" : "p",
        bold: a("bold"), italic: a("italic"), underline: a("underline"), strike: a("strike"),
        bullet: a("bulletList"), ordered: a("orderedList"), task: a("taskList"), callout: a("callout"),
        table: a("table"), image: img, link: a("link"),
        canUndo: editor.can().undo(), canRedo: editor.can().redo(),
      };
    },
  };
  handle.ready = handle.setMarkdown(opts.markdown || "");
  return handle;
}

window.NMEditor = { create, CALLOUTS, COLORS, HILITES, FONTS, SIZES };
