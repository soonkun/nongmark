// 새싹이의 농막 화면. 블록 단위 편집(노션식): 블록을 누르면 그 블록의 마크다운 원문이 열리고, 벗어나면 다시 그려진다.
// 저장소는 셋 중 하나 - 모두 같은 함수 모양(list/read/write/remove/rename/mkdir/saveAsset/imageUrl)을 갖는다:
//   native : nongmak.exe 창(WebView2) 안. 프로그램이 넣어 준 nm_* 함수를 부른다(같은 프로세스, 네트워크 없음).
//   folder : 브라우저에서 nongmak.html을 열고 "폴더 열기"(File System Access API, Edge·Chrome).
//   single : 둘 다 안 될 때 - 파일 하나를 열고 내려받기로 저장.
// 네트워크: 이 코드는 어디에도 연결하지 않는다. 페이지의 CSP가 connect-src 'none'으로 막는다.

"use strict";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const MD_EXT = /\.(md|markdown)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/* ---------------- 저장소 ---------------- */

const NATIVE = !!window.NONGMAK_NATIVE;

function blobToBase64(blob) {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

function nativeStore(info) {
  return {
    kind: "native",
    rootName: info.root,
    dir: info.dir,
    list: () => window.nm_list(),
    read: (p) => window.nm_read(p),
    write: (p, text) => window.nm_write(p, text),
    remove: (p) => window.nm_remove(p),
    rename: (a, b) => window.nm_rename(a, b),
    mkdir: (p) => window.nm_mkdir(p),
    async saveAsset(name, blob) { return window.nm_saveAsset(name, await blobToBase64(blob)); },
    imageUrl: (p) => window.nm_image(p), // data: 주소
  };
}

function folderStore(dir) {
  const walk = async (path, create) => {
    const parts = path.split("/").filter(Boolean);
    let h = dir;
    for (const part of parts.slice(0, -1)) h = await h.getDirectoryHandle(part, { create });
    return { parent: h, name: parts[parts.length - 1] };
  };
  const fileHandle = async (path, create = false) => {
    const { parent, name } = await walk(path, create);
    return parent.getFileHandle(name, { create });
  };
  const write = async (path, data) => {
    const w = await (await fileHandle(path, true)).createWritable();
    await w.write(data);
    await w.close();
  };
  return {
    kind: "folder",
    rootName: dir.name,
    async list() {
      const out = [];
      const rec = async (h, prefix, depth) => {
        if (depth > 8) return;
        for await (const [name, child] of h.entries()) {
          if (name.startsWith(".") || name === "node_modules") continue;
          const p = prefix + name;
          if (child.kind === "directory") {
            out.push({ path: p, dir: true });
            await rec(child, p + "/", depth + 1);
          } else if (MD_EXT.test(name)) out.push({ path: p, dir: false });
        }
      };
      await rec(dir, "", 0);
      return out;
    },
    async read(p) { return (await (await fileHandle(p)).getFile()).text(); },
    write,
    async remove(p) { const { parent, name } = await walk(p, false); await parent.removeEntry(name); },
    async rename(a, b) {
      const data = await (await (await fileHandle(a)).getFile()).arrayBuffer();
      try { await fileHandle(b); throw new Error("같은 이름의 파일이 이미 있습니다."); } catch (e) { if (e.name !== "NotFoundError") throw e; }
      await write(b, data);
      const { parent, name } = await walk(a, false);
      await parent.removeEntry(name);
    },
    async mkdir(p) { await walk(p + "/x", true); },
    async saveAsset(name, blob) { const p = "assets/" + name; await write(p, blob); return p; },
    async imageUrl(p) { return URL.createObjectURL(await (await fileHandle(p)).getFile()); },
    async imageBytes(p) { return new Uint8Array(await (await (await fileHandle(p)).getFile()).arrayBuffer()); },
  };
}

function singleStore(name, text) {
  const files = { [name]: text };
  return {
    kind: "single",
    rootName: "",
    async list() { return Object.keys(files).map((p) => ({ path: p, dir: false })); },
    async read(p) { return files[p]; },
    async write(p, t) {
      files[p] = t;
      const a = el("a");
      a.href = URL.createObjectURL(new Blob([t], { type: "text/markdown;charset=utf-8" }));
      a.download = p.split("/").pop();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async remove(p) { delete files[p]; },
    async rename(a, b) { files[b] = files[a]; delete files[a]; },
    async mkdir() { throw new Error("파일 하나만 연 상태에서는 폴더를 만들 수 없습니다."); },
    async saveAsset() { throw new Error("그림 붙여넣기는 폴더를 연 뒤에 쓸 수 있습니다."); },
    async imageUrl() { throw new Error("no folder"); },
  };
}

/* ---------------- 상태 ---------------- */

const state = {
  store: null,
  entries: [],
  path: null, // 지금 연 파일
  untitled: false, // 아직 저장한 적 없는 새 문서
  zoom: 1,
  blocks: [],
  dirty: false,
  editing: -1,
  raw: false,
  rich: true, // 편집기(서식 도구) 모드. false면 블록을 누를 때 마크다운 원문 상자가 열린다
  saveTimer: null,
  imageCache: new Map(),
  collapsed: new Set(),
  cache: new Map(), // 검색용 본문
};

const status = (text, kind = "") => {
  const s = $("#status");
  s.textContent = text;
  s.className = "status " + kind;
};

/* ---------------- 파일 목록 ---------------- */

async function refreshTree() {
  state.entries = (await state.store.list()).sort((a, b) => a.path.localeCompare(b.path, "ko"));
  renderTree();
}

function renderTree() {
  const tree = $("#tree");
  tree.textContent = "";
  const filter = $("#search").value.trim().toLowerCase();
  const hits = filter ? searchHits(filter) : null;
  for (const entry of state.entries) {
    const parts = entry.path.split("/");
    const parentHidden = parts.slice(0, -1).some((_, i) => state.collapsed.has(parts.slice(0, i + 1).join("/")));
    if (hits) {
      if (entry.dir || !hits.has(entry.path)) continue;
    } else if (parentHidden) continue;
    const row = el("div", "tree-row" + (entry.dir ? " dir" : "") + (entry.path === state.path ? " active" : ""));
    row.style.paddingLeft = (hits ? 8 : 8 + (parts.length - 1) * 14) + "px";
    const name = parts[parts.length - 1];
    if (entry.dir) {
      row.append(el("span", "twisty", state.collapsed.has(entry.path) ? "▸" : "▾"), el("span", "name", name));
      row.onclick = () => {
        state.collapsed.has(entry.path) ? state.collapsed.delete(entry.path) : state.collapsed.add(entry.path);
        renderTree();
      };
    } else {
      row.append(el("span", "page-icon", "📄"), el("span", "name", hits ? entry.path : name.replace(MD_EXT, "")));
      row.title = entry.path;
      row.onclick = () => openFile(entry.path);
      if (hits && hits.get(entry.path)) row.append(el("div", "snippet", hits.get(entry.path)));
    }
    tree.append(row);
  }
  if (!tree.childElementCount) tree.append(el("div", "empty", filter ? "찾은 페이지가 없습니다." : "페이지가 없습니다. ＋ 새 페이지로 시작하세요."));
}

function searchHits(q) {
  const hits = new Map();
  for (const e of state.entries) {
    if (e.dir) continue;
    if (e.path.toLowerCase().includes(q)) hits.set(e.path, "");
    const text = state.cache.get(e.path);
    if (text) {
      const i = text.toLowerCase().indexOf(q);
      if (i >= 0) hits.set(e.path, (i > 20 ? "…" : "") + text.slice(Math.max(0, i - 20), i + q.length + 40).replace(/\s+/g, " "));
    }
  }
  return hits;
}

async function warmSearch() {
  // 검색을 위해 본문을 읽어 둔다(파일이 많으면 처음 한 번 조금 걸린다)
  for (const e of state.entries) {
    if (e.dir || state.cache.has(e.path)) continue;
    try { state.cache.set(e.path, await state.store.read(e.path)); } catch { /* 읽을 수 없는 파일은 건너뛴다 */ }
  }
}

/* ---------------- 문서 열기·저장 ---------------- */

async function openFile(path) {
  if (!(await flush())) return;
  try {
    const text = await state.store.read(path);
    state.path = path;
    state.cache.set(path, text);
    state.blocks = MD.splitBlocks(text);
    state.dirty = false;
    state.editing = -1;
    $("#raw").value = text;
    state.untitled = false;
    setDocTitle(path.split("/").pop().replace(MD_EXT, ""), path);
    renderDoc();
    renderTree();
    status("열림");
    $("#empty-state").hidden = true;
    $("#page").hidden = false;
  } catch (e) {
    status("열지 못했습니다: " + e.message, "error");
  }
}

function syncEditing() {
  // 서식 편집 중인 블록의 현재 내용을 state.blocks에 반영한다(자동 저장·글자 수가 쓴다). 화면은 건드리지 않는다.
  const i = state.editing;
  if (i < 0) return;
  const body = editingBody(i);
  if (body) state.blocks[i] = Editor.serialize(body);
}
const editingBody = (i) => document.querySelector(`.block[data-i="${i}"]:not(.cont) .block-body[contenteditable]`);
const isCodeBlock = (md) => /^\s*(```|~~~)/.test(md);
// 서식 편집이 뜻이 없는 블록(코드·구분선·쪽 나눔)은 마크다운 상자로 고친다
const sourceOnly = (md) => isCodeBlock(md) || (!md.includes("\n") && (MD.RE.hr.test(md) || MD.RE.pagebreak.test(md)));
const docText = () => (syncEditing(), state.raw ? $("#raw").value : state.blocks.join("\n\n") + "\n");

function setDocTitle(name, path) {
  $("#pagename").textContent = name;
  $("#crumb").textContent = path && path.includes("/") ? path.split("/").slice(0, -1).join(" › ") + " ›" : state.store?.rootName ? state.store.rootName + " ›" : "";
  document.title = name + " - 새싹이의 농막";
  if (NATIVE) window.nm_setTitle(name);
}

function countChars() {
  const text = docText();
  $("#count").textContent = `${text.replace(/\s/g, "").length.toLocaleString("ko-KR")}자`;
}

function changed() {
  state.dirty = true;
  countChars();
  if (state.untitled) return status("저장하지 않은 새 문서 (Ctrl+S)");
  status(state.store.kind === "single" ? "저장 안 됨 (Ctrl+S로 내려받기)" : "저장 중…");
  if (state.store.kind !== "single") {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 800);
  }
}

async function save() {
  clearTimeout(state.saveTimer);
  if (state.untitled) return saveAs();
  if (!state.path || !state.dirty) return true;
  const text = docText();
  try {
    await state.store.write(state.path, text);
    state.cache.set(state.path, text);
    state.dirty = false;
    status("저장됨 · " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), "ok");
    return true;
  } catch (e) {
    status("저장 실패: " + e.message, "error");
    return false;
  }
}

async function flush() {
  if (state.editing >= 0) commitEdit();
  if (!state.dirty) return true;
  if (state.untitled) return confirm("저장하지 않은 새 문서가 있습니다. 버리고 계속할까요?");
  if (state.store.kind === "single") return confirm("저장하지 않은 내용이 있습니다. 버리고 계속할까요?");
  return save();
}

/* ---------------- 그리기 ---------------- */

/* 쪽 보기: A4(210×297mm), 여백 좌우 20mm·위아래 30mm. 블록을 차례로 쪽에 담다가 넘치면 다음 쪽으로 넘긴다.
   <!-- pagebreak --> 블록 뒤는 무조건 새 쪽. 표·목록이 쪽을 넘치면 줄(tr)·항목(li) 단위로 잘라 다음 쪽에 잇는다(표는 머리 줄 반복).
   잘린 뒷부분은 .cont(복제본)이고 원본 블록(.block[data-split])이 내용을 다 가진다 - 편집은 원본에서, 다시 그릴 때 원본을 새로 그린다. */
function newSheet(doc) {
  const sheet = el("section", "sheet");
  const body = el("div", "sheet-body");
  const no = el("div", "sheet-no");
  sheet.append(body, no);
  doc.append(sheet);
  return body;
}

/** 쪽 안에서의 세로 위치(sheet-body 기준, 확대·축소와 무관한 레이아웃 좌표). */
function topIn(e, ancestor) {
  let top = 0;
  for (; e && e !== ancestor; e = e.offsetParent) top += e.offsetTop;
  return top;
}

/** 넘친 블록을 자른다: 들어가는 줄까지만 남기고 나머지(와 그 뒤 내용)를 이어 붙일 조각으로 돌려준다. 못 자르면 null. */
function splitBlock(wrap, sheetBody, limit) {
  const target = wrap.querySelector(":scope > .block-body > table, :scope > .block-body > ul, :scope > .block-body > ol");
  if (!target) return null;
  const isTable = target.tagName === "TABLE";
  const rows = isTable ? [...target.querySelectorAll(":scope > tbody > tr")] : [...target.children];
  const over = rows.findIndex((r) => topIn(r, sheetBody) + r.offsetHeight > limit);
  if (over < 1) return null; // 첫 줄부터 안 들어가면 통째로 다음 쪽으로
  const cont = el("div", "block cont");
  cont.dataset.i = wrap.dataset.i;
  const body = el("div", "block-body");
  const shell = target.cloneNode(false);
  if (isTable) {
    const thead = target.querySelector(":scope > thead");
    if (thead) shell.append(thead.cloneNode(true));
    const tbody = el("tbody");
    tbody.append(...rows.slice(over));
    shell.append(tbody);
  } else {
    shell.append(...rows.slice(over));
    if (shell.tagName === "OL") shell.start = Number(target.getAttribute("start") || 1) + over;
  }
  body.append(shell);
  while (target.nextSibling) body.append(target.nextSibling); // 표 뒤에 붙어 있던 것도 함께 넘긴다
  Editor.applyStyles(body);
  cont.append(body);
  cont.onclick = wrap.onclick;
  wrap.dataset.split = "1";
  return cont;
}

function paginate() {
  const doc = $("#doc");
  const sheets = [...doc.querySelectorAll(".sheet")];
  const queue = sheets.flatMap((sh) => [...sh.querySelector(".sheet-body").children]).filter((b) => !b.classList.contains("cont"));
  doc.textContent = "";
  let body = newSheet(doc);
  const limit = () => body.clientHeight;
  const overflow = (b) => b.offsetTop + b.offsetHeight > limit();
  for (let k = 0; k < queue.length; k++) {
    let b = queue[k];
    if (b.dataset.split) b = blockView(state.blocks[Number(b.dataset.i)], Number(b.dataset.i)); // 지난번에 잘린 블록은 온전히 다시
    body.append(b);
    if (overflow(b)) {
      const editing = Number(b.dataset.i) === state.editing; // 고치는 중인 블록은 자르지 않는다(커서가 있는 DOM을 옮기지 않게)
      let cont = editing ? null : splitBlock(b, body, limit());
      if (!cont && body.childElementCount > 1) {
        b.remove();
        body = newSheet(doc);
        body.append(b);
        if (overflow(b) && !editing) cont = splitBlock(b, body, limit());
      }
      if (cont) queue.splice(k + 1, 0, cont);
    }
    if (b.querySelector("[data-pagebreak]")) body = newSheet(doc);
  }
  const all = doc.querySelectorAll(".sheet");
  all.forEach((sh, n) => (sh.querySelector(".sheet-no").textContent = `- ${n + 1} -`));
  $("#pages").textContent = `${all.length}쪽`;
}

function renderDoc() {
  const doc = $("#doc");
  doc.textContent = "";
  if (!state.blocks.length) state.blocks = [""];
  const body = newSheet(doc);
  state.blocks.forEach((md, i) => body.append(blockView(md, i)));
  paginate();
  loadImages(doc).then(() => withCaret(paginate)); // 그림이 들어오면 높이가 바뀐다
  countChars();
}

function blockView(md, i) {
  const wrap = el("div", "block");
  wrap.dataset.i = i;
  const add = el("button", "block-add", "+");
  add.title = "아래에 블록 넣기";
  add.tabIndex = -1;
  add.onclick = (ev) => {
    ev.stopPropagation();
    commitEdit();
    state.blocks.splice(i + 1, 0, "");
    renderDoc();
    editBlock(i + 1);
  };
  const body = el("div", "block-body");
  const rich = state.rich && !sourceOnly(md);
  if (md.trim()) {
    body.innerHTML = MD.renderBlock(md); // MD.renderBlock은 원문을 전부 이스케이프한다(markdown.js 머리말)
    Editor.applyStyles(body);
    if (rich) body.querySelectorAll("a").forEach((a) => (a.title = "Ctrl+클릭: 열기"));
  } else if (rich) body.dataset.placeholder = i === 0 && state.blocks.length === 1 ? "여기를 눌러 쓰기 시작 · / 로 블록 넣기" : "";
  else body.append(el("p", "placeholder", i === 0 && state.blocks.length === 1 ? "여기를 눌러 쓰기 시작 · / 로 블록 넣기" : ""));
  wrap.append(add, body);
  if (rich) {
    body.contentEditable = "true";
    body.spellcheck = false;
    body.addEventListener("focusin", () => { if (state.editing !== i) editBlock(i, null); });
    body.addEventListener("input", () => richInput(i, body));
    body.addEventListener("keydown", (ev) => richKey(ev, i, body));
    body.addEventListener("paste", (ev) => richPaste(ev, i, body));
    body.addEventListener("blur", () => setTimeout(() => {
      if (!body.isConnected) return; // 다시 그려져 떨어져 나간 옛 요소의 blur
      if (state.editing === i && document.activeElement !== body && !slash.open && !document.activeElement?.closest?.(".fmt")) commitEdit();
    }, 120));
  }
  wrap.onclick = (ev) => {
    const t = ev.target;
    if (t.matches("input[type=checkbox]")) {
      state.editing = -1; // 화면 DOM이 아니라 원문을 뒤집는다(그 뒤 다시 그린다)
      state.blocks[i] = MD.toggleTask(state.blocks[i], Number(t.dataset.line));
      changed();
      renderDoc();
      return;
    }
    const link = t.closest("a[data-href]");
    if (link && (!rich || ev.ctrlKey)) { // 서식 편집 중에는 Ctrl+클릭으로 연다(그냥 클릭은 글자 고치기)
      ev.preventDefault();
      followLink(link.dataset.href);
      return;
    }
    // 서식 블록 안을 누르면 focusin이 처리한다. 잘린 뒷조각(.cont)·여백·원문 전용 블록은 여기서 연다
    if (!rich || ev.currentTarget.classList.contains("cont") || !ev.target.closest(".block-body")) editBlock(i, "end");
  };
  return wrap;
}

/** 커서 위치(블록 번호 + 글자 위치)를 지켰다가 화면을 다시 만든 뒤 되돌린다. */
function withCaret(fn) {
  const i = state.editing;
  const body = i >= 0 ? editingBody(i) : null;
  const off = body ? Editor.caretOffset(body) : null;
  fn();
  if (off === null) return;
  const b2 = editingBody(i);
  if (b2) Editor.setCaret(b2, off);
}

async function loadImages(root) { // 끝나면 resolve(쪽 다시 나누기용)
  for (const img of root.querySelectorAll("img[data-src]")) {
    const rel = resolvePath(img.dataset.src);
    if (!rel) continue;
    try {
      if (!state.imageCache.has(rel)) state.imageCache.set(rel, await state.store.imageUrl(rel));
      img.src = state.imageCache.get(rel);
    } catch {
      img.replaceWith(el("span", "blocked", `[그림 없음: ${img.dataset.src}]`));
    }
  }
}

/** 문서 기준 상대 경로 → 작업 폴더 기준 경로. 폴더 밖(..로 루트를 넘음)이면 null. */
function resolvePath(rel) {
  let p;
  try {
    p = decodeURI(rel.split("#")[0].split("?")[0]).replace(/\\/g, "/");
  } catch {
    return null; // 깨진 %인코딩
  }
  const base = (state.path || "").split("/").slice(0, -1);
  const parts = p.startsWith("/") ? [] : base;
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

function followLink(href) {
  if (/^(https?:|mailto:)/i.test(href)) {
    // 바깥 주소는 열지 않는다(내부망·보안). 주소를 복사해 주고 알린다.
    navigator.clipboard?.writeText(href).catch(() => {});
    status("바깥 주소는 열지 않습니다 - 주소를 복사했습니다: " + href);
    return;
  }
  if (href.startsWith("#")) return;
  const p = resolvePath(href);
  if (p && MD_EXT.test(p)) openFile(p);
  else status("문서 링크(.md)만 열 수 있습니다: " + href, "error");
}

/* ---------------- 블록 편집 ---------------- */

/** 블록 고치기 시작. 서식 모드면 그 자리에서(contenteditable), 아니면(코드 블록·원문 모드) 마크다운 상자로.
 * caret: "start" | "end" | 글자 위치 | null(지금 커서 그대로 - 눌러서 들어온 경우) */
function editBlock(i, caret = "end") {
  if (state.editing === i) return;
  i = Math.max(0, Math.min(i, state.blocks.length - 1));
  if (!state.rich || sourceOnly(state.blocks[i])) return editSource(i, caret);
  const before = $(`.block[data-i="${i}"]:not(.cont)`);
  commitEdit(); // 다른 블록을 고치던 중이면 반영(화면이 다시 그려질 수 있다)
  let wrap = $(`.block[data-i="${i}"]:not(.cont)`);
  if (!wrap) return;
  let cellAt = null; // 잘린 표의 칸을 눌렀으면 (줄, 칸) 번호를 기억해 두었다가 온전한 표에서 같은 칸으로
  if (wrap.dataset.split) { // 잘려 있던 블록은 온전한 모습으로 돌려놓고 고친다
    const sel = getSelection();
    const cell = sel.rangeCount && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest("td, th");
    if (cell) cellAt = [[...cell.closest("table").querySelectorAll("tr")].indexOf(cell.parentElement), [...cell.parentElement.children].indexOf(cell)];
    document.querySelectorAll(`.block.cont[data-i="${i}"]`).forEach((c) => c.remove());
    const fresh = blockView(state.blocks[i], i);
    wrap.replaceWith(fresh);
    wrap = fresh;
  }
  state.editing = i;
  wrap.classList.add("editing");
  const body = wrap.querySelector(".block-body");
  if (cellAt) {
    const cell = body.querySelectorAll("tr")[cellAt[0]]?.children[cellAt[1]];
    body.focus({ preventScroll: true });
    if (cell) { const r = document.createRange(); r.selectNodeContents(cell); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  } else if (caret !== null || wrap !== before) Editor.setCaret(body, caret === null || caret === "end" ? Infinity : caret);
  fmtState();
}

function editSource(i, caret) {
  commitEdit();
  state.editing = i;
  const wrap = $(`.block[data-i="${i}"]:not(.cont)`);
  if (!wrap) return;
  document.querySelectorAll(`.block.cont[data-i="${i}"]`).forEach((c) => c.remove());
  const ta = el("textarea", "block-edit");
  ta.value = state.blocks[i];
  ta.spellcheck = false;
  wrap.classList.add("editing");
  wrap.querySelector(".block-body").replaceWith(ta);
  autosize(ta);
  ta.focus();
  const pos = caret === "start" ? 0 : typeof caret === "number" ? caret : ta.value.length;
  ta.setSelectionRange(pos, pos);
  ta.addEventListener("input", () => {
    autosize(ta);
    changed();
    slashCheck(taTarget(ta, i));
  });
  ta.addEventListener("keydown", (ev) => blockKey(ev, ta));
  ta.addEventListener("blur", () => setTimeout(() => { if (!slash.open && document.activeElement !== ta) commitEdit(); }, 120));
  ta.addEventListener("paste", (ev) => pasteImage(ev, ta));
}

/* ---------------- 서식 편집(contenteditable) ---------------- */

let richTimer = null;
function richInput(i, body) {
  changed();
  const text = body.textContent;
  if (/^\/[^\n]*$/.test(text) && !body.querySelector("table, ul, ol, img, h1, h2, h3, h4, h5, h6, blockquote")) slashCheck(richTarget(i, body));
  else closeSlash();
  clearTimeout(richTimer);
  richTimer = setTimeout(() => withCaret(paginate), 150); // 글이 길어지면 쪽을 다시 나눈다(커서는 지킨다)
}

function richKey(ev, i, body) {
  if (slash.open && slashKey(ev, richTarget(i, body))) return;
  const cell = Editor.selectionIn(body, "td, th");
  const inList = Editor.selectionIn(body, "li");
  if (ev.key === "Escape") {
    ev.preventDefault();
    body.blur();
    commitEdit();
    return;
  }
  if (cell && (ev.key === "Tab" || (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing))) {
    ev.preventDefault();
    Editor.tableMove(cell, ev.key === "Tab" ? (ev.shiftKey ? -1 : 1) : "down");
    changed();
    return;
  }
  if (ev.key === "Tab" && inList) {
    ev.preventDefault();
    Editor.exec(ev.shiftKey ? "outdent" : "indent");
    changed();
    return;
  }
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && !inList && !Editor.selectionIn(body, "blockquote, .callout")) {
    ev.preventDefault();
    splitAtCaret(i, body);
    return;
  }
  const off = ev.key === "Backspace" || ev.key === "ArrowUp" || ev.key === "ArrowDown" ? Editor.caretOffset(body) : null; // 선택 중이면 객체 → 아래 비교에 안 걸린다
  if (ev.key === "Backspace" && off === 0 && !body.textContent.trim() && !body.querySelector("img, table") && state.blocks.length > 1) {
    ev.preventDefault(); // 빈 블록에서 Backspace: 블록을 지우고 앞 블록 끝으로
    state.editing = -1;
    state.blocks.splice(i, 1);
    changed();
    renderDoc();
    editBlock(Math.max(0, i - 1), "end");
    return;
  }
  if (ev.key === "ArrowUp" && off === 0 && i > 0) {
    ev.preventDefault();
    editBlock(i - 1, "end");
    return;
  }
  if (ev.key === "ArrowDown" && off !== null && off >= body.textContent.length && i < state.blocks.length - 1) {
    ev.preventDefault();
    editBlock(i + 1, "start");
  }
}

/** Enter: 커서 뒤를 떼어 새 블록으로. 제목 가운데서 누르면 뒷부분은 본문이 된다. */
function splitAtCaret(i, body) {
  const sel = window.getSelection();
  let tailMd = "";
  if (sel.rangeCount && body.lastChild) {
    const r = sel.getRangeAt(0);
    const after = document.createRange();
    after.setStart(r.endContainer, r.endOffset);
    after.setEndAfter(body.lastChild);
    const tmp = el("div");
    tmp.append(after.extractContents());
    tailMd = Editor.serialize(tmp).replace(/^#{1,6} /, "");
  }
  const headParts = MD.splitBlocks(Editor.serialize(body));
  state.editing = -1;
  state.blocks.splice(i, 1, ...(headParts.length ? headParts : [""]), tailMd);
  changed();
  renderDoc();
  editBlock(i + Math.max(1, headParts.length), "start");
}

async function richPaste(ev, i, body) {
  const file = [...(ev.clipboardData?.items || [])].find((it) => it.kind === "file" && /^image\/(png|jpeg|gif|webp)$/.test(it.type))?.getAsFile();
  if (file) {
    ev.preventDefault();
    const rel = await storeImage(file);
    if (rel) insertImage(rel);
    return;
  }
  const text = ev.clipboardData?.getData("text/plain");
  if (text === undefined || text === null) return;
  ev.preventDefault();
  if (/\n/.test(text) && /^(#{1,6} |[-*+] |\d+[.)] |\||```|> )/m.test(text)) {
    // 여러 줄 마크다운을 붙여 넣으면 블록으로 해석해 뒤에 넣는다
    commitEdit();
    const parts = MD.splitBlocks(text);
    state.blocks.splice(i + 1, 0, ...parts);
    changed();
    renderDoc();
    editBlock(i + parts.length, "end");
    return;
  }
  Editor.exec("insertText", text);
}

