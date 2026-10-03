// 새싹이의 농막 화면. 메모장·한글처럼 문서를 탭으로 열고(폴더 보기 없음), 본문은 편집기(NMEditor, ProseMirror)가 맡는다.
// 파일은 언제나 마크다운(.md). 편집기 ⇄ 마크다운 변환은 편집기 묶음(web/editor-app)이 한다.
// 저장소는 둘 중 하나 - 같은 함수 모양(read/write/saveAsset/imageUrl)을 갖는다:
//   native : nongmak.exe 창(WebView2) 안. 프로그램이 넣어 준 nm_* 함수를 부른다(같은 프로세스, 네트워크 없음). 문서가 든 폴더(dir)가 열쇠.
//   single : 브라우저에서 nongmak.html을 연 경우 - 파일 하나를 열고 내려받기로 저장.
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
  const dir = info.dir; // 프로그램이 등록한 폴더만 받는다
  return {
    kind: "native",
    rootName: info.root,
    dir,
    read: (p) => window.nm_read(dir, p),
    write: (p, text) => window.nm_write(dir, p, text),
    async saveAsset(name, blob) { return window.nm_saveAsset(dir, name, await blobToBase64(blob)); },
    imageUrl: (p) => window.nm_image(dir, p), // data: 주소
  };
}

function singleStore(name, text) {
  const files = { [name]: text };
  return {
    kind: "single",
    rootName: "",
    dir: "",
    async read(p) { return files[p]; },
    async write(p, t) {
      files[p] = t;
      const a = el("a");
      a.href = URL.createObjectURL(new Blob([t], { type: "text/markdown;charset=utf-8" }));
      a.download = p.split("/").pop();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async saveAsset() { throw new Error("그림 넣기는 프로그램 창(nongmak.exe)에서 쓸 수 있습니다."); },
    async imageUrl() { throw new Error("no folder"); },
  };
}

/* ---------------- 상태 ---------------- */

// 탭 하나 = 문서 하나 = 편집기 하나. state.tab이 지금 보는 탭.
const state = {
  tabs: [], // {store, path, untitled, dirty, ed(편집기), host(div), saveTimer}
  tab: -1,
  zoom: 1,
  raw: false,
};
const cur = () => state.tabs[state.tab];

const status = (text, kind = "") => {
  const s = $("#status");
  s.textContent = text;
  s.className = "status " + kind;
};

/* ---------------- 탭(열린 문서) ---------------- */

function nameOf(t) {
  if (t.path) return t.path.split("/").pop().replace(MD_EXT, "");
  return (MD.titleOf(t.ed ? t.ed.getMarkdown() : "") || "새 문서").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 60) || "새 문서";
}

