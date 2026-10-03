# 새싹이의 농막 — 농촌진흥청 마크다운 편집기

인터넷이 안 되는 내부망 PC(Windows 10·11)에서 마크다운(.md) 문서를 노션처럼 읽고 고치는 편집기.
한글·워드처럼 **프로그램 창**으로 열리고, `.md` 파일을 더블클릭하면 바로 열린다. Python·Node.js·관리자 권한이 필요 없다.

## 내부망으로 가져갈 파일 (`dist/`)

| 파일 | 쓰임 |
|---|---|
| `nongmak.exe` | 프로그램(약 3.7MB). 아이콘·버전 정보 포함 |
| `WebView2Loader.dll` | 마이크로소프트가 서명한 WebView2 연결 파일(NuGet `Microsoft.Web.WebView2` 1.0.4258.31). exe와 같은 폴더에 둔다 |
| `install.cmd` / `uninstall.cmd` | 현재 사용자에게 설치·.md 연결 / 해제(관리자 권한 불필요) |
| `nongmak.html` | 프로그램 없이 Edge·Chrome으로 여는 판(폴더 열기) |
| `SHA256SUMS.txt` | 위 파일들의 SHA-256 — `certutil -hashfile nongmak.exe SHA256`으로 대조 |

## 설치 (한 번)
1. 여섯 파일을 한 폴더에 둔다(예: USB → 바탕화면\농막). 해시를 대조한다.
2. `install.cmd` 더블클릭 → "설치했습니다" 창. 프로그램은 `%LOCALAPPDATA%\Programs\Nongmak\`에 복사된다.
3. `.md` 파일을 더블클릭하면 농막 창으로 열린다.
   - 이미 다른 프로그램으로 열리게 정해져 있었다면 한 번만: 파일 오른쪽 단추 → **연결 프로그램** → **다른 앱 선택** → **새싹이의 농막** → **항상 이 앱 사용**. (Windows가 사용자가 고른 연결을 프로그램이 바꾸지 못하게 막는다.)
   - 인터넷에서 받은 파일로 표시돼 "Windows의 PC 보호" 창이 뜨면 파일 속성 → **차단 해제**.
- 화면을 그리는 **WebView2 런타임**이 필요하다. Windows 11에는 기본으로 있고, Windows 10도 대부분 있다(Edge·Office가 함께 깐다). 없으면 농막이 그렇게 알려 주니, 전산 담당에게 "WebView2 런타임 오프라인 설치 파일(Evergreen Standalone x64)" 설치를 요청한다.

## 쓰는 법
- **파일 메뉴**: 새 문서(Ctrl+N) · 열기(Ctrl+O) · 폴더 열기 · 저장(Ctrl+S) · 다른 이름으로 저장(Ctrl+Shift+S) · 인쇄/PDF(Ctrl+P). 연 문서가 든 폴더의 다른 .md 문서가 왼쪽 목록에 나온다.
- **블록 편집**: 문단·제목·목록을 누르면 그 부분의 마크다운이 열리고, 밖을 누르거나 Esc면 다시 그려진다. 고친 내용은 곧바로 자동 저장.
- **`/` 메뉴**: 빈 블록에서 `/` → 제목·목록·할 일·인용·콜아웃·코드·표·구분선.
- Enter 다음 블록 · Shift+Enter 줄바꿈 · 목록에서 Enter 다음 항목(빈 항목이면 목록 끝) · Tab/Shift+Tab 들여쓰기 · 맨 앞 Backspace 앞 블록과 합치기 · ↑↓ 블록 이동 · Ctrl+B/I.
- 할 일 체크, 다른 .md로 가는 링크 열기, 그림 붙여넣기(`assets/`에 저장), 제목·본문 검색, 원문 전체 보기, 어둡게.
- 바깥 주소(https://…) 링크는 열지 않고 주소만 복사한다.

## 보안 설계
- **통신이 없다**: 프로그램에 통신 패키지가 들어 있지 않다(`go list -deps`로 net·http·tls 0개 확인). 서버도 포트도 열지 않는다 — 화면과 프로그램은 같은 프로세스 안에서 WebView2의 메시지로 함수를 주고받는다. 화면의 CSP는 `connect-src 'none'`이고 외부 글꼴·그림·스크립트를 모두 막는다. 시험에서 바깥 요청 0건.
- **들어간 코드는 검토한 것뿐**: Go 표준 라이브러리 + 우리가 쓴 코드 + WebView2 COM 래퍼(go-webview2, MIT)를 `app/internal/`에 **소스째 들여와 검토·수정**한 것. 원래 래퍼는 WebView2Loader.dll을 exe 안에 넣었다가 메모리에서 바로 올렸는데(백신이 악성코드 수법으로 보는 방식), 그 부분을 지우고 마이크로소프트가 서명한 DLL을 exe 옆에서 전체 경로로만 불러오게 바꿨다. golang.org/x/sys도 쓰지 않는다(그것이 net 패키지를 끌고 들어와 표준 syscall 위의 작은 대용품으로 바꿨다).
- **악성 문서 방어**: 마크다운 해석기를 직접 썼다. 문서 안의 HTML은 글자로만 보이고, 링크는 http/https/mailto/상대 경로만(`/\서버` 같은 우회도 차단), 그림은 폴더 안 래스터 그림만(SVG·외부 그림 차단). 공격 문자열 26종·느려지게 만드는 입력(ReDoS) 시험 통과. 화면 스크립트·스타일은 SHA-256 해시가 맞아야만 실행된다.
- **파일 접근 제한**: 연 폴더 안의 .md·그림만. 모든 파일 작업이 Go의 `os.Root`를 거쳐 심볼릭 링크·**정션(mklink /J)**으로 폴더 밖에 닿는 것을 운영체제 수준에서 막는다. `..`·절대 경로·드라이브·네트워크 경로(UNC)·대체 데이터 스트림·장치 이름(CON, COM¹ 등)도 거절. 지우기는 파일 하나씩만. 쓰기는 임시 파일 → 바꿔 끼우기.
- **설치는 현재 사용자 범위만**: 관리자 권한·서비스·시작 프로그램 등록 없음. 레지스트리는 `HKCU\Software\Classes`의 연결 키만(`app/install_windows.go`에 전부). 시스템 DLL은 System32 전체 경로로만.
- **독립 검토**: 별도 검토로 지적된 정션 탈출·느려짐(ReDoS)·백슬래시 링크 우회·장치 이름 누락을 모두 고치고 시험을 더했다.
- **재현 가능한 빌드**: 같은 소스면 바이트까지 같은 exe(`CGO_ENABLED=0 -trimpath -buildid=`). 코드 서명 인증서가 없어 서명하지 않았다 — 해시로 무결성을 확인한다.

## 빌드 (개발 서버에서만)
```
python3 build.py                       # 금지 API 검사 → HTML·CSP → 아이콘(windres) → go test/vet → Windows exe → SHA256SUMS
node --test tests/markdown.test.cjs    # 해석기 보안 시험
../.tools/pw/bin/python tests/e2e.py   # 화면 시험(Chromium, 프로그램 함수는 가짜로)
```
도구: Go 1.27.1(go.dev 공식, SHA-256 대조), `binutils-mingw-w64`의 windres(Ubuntu), 아이콘은 `make_icon.py`(Pillow).
**아직 실제 Windows에서 돌려 보지 못했다** — 이 개발 서버에는 Windows가 없다. 첫 설치 때 창이 뜨는지, .md 더블클릭·저장이 되는지 확인이 필요하다.