/** 그림 파일을 assets/에 저장하고 문서 기준 상대 경로를 돌려준다. */
async function storeImage(file) {
  if (file.size > 20 * 1024 * 1024) return status("그림이 20MB를 넘습니다.", "error"), null;
  try {
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const name = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6) + "." + ext;
    const saved = await state.store.saveAsset(name, file);
    const depth = (state.path || "").split("/").length - 1;
    return "../".repeat(depth) + saved;
  } catch (e) {
    status("그림을 저장하지 못했습니다: " + e.message, "error");
    return null;
  }
}

async function insertImage(rel) {
  const i = state.editing;
  const body = i >= 0 ? editingBody(i) : null;
  if (!body) { // 고치는 블록이 없으면 끝에 그림 블록을 더한다
    state.blocks.push(`![](${rel})`);
    changed();
    renderDoc();
    return;
  }
  const img = el("img");
  img.dataset.src = rel;
  img.alt = "";
  const sel = window.getSelection();
  if (sel.rangeCount && body.contains(sel.anchorNode)) { const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(img); r.setStartAfter(img); r.collapse(true); }
  else body.append(img);
  changed();
  await loadImages(body);
  withCaret(paginate);
}

/* / 메뉴·꾸밈 명령이 다루는 대상: 마크다운 상자(textarea)와 서식 블록을 같은 모양으로 */
const taTarget = (ta, i) => ({
  i,
  text: () => ta.value,
  rect: () => ta.getBoundingClientRect(),
  pick(text, back) {
    ta.value = text;
    const pos = text.length - (back || 0);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event("input"));
  },
});
const richTarget = (i, body) => ({
  i,
  text: () => body.textContent,
  rect: () => body.getBoundingClientRect(),
  pick(text, back) {
    state.editing = -1;
    state.blocks[i] = text;
    changed();
    renderDoc();
    if (sourceOnly(text)) editSource(i, text.length - (back || 0));
    else {
      editBlock(i, "end");
      const cell = editingBody(i)?.querySelector("td"); // 표면 첫 칸에서 시작
      if (cell) { const r = document.createRange(); r.selectNodeContents(cell); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
  },
});

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + 2 + "px";
}

/** 고치기 끝: 상자(또는 서식 블록)의 내용을 state.blocks에 넣고 다시 그린다. 서식 블록이 바뀌지 않았으면 쪽만 다시 나눈다. */
function commitEdit() {
  const i = state.editing;
  if (i < 0) return;
  state.editing = -1;
  closeSlash();
  const ta = $(".block-edit");
  const body = ta ? null : editingBody(i);
  const text = ta ? ta.value : body ? Editor.serialize(body) : null;
  if (text === null) return;
  const parts = MD.splitBlocks(text);
  const one = parts.length === 1 || (!parts.length && state.blocks.length === 1);
  if (!(parts.length === 1 && parts[0] === state.blocks[i])) state.blocks.splice(i, 1, ...(parts.length ? parts : state.blocks.length > 1 ? [] : [""]));
  if (body && one) {
    // 블록 수가 그대로면 이 블록만 새로 그린다(브라우저가 만든 <div>·<font> 같은 꼴을 정돈) - 문서 전체를 다시 그리는 것보다 빠르다
    const wrap = body.closest(".block");
    wrap.replaceWith(blockView(state.blocks[i], i));
    paginate(); // 길이가 바뀌었을 수 있다(잘린 표 다시 잇기)
    fmtState();
    return;
  }
  renderDoc();
  fmtState();
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

function blockKey(ev, ta) {
  const i = state.editing;
  if (slash.open && slashKey(ev, taTarget(ta, i))) return;
  const v = ta.value;
  const a = ta.selectionStart;
  const b = ta.selectionEnd;
  const lineStart = v.lastIndexOf("\n", a - 1) + 1;
  const line = v.slice(lineStart, v.indexOf("\n", a) < 0 ? v.length : v.indexOf("\n", a));
  const isCode = /^\s*(```|~~~)/.test(v);
  const isTable = /^\s*\|/.test(v);

  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === "b" || ev.key === "i")) {
    ev.preventDefault();
    const mark = ev.key === "b" ? "**" : "*";
    ta.setRangeText(mark + v.slice(a, b) + mark, a, b, a === b ? "end" : "select");
    if (a === b) ta.setSelectionRange(a + mark.length, a + mark.length);
    ta.dispatchEvent(new Event("input"));
    return;
  }
  if (ev.key === "Escape") {
    ev.preventDefault();
    ta.blur();
    commitEdit();
    return;
  }
  if (ev.key === "Tab" && LIST_ITEM.test(line)) {
    ev.preventDefault();
    if (ev.shiftKey) {
      const cut = line.match(/^ {1,2}/);
      if (cut) ta.setRangeText("", lineStart, lineStart + cut[0].length, "end");
    } else ta.setRangeText("  ", lineStart, lineStart, "end");
    ta.setSelectionRange(a + (ev.shiftKey ? -Math.min(2, (line.match(/^ */)[0] || "").length) : 2), a + (ev.shiftKey ? -Math.min(2, (line.match(/^ */)[0] || "").length) : 2));
    ta.dispatchEvent(new Event("input"));
    return;
  }
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    const item = line.match(LIST_ITEM);
    if (item && !isCode) {
      ev.preventDefault();
      if (!item[5].trim()) {
        // 빈 항목에서 Enter: 목록을 끝내고 다음 블록으로
        ta.value = (v.slice(0, lineStart) + v.slice(lineStart + line.length)).replace(/\n$/, "");
        commitAndNew(i, "");
        return;
      }
      const marker = /\d/.test(item[2]) ? parseInt(item[2], 10) + 1 + item[2].slice(-1) : item[2];
      const insert = "\n" + item[1] + marker + item[3] + (item[4] ? "[ ] " : "");
      ta.setRangeText(insert, a, b, "end");
      ta.dispatchEvent(new Event("input"));
      return;
    }
    if (!isCode && !isTable) {
      ev.preventDefault();
      const rest = v.slice(b);
      ta.value = v.slice(0, a);
      commitAndNew(i, rest);
      return;
    }
  }
  if (ev.key === "Backspace" && a === 0 && b === 0 && i > 0) {
    ev.preventDefault();
    const prev = state.blocks[i - 1];
    const joinAt = prev.length;
    state.blocks[i - 1] = v ? prev + (prev ? "\n" : "") + v : prev;
    state.blocks.splice(i, 1);
    state.editing = -1;
    changed();
    renderDoc();
    editBlock(i - 1, joinAt + (v && prev ? 1 : 0));
    return;
  }
  if (ev.key === "ArrowUp" && a === 0 && b === 0 && i > 0) {
    ev.preventDefault();
    editBlock(i - 1, "end");
    return;
  }
  if (ev.key === "ArrowDown" && a === v.length && i < state.blocks.length - 1) {
    ev.preventDefault();
    editBlock(i + 1, "start");
  }
}

function commitAndNew(i, rest) {
  const ta = $(".block-edit");
  const text = ta.value;
  state.editing = -1;
  const parts = MD.splitBlocks(text);
  state.blocks.splice(i, 1, ...(parts.length ? parts : [""]), rest);
  changed();
  renderDoc();
  editBlock(i + Math.max(parts.length, 1), "start");
}

/* ---------------- / 메뉴 ---------------- */

const SLASH_ITEMS = [
  ["제목 1", "h1 큰 제목", "# "],
  ["제목 2", "h2 중간 제목", "## "],
  ["제목 3", "h3 작은 제목", "### "],
  ["글머리 목록", "- 항목", "- "],
  ["번호 목록", "1. 항목", "1. "],
  ["할 일", "체크 상자", "- [ ] "],
  ["인용", "> 인용문", "> "],
  ["콜아웃 · 참고", "눈에 띄는 상자", "> [!NOTE]\n> "],
  ["콜아웃 · 주의", "경고 상자", "> [!WARNING]\n> "],
  ["코드", "고정폭 코드 블록", "```\n\n```", 4],
  ["표", "2열 표", "| 항목 | 내용 |\n| --- | --- |\n|  |  |", 2],
  ["구분선", "가로줄", "---"],
  ["쪽 나누기", "여기서 다음 쪽으로", "<!-- pagebreak -->"],
];
const slash = { open: false, items: [], index: 0 };

function slashCheck(tgt) {
  const m = tgt.text().match(/^\/([^\n]*)$/);
  if (!m) return closeSlash();
  const q = m[1].trim();
  slash.items = SLASH_ITEMS.filter(([name, hint]) => !q || name.includes(q) || hint.includes(q));
  slash.index = 0;
  slash.open = slash.items.length > 0;
  drawSlash(tgt);
}

function drawSlash(tgt) {
  const menu = $("#slash");
  menu.textContent = "";
  if (!slash.open) return (menu.hidden = true);
  slash.items.forEach(([name, hint], n) => {
    const row = el("div", "slash-item" + (n === slash.index ? " on" : ""));
    row.append(el("span", "slash-name", name), el("span", "slash-hint", hint));
    row.onmousedown = (ev) => {
      ev.preventDefault();
      slash.index = n;
      slashPick(tgt);
    };
    menu.append(row);
  });
  const r = tgt.rect();
  menu.style.left = Math.min(r.left, window.innerWidth - 260) + window.scrollX + "px";
  menu.style.top = r.bottom + window.scrollY + 4 + "px";
  menu.hidden = false;
}

function slashKey(ev, tgt) {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    slash.index = (slash.index + (ev.key === "ArrowDown" ? 1 : -1) + slash.items.length) % slash.items.length;
    drawSlash(tgt);
    return true;
  }
  if (ev.key === "Enter" || ev.key === "Tab") {
    ev.preventDefault();
    slashPick(tgt);
    return true;
  }
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeSlash();
    return true;
  }
  return false;
}

function slashPick(tgt) {
  const [, , text, back] = slash.items[slash.index];
  closeSlash();
  tgt.pick(text, back);
}

function closeSlash() {
  slash.open = false;
  $("#slash").hidden = true;
}

/* ---------------- 그림 붙여넣기 ---------------- */

async function pasteImage(ev, ta) {
  const file = [...(ev.clipboardData?.items || [])].find((it) => it.kind === "file" && /^image\/(png|jpeg|gif|webp)$/.test(it.type))?.getAsFile();
  if (!file) return;
  ev.preventDefault();
  const rel = await storeImage(file);
  if (!rel) return;
  ta.setRangeText(`![](${rel})`, ta.selectionStart, ta.selectionEnd, "end");
  ta.dispatchEvent(new Event("input"));
}

/* ---------------- 서식 도구 줄 ---------------- */

let lastRange = null; // 블록 안의 마지막 선택 범위 - 도구 줄의 select를 쓰는 동안 잃지 않게

function restoreSel() {
  const body = state.editing >= 0 ? editingBody(state.editing) : null;
  if (!body) return null;
  const sel = window.getSelection();
  if (lastRange && body.contains(lastRange.startContainer)) {
    body.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(lastRange);
  } else if (!sel.rangeCount || !body.contains(sel.anchorNode)) Editor.setCaret(body, Infinity);
  return body;
}

/** 도구 줄의 켜짐 표시·표 도구 보이기를 지금 선택에 맞춘다. */
function fmtState() {
  const body = state.editing >= 0 ? editingBody(state.editing) : null;
  const inBlock = !!body && (() => { const sel = getSelection(); return sel.rangeCount && body.contains(sel.anchorNode); })();
  for (const b of document.querySelectorAll("#fmt [data-cmd]")) {
    let on = false;
    try { on = inBlock && document.queryCommandState(b.dataset.cmd); } catch { /* 명령을 모르는 경우 */ }
    b.classList.toggle("on", on);
  }
  $("#f-tablebar").hidden = !(inBlock && Editor.selectionIn(body, "td, th"));
  const blockEl = inBlock && Editor.selectionIn(body, "h1, h2, h3, h4, h5, h6, blockquote, pre");
  $("#f-block").value = blockEl ? blockEl.tagName.toLowerCase().replace(/^h[4-6]$/, "h3").replace("pre", "code") : "p";
}

function insertBlocksAfter(parts, focus = 0, caret = "end") {
  // 고치는 블록 뒤(없으면 문서 끝)에 블록들을 넣고 그중 focus번째를 연다
  const at = state.editing >= 0 ? state.editing : state.blocks.length - 1;
  commitEdit();
  state.blocks.splice(at + 1, 0, ...parts);
  changed();
  renderDoc();
  editBlock(at + 1 + focus, caret);
}

function setBlockType(v) {
  const i = state.editing;
  if (i < 0) return;
  if (v === "code") {
    const body = editingBody(i);
    const text = body ? body.innerText.replace(/\n+$/, "") : state.blocks[i];
    state.editing = -1;
    state.blocks[i] = "```\n" + text + "\n```";
    changed();
    renderDoc();
    editSource(i, 4 + text.length);
    return;
  }
  if (!restoreSel()) return;
  Editor.exec("formatBlock", "<" + v + ">");
  changed();
  fmtState();
}

function toggleTaskBlock() {
  const i = state.editing;
  if (i < 0) return;
  syncEditing();
  const md = state.blocks[i];
  const lines = md.split("\n");
  const allTask = lines.every((l) => /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s/.test(l));
  state.blocks[i] = lines.map((l) => {
    if (allTask) return l.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]\s/, "$1");
    const item = l.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    return item ? `${item[1]}[ ] ${item[2]}` : `- [ ] ${l.replace(/^\s*#{1,6}\s+/, "")}`;
  }).join("\n");
  state.editing = -1;
  changed();
  renderDoc();
  editBlock(i, "end");
}

function insertTable() {
  const ans = prompt("표 크기 - 줄 수 × 칸 수 (머리 줄 포함)", "3 × 3");
  if (!ans) return;
  const nums = ans.match(/\d+/g) || [];
  const rows = Math.min(50, Math.max(2, Number(nums[0] || 3)));
  const cols = Math.min(12, Math.max(1, Number(nums[1] || 3)));
  const row = (cells) => "| " + cells.join(" | ") + " |";
  const md = [row([...Array(cols)].map((_, k) => `항목${k + 1}`)), row(Array(cols).fill("---")), ...Array(rows - 1).fill(row(Array(cols).fill(" ")))].join("\n");
  insertBlocksAfter([md], 0, "start");
}

function tableOp(op) {
  const body = restoreSel();
  const cell = body && Editor.selectionIn(body, "td, th");
  if (!cell) return;
  const table = cell.closest("table");
  const ok = op === "row-add" ? Editor.addRow(table, cell.parentElement) : op === "col-add" ? Editor.addCol(table, cell) : op === "row-del" ? Editor.delRow(table, cell) : Editor.delCol(table, cell);
  if (ok === false) return status("머리 줄이나 마지막 하나는 지울 수 없습니다.", "error");
  changed();
  withCaret(paginate);
  fmtState();
}

function insertLink() {
  const body = restoreSel();
  if (!body) return;
  const sel = window.getSelection();
  const url = prompt("링크 주소 (https://… 또는 다른 문서.md)", sel.toString().match(/^https?:\/\//) ? sel.toString() : "https://");
  if (!url || url === "https://") return;
  if (sel.isCollapsed) {
    const a = el("a", "", url);
    a.dataset.href = url;
    const r = sel.getRangeAt(0);
    r.insertNode(a);
    r.setStartAfter(a);
    r.collapse(true);
  } else Editor.exec("createLink", url);
  changed();
}

function drawPalette(id, colors, kind) {
  const pal = $("#" + id);
  pal.textContent = "";
  for (const c of colors) {
    const b = el("button");
    b.title = c;
    b.style.background = c;
    b.onmousedown = (ev) => ev.preventDefault();
    b.onclick = () => applyMark(kind, c);
    pal.append(b);
  }
  const none = el("button", "none", kind === "color" ? "기본 색으로" : "형광펜 지우기");
  none.onmousedown = (ev) => ev.preventDefault();
  none.onclick = () => applyMark(kind, "none");
  pal.append(none);
}

function applyMark(kind, value) {
  document.querySelectorAll(".pal").forEach((p) => (p.hidden = true));
  const body = restoreSel();
  if (!body) return;
  Editor.mark(body, kind, value);
  if (kind === "color") $("#f-color-sw").style.background = value === "none" ? "#000" : value;
  if (kind === "bg") $("#f-bg-sw").style.background = value === "none" ? "#ffff00" : value;
  changed();
  withCaret(paginate);
}

function setupFmt() {
  const fmt = $("#fmt");
  fmt.addEventListener("mousedown", (ev) => { if (ev.target.closest("button")) ev.preventDefault(); }); // 단추를 눌러도 글의 선택이 풀리지 않게
  for (const b of fmt.querySelectorAll("[data-cmd]")) b.onclick = () => { if (restoreSel()) { Editor.exec(b.dataset.cmd); changed(); fmtState(); } };
  const fontSel = $("#f-font");
  for (const f of Editor.FONTS) { const o = el("option", "", f); o.value = f; o.style.fontFamily = `"${f}"`; fontSel.append(o); }
  fontSel.onchange = () => { applyMark("font", fontSel.value || "none"); fontSel.value = ""; };
  const sizeSel = $("#f-size");
  for (const z of Editor.FONT_SIZES) { const o = el("option", "", z); o.value = z; sizeSel.append(o); }
  sizeSel.onchange = () => { applyMark("size", sizeSel.value || "none"); sizeSel.value = ""; };
  $("#f-block").onchange = (ev) => setBlockType(ev.target.value);
  drawPalette("pal-color", Editor.COLORS, "color");
  drawPalette("pal-bg", Editor.HILITES, "bg");
  const togglePal = (id) => { const p = $("#" + id); const show = p.hidden; document.querySelectorAll(".pal").forEach((x) => (x.hidden = true)); p.hidden = !show; };
  $("#f-color").onclick = () => togglePal("pal-color");
  $("#f-bg").onclick = () => togglePal("pal-bg");
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".pal-wrap")) document.querySelectorAll(".pal").forEach((x) => (x.hidden = true)); });
  $("#f-task").onclick = toggleTaskBlock;
  $("#f-table").onclick = insertTable;
  for (const op of ["row-add", "col-add", "row-del", "col-del"]) $("#f-" + op).onclick = () => tableOp(op);
  $("#f-image").onclick = () => $("#f-image-file").click();
  $("#f-image-file").onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file || !state.store) return;
    const rel = await storeImage(file);
    if (rel) { restoreSel(); await insertImage(rel); }
  };
  $("#f-link").onclick = insertLink;
  $("#f-break").onclick = () => insertBlocksAfter(["<!-- pagebreak -->", ""], 1, "start");
  $("#f-clear").onclick = () => { const body = restoreSel(); if (body) { Editor.clearFormat(body); changed(); fmtState(); } };
  document.addEventListener("selectionchange", () => {
    const body = state.editing >= 0 ? editingBody(state.editing) : null;
    const sel = window.getSelection();
    if (body && sel.rangeCount && body.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange();
    fmtState();
  });
  $("#mode-rich").onclick = () => { if (state.raw) toggleRaw(); };
  $("#mode-raw").onclick = () => { if (!state.raw) toggleRaw(); };
}