/** 문서 기준 상대 경로 → 폴더 기준 경로. 폴더 밖(..로 루트를 넘음)이면 null. */
function resolvePath(rel, t = cur()) {
  let p;
  try {
    p = decodeURI(String(rel).split("#")[0].split("?")[0]).replace(/\\/g, "/");
  } catch {
    return null;
  }
  const base = (t?.path || "").split("/").slice(0, -1);
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

/** 탭을 만들고 편집기를 붙인다. */
async function addTab(doc, markdown) {
  const t = { untitled: false, dirty: false, saveTimer: null, ...doc };
  t.host = el("div", "nm-desk");
  t.host.hidden = true;
  $("#editors").append(t.host);
  t.ed = window.NMEditor.create(t.host, {
    markdown,
    resolveImage: async (src) => {
      const img = MD.safeImage(src);
      if (!img) return "";
      if (img.kind === "data") return img.src;
      const rel = resolvePath(img.src, t);
      if (!rel) return "";
      try { return await t.store.imageUrl(rel); } catch { return ""; }
    },
    saveImage: (file) => storeImage(file, t),
  });
  t.ed.on("change", () => { if (t === cur()) changed(); });
  t.ed.on("pages", (n) => { if (t === cur()) $("#pages").textContent = `${n}쪽`; });
  t.ed.on("state", () => { if (t === cur()) fmtState(); });
  t.host.addEventListener("click", (ev) => {
    const a = ev.target.closest("a[href]");
    if (a && ev.ctrlKey) { ev.preventDefault(); followLink(a.getAttribute("href")); } // 편집 중엔 Ctrl+클릭이 링크 열기
  });
  await t.ed.ready;
  state.tabs.push(t);
  showHome(false);
  await activate(state.tabs.length - 1);
  return t;
}

/** 탭 j를 보여 준다. 지금 문서는 저장해 두고(제목 없는 새 문서는 탭에 남는다) 바꾼다. */
async function activate(j) {
  const prev = cur();
  if (prev && prev !== state.tabs[j]) {
    if (prev.dirty && !prev.untitled && prev.store?.kind === "native") await save(prev);
    prev.host.hidden = true;
  }
  state.tab = j;
  const t = cur();
  t.host.hidden = false;
  if (state.raw) $("#raw").value = t.ed.getMarkdown();
  renderTabs();
  setDocTitle();
  countChars();
  fmtState();
  status(t.untitled ? "저장하지 않은 새 문서 (Ctrl+S)" : "열림");
}

async function closeTab(j) {
  const t = state.tabs[j];
  if (!t) return;
  if (j === state.tab) {
    if (!(await flush())) return;
  } else if (t.dirty && (t.untitled || t.store.kind !== "native") && !confirm(`"${nameOf(t)}"에 저장하지 않은 내용이 있습니다. 버리고 닫을까요?`)) return;
  clearTimeout(t.saveTimer);
  t.ed.destroy();
  t.host.remove();
  state.tabs.splice(j, 1);
  if (!state.tabs.length) {
    state.tab = -1;
    renderTabs();
    return showHome(true); // 다 닫으면 대문으로
  }
  const next = j < state.tab ? state.tab - 1 : Math.min(state.tab, state.tabs.length - 1);
  state.tab = -1;
  await activate(next);
}

function renderTabs() {
  const bar = $("#tabs");
  bar.querySelectorAll(".tab").forEach((x) => x.remove());
  const add = $("#tab-add");
  state.tabs.forEach((t, j) => {
    const name = nameOf(t);
    const tab = el("div", "tab" + (j === state.tab ? " on" : ""));
    tab.title = t.store?.dir && t.path ? t.store.dir + "\\" + t.path.replace(/\//g, "\\") : name;
    tab.append(el("span", "tab-name", name), el("span", "tab-dot" + (t.dirty || t.untitled ? " show" : ""), "●"));
    const x = el("button", "tab-x", "×");
    x.title = "닫기 (Ctrl+W)";
    x.onclick = (ev) => { ev.stopPropagation(); closeTab(j); };
    tab.append(x);
    tab.onclick = () => { if (j !== state.tab) activate(j); };
    tab.onauxclick = (ev) => { if (ev.button === 1) closeTab(j); };
    bar.insertBefore(tab, add);
  });
}

/** 폴더(store) 안의 문서를 탭으로 연다. 이미 열려 있으면 그 탭으로. */
async function openPath(store, path) {
  const j = state.tabs.findIndex((t) => t.store?.dir === store.dir && t.path === path);
  if (j >= 0) return activate(j);
  try {
    const text = await store.read(path);
    await addTab({ store, path }, text);
    rememberRecent(store, path);
  } catch (e) {
    status("열지 못했습니다: " + (e.message || e), "error");
  }
}

/* ---------------- 대문과 최근 문서 ---------------- */

function showHome(on) {
  $("#app").classList.toggle("home", on);
  $("#welcome").hidden = !on;
  if (on) {
    document.title = "새싹이의 농막";
    if (NATIVE) window.nm_setTitle("");
    renderRecent();
  }
}

function recentList() {
  try { return JSON.parse(localStorage.getItem("nongmak.recent") || "[]"); } catch { return []; }
}

function rememberRecent(store, path) {
  if (store.kind !== "native" || !path) return;
  const full = store.dir + "\\" + path.replace(/\//g, "\\");
  const list = [{ full, name: path.split("/").pop().replace(MD_EXT, "") }, ...recentList().filter((r) => r.full !== full)].slice(0, 8);
  try { localStorage.setItem("nongmak.recent", JSON.stringify(list)); } catch { /* 기억 못 해도 된다 */ }
}

function renderRecent() {
  const list = recentList();
  $("#w-recent").hidden = !NATIVE || !list.length;
  const box = $("#w-recent-list");
  box.textContent = "";
  for (const r of list) {
    const b = el("button");
    b.append(el("span", "r-name", r.name), el("span", "r-path", r.full));
    b.title = r.full;
    b.onclick = async () => {
      try {
        const info = await window.nm_openRecent(r.full);
        if (info && info.root) await openPath(nativeStore(info), info.open);
      } catch (e) {
        status("열지 못했습니다(옮겨졌거나 지워진 문서): " + e, "error");
        try { localStorage.setItem("nongmak.recent", JSON.stringify(list.filter((x) => x.full !== r.full))); } catch { /* 무시 */ }
        renderRecent();
      }
    };
    box.append(b);
  }
}

/* ---------------- 문서 글·저장 ---------------- */

const docText = (t = cur()) => (t ? (state.raw && t === cur() ? $("#raw").value : t.ed.getMarkdown()) : "");

function setDocTitle() {
  const t = cur();
  const name = t ? nameOf(t) : "새 문서";
  $("#docpath").textContent = t?.store?.dir && t.path ? t.store.dir + "\\" + t.path.replace(/\//g, "\\") : t?.untitled ? "저장하지 않은 새 문서" : "";
  document.title = name + " - 새싹이의 농막";
  if (NATIVE) window.nm_setTitle(name);
}

function countChars() {
  const text = docText();
  $("#count").textContent = `${text.replace(/\s/g, "").length.toLocaleString("ko-KR")}자`;
}

function changed() {
  const t = cur();
  if (!t) return;
  if (!t.dirty) { t.dirty = true; renderTabs(); }
  countChars();
  if (t.untitled) return status("저장하지 않은 새 문서 (Ctrl+S)");
  status(t.store.kind === "single" ? "저장 안 됨 (Ctrl+S로 내려받기)" : "저장 중…");
  if (t.store.kind !== "single") {
    clearTimeout(t.saveTimer);
    t.saveTimer = setTimeout(() => save(t), 800);
  }
}

async function save(t = cur()) {
  if (!t) return true;
  clearTimeout(t.saveTimer);
  if (t.untitled) return saveAs();
  if (!t.path || !t.dirty) return true;
  const text = docText(t);
  try {
    await t.store.write(t.path, text);
    t.dirty = false;
    renderTabs();
    if (t === cur()) status("저장됨 · " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), "ok");
    return true;
  } catch (e) {
    status("저장 실패: " + e.message, "error");
    return false;
  }
}

async function flush() {
  const t = cur();
  if (!t || !t.dirty) return true;
  if (t.untitled) return confirm("저장하지 않은 새 문서가 있습니다. 버리고 계속할까요?");
  if (t.store.kind === "single") return confirm("저장하지 않은 내용이 있습니다. 버리고 계속할까요?");
  return save(t);
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
  if (p && MD_EXT.test(p)) openPath(cur().store, p);
  else status("문서 링크(.md)만 열 수 있습니다: " + href, "error");
}

/** 그림 파일을 문서 폴더의 assets/에 저장하고 문서 기준 상대 경로를 돌려준다. */
async function storeImage(file, t = cur()) {
  if (file.size > 20 * 1024 * 1024) return status("그림이 20MB를 넘습니다.", "error"), null;
  if (t.untitled || !t.store || t.store.kind !== "native") return status("그림을 넣으려면 먼저 문서를 저장하세요(Ctrl+S) - 그림은 문서 옆 assets 폴더에 저장됩니다.", "error"), null;
  try {
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const name = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6) + "." + ext;
    const saved = await t.store.saveAsset(name, file);
    const depth = (t.path || "").split("/").length - 1;
    return "../".repeat(depth) + saved;
  } catch (e) {
    status("그림을 저장하지 못했습니다: " + e.message, "error");
    return null;
  }
}

/* ---------------- 왼쪽 도구 막대 ---------------- */

const BLOCK_TYPES = [["p", "본문"], ["h1", "제목 1"], ["h2", "제목 2"], ["h3", "제목 3"], ["blockquote", "인용"], ["code", "코드"]];

/** 도구 막대의 켜짐 표시·표/그림 도구 보이기를 지금 선택에 맞춘다. */
function fmtState() {
  const t = cur();
  const st = t ? t.ed.state() : null;
  for (const b of document.querySelectorAll("#rail [data-cmd]")) b.classList.toggle("on", !!(st && st[b.dataset.cmd]));
  $("#f-tablebar").hidden = !(st && st.table);
  $("#f-imagebar").hidden = !(st && st.image);
  $("#f-block .lb").textContent = (BLOCK_TYPES.find(([v]) => v === (st ? st.block : "p")) || BLOCK_TYPES[0])[1];
  $("#f-undo").disabled = !(st && st.canUndo);
  $("#f-redo").disabled = !(st && st.canRedo);
}

function closePops() {
  document.querySelectorAll(".pop").forEach((p) => (p.hidden = true));
}

/** 설명 상자를 단추 오른쪽에 놓는다(도구 막대가 스크롤돼도 잘리지 않게 화면 기준 고정 위치). */
function placePop(pop) {
  const r = pop.parentElement.querySelector("button").getBoundingClientRect();
  pop.hidden = false;
  const h = pop.offsetHeight;
  pop.style.left = r.right + 6 + "px";
  pop.style.top = Math.max(8, Math.min(r.top, window.innerHeight - h - 8)) + "px";
}

/** 도구 막대 단추 옆에 펼쳐지는 목록. items: [값, 이름, 작은 글(선택)]. */
function showPop(id, items, onPick, current) {
  const pop = $("#" + id);
  const wasOpen = !pop.hidden;
  closePops();
  if (wasOpen) return;
  pop.textContent = "";
  for (const [value, name, hint] of items) {
    const row = el("button", "pi" + (value === current ? " on" : ""));
    row.type = "button";
    row.append(el("span", "", name));
    if (hint) row.append(el("small", "", hint));
    if (id === "pop-font" && value) row.firstChild.style.fontFamily = `"${value}"`;
    if (id === "pop-size" && value) row.firstChild.style.fontSize = value;
    row.onmousedown = (ev) => ev.preventDefault();
    row.onclick = () => { closePops(); onPick(value); };
    pop.append(row);
  }
  placePop(pop);
}

function drawPalette(id, colors, kind) {
  const pal = $("#" + id);
  pal.textContent = "";
  for (const c of colors) {
    const b = el("button");
    b.type = "button";
    b.title = c;
    b.style.background = c;
    b.onmousedown = (ev) => ev.preventDefault();
    b.onclick = () => { closePops(); cmd(kind, c); };
    pal.append(b);
  }
  const none = el("button", "none", kind === "color" ? "기본 색으로" : "형광펜 지우기");
  none.type = "button";
  none.onmousedown = (ev) => ev.preventDefault();
  none.onclick = () => { closePops(); cmd(kind, null); };
  pal.append(none);
}

/** 편집기 명령. 문서가 없으면 아무 일도 하지 않는다. */
function cmd(name, value) {
  const t = cur();
  if (!t) return;
  if (state.raw) return status("원문 모드에서는 서식 도구를 쓸 수 없습니다 - 편집기로 돌아가세요.");
  t.ed.cmd(name, value);
  fmtState();
}

function setupRail() {
  const rail = $("#rail");
  rail.addEventListener("mousedown", (ev) => { if (ev.target.closest("button")) ev.preventDefault(); }); // 단추를 눌러도 글의 선택이 풀리지 않게
  for (const b of rail.querySelectorAll("[data-cmd]")) b.onclick = () => { closePops(); cmd(b.dataset.cmd); };
  $("#f-undo").onclick = () => cmd("undo");
  $("#f-redo").onclick = () => cmd("redo");
  $("#f-block").onclick = () => showPop("pop-block", BLOCK_TYPES, (v) => cmd("block", v), cur()?.ed.state().block);
  const E = window.NMEditor;
  $("#f-font").onclick = () => showPop("pop-font", [[null, "기본 글꼴"], ...E.FONTS.map((f) => [f, f])], (v) => cmd("font", v));
  $("#f-size").onclick = () => showPop("pop-size", [[null, "기본 크기", "11pt"], ...E.SIZES.map((z) => [z, z])], (v) => cmd("size", v));
  drawPalette("pal-color", E.COLORS, "color");
  drawPalette("pal-bg", E.HILITES, "bg");
  const togglePal = (id) => { const p = $("#" + id); const show = p.hidden; closePops(); if (show) placePop(p); };
  $("#f-color").onclick = () => togglePal("pal-color");
  $("#f-bg").onclick = () => togglePal("pal-bg");
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".rb-wrap")) closePops(); });
  $("#f-callout").onclick = () => showPop("pop-callout", Object.entries(E.CALLOUTS).map(([k, v]) => [k, v]), (v) => cmd("callout", v));
  $("#f-table").onclick = () => {
    const ans = prompt("표 크기 - 줄 수 × 칸 수 (머리 줄 포함)", "3 × 3");
    if (!ans) return;
    const nums = ans.match(/\d+/g) || [];
    cmd("table", { rows: Math.min(50, Math.max(2, Number(nums[0] || 3))), cols: Math.min(12, Math.max(1, Number(nums[1] || 3))) });
  };
  for (const op of ["rowAdd", "colAdd", "rowDel", "colDel", "tableDel", "headerRow"]) $("#f-" + op).onclick = () => cmd(op);
  for (const a of ["left", "center", "right"]) {
    $("#f-cell-" + a).onclick = () => cmd("cellAlign", a === "left" ? null : a);
    $("#f-img-" + a).onclick = () => cmd("imageAlign", a === "left" ? null : a);
  }
  $("#f-img-width").onclick = () => {
    const w = cur()?.ed.state().image?.width;
    const ans = prompt("그림 너비(px) - 비우면 원래 크기", w ? String(Math.round(w)) : "");
    if (ans === null) return;
    cmd("imageWidth", ans.trim() ? Math.max(40, Number(ans.replace(/\D/g, "")) || 40) : null);
  };
  $("#f-img-alt").onclick = () => {
    const alt = cur()?.ed.state().image?.alt || "";
    const ans = prompt("그림 설명(대체 글)", alt);
    if (ans !== null) cmd("imageAlt", ans.trim());
  };
  $("#f-img-del").onclick = () => cmd("imageDel");
  $("#f-image").onclick = () => cmd("image");
  $("#f-link").onclick = () => cmd("link");
  $("#f-break").onclick = () => cmd("pagebreak");
  $("#f-hr").onclick = () => cmd("hr");
  $("#f-up").onclick = () => cmd("moveUp");
  $("#f-down").onclick = () => cmd("moveDown");
  $("#f-clear").onclick = () => cmd("clear");
  $("#mode-rich").onclick = () => setRaw(false);
  $("#mode-raw").onclick = () => setRaw(true);
}

