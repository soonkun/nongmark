"""화면 시험: nongmak.html을 Chromium에서 연다. 프로그램(nongmak.exe)이 넣어 주는 nm_* 함수를 메모리 가짜로 대신 넣어
'창 안' 모드를 그대로 돌린다. 바깥 요청 0건, CSP 위반 0건, 열기·고치기·저장·새 문서·다른 이름 저장·링크·검색을 본다.
실행: ../.tools/pw/bin/python tests/e2e.py"""
import json, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "시작.md": "# 시작\n\n첫 문단 **굵게** [회의록](회의/1차.md) [바깥](https://example.org)\n\n- [ ] 할 일 하나\n- [x] 끝난 일\n\n<script>alert(1)</script>\n",
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
    page.click("#doc-end"); page.keyboard.type("/표"); page.wait_for_selector(".slash-item"); page.keyboard.press("Enter"); page.keyboard.press("Escape"); time.sleep(1.2)
    assert "| 항목 | 내용 |" in files()["시작.md"], "/ 메뉴"
    page.click(".doc a:has-text('바깥')"); time.sleep(0.3)
    assert "바깥 주소는 열지 않습니다" in page.inner_text("#status")
    page.click(".doc a:has-text('회의록')"); page.wait_for_selector(".doc h1:has-text('1차 회의')")
    assert page.locator(".callout").count() == 1 and page.locator(".doc table").count() == 1
    page.fill("#search", "참고 상자"); time.sleep(0.4)
    assert any("1차" in t for t in page.locator(".tree-row").all_inner_texts())
    page.fill("#search", "")
    # 파일 메뉴 → 새 문서 → 쓰고 → Ctrl+S(다른 이름으로 저장)
    page.click("#btn-file"); page.click("#m-new"); page.wait_for_selector(".block-edit")
    page.keyboard.type("새 문서 본문"); page.keyboard.press("Escape")
    page.keyboard.press("Control+s"); time.sleep(1)
    assert "새 문서.md" in files() and "새 문서 본문" in files()["새 문서.md"], files().keys()
    page.screenshot(path=str(ROOT / "build" / "editor2.png"))
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