/* ---------------- 원문 보기 ---------------- */

function toggleRaw() {
  commitEdit();
  state.raw = !state.raw;
  if (state.raw) {
    $("#raw").value = state.blocks.join("\n\n") + "\n";
  } else {
    state.blocks = MD.splitBlocks($("#raw").value);
    renderDoc();
  }
  $("#raw-wrap").hidden = !state.raw;
  $("#doc").hidden = state.raw;
  $("#mode-rich").classList.toggle("on", !state.raw);
  $("#mode-raw").classList.toggle("on", state.raw);
  $("#fmt").hidden = state.raw;
  if (state.raw) autosize($("#raw"));
}

/* ---------------- 페이지 만들기·이름 바꾸기·지우기 ---------------- */

const SAFE_NAME = /^[^\\/:*?"<>|\u0000-\u001f]+$/;

function currentFolder() {
  return state.path && state.path.includes("/") ? state.path.split("/").slice(0, -1).join("/") + "/" : "";
}

async function newPage() {
  if (!state.store || state.store.kind === "single") return newDocument();
  const title = prompt("새 페이지 이름", "새 페이지");
  if (!title) return;
  const name = title.trim().replace(/\.md$/i, "");
  if (!SAFE_NAME.test(name) || name === "." || name === "..") return status("파일 이름에 쓸 수 없는 글자가 있습니다.", "error");
  const path = currentFolder() + name + ".md";
  if (state.entries.some((e) => e.path === path)) return status("같은 이름의 페이지가 있습니다.", "error");
  if (!(await flush())) return;
  await state.store.write(path, `# ${name}\n\n`);
  if (state.store.kind !== "single") await refreshTree();
  await openFile(path);
  editBlock(state.blocks.length > 1 ? 1 : 0);
}

async function newFolder() {
  const name = prompt("새 폴더 이름");
  if (!name) return;
  if (!SAFE_NAME.test(name.trim())) return status("폴더 이름에 쓸 수 없는 글자가 있습니다.", "error");
  try {
    await state.store.mkdir(currentFolder() + name.trim());
    await refreshTree();
  } catch (e) {
    status(e.message, "error");
  }
}

async function renamePage() {
  if (!state.path) return;
  const old = state.path.split("/").pop().replace(MD_EXT, "");
  const name = prompt("새 이름", old);
  if (!name || name === old) return;
  if (!SAFE_NAME.test(name.trim())) return status("파일 이름에 쓸 수 없는 글자가 있습니다.", "error");
  if (!(await flush())) return;
  const to = currentFolder() + name.trim().replace(/\.md$/i, "") + ".md";
  try {
    await state.store.rename(state.path, to);
    state.cache.delete(state.path);
    state.path = null;
    await refreshTree();
    await openFile(to);
  } catch (e) {
    status("이름을 바꾸지 못했습니다: " + e.message, "error");
  }
}

async function deletePage() {
  if (!state.path || !confirm(`"${state.path}" 페이지를 지울까요? 되돌릴 수 없습니다.`)) return;
  try {
    await state.store.remove(state.path);
    state.cache.delete(state.path);
    state.path = null;
    state.dirty = false;
    $("#page").hidden = true;
    $("#empty-state").hidden = false;
    await refreshTree();
  } catch (e) {
    status("지우지 못했습니다: " + e.message, "error");
  }
}

/* ---------------- 내보내기: 한글(hwpx)·PDF·인쇄 ---------------- */

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 그림 바이트(한글 문서에 넣을 것). 문서 기준 상대 경로 → 폴더 안 그림만. */
async function imageBytes(src) {
  const img = MD_SAFE_IMAGE(src);
  if (!img) return null;
  if (img.kind === "data") return b64ToBytes(img.src.split(",")[1].replace(/\s/g, ""));
  const rel = resolvePath(img.src);
  if (!rel || !state.store) return null;
  if (state.store.imageBytes) return state.store.imageBytes(rel);
  const url = await state.store.imageUrl(rel);
  return url.startsWith("data:") ? b64ToBytes(url.split(",")[1]) : null;
}

function docName() {
  if (state.path) return state.path.split("/").pop().replace(MD_EXT, "");
  return (MD.titleOf(docText()) || "새 문서").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 60) || "새 문서";
}