/* ---------------- 원문 보기 ---------------- */

function setRaw(on) {
  const t = cur();
  if (!t || state.raw === on) return;
  if (on) $("#raw").value = t.ed.getMarkdown();
  else t.ed.setMarkdown($("#raw").value);
  state.raw = on;
  $("#raw-wrap").hidden = !on;
  $("#editors").hidden = on;
  $("#mode-rich").classList.toggle("on", !on);
  $("#mode-raw").classList.toggle("on", on);
  $("#rail").classList.toggle("off", on);
  if (on) autosize($("#raw"));
}

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + 2 + "px";
}

/* ---------------- 인쇄: 마크다운을 쪽으로 그려서(화면 해석기) 인쇄한다 ---------------- */

/* 쪽: A4(210×297mm), 여백 좌우 20mm·위아래 30mm. 블록을 차례로 쪽에 담다가 넘치면 다음 쪽으로 넘긴다.
   <!-- pagebreak --> 뒤는 무조건 새 쪽. 표·목록이 쪽을 넘치면 줄(tr)·항목(li) 단위로 잘라 다음 쪽에 잇는다(표는 머리 줄 반복). */
function newSheet(doc) {
  const sheet = el("section", "sheet");
  const body = el("div", "sheet-body");
  const no = el("div", "sheet-no");
  sheet.append(body, no);
  doc.append(sheet);
  return body;
}

