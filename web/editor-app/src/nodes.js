// 농막 전용 노드·확장: 콜아웃, 쪽 나눔, 그림(정렬·크기·설명), 표 칸 정렬, 블록 위아래 옮기기(Alt+↑/↓).
import { Node, Extension, mergeAttributes } from "@tiptap/core";
import { TableCell, TableHeader } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { TableMap } from "@tiptap/pm/tables";

export const CALLOUTS = { NOTE: "참고", TIP: "팁", IMPORTANT: "중요", WARNING: "주의", CAUTION: "경고" };

/** 콜아웃(색 상자): > [!NOTE] … 꼴. 안에 문단·목록 등 블록을 담는다. 왼쪽 라벨을 누르면 종류가 바뀐다. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { kind: { default: "NOTE", parseHTML: (el) => el.getAttribute("data-kind") || "NOTE", renderHTML: (a) => ({ "data-kind": a.kind }) } };
  },
  parseHTML() { return [{ tag: "div[data-callout]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "", class: "nm-callout" }), 0]; },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "nm-callout c-" + node.attrs.kind.toLowerCase();
      dom.setAttribute("data-callout", "");
      const label = document.createElement("button");
      label.type = "button";
      label.className = "nm-callout-label";
      label.contentEditable = "false";
      label.textContent = CALLOUTS[node.attrs.kind] || node.attrs.kind;
      label.title = "눌러서 종류 바꾸기(참고→팁→중요→주의→경고)";
      label.onmousedown = (e) => e.preventDefault();
      label.onclick = () => {
        const kinds = Object.keys(CALLOUTS);
        const next = kinds[(kinds.indexOf(node.attrs.kind) + 1) % kinds.length];
        editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, kind: next }));
      };
      const body = document.createElement("div");
      body.className = "nm-callout-body";
      dom.append(label, body);
      return {
        dom, contentDOM: body,
        update(n) {
          if (n.type !== node.type) return false;
          node = n;
          dom.className = "nm-callout c-" + n.attrs.kind.toLowerCase();
          label.textContent = CALLOUTS[n.attrs.kind] || n.attrs.kind;
          return true;
        },
        ignoreMutation: (m) => m.target === label || label.contains(m.target),
      };
    };
  },
  addCommands() {
    return {
      setCallout: (kind = "NOTE") => ({ commands, state }) => {
        const { $from } = state.selection;
        if ($from.node(-1)?.type.name === "callout") return commands.lift("callout");
        return commands.wrapIn("callout", { kind });
      },
    };
  },
});

/** 쪽 나눔: <!-- pagebreak -->. 화면에서는 점선, 인쇄·한글에서는 다음 쪽. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() { return [{ tag: "div[data-pagebreak]" }]; },
  renderHTML() { return ["div", { "data-pagebreak": "", class: "nm-pagebreak" }, ["span", {}, "쪽 나눔"]]; },
  addCommands() {
    return { setPageBreak: () => ({ chain }) => chain().insertContent([{ type: "pageBreak" }, { type: "paragraph" }]).run() };
  },
});

/** 표 칸: 정렬 속성(마크다운 표의 :---: 와 대응). */
const alignAttr = {
  textAlign: {
    default: null,
    parseHTML: (el) => el.style.textAlign || el.getAttribute("data-align") || null,
    renderHTML: (a) => (a.textAlign ? { "data-align": a.textAlign, style: `text-align:${a.textAlign}` } : {}),
  },
};
export const NmTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttr }; } });
export const NmTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttr }; } });

/** 그림: 기본 그림 노드 + 정렬. 크기 조절(모서리 손잡이)은 확장이 제공한다.
 * 문서 모델의 src는 문서 기준 상대 경로(마크다운에 그대로 적힘)이고, 화면에는 options.resolve(src)가 준 data: 주소를 쓴다 -
 * 파일 폴더 밖·바깥 주소는 보이지 않는다(resolve가 빈 값을 주면 src 없는 그림). */
export const NmImage = Image.extend({
  addOptions() { return { ...this.parent?.(), resolve: null }; },
  addAttributes() {
    const ext = this;
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-src") || el.getAttribute("src"),
        renderHTML: (a) => ({ src: (ext.options.resolve && ext.options.resolve(a.src)) || "", "data-src": a.src }),
      },
      align: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-align") || null,
        renderHTML: (a) => (a.align ? { "data-align": a.align } : {}),
      },
    };
  },
});