async function saveBytes(bytes, name, ext) {
  if (NATIVE) {
    const where = await window.nm_saveBytes(name + "." + ext, ext, bytesToB64(bytes));
    if (where) status(`${ext.toUpperCase()}로 저장했습니다: ${where}`, "ok");
    return;
  }
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  a.download = name + "." + ext;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function exportHwpx() {
  commitEdit();
  status("한글 문서를 만드는 중…");
  try {
    const bytes = await HWPX.build(docText(), { template: HWPX_TEMPLATE, title: docName(), readImage: imageBytes });
    await saveBytes(bytes, docName(), "hwpx");
  } catch (e) {
    status("한글 문서로 내보내지 못했습니다: " + (e.message || e), "error");
  }
}

function printDoc(pdfHint) {
  commitEdit();
  if (pdfHint) status("인쇄 창의 '프린터'에서 'PDF로 저장'(또는 Microsoft Print to PDF)을 고르세요.");
  setTimeout(() => window.print(), 50);
}

/* ---------------- 파일 메뉴 (한글·워드처럼) ---------------- */

async function newDocument() {
  if (!(await flushIfAny())) return;
  if (!state.store) state.store = singleStore("새 문서.md", "");
  state.path = null;
  state.untitled = true;
  state.dirty = false;
  state.blocks = ["# 새 문서", ""];
  showEditor();
  setDocTitle("새 문서", "");
  renderDoc();
  renderTree();
  status("저장하지 않은 새 문서");
  editBlock(1);
}

async function saveAs() {
  commitEdit();
  const name = (MD.titleOf(docText()) || "새 문서").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 60) || "새 문서";
  if (NATIVE) {
    try {
      const info = await window.nm_saveAs(name + ".md", docText());
      if (!info || !info.root) return false; // 취소
      state.store = nativeStore(info);
      state.untitled = false;
      state.dirty = false;
      await refreshTree();
      await openFile(info.open);
      status("저장됨", "ok");
      return true;
    } catch (e) {
      status("저장하지 못했습니다: " + e, "error");
      return false;
    }
  }
  if (state.store?.kind === "folder") {
    const p = prompt("저장할 이름", name);
    if (!p) return false;
    const path = currentFolder() + p.trim().replace(/\.md$/i, "") + ".md";
    await state.store.write(path, docText());
    state.untitled = false;
    state.dirty = false;
    await refreshTree();
    await openFile(path);
    return true;
  }
  const a = el("a"); // 파일 하나 모드: 내려받기
  a.href = URL.createObjectURL(new Blob([docText()], { type: "text/markdown;charset=utf-8" }));
  a.download = name + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  state.dirty = false;
  return true;
}