function applyStyles(root) {
  for (const s of root.querySelectorAll(".st")) {
    const d = s.dataset;
    if (d.color) s.style.color = d.color;
    if (d.bg) s.style.backgroundColor = d.bg;
    if (d.font) s.style.fontFamily = `"${d.font}"`;
    if (d.size) s.style.fontSize = d.size;
  }
}

function printBlock(md, i) {
  const wrap = el("div", "block");
  wrap.dataset.i = i;
  const body = el("div", "block-body");
  body.innerHTML = MD.renderBlock(md); // MD.renderBlock은 원문을 전부 이스케이프한다(markdown.js 머리말)
  applyStyles(body);
  wrap.append(body);
  return wrap;
}

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
  while (target.nextSibling) body.append(target.nextSibling);
  applyStyles(body);
  cont.append(body);
  return cont;
}

async function buildPrintDoc(md, t) {
  const doc = $("#print-doc");
  doc.textContent = "";
  const blocks = MD.splitBlocks(md).map((b, i) => printBlock(b, i));
  // 그림을 먼저 넣는다(높이를 재야 하니까)
  for (const b of blocks) {
    for (const img of b.querySelectorAll("img[data-src]")) {
      const rel = resolvePath(img.dataset.src, t);
      try { img.src = rel ? await t.store.imageUrl(rel) : ""; } catch { img.replaceWith(el("span", "blocked", `[그림 없음: ${img.dataset.src}]`)); }
    }
  }
  doc.hidden = false;
  let body = newSheet(doc);
  const limit = () => body.clientHeight;
  const overflow = (b) => b.offsetTop + b.offsetHeight > limit();
  const queue = blocks;
  for (let k = 0; k < queue.length; k++) {
    const b = queue[k];
    body.append(b);
    if (overflow(b)) {
      let cont = splitBlock(b, body, limit());
      if (!cont && body.childElementCount > 1) {
        b.remove();
        body = newSheet(doc);
        body.append(b);
        if (overflow(b)) cont = splitBlock(b, body, limit());
      }
      if (cont) queue.splice(k + 1, 0, cont);
    }
    if (b.querySelector("[data-pagebreak]")) body = newSheet(doc);
  }
  doc.querySelectorAll(".sheet").forEach((sh, n) => (sh.querySelector(".sheet-no").textContent = `- ${n + 1} -`));
}