/** Alt+↑/↓ 로 지금 블록(맨 바깥 블록)을 위·아래 블록과 자리 바꾼다. 손잡이로 끄는 것과 같은 일을 키보드로. */
export const MoveBlock = Extension.create({
  name: "moveBlock",
  addCommands() {
    return {
      moveBlock: (dir) => ({ state, dispatch }) => {
        const { $from } = state.selection;
        const depth = state.selection instanceof NodeSelection ? $from.depth + 1 : 1;
        const pos = $from.before(depth);
        const node = state.doc.nodeAt(pos);
        if (!node) return false;
        const parent = $from.node(depth - 1);
        const index = $from.index(depth - 1);
        const j = index + dir;
        if (j < 0 || j >= parent.childCount) return false;
        const other = parent.child(j);
        // 내 블록이 아니라 '이웃'을 옮긴다 - 그러면 내 블록 안의 선택 위치는 변환이 알아서 따라온다
        const tr = state.tr;
        if (dir < 0) {
          const otherPos = pos - other.nodeSize;
          tr.delete(otherPos, otherPos + other.nodeSize).insert(otherPos + node.nodeSize, other);
        } else {
          const otherPos = pos + node.nodeSize;
          tr.delete(otherPos, otherPos + other.nodeSize).insert(pos, other);
        }
        tr.scrollIntoView();
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
  addKeyboardShortcuts() {
    return { "Alt-ArrowUp": () => this.editor.commands.moveBlock(-1), "Alt-ArrowDown": () => this.editor.commands.moveBlock(1) };
  },
});

/* ---------------- 쪽 보기: 블록 높이를 재서 쪽 경계(여백·쪽 번호)를 그 사이에 그린다 ---------------- */

const MM = 96 / 25.4;
export const PAGE = { contentH: Math.round(237 * MM), top: Math.round(30 * MM), bottom: Math.round(30 * MM), gap: 24, sideL: Math.round(20 * MM) };
const pagesKey = new PluginKey("nm-pages");

function gapWidget(remaining, pageNo) {
  const dom = document.createElement("div");
  dom.className = "nm-pagegap";
  dom.contentEditable = "false";
  dom.style.height = remaining + PAGE.bottom + PAGE.gap + PAGE.top + "px";
  const fill = document.createElement("div");
  fill.className = "nm-pagegap-fill";
  fill.style.height = remaining + PAGE.bottom + "px";
  const no = document.createElement("div");
  no.className = "nm-pagegap-no";
  no.textContent = `- ${pageNo} -`;
  fill.append(no);
  const desk = document.createElement("div");
  desk.className = "nm-pagegap-desk";
  desk.style.height = PAGE.gap + "px";
  const top = document.createElement("div");
  top.className = "nm-pagegap-top";
  top.style.height = PAGE.top + "px";
  dom.append(fill, desk, top);
  return dom;
}

/** 쪽 경계 플러그인. 문서가 바뀌면 다음 프레임에 맨 바깥 블록들의 높이를 재어 경계 위치를 다시 정한다. */
export const Pages = Extension.create({
  name: "pages",
  addOptions() { return { onPages: null, enabled: true }; },
  addStorage() { return { enabled: true }; }, // 켜고 끄기는 storage로(editor.storage.pages.enabled) - 플러그인이 매번 읽는다
  onCreate() { this.storage.enabled = this.options.enabled; },
  addProseMirrorPlugins() {
    const ext = this;
    let scheduled = 0;
    let lastSig = "";
    const measure = (view) => {
      scheduled = 0;
      if (!view.dom.isConnected) return;
      const sheetEl = view.dom.closest(".nm-sheet");
      if (!ext.storage.enabled) { // 쪽 나눔 끔: 경계를 지우고 쪽을 내용 길이대로
        if (sheetEl) sheetEl.style.paddingBottom = "";
        if (lastSig !== "off") { lastSig = "off"; view.dispatch(view.state.tr.setMeta(pagesKey, [])); }
        if (ext.options.onPages) ext.options.onPages(0);
        return;
      }
      const doc = view.state.doc;
      const breaks = []; // [pos, remaining, pageNo]
      // 블록 높이 = offsetHeight + 위아래 여백(문단 사이 여백을 빼먹으면 쪽이 넘쳐 인쇄에서 쪽이 하나 더 생긴다).
      // 여백이 겹치는 만큼은 조금 넉넉히 잡히는데, 그 편이 안전하다(인쇄에서 절대 넘치지 않는다). 다단(두 쪽) 보기에서는 offsetTop이
      // 단마다 다시 시작하므로 위치 차이로는 잴 수 없고 이 방법이어야 한다.
      const extent = new Map();
      for (const a of view.dom.children) {
        if (a.classList.contains("nm-pagegap")) continue;
        const cs = getComputedStyle(a);
        extent.set(a, a.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0));
      }
      const LIMIT = PAGE.contentH - 6; // 인쇄 엔진과의 반올림 차이 여유
      let y = 0, page = 1, force = false;
      doc.forEach((node, offset) => {
        const dom = view.nodeDOM(offset);
        if (!dom || !(dom instanceof HTMLElement)) return;
        const h = extent.has(dom) ? extent.get(dom) : dom.offsetHeight;
        if (node.type.name === "pageBreak") { force = true; y += h; return; }
        // 한 쪽보다 긴 블록(긴 표)은 쪽 절반 넘게 찼을 때만 다음 쪽으로 보낸다 - 아니면 거의 빈 쪽이 남는다. 인쇄는 줄 단위로 자른다.
        const tall = h > LIMIT && y < LIMIT / 2;
        if (y > 0 && (force || (y + h > LIMIT && !tall))) {
          breaks.push([offset, Math.max(0, PAGE.contentH - y), page++]);
          y = 0;
        }
        force = false;
        y += h;
      });
      const sig = breaks.map((b) => b.join(":")).join(",") + "|" + Math.round(y);
      const sheet = view.dom.closest(".nm-sheet");
      if (sheet) sheet.style.paddingBottom = sheet.classList.contains("two") ? "" : Math.max(0, PAGE.contentH - y) + PAGE.bottom + "px"; // 마지막 쪽도 A4 한 장을 채운다(두 쪽 보기는 높이 고정)
      if (ext.options.onPages) ext.options.onPages(page);
      if (sig === lastSig) return;
      lastSig = sig;
      view.dispatch(view.state.tr.setMeta(pagesKey, breaks));
    };
    const schedule = (view) => { if (!scheduled) scheduled = requestAnimationFrame(() => measure(view)); };
    return [
      new Plugin({
        key: pagesKey,
        state: {
          init: () => ({ breaks: [], decos: null }),
          apply(tr, prev, _old, state) {
            const breaks = tr.getMeta(pagesKey);
            if (breaks) {
              return { breaks, decos: DecorationSet.create(state.doc, breaks.map(([pos, rem, no]) => Decoration.widget(pos, () => gapWidget(rem, no), { side: -1, key: `${pos}:${rem}:${no}` }))) };
            }
            if (tr.docChanged && prev.decos) return { breaks: prev.breaks, decos: prev.decos.map(tr.mapping, tr.doc) };
            return prev;
          },
        },
        props: { decorations(state) { return pagesKey.getState(state)?.decos || null; } },
        view(view) {
          schedule(view);
          const ro = new ResizeObserver(() => schedule(view));
          ro.observe(view.dom);
          return { update: () => schedule(view), destroy: () => { ro.disconnect(); if (scheduled) cancelAnimationFrame(scheduled); } };
        },
      }),
    ];
  },
});

/* ---------------- 표 전체 크기 조절: 커서가 표 안에 있으면 표 둘레에 테두리와 네 모서리 손잡이 ---------------- */


const tableResizeKey = new PluginKey("nm-table-resize");

/** 선택이 든 표의 (pos, node). 없으면 null. */
function tableAt(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "table") return { pos: $from.before(d), node: n };
  }
  return null;
}