async function openDialog() {
  if (!NATIVE) return openSingle();
  if (!(await flushIfAny())) return;
  try {
    const info = await window.nm_openFile();
    if (info && info.root) await useStore(nativeStore(info), info.open);
  } catch (e) {
    status("열지 못했습니다: " + e, "error");
  }
}

function toggleMenu(force) {
  const menu = $("#filemenu");
  const open = force ?? menu.hidden;
  menu.hidden = !open;
  $("#btn-file").classList.toggle("on", open);
}

function showEditor() {
  $("#welcome").hidden = true;
  $("#app").hidden = false;
  $("#empty-state").hidden = true;
  $("#page").hidden = false;
}

/* ---------------- 시작 ---------------- */

async function useStore(store, openPath) {
  if (!(await flushIfAny())) return;
  state.store = store;
  state.cache.clear();
  state.imageCache.forEach((u) => URL.revokeObjectURL(u));
  state.imageCache.clear();
  state.path = null;
  state.untitled = false;
  $("#welcome").hidden = true;
  $("#app").hidden = false;
  $("#rootname").textContent = store.rootName || "";
  $("#rootname").title = store.dir || store.rootName || "";
  await refreshTree();
  const first = openPath || state.entries.find((e) => !e.dir && /(^|\/)(readme|index)\.md$/i.test(e.path))?.path || state.entries.find((e) => !e.dir)?.path;
  if (first) await openFile(first);
  else {
    $("#page").hidden = true;
    $("#empty-state").hidden = false;
  }
  warmSearch();
}