async function printDoc(pdfHint) {
  const t = cur();
  if (!t) return;
  await buildPrintDoc(docText(), t);
  document.body.classList.add("printing");
  if (pdfHint) status("인쇄 창의 '프린터'에서 'PDF로 저장'(또는 Microsoft Print to PDF)을 고르세요.");
  const done = () => { document.body.classList.remove("printing"); $("#print-doc").hidden = true; $("#print-doc").textContent = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 50);
}

/* ---------------- 내보내기: 한글(hwpx) ---------------- */

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
  const t = cur();
  const rel = resolvePath(img.src, t);
  if (!rel || !t?.store) return null;
  const url = await t.store.imageUrl(rel);
  return url.startsWith("data:") ? b64ToBytes(url.split(",")[1]) : null;
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
  const t = cur();
  if (!t) return;
  status("한글 문서를 만드는 중…");
  try {
    const bytes = await HWPX.build(docText(), { template: HWPX_TEMPLATE, title: nameOf(t), readImage: imageBytes });
    await saveBytes(bytes, nameOf(t), "hwpx");
  } catch (e) {
    status("한글 문서로 내보내지 못했습니다: " + (e.message || e), "error");
  }
}

/* ---------------- 파일 메뉴 (한글·워드처럼) ---------------- */

async function newDocument() {
  const t = await addTab({ store: singleStore("새 문서.md", ""), path: null, untitled: true }, "# 새 문서\n\n");
  t.ed.editor.commands.focus("end");
}

