"""화면 시험: nongmak.html을 Chromium에서 연다. 프로그램(nongmak.exe)이 넣어 주는 nm_* 함수를 메모리 가짜로 대신 넣어
'창 안' 모드를 그대로 돌린다. 바깥 요청 0건, CSP 위반 0건, 열기·고치기·저장·새 문서·다른 이름 저장·링크·검색을 본다.
실행: ../.tools/pw/bin/python tests/e2e.py"""
import json, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "시작.md": "# 시작\n\n첫 문단 **굵게** [회의록](회의/1차.md) [바깥](https://example.org)\n\n- [ ] 할 일 하나\n- [x] 끝난 일\n\n<script>alert(1)</script>\n",
    "긴 문서.md": "# 긴 문서\n\n" + "\n\n".join(f"{n}번째 문단입니다. 공무원 문서는 쪽 단위로 편집합니다. " * 3 for n in range(1, 60)) + "\n\n<!-- pagebreak -->\n\n## 새 쪽\n\n| 항목 | 내용 |\n| --- | --- |\n| 예산 | 3억 |\n",
    "회의/1차.md": "# 1차 회의\n\n> [!NOTE]\n> 참고 상자\n\n| 항목 | 내용 |\n| --- | --- |\n| 예산 | 3억 |\n",
}
FAKE = """
window.NONGMAK_NATIVE = true;
const F = %s; window.__files = F; let root = {root: "농막 시험", dir: "C:\\\\시험", open: "시작.md"};
const ok = (v) => Promise.resolve(v);
window.nm_info = () => ok(root);
window.nm_list = () => { const out = new Set(); for (const p of Object.keys(F)) { const parts = p.split("/"); for (let i = 1; i < parts.length; i++) out.add(JSON.stringify({path: parts.slice(0, i).join("/"), dir: true})); out.add(JSON.stringify({path: p, dir: false})); } return ok([...out].map((s) => JSON.parse(s)).sort((a, b) => a.path.localeCompare(b.path))); };
window.nm_read = (p) => p in F ? ok(F[p]) : Promise.reject("없음");
window.nm_write = (p, t) => { F[p] = t; return ok(null); };
window.nm_remove = (p) => { delete F[p]; return ok(null); };
window.nm_rename = (a, b) => { F[b] = F[a]; delete F[a]; return ok(null); };
window.nm_mkdir = () => ok(null);
window.nm_saveAsset = (n) => ok("assets/" + n);
window.nm_image = () => Promise.reject("없음");
window.nm_setTitle = (t) => { window.__title = t; return ok(null); };
window.nm_openFile = () => ok(root);
window.nm_openFolder = () => ok(root);
window.nm_saveAs = (name, text) => { F[name] = text; root = {...root, open: name}; return ok(root); };
window.nm_alert = () => ok(null);
window.nm_saveBytes = (name, ext, b64) => { window.__export = {name, ext, b64}; return ok("C:/시험/" + name); };
""" % json.dumps(FILES, ensure_ascii=False)