async function flushIfAny() {
  return state.store ? flush() : true;
}

async function pickFolder() {
  if (NATIVE) {
    if (!(await flushIfAny())) return;
    try {
      const info = await window.nm_openFolder();
      if (info && info.root) await useStore(nativeStore(info));
    } catch (e) {
      status("폴더를 열지 못했습니다: " + e, "error");
    }
    return;
  }
  if (!window.showDirectoryPicker) {
    alert("이 브라우저는 폴더 열기를 지원하지 않습니다. Edge나 Chrome으로 여시거나, '파일 하나 열기'를 쓰세요.");
    return;
  }
  try {
    const dir = await window.showDirectoryPicker({ id: "nongmak", mode: "readwrite" });
    await rememberFolder(dir);
    await useStore(folderStore(dir));
  } catch (e) {
    if (e.name !== "AbortError") status("폴더를 열지 못했습니다: " + e.message, "error");
  }
}

function openSingle() {
  const input = el("input");
  input.type = "file";
  input.accept = ".md,.markdown,text/markdown,text/plain";
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    await useStore(singleStore(f.name, await f.text()), f.name);
  };
  input.click();
}

// 최근 폴더 - 브라우저가 폴더 손잡이를 IndexedDB에 기억한다(이 PC·이 브라우저 안에만). 다시 열 때 권한을 한 번 묻는다.
function idb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open("nongmak", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function rememberFolder(dir) {
  try {
    const db = await idb();
    db.transaction("kv", "readwrite").objectStore("kv").put(dir, "folder");
  } catch { /* 기억 못 해도 된다 */ }
}
async function recallFolder() {
  try {
    const db = await idb();
    return await new Promise((ok) => {
      const r = db.transaction("kv").objectStore("kv").get("folder");
      r.onsuccess = () => ok(r.result || null);
      r.onerror = () => ok(null);
    });
  } catch {
    return null;
  }
}

function setZoom(z) {
  state.zoom = Math.round(Math.min(2, Math.max(0.3, z)) * 10) / 10;
  $("#doc").style.zoom = state.zoom;
  $("#raw-wrap").style.zoom = state.zoom;
  $("#zoom-val").textContent = Math.round(state.zoom * 100) + "%";
}

function toggleSide(open) {
  const app = $("#app");
  const show = open ?? app.classList.contains("side-closed");
  app.classList.toggle("side-closed", !show);
  try { localStorage.setItem("nongmak.side", show ? "1" : "0"); } catch { /* 무시 */ }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#btn-theme").textContent = theme === "dark" ? "밝게" : "어둡게";
  try { localStorage.setItem("nongmak.theme", theme); } catch { /* 무시 */ }
}

async function start() {
  try {
    const t = localStorage.getItem("nongmak.theme");
    if (t) document.documentElement.dataset.theme = t;
  } catch { /* 무시 */ }
  $("#btn-folder").onclick = pickFolder;
  $("#w-folder").onclick = pickFolder;
  $("#w-file").onclick = openDialog;
  $("#w-new").onclick = newDocument;
  $("#btn-file").onclick = (ev) => {
    ev.stopPropagation();
    toggleMenu();
  };
  document.addEventListener("click", () => toggleMenu(false));
  const menu = {
    "m-new": newDocument, "m-open": openDialog, "m-folder": pickFolder,
    "m-save": () => { state.dirty = true; save(); }, "m-saveas": saveAs,
    "m-hwpx": exportHwpx, "m-pdf": () => printDoc(true), "m-print": () => printDoc(false),
  };
  for (const [id, fn] of Object.entries(menu)) $("#" + id).onclick = () => { toggleMenu(false); fn(); };
  $("#btn-new").onclick = newPage;
  $("#btn-newdir").onclick = newFolder;
  $("#btn-rename").onclick = renamePage;
  $("#btn-delete").onclick = deletePage;
  setupFmt();
  $("#btn-theme").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $("#search").oninput = () => renderTree();
  $("#raw").oninput = () => {
    autosize($("#raw"));
    changed();
  };
  $("#doc").addEventListener("click", (ev) => {
    // 마지막 쪽의 빈 곳(블록 아래)을 누르면 끝에 이어 쓴다
    const body = ev.target.closest(".sheet-body") || ev.target.closest(".sheet")?.querySelector(".sheet-body");
    if (!body || ev.target.closest(".block") || body !== [...document.querySelectorAll(".sheet-body")].pop()) return;
    if (state.blocks[state.blocks.length - 1]?.trim()) state.blocks.push("");
    renderDoc();
    editBlock(state.blocks.length - 1);
  });
  // 확대·축소: 문서 위에서 Ctrl+휠, Ctrl+0은 100%. 작게 하면 쪽이 나란히 두 장 이상 보인다.
  $(".desk").addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    setZoom(state.zoom + (ev.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  $("#zoom-in").onclick = () => setZoom(state.zoom + 0.1);
  $("#zoom-out").onclick = () => setZoom(state.zoom - 0.1);
  $("#zoom-val").onclick = () => setZoom(1);
  $("#btn-side").onclick = () => toggleSide();
  $("#btn-side-close").onclick = () => toggleSide(false);
  try { if (localStorage.getItem("nongmak.side") === "0") toggleSide(false); } catch { /* 무시 */ }
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === "s") {
      ev.preventDefault();
      commitEdit();
      if (ev.shiftKey) return void saveAs();
      state.dirty = true;
      save();
    } else if (k === "o") {
      ev.preventDefault();
      openDialog();
    } else if (k === "n") {
      ev.preventDefault();
      newDocument();
    } else if (k === "p") {
      ev.preventDefault();
      printDoc(false);
    } else if (k === "0") {
      ev.preventDefault();
      setZoom(1);
    }
  });
  window.addEventListener("beforeunload", (ev) => {
    if (state.dirty) {
      ev.preventDefault();
      ev.returnValue = "";
    }
  });

  if (NATIVE) {
    const info = await window.nm_info();
    if (info && info.root) {
      await useStore(nativeStore(info), info.open || undefined);
      return;
    }
  }
  $("#welcome").hidden = false;
  if (NATIVE) $("#w-note").textContent = "마크다운(.md) 파일을 더블클릭해도 농막으로 열립니다. 이 프로그램은 인터넷에 연결하지 않습니다.";
  else if (!window.showDirectoryPicker) $("#w-note").textContent = "이 브라우저는 폴더 열기를 지원하지 않습니다. 파일 하나 열기만 쓸 수 있습니다(Edge·Chrome 권장).";
  const last = await recallFolder();
  if (last) {
    const btn = $("#w-last");
    btn.hidden = false;
    btn.textContent = `최근 폴더 다시 열기: ${last.name}`;
    btn.onclick = async () => {
      if ((await last.requestPermission({ mode: "readwrite" })) === "granted") await useStore(folderStore(last));
    };
  }
}

start();
