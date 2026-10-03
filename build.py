#!/usr/bin/env python3
"""새싹이의 농막 빌드 - web/의 세 파일을 한 장짜리 화면(nongmark.html)으로 묶고, Windows 10·11용 nongmark.exe를 만든다.

빌드는 이 개발 서버에서만 한다(Python·Go·windres 필요). 내부망 PC에는 dist/의 결과물만 가져간다.
묶을 때 하는 일:
  1) 금지 API 검사 - 스크립트에 eval·Function·fetch·XMLHttpRequest·WebSocket·외부 주소 등이 있으면 빌드를 멈춘다.
  2) CSP - 스크립트·스타일은 SHA-256 해시가 맞는 것만 실행·적용, 연결(connect-src)은 'none'.
  3) exe - Go 표준 라이브러리 + golang.org/x/sys + 직접 들여와 검토한 WebView2 COM 래퍼(app/internal). 아이콘·버전 정보 포함.
  4) 결과물의 SHA-256을 SHA256SUMS.txt에 적는다 - 내부망에서 `certutil -hashfile 파일 SHA256`으로 대조한다.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
WEB, DIST, APP, ASSETS = ROOT / "web", ROOT / "dist", ROOT / "app", ROOT / "assets"
GO = Path(os.environ.get("GO", ROOT.parent / ".tools/go/bin/go"))
LOADER_DLL = ROOT / "vendor-bin" / "WebView2Loader.dll"  # Microsoft.Web.WebView2 NuGet 1.0.4258.31, 마이크로소프트 서명
LOADER_SHA256 = "3426dcc55fdfb8b5e7ac623cf33b4ccf283fbf68a0c5a65bddfdb4d749a8abee"

# 스크립트에 있으면 안 되는 것. (정규식, 이유)
FORBIDDEN = [
    (r"\beval\s*\(", "eval - 문자열을 코드로 실행"),
    (r"\bnew\s+Function\b|\bFunction\s*\(", "Function 생성자 - 문자열을 코드로 실행"),
    (r"set(Timeout|Interval)\s*\(\s*['\"`]", "문자열 타이머 - 문자열을 코드로 실행"),
    (r"\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bRTCPeerConnection\b|sendBeacon", "통신"),
    (r"\bimportScripts\b|\bimport\s*\(|\bnew\s+Worker\b|SharedWorker|serviceWorker", "외부 코드 불러오기"),
    (r"document\.write|insertAdjacentHTML|outerHTML\s*=|\.srcdoc\b|createContextualFragment", "HTML 주입 경로"),
    (r"postMessage|\bwindow\.open\s*\(|\bopener\b\s*\.|\blocation\s*=|location\.(href|assign|replace)\b", "다른 창·주소로 보내기"),
    # 한글 문서 XML의 이름공간(namespace) 식별자는 주소 모양이지만 연결하지 않는 이름일 뿐이라 뺀다
    (r"https?://(?!www\.hancom\.co\.kr/(hwpml|schema)/|www\.idpf\.org/20|purl\.org/dc/|www\.w3\.org/)[a-z0-9-]+\.[a-z0-9.-]+", "외부 주소 문자열"),
    (r"\bdocument\.cookie\b", "쿠키 사용"),
]


def strip_comments(js: str) -> str:
    js = re.sub(r"/\*[\s\S]*?\*/", "", js)
    return "\n".join(re.sub(r"(^|\s)//[^\n]*$", r"\1", line) for line in js.split("\n"))


def check(script: str) -> None:
    code = strip_comments(script)
    problems = [f"  {why}: {m.group(0)!r}" for pattern, why in FORBIDDEN for m in re.finditer(pattern, code)]
    if problems:
        sys.exit("금지 API가 있어 빌드를 멈춥니다:\n" + "\n".join(problems))


def sha(text: str) -> str:
    return "sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()


def data_uri(name: str) -> str:
    return "data:image/png;base64," + base64.b64encode((ASSETS / name).read_bytes()).decode()


NODE = Path(os.environ.get("NODE", ROOT.parent / "opt/node22/bin/node"))
EDITOR_APP = WEB / "editor-app"  # ProseMirror/Tiptap 편집기 묶음(esbuild) - 버전은 package-lock.json에 고정
BUNDLE = ROOT / "build" / "editor-bundle.js"


def build_editor() -> str:
    """편집기 묶음을 만든다(node_modules가 있어야 한다: cd web/editor-app && npm ci). 묶음 안에 코드 실행 API가 있으면 멈춘다."""
    subprocess.run([str(NODE), str(EDITOR_APP / "build.mjs")], check=True)
    js = BUNDLE.read_text(encoding="utf-8")
    # 화면 코드와 같은 금지 목록을 묶음에도 적용한다. 라이브러리 안의 알려진 무해 항목만 예외:
    #   window.open( - Tiptap Link 확장의 클릭 처리(openOnClick:false라 비활성, app.js가 window.open을 null 함수로 덮음)
    #   오류 문구 안의 문서 링크 두 개(prosemirror.net 안내, yjs 이슈 주소) - 글자일 뿐 연결하지 않는다
    #   obj.fetch(  - 객체의 메서드(제안 메뉴의 항목 가져오기). window/globalThis/self.fetch( 는 그대로 잡는다
    #   typeof location== - 환경 검사(lib0). 주소를 바꾸는 location= 대입은 그대로 잡는다
    allowed = {"window.open(": 1, "https://prosemirror.net": 1, "https://github.com": 1}
    code = strip_comments(js)
    problems = {}
    for pattern, why in FORBIDDEN:
        for m in re.finditer(pattern, code):
            before = code[max(0, m.start() - 12):m.start()]
            if m.group(0).startswith("fetch") and before.endswith(".") and not re.search(r"(window|globalThis|self)\.$", before):
                continue
            if m.group(0) == "location=" and before.endswith("typeof "):
                continue
            problems[m.group(0)] = why
    for text, n in allowed.items():
        if code.count(text) <= n:
            problems.pop(text, None)
    if problems:
        sys.exit("편집기 묶음에 금지 API가 있어 빌드를 멈춥니다:\n" + "\n".join(f"  {why}: {t!r}" for t, why in problems.items()))
    return js


def build_html() -> Path:
    markdown = (WEB / "markdown.js").read_text(encoding="utf-8")
    app = (WEB / "app.js").read_text(encoding="utf-8")
    hwpx = (WEB / "hwpx.js").read_text(encoding="utf-8")
    editor_js = build_editor()
    editor_css = "\n" + (WEB / "editor.css").read_text(encoding="utf-8")
    T = ASSETS / "hwpx-template"
    template = {k: (T / f).read_text(encoding="utf-8") for k, f in [("header", "header.xml"), ("section", "section0.xml"), ("version", "version.xml"),
                ("settings", "settings.xml"), ("container", "container.xml"), ("containerRdf", "container.rdf"), ("manifest", "manifest.xml")]}
    # markdown.js를 함수 안에 가둬 전역에는 MD 하나만 남긴다
    script = "\nconst MD = (() => {\n" + markdown.replace("if (typeof module", "// node 시험용 내보내기\n  if (false && typeof module") + \
        "\nreturn { splitBlocks, renderBlock, toggleTask, titleOf, inlineRuns, parseStyle, safeImage, headingText, RE };\n})();\n" + \
        "const MDX = MD;\nconst MD_SAFE_IMAGE = MD.safeImage;\nconst HWPX_TEMPLATE = " + json.dumps(template, ensure_ascii=False).replace("</", "<\\/") + ";\n" + \
        hwpx.replace("if (typeof module", "if (false && typeof module") + "\n" + app + "\n"
    check(script)
    style = "\n" + (WEB / "style.css").read_text(encoding="utf-8")
    # style-src 'unsafe-inline': 편집기(ProseMirror)가 글자색·표 너비·손잡이 위치를 style 속성으로 그린다. 스타일은 코드를 실행하지 못하고
    # 바깥 연결(connect/img/font-src)이 모두 막혀 있어 새어 나갈 길이 없다. 스크립트는 여전히 해시가 맞는 두 덩이만 돈다.
    csp = "; ".join([
        "default-src 'none'",
        f"script-src '{sha(editor_js)}' '{sha(script)}'",
        "style-src 'unsafe-inline'",
        "img-src blob: data:",
        "connect-src 'none'",
        "font-src 'none'", "media-src 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'",
        "manifest-src 'none'", "base-uri 'none'", "form-action 'none'",
    ])
    html = (WEB / "index.html").read_text(encoding="utf-8")
    html = html.replace("{{CSP}}", csp).replace("{{STYLE}}", style).replace("{{EDITOR_STYLE}}", editor_css)
    html = html.replace("{{EDITOR_SCRIPT}}", editor_js).replace("{{SCRIPT}}", script)
    html = html.replace("{{ICON64}}", data_uri("icon-64.png")).replace("{{WORDMARK}}", data_uri("wordmark.png"))
    assert "{{" not in html
    DIST.mkdir(exist_ok=True)
    out = DIST / "nongmark.html"
    out.write_text(html, encoding="utf-8", newline="\n")
    shutil.copy(out, APP / "nongmark.html")  # exe 안에 넣는다(go:embed)
    return out


def build_exe() -> list[Path]:
    gotmp = ROOT / "build" / "gotmp"
    gotmp.mkdir(parents=True, exist_ok=True)
    # GOPROXY=off: 빌드 중에 아무것도 내려받지 않는다(의존성은 go.sum으로 고정된 것만, 미리 받아 둔 것만)
    env = {**os.environ, "CGO_ENABLED": "0", "GOFLAGS": "-mod=mod", "GOTOOLCHAIN": "local", "GOPROXY": "off", "GOTMPDIR": str(gotmp)}
    win = {**env, "GOOS": "windows", "GOARCH": "amd64"}
    # 아이콘·버전 정보 → COFF 리소스(.syso). .rc에는 #include·매크로가 없어 전처리기 대신 그대로 넘긴다.
    rcpp = ROOT / "build" / "rcpp.sh"
    rcpp.write_text('#!/bin/sh\nfor a; do f="$a"; done\ncat "$f"\n')
    rcpp.chmod(0o755)
    subprocess.run(["x86_64-w64-mingw32-windres", f"--preprocessor={rcpp}", "-c", "65001", "-O", "coff", "-o", "rsrc_windows_amd64.syso", "nongmark.rc"], cwd=APP, check=True)
    subprocess.run([str(GO), "test", "./..."], cwd=APP, env=env, check=True)
    subprocess.run([str(GO), "vet", "."], cwd=APP, env=win, check=True)
    # 들여온 WebView2 래퍼의 Win32 핸들 변환(uintptr→unsafe.Pointer)은 Win32 API의 정상 쓰임이라 unsafeptr 검사만 끈다
    subprocess.run([str(GO), "vet", "-unsafeptr=false", "./internal/..."], cwd=APP, env=win, check=True)
    exe = DIST / "nongmark.exe"
    subprocess.run([str(GO), "build", "-trimpath", "-buildvcs=false", "-ldflags", "-s -w -buildid= -H=windowsgui", "-o", str(exe), "."], cwd=APP, env=win, check=True)
    if hashlib.sha256(LOADER_DLL.read_bytes()).hexdigest() != LOADER_SHA256:
        sys.exit("WebView2Loader.dll의 해시가 기록과 다릅니다 - 바뀐 파일을 넣지 않습니다")
    shutil.copy(LOADER_DLL, DIST / "WebView2Loader.dll")
    return [exe, DIST / "WebView2Loader.dll"]


def main() -> None:
    for old in DIST.glob("*"):
        old.unlink()
    html = build_html()
    outs = [html] + ([] if "--html-only" in sys.argv else build_exe())
    for extra in (ROOT / "scripts").iterdir():
        shutil.copy(extra, DIST / extra.name)
        outs.append(DIST / extra.name)
    sums = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in sorted(set(outs)))
    (DIST / "SHA256SUMS.txt").write_text(sums, encoding="utf-8")
    print(sums, end="")


if __name__ == "__main__":
    main()