outside, errors = [], []
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 820})
    page.add_init_script(FAKE)
    page.on("request", lambda r: None if r.url.startswith(("file:", "data:", "blob:")) else outside.append(r.url))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept("새 페이지"))
    page.goto("file://" + str(ROOT / "dist" / "nongmak.html"))
    page.wait_for_selector(".doc h1")
    files = lambda: page.evaluate("window.__files")
    assert page.inner_text(".doc h1") == "시작" and page.evaluate("window.__title") == "시작"
    assert page.locator(".doc script").count() == 0 and "<script>alert(1)</script>" in page.inner_text(".doc")
    page.screenshot(path=str(ROOT / "build" / "editor.png"))
    page.click(".doc input[type=checkbox] >> nth=0"); time.sleep(1.2)
    assert "- [x] 할 일 하나" in files()["시작.md"], "체크 저장"
    page.click(".doc p >> nth=0"); page.keyboard.press("End"); page.keyboard.type(" 덧붙임"); page.keyboard.press("Escape"); time.sleep(1.2)
    assert "덧붙임" in files()["시작.md"], "편집 저장"
    page.click(".sheet:last-child .sheet-body", position={"x": 20, "y": 860}); page.keyboard.type("/표"); page.wait_for_selector(".slash-item"); page.keyboard.press("Enter"); page.keyboard.press("Escape"); time.sleep(1.2)
    assert "| 항목 | 내용 |" in files()["시작.md"], "/ 메뉴"
    page.click(".doc a:has-text('바깥')", modifiers=["Control"]); time.sleep(0.3)  # 서식 편집 중엔 Ctrl+클릭이 링크 열기
    assert "바깥 주소는 열지 않습니다" in page.inner_text("#status")
    page.click(".doc a:has-text('회의록')", modifiers=["Control"]); page.wait_for_selector(".doc h1:has-text('1차 회의')")
    assert page.locator(".callout").count() == 1 and page.locator(".doc table").count() == 1
    page.fill("#search", "참고 상자"); time.sleep(0.4)
    assert any("1차" in t for t in page.locator(".tree-row").all_inner_texts())
    page.fill("#search", "")
    # 파일 메뉴 → 새 문서 → 쓰고 → Ctrl+S(다른 이름으로 저장)
    page.click("#btn-file"); page.click("#m-new"); page.wait_for_selector(".block.editing")
    page.keyboard.type("새 문서 본문"); page.keyboard.press("Escape")
    page.keyboard.press("Control+s"); time.sleep(1)
    assert "새 문서.md" in files() and "새 문서 본문" in files()["새 문서.md"], files().keys()
    page.screenshot(path=str(ROOT / "build" / "editor2.png"))
    # 쪽: 긴 문서는 여러 쪽, 쪽 나눔 뒤는 새 쪽, 쪽 크기는 A4(96dpi에서 794px 폭)
    page.click(".tree-row:has-text('긴 문서')"); page.wait_for_selector(".doc h1:has-text('긴 문서')"); time.sleep(0.5)
    sheets = page.locator(".sheet").count()
    w = page.evaluate("document.querySelector('.sheet').getBoundingClientRect().width")
    last_has_new = page.locator(".sheet").nth(sheets - 1).locator("h2:has-text('새 쪽')").count()
    print("쪽 수:", sheets, "| 쪽 폭 px:", round(w), "| 쪽 나눔 뒤 새 쪽:", bool(last_has_new))
    assert sheets >= 3 and abs(w - 793.7) < 3 and last_has_new
    over = page.evaluate("[...document.querySelectorAll('.sheet-body')].filter(b => b.scrollHeight > b.clientHeight + 2 && b.childElementCount > 1).length")
    assert over == 0, f"넘친 쪽 {over}"
    # 서식 편집기: 단어를 골라 굵게·빨강, 표를 넣고 칸에 쓰기, 긴 표는 쪽을 넘어 잘린다(머리 줄 반복)
    page.click(".tree-row:has-text('시작')"); page.wait_for_selector(".doc h1:has-text('시작')")
    page.click(".doc p >> nth=0"); page.keyboard.press("Home")
    for _ in range(2): page.keyboard.press("Shift+ArrowRight")
    page.click("#fmt [data-cmd=bold]"); page.click("#f-color"); page.click("#pal-color button >> nth=3"); page.keyboard.press("Escape"); time.sleep(1.2)
    assert '**<span style="color:#c00000">첫 </span>**' in files()["시작.md"], files()["시작.md"]
    page.click(".doc p >> nth=0"); page.click("#f-table"); time.sleep(0.3)  # 대화상자 → "4 × 2"는 기본값으로 받는다
    page.keyboard.type("가"); page.keyboard.press("Tab"); page.keyboard.type("나"); page.keyboard.press("Escape"); time.sleep(1.2)
    assert "| 가 | 나 |" in files()["시작.md"], files()["시작.md"]
    page.evaluate("""() => { window.__files["긴 표.md"] = "# 긴 표\\n\\n| 구분 | 내용 |\\n| --- | --- |\\n" + Array.from({length: 70}, (_, n) => `| 항목 ${n} | 내용 ${n} |`).join("\\n") + "\\n\\n끝 문단\\n"; }""")
    page.click("#btn-folder"); page.wait_for_selector(".tree-row:has-text('긴 표')"); page.click(".tree-row:has-text('긴 표')"); page.wait_for_selector(".doc h1:has-text('긴 표')"); time.sleep(0.5)
    conts, theads = page.locator(".block.cont").count(), page.locator(".doc thead").count()
    over = page.evaluate("[...document.querySelectorAll('.sheet-body')].filter(b => b.scrollHeight > b.clientHeight + 2).length")
    print("긴 표: 이어 붙인 조각", conts, "| 머리 줄", theads, "| 넘친 쪽", over)
    assert conts >= 1 and theads == conts + 1 and over == 0 and page.locator(".sheet").last.locator("p:has-text('끝 문단')").count() == 1
    page.click(".tree-row:has-text('긴 문서')"); page.wait_for_selector(".doc h1:has-text('긴 문서')"); time.sleep(0.5)
    # 확대·축소: Ctrl+휠로 줄이면 쪽이 나란히
    page.mouse.move(700, 400)
    for _ in range(6): page.keyboard.down("Control"); page.mouse.wheel(0, 120); page.keyboard.up("Control"); time.sleep(0.05)
    tops = page.evaluate("[...document.querySelectorAll('.sheet')].slice(0,2).map(s => Math.round(s.getBoundingClientRect().top))")
    print("줌:", page.inner_text("#zoom-val"), "| 첫 두 쪽 위치:", tops)
    assert tops[0] == tops[1], "두 쪽이 나란히 놓이지 않음"
    page.screenshot(path=str(ROOT / "build" / "two-pages.png"))
    page.click("#zoom-val")
    # 목록 닫기·열기
    page.click("#btn-side-close"); time.sleep(0.4)
    assert page.evaluate("document.querySelector('.side').getBoundingClientRect().width") < 5
    page.click("#btn-side"); time.sleep(0.4)
    assert page.evaluate("document.querySelector('.side').getBoundingClientRect().width") > 200
    # 한글로 내보내기
    page.click("#btn-file"); page.click("#m-hwpx"); time.sleep(1)
    exp = page.evaluate("window.__export")
    import base64
    (ROOT / "build" / "export.hwpx").write_bytes(base64.b64decode(exp["b64"]))
    print("내보냄:", exp["name"], exp["ext"], len(exp["b64"]))
    b.close()

with sync_playwright() as p:  # 시작 화면(가짜 없이 = 브라우저에서 html만 연 경우)
    b = p.chromium.launch(); page = b.new_page(viewport={"width": 1280, "height": 820})
    page.on("request", lambda r: None if r.url.startswith(("file:", "data:", "blob:")) else outside.append(r.url))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto("file://" + str(ROOT / "dist" / "nongmak.html")); page.wait_for_selector("#welcome:not([hidden])")
    page.screenshot(path=str(ROOT / "build" / "welcome.png")); b.close()

print("바깥 연결:", outside or "없음")
print("콘솔 오류:", errors or "없음")
assert not outside and not errors
print("OK")