async function saveAs() {
  const t = cur();
  if (!t) return false;
  const name = nameOf(t);
  if (NATIVE) {
    try {
      const info = await window.nm_saveAs(name + ".md", docText(t));
      if (!info || !info.root) return false; // 취소
      t.store = nativeStore(info);
      t.path = info.open;
      t.untitled = false;
      t.dirty = false;
      renderTabs();
      setDocTitle();
      rememberRecent(t.store, t.path);
      status("저장됨", "ok");
      return true;
    } catch (e) {
      status("저장하지 못했습니다: " + e, "error");
      return false;
    }
  }
  const a = el("a"); // 브라우저: 내려받기
  a.href = URL.createObjectURL(new Blob([docText(t)], { type: "text/markdown;charset=utf-8" }));
  a.download = name + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  t.dirty = false;
  renderTabs();
  return true;
}

async function openDialog() {
  if (!NATIVE) return openSingle();
  try {
    const info = await window.nm_openFile();
    if (info && info.root) await openPath(nativeStore(info), info.open);
  } catch (e) {
    status("열지 못했습니다: " + e, "error");
  }
}

function openSingle() {
  const input = el("input");
  input.type = "file";
  input.accept = ".md,.markdown,text/markdown,text/plain";
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    await openPath(singleStore(f.name, await f.text()), f.name);
  };
  input.click();
}

