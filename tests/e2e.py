"""화면 시험: nongmark.html을 Chromium에서 연다. 프로그램(nongmark.exe)이 넣어 주는 nm_* 함수를 메모리 가짜로 대신 넣어
'창 안' 모드를 그대로 돌린다. 바깥 요청 0건, CSP 위반 0건, 열기·고치기·저장·새 문서·다른 이름 저장·링크·탭·서식 편집·쪽 나눔을 본다.
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
window.NONGMAK_NATIVE = true; window.NONGMAK_FRAMELESS = true;
window.nm_win = (c) => { window.__win = (window.__win || []).concat(c); return Promise.resolve(c === "max" ? !(window.__zoomed = !window.__zoomed) === false : !!window.__zoomed); };
const F = %s; window.__files = F; const DIR = "C:\\\\시험"; const root = {root: "시험", dir: DIR, open: "시작.md"};
const ok = (v) => Promise.resolve(v);
const chk = (dir) => { if (dir !== DIR) throw new Error("열지 않은 폴더: " + dir); };
window.nm_info = () => ok(root);
window.nm_read = (dir, p) => { chk(dir); return p in F ? ok(F[p]) : Promise.reject("없음"); };
window.nm_write = (dir, p, t) => { chk(dir); F[p] = t; return ok(null); };
window.nm_saveAsset = (dir, n) => ok("assets/" + n);
window.nm_image = () => Promise.reject("없음");
window.nm_setTitle = (t) => { window.__title = t; return ok(null); };
window.nm_openFile = () => ok({...root, open: window.__openNext || "시작.md"});
window.nm_saveAs = (name, text) => { F[name] = text; return ok({...root, open: name}); };
window.__recent = []; window.nm_recent = () => ok(window.__recent); window.nm_openRecent = (k) => ok({...root, open: window.__recent[k].full.split("\\\\").pop()}); window.nm_release = () => ok(null);
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
    page.goto("file://" + str(ROOT / "dist" / "nongmark.html"))
    page.wait_for_selector(".nm-pm h1")
    files = lambda: page.evaluate("window.__files")
    open_doc = lambda name: (page.evaluate(f"window.__openNext = {json.dumps(name)}"), page.click("#btn-file"), page.click("#m-open"), page.wait_for_selector(f".tab.on:has-text('{name.replace('.md', '')}')"), time.sleep(0.6))
    assert page.inner_text(".nm-pm h1") == "시작" and page.evaluate("window.__title") == "시작"
    assert page.locator(".nm-pm script").count() == 0 and "<script>alert(1)</script>" in page.inner_text(".nm-pm")
    assert page.locator(".tab").count() == 1 and page.inner_text(".tab.on .tab-name") == "시작"
    page.screenshot(path=str(ROOT / "build" / "editor.png"))
    page.click(".nm-pm input[type=checkbox] >> nth=0"); time.sleep(0.4)
    assert "- [x] 할 일 하나" not in files()["시작.md"] and page.locator(".tab.on .tab-dot.show").count() == 1, "자동 저장하지 않고 ● 표시"
    page.keyboard.press("Control+s"); time.sleep(0.4)
    assert "- [x] 할 일 하나" in files()["시작.md"] and page.locator(".tab.on .tab-dot.show").count() == 0, "Ctrl+S로 저장"
    page.click(".nm-pm p >> nth=0"); page.keyboard.press("End"); page.keyboard.type(" 덧붙임"); page.keyboard.press("Control+s"); time.sleep(0.4)
    assert "덧붙임" in files()["시작.md"], "편집 저장"
    # 문서 끝에서 Enter → 빈 문단 → / 메뉴로 표
    page.keyboard.press("Control+End"); page.keyboard.press("Enter"); page.keyboard.type("/표"); page.wait_for_selector(".nm-slash-item"); page.keyboard.press("Enter"); page.keyboard.press("Control+s"); time.sleep(0.4)
    assert "| --- | --- | --- |" in files()["시작.md"], files()["시작.md"]
    assert not page.is_hidden("#f-tablebar"), "표 안이면 표 도구가 보인다"
    page.keyboard.type("가"); page.keyboard.press("Tab"); page.keyboard.type("나"); page.keyboard.press("Control+s"); time.sleep(0.4)
    assert "| 가 | 나 |  |" in files()["시작.md"], files()["시작.md"]
    # 표 둘레 테두리의 모서리를 끌면 표 전체 너비가 바뀌고 열 너비가 파일에 남는다
    assert not page.is_hidden(".nm-desk:not([hidden]) .nm-tablebox")
    w0 = page.evaluate("document.querySelector('.nm-desk:not([hidden]) .nm-pm table').getBoundingClientRect().width")
    hb = page.locator(".nm-desk:not([hidden]) .nm-tablebox-h[data-dir=bottom-right]").bounding_box()
    page.mouse.move(hb["x"] + 6, hb["y"] + 6); page.mouse.down(); page.mouse.move(hb["x"] - 120, hb["y"] + 6, steps=6); page.mouse.up(); page.keyboard.press("Control+s"); time.sleep(0.4)
    w1 = page.evaluate("document.querySelector('.nm-desk:not([hidden]) .nm-pm table').getBoundingClientRect().width")
    print("표 너비:", round(w0), "→", round(w1)); assert w1 < w0 - 80 and "<!-- cols:" in files()["시작.md"]
    page.click(".nm-pm a:has-text('바깥')", modifiers=["Control"]); time.sleep(0.3)  # 편집 중엔 Ctrl+클릭이 링크 열기
    assert "바깥 주소는 열지 않습니다" in page.inner_text("#status")
    page.click(".nm-pm a:has-text('회의록')", modifiers=["Control"]); page.wait_for_selector(".tab.on:has-text('1차')"); time.sleep(0.4)
    assert page.locator(".nm-desk:not([hidden]) .nm-callout").count() == 1 and page.locator(".nm-desk:not([hidden]) table").count() == 1
    assert page.locator(".tab").count() == 2, "링크는 새 탭으로"
    # 파일 메뉴 → 새 문서(새 탭) → 쓰고 → Ctrl+S(다른 이름으로 저장)
    page.click("#btn-file"); page.click("#m-new"); page.wait_for_selector(".tab.on:has-text('새 문서')"); time.sleep(0.3)
    assert page.locator(".tab").count() == 3 and page.locator(".tab.on .tab-dot.show").count() == 1
    page.keyboard.type("새 문서 본문")
    page.keyboard.press("Control+s"); time.sleep(0.6)
    assert "새 문서.md" in files() and "새 문서 본문" in files()["새 문서.md"], repr(files().get("새 문서.md"))
    assert page.inner_text(".tab.on .tab-name") == "새 문서" and page.locator(".tab.on .tab-dot.show").count() == 0
    page.keyboard.press("Control+w"); time.sleep(0.3)
    assert page.locator(".tab").count() == 2, "탭 닫기"
    page.click(".tab:has-text('시작')"); page.wait_for_selector(".tab.on:has-text('시작')"); time.sleep(0.3)
    # 서식: 단어를 골라 굵게·빨강(도구 막대), 글을 고르면 서식 띠가 뜬다
    page.click(".nm-desk:not([hidden]) .nm-pm p >> nth=0"); page.keyboard.press("Home")
    for _ in range(2): page.keyboard.press("Shift+ArrowRight")
    time.sleep(0.2); assert not page.is_hidden(".nm-desk:not([hidden]) .nm-bubble"), "서식 띠"
    page.click("#rail [data-cmd=bold]"); page.click("#f-color"); page.click("#pal-color button >> nth=3"); page.keyboard.press("Control+s"); time.sleep(0.4)
    assert '<span style="color:#c00000">**첫**</span>' in files()["시작.md"], files()["시작.md"]
    # 저장 안 된 채 탭을 닫으면 저장/저장 안 함/취소를 묻는다
    page.keyboard.type("임시"); time.sleep(0.2); page.keyboard.press("Control+w"); page.wait_for_selector(".ask")
    page.click(".ask button:has-text('취소')"); assert page.locator(".ask").count() == 0 and page.locator(".tab").count() == 2
    page.keyboard.press("Control+w"); page.wait_for_selector(".ask"); page.click(".ask button:has-text('저장 안 함')"); time.sleep(0.3)
    assert page.locator(".tab").count() == 1 and "임시" not in files()["시작.md"]
    page.evaluate("window.__openNext = '시작.md'"); page.click("#btn-file"); page.click("#m-open"); page.wait_for_selector(".tab.on:has-text('시작')"); time.sleep(0.4)
    page.screenshot(path=str(ROOT / "build" / "editor2.png"))
    # 창 제목 줄 = 탭 줄: 빈 곳을 끌면 창 끌기, 두 번 누르면 최대화, 오른쪽 단추
    assert not page.is_hidden("#wincmd")
    page.mouse.move(700, 20); page.mouse.down(); page.mouse.up(); time.sleep(0.6); page.mouse.down(); page.mouse.up(); page.mouse.down(); page.mouse.up(); page.click("#win-min"); time.sleep(0.2)
    cmds = page.evaluate("window.__win"); print("창 명령:", cmds)
    assert "drag" in cmds and "max" in cmds and "min" in cmds
    # 도구 막대 펼치기(이름 보임)·접기
    w0 = page.evaluate("document.querySelector('#rail').getBoundingClientRect().width")
    page.click("#btn-side"); time.sleep(0.4)
    assert page.is_visible("#f-table .lb") and page.evaluate("document.querySelector('#rail').getBoundingClientRect().width") > w0 + 80
    page.click("#btn-side"); time.sleep(0.4)
    assert not page.is_visible("#f-table .lb") and 40 < w0 < 60
    # 긴 표: 쪽 경계가 생기고 쪽 수가 센다
    page.evaluate("""() => { window.__files["긴 표.md"] = "# 긴 표\\n\\n| 구분 | 내용 |\\n| --- | --- |\\n" + Array.from({length: 70}, (_, n) => `| 항목 ${n} | 내용 ${n} |`).join("\\n") + "\\n\\n끝 문단\\n"; }""")
    open_doc("긴 표.md")
    gaps = page.locator(".nm-desk:not([hidden]) .nm-pagegap").count()
    print("긴 표: 쪽 경계", gaps, "| 상태 줄", page.inner_text("#pages"))
    assert gaps >= 1 and page.inner_text("#pages") == f"{gaps + 1}쪽"
    # 긴 문서: 여러 쪽, 쪽 나눔 뒤는 새 쪽
    open_doc("긴 문서.md")
    assert page.locator(".tab").count() == 4
    gaps = page.locator(".nm-desk:not([hidden]) .nm-pagegap").count()
    w = page.evaluate("document.querySelector('.nm-desk:not([hidden]) .nm-sheet').getBoundingClientRect().width")
    print("긴 문서: 쪽 경계", gaps, "| 쪽 폭 px:", round(w))
    assert gaps >= 2 and abs(w - 793.7) < 3
    # 확대·축소: 책상 폭(창 - 도구 막대)에 두 쪽이 들어갈 만큼 줄이면 나란히 미리보기, 쪽을 누르면 편집으로
    # 1280px 창, 도구 막대 접힘 48px → 80%(1293px 필요)는 안 들어가고 70%(1131px)부터 들어간다
    page.mouse.move(700, 400)
    for _ in range(2): page.keyboard.down("Control"); page.mouse.wheel(0, 120); page.keyboard.up("Control"); time.sleep(0.1)
    time.sleep(0.4); assert page.inner_text("#zoom-val") == "80%" and page.is_hidden("#preview"), "80%: 두 쪽이 안 들어가 편집 유지"
    page.keyboard.down("Control"); page.mouse.wheel(0, 120); page.keyboard.up("Control"); time.sleep(0.6)
    print("줌:", page.inner_text("#zoom-val")); assert page.inner_text("#zoom-val") == "70%"
    assert not page.is_hidden("#preview") and page.is_hidden("#editors")
    page.click("#btn-side"); time.sleep(0.6)  # 도구 막대를 펼치면(184px) 70%로는 두 쪽이 안 들어가 편집으로 돌아온다
    assert page.is_hidden("#preview") and not page.is_hidden("#editors"), "도구 막대 폭을 고려"
    page.click("#btn-side"); time.sleep(0.6)
    assert not page.is_hidden("#preview")
    tops = page.evaluate("[...document.querySelectorAll('#preview .sheet')].slice(0,2).map(s => Math.round(s.getBoundingClientRect().top))")
    print("미리보기 첫 두 쪽 위치:", tops, "| 쪽 수:", page.locator("#preview .sheet").count()); assert tops[0] == tops[1]
    page.screenshot(path=str(ROOT / "build" / "two-pages.png"))
    page.click("#preview .sheet >> nth=0"); time.sleep(0.3)
    assert page.inner_text("#zoom-val") == "100%" and page.is_hidden("#preview") and not page.is_hidden("#editors")
    # 쪽 나눔 끄기: 경계가 사라지고 쪽 수가 비며, 다시 켜면 돌아온다
    page.click("#btn-pages"); time.sleep(0.5)
    print("쪽 끔:", page.locator(".nm-desk:not([hidden]) .nm-pagegap").count(), repr(page.inner_text("#pages")), page.evaluate("localStorage.getItem('nongmak.pages')"))
    assert page.locator(".nm-desk:not([hidden]) .nm-pagegap").count() == 0 and page.inner_text("#pages") == "" and page.evaluate("localStorage.getItem('nongmak.pages')") == "0"
    page.click("#btn-pages"); time.sleep(0.5)
    assert page.locator(".nm-desk:not([hidden]) .nm-pagegap").count() >= 2
    # 한글로 내보내기
    page.click("#btn-file"); page.click("#m-hwpx"); time.sleep(1.5)
    exp = page.evaluate("window.__export")
    import base64
    (ROOT / "build" / "export.hwpx").write_bytes(base64.b64decode(exp["b64"]))
    print("내보냄:", exp["name"], exp["ext"], len(exp["b64"]))
    b.close()

with sync_playwright() as p:  # 가짜 없이 = 브라우저에서 html만 연 경우: 빈 새 문서 탭으로 시작
    b = p.chromium.launch(); page = b.new_page(viewport={"width": 1280, "height": 820})
    page.on("request", lambda r: None if r.url.startswith(("file:", "data:", "blob:")) else outside.append(r.url))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto("file://" + str(ROOT / "dist" / "nongmark.html")); page.wait_for_selector("#welcome:not([hidden])")
    page.screenshot(path=str(ROOT / "build" / "welcome.png"))
    page.click("#w-new"); page.wait_for_selector(".tab.on:has-text('새 문서')"); assert page.is_hidden("#welcome")
    page.keyboard.press("Control+w"); page.wait_for_selector("#welcome:not([hidden])")  # 다 닫으면 대문
    b.close()

print("바깥 연결:", outside or "없음")
print("콘솔 오류:", errors or "없음")
assert not outside and not errors
print("OK")