/** 표의 열 너비 목록(px). colwidth가 없는 열은 DOM에서 잰다. */
function columnWidths(node, dom) {
  const map = TableMap.get(node);
  const widths = new Array(map.width).fill(0);
  const firstRow = dom.querySelector("tr");
  const cells = firstRow ? [...firstRow.children] : [];
  let col = 0;
  for (const cell of cells) {
    const span = Number(cell.getAttribute("colspan") || 1);
    const cw = (cell.getAttribute("colwidth") || "").split(",").map(Number).filter(Boolean);
    for (let k = 0; k < span && col < map.width; k++, col++) widths[col] = cw[k] || Math.round(cell.offsetWidth / span);
  }
  return widths;
}

export const TableResize = Extension.create({
  name: "tableResize",
  addOptions() { return { maxWidth: 642, minCol: 40 }; },
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        key: tableResizeKey,
        view(view) {
          const host = view.dom.parentElement; // .nm-sheet(position: relative)
          const box = document.createElement("div");
          box.className = "nm-tablebox";
          box.hidden = true;
          const handles = ["top-left", "top-right", "bottom-left", "bottom-right"].map((dir) => {
            const h = document.createElement("div");
            h.className = "nm-tablebox-h";
            h.dataset.dir = dir;
            h.title = "끌어서 표 너비 조절";
            box.append(h);
            return h;
          });
          host.append(box);
          let current = null; // {pos, dom, table}
          const zoom = () => Number(getComputedStyle(host.closest(".nm-desk") || host).zoom) || 1;

          const place = () => {
            const t = tableAt(view.state);
            const dom = t && view.nodeDOM(t.pos);
            const table = dom && dom.querySelector && dom.querySelector("table");
            if (!t || !table || !view.hasFocus() && !box.contains(document.activeElement) && !dragging) { box.hidden = true; current = null; return; }
            current = { pos: t.pos, node: t.node, dom, table };
            const z = zoom();
            const hr = host.getBoundingClientRect(), r = table.getBoundingClientRect();
            box.style.left = (r.left - hr.left) / z + "px";
            box.style.top = (r.top - hr.top) / z + "px";
            box.style.width = r.width / z + "px";
            box.style.height = r.height / z + "px";
            box.hidden = false;
          };

          // 모서리 끌기: 가로 이동만 본다(표의 세로 크기는 내용이 정한다). 열 너비를 같은 비율로 늘이고 줄인다.
          let dragging = null;
          const onMove = (e) => {
            if (!dragging) return;
            const dx = (e.clientX - dragging.x) / zoom() * (dragging.dir.includes("left") ? -1 : 1);
            const minTotal = dragging.widths.length * ext.options.minCol;
            const total = Math.max(minTotal, Math.min(ext.options.maxWidth, dragging.total + dx));
            dragging.scale = total / dragging.total;
            const cols = dragging.table.querySelectorAll("colgroup col");
            dragging.widths.forEach((w, k) => { if (cols[k]) cols[k].style.width = Math.round(w * dragging.scale) + "px"; });
            dragging.table.style.width = Math.round(total) + "px";
            place();
          };
          const onUp = () => {
            if (!dragging) return;
            const { node, pos, widths, scale } = dragging;
            dragging = null;
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.body.classList.remove("nm-resizing");
            if (!scale || Math.abs(scale - 1) < 0.002) return;
            const map = TableMap.get(node);
            const tr = view.state.tr;
            const seen = new Set();
            for (let row = 0; row < map.height; row++) {
              for (let col = 0; col < map.width; col++) {
                const cellPos = map.map[row * map.width + col];
                if (seen.has(cellPos)) continue;
                seen.add(cellPos);
                const cell = node.nodeAt(cellPos);
                const span = cell.attrs.colspan || 1;
                const cw = [];
                for (let k = 0; k < span; k++) cw.push(Math.max(ext.options.minCol, Math.round(widths[col + k] * scale)));
                tr.setNodeMarkup(pos + 1 + cellPos, undefined, { ...cell.attrs, colwidth: cw });
              }
            }
            view.dispatch(tr);
          };
          for (const h of handles) {
            h.addEventListener("pointerdown", (e) => {
              if (!current) return;
              e.preventDefault();
              const widths = columnWidths(current.node, current.table);
              dragging = { x: e.clientX, dir: h.dataset.dir, widths, total: widths.reduce((a, b) => a + b, 0), scale: 1, table: current.table, node: current.node, pos: current.pos };
              document.body.classList.add("nm-resizing");
              document.addEventListener("pointermove", onMove);
              document.addEventListener("pointerup", onUp);
            });
          }
          const ro = new ResizeObserver(() => place());
          ro.observe(view.dom);
          view.dom.addEventListener("blur", () => setTimeout(place, 100));
          return { update: place, destroy: () => { ro.disconnect(); box.remove(); } };
        },
      }),
    ];
  },
});