function toggleMenu(force) {
  const menu = $("#filemenu");
  const open = force ?? menu.hidden;
  menu.hidden = !open;
  $("#btn-file").classList.toggle("on", open);
}

/* ---------------- 창 제목 줄(탭 줄) - 프로그램 창에는 시스템 제목 줄이 없다 ---------------- */

function setupTitlebar() {
  if (!window.NONGMAK_FRAMELESS || !window.nm_win) return;
  $("#wincmd").hidden = false;
  const win = (cmd) => window.nm_win(cmd).then(syncMax).catch(() => {});
  const syncMax = (zoomed) => {
    $("#app").classList.toggle("maximized", !!zoomed);
    $("#win-max").title = zoomed ? "이전 크기로" : "최대화";
    $("#win-max").firstElementChild.innerHTML = zoomed
      ? '<rect x="2.5" y=".5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><rect x=".5" y="2.5" width="7" height="7" fill="var(--cream)" stroke="currentColor" stroke-width="1"/>'
      : '<rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/>';
  };
  // 끌기는 창의 끌기 루프가 마우스를 가져가 dblclick 이벤트가 오지 않는다 - 두 번째 누름을 직접 알아본다
  let last = { t: 0, x: 0, y: 0 };
  const drag = (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const now = Date.now();
    const twice = now - last.t < 450 && Math.abs(ev.clientX - last.x) < 6 && Math.abs(ev.clientY - last.y) < 6;
    last = { t: twice ? 0 : now, x: ev.clientX, y: ev.clientY };
    win(twice ? "max" : "drag");
  };
  $("#tabs-drag").addEventListener("mousedown", drag);
  $("#tabs").addEventListener("mousedown", (ev) => { if (ev.target === $("#tabs")) drag(ev); });
  $("#win-min").onclick = () => win("min");
  $("#win-max").onclick = () => win("max");
  $("#win-close").onclick = () => win("close");
  // 위쪽 가장자리 5px: 창 높이 조절(제목 줄이 없어진 자리의 크기 조절 테두리 노릇)
  const edge = el("div", "resize-top");
  document.body.append(edge);
  edge.addEventListener("mousedown", (ev) => { if (ev.button !== 0) return; ev.preventDefault(); const w = window.innerWidth; win(ev.clientX < 8 ? "resize-top-left" : ev.clientX > w - 8 ? "resize-top-right" : "resize-top"); });
  window.addEventListener("resize", () => win("state"));
  win("state");
}

/* ---------------- 보기 ---------------- */

function setZoom(z) {
  state.zoom = Math.round(Math.min(2, Math.max(0.3, z)) * 10) / 10;
  $("#editors").style.zoom = state.zoom;
  $("#raw-wrap").style.zoom = state.zoom;
  $("#zoom-val").textContent = Math.round(state.zoom * 100) + "%";
}

function toggleSide(open) {
  // 왼쪽 도구 막대: 접으면 아이콘만, 펴면 이름도
  const app = $("#app");
  const show = open ?? !app.classList.contains("rail-open");
  app.classList.toggle("rail-open", show);
  $("#btn-side").classList.toggle("on", show);
  try { localStorage.setItem("nongmak.rail", show ? "1" : "0"); } catch { /* 무시 */ }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#btn-theme").textContent = theme === "dark" ? "밝게" : "어둡게";
  try { localStorage.setItem("nongmak.theme", theme); } catch { /* 무시 */ }
}

/* ---------------- 시작 ---------------- */

async function start() {
  try {
    const t = localStorage.getItem("nongmak.theme");
    if (t) document.documentElement.dataset.theme = t;
  } catch { /* 무시 */ }
  $("#btn-file").onclick = (ev) => {
    ev.stopPropagation();
    toggleMenu();
  };
  document.addEventListener("click", () => toggleMenu(false));
  const menu = {
    "m-new": newDocument, "m-open": openDialog,
    "m-save": () => { const t = cur(); if (t) { t.dirty = true; save(t); } }, "m-saveas": saveAs,
    "m-hwpx": exportHwpx, "m-pdf": () => printDoc(true), "m-print": () => printDoc(false),
    "m-close": () => closeTab(state.tab),
  };
  for (const [id, fn] of Object.entries(menu)) $("#" + id).onclick = () => { toggleMenu(false); fn(); };
  $("#tab-add").onclick = newDocument;
  $("#w-new").onclick = newDocument;
  $("#w-file").onclick = openDialog;
  setupTitlebar();
  setupRail();
  $("#btn-theme").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $("#raw").oninput = () => {
    autosize($("#raw"));
    changed();
  };
  // 확대·축소: 문서 위에서 Ctrl+휠, Ctrl+0은 100%
  $(".desk").addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    setZoom(state.zoom + (ev.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  $("#zoom-in").onclick = () => setZoom(state.zoom + 0.1);
  $("#zoom-out").onclick = () => setZoom(state.zoom - 0.1);
  $("#zoom-val").onclick = () => setZoom(1);
  $("#btn-side").onclick = () => toggleSide();
  try { if (localStorage.getItem("nongmak.rail") === "1") toggleSide(true); } catch { /* 무시 */ }
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === "s") {
      ev.preventDefault();
      if (ev.shiftKey) return void saveAs();
      const t = cur();
      if (t) { t.dirty = true; save(t); }
    } else if (k === "o") {
      ev.preventDefault();
      openDialog();
    } else if (k === "n") {
      ev.preventDefault();
      newDocument();
    } else if (k === "w") {
      ev.preventDefault();
      closeTab(state.tab);
    } else if (k === "tab" && state.tabs.length > 1) {
      ev.preventDefault();
      activate((state.tab + (ev.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length);
    } else if (k === "p") {
      ev.preventDefault();
      printDoc(false);
    } else if (k === "0") {
      ev.preventDefault();
      setZoom(1);
    }
  });
  window.addEventListener("beforeunload", (ev) => {
    if (state.tabs.some((t) => t.dirty && (t.untitled || t.store?.kind !== "native"))) {
      ev.preventDefault();
      ev.returnValue = "";
    }
  });

  if (NATIVE) {
    const info = await window.nm_info();
    if (info && info.root && info.open) {
      await openPath(nativeStore(info), info.open);
      return;
    }
  }
  showHome(true); // 열 문서가 없으면 대문
}

start();
