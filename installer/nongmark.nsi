; 새싹이의 농막(nongmark) 설치 프로그램 - NSIS 3(Modern UI 2, MultiUser).
; 빌드: build.py가 dist/nongmark.exe·WebView2Loader.dll을 만든 뒤 makensis로 이 파일을 묶는다 → dist/nongmark-setup.exe
; 하는 일: 범위 선택(모든 사용자 = Program Files·HKLM, 관리자 승인 / 현재 사용자 = %LOCALAPPDATA%\Programs·HKCU), 설치 폴더,
;         바로 가기(시작 메뉴·바탕화면 선택), .md/.markdown 연결, "앱 및 기능" 항목, 제거 프로그램. 네트워크 없음.

Unicode true
!define APP_NAME "새싹이의 농막"
!define APP_ID "Nongmark"
!define APP_EXE "nongmark.exe"
!define APP_VERSION "1.0.3"
!define PUBLISHER "농촌진흥청"
!define PROG_ID "Nongmark.Markdown"
!define REG_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

; MultiUser: 설치 때 범위를 묻는다. 관리자면 기본 '모든 사용자'
!define MULTIUSER_EXECUTIONLEVEL Highest
!define MULTIUSER_MUI
!define MULTIUSER_INSTALLMODE_COMMANDLINE
!define MULTIUSER_INSTALLMODE_INSTDIR "${APP_ID}"
!define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${REG_UNINST}"
!define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "InstallMode"
!define MULTIUSER_INSTALLMODE_INSTDIR_REGISTRY_KEY "${REG_UNINST}"
!define MULTIUSER_INSTALLMODE_INSTDIR_REGISTRY_VALUENAME "InstallLocation"
!define MULTIUSER_USE_PROGRAMFILES64
!include "MultiUser.nsh"
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

Name "${APP_NAME}"
OutFile "..\dist\nongmark-setup.exe"
BrandingText "${APP_NAME} ${APP_VERSION} · ${PUBLISHER}"
SetCompressor /SOLID lzma
RequestExecutionLevel highest
ManifestDPIAware true

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1042 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=1042 "FileDescription" "${APP_NAME} 설치"
VIAddVersionKey /LANG=1042 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1042 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1042 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1042 "LegalCopyright" "${PUBLISHER}"

!define MUI_ICON "..\assets\nongmark.ico"
!define MUI_UNICON "..\assets\nongmark.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APP_NAME} 설치"
!define MUI_WELCOMEPAGE_TEXT "농촌진흥청 마크다운(.md) 편집기 '${APP_NAME}'을(를) 설치합니다.$\r$\n$\r$\n이 프로그램은 인터넷에 연결하지 않으며, 연 문서가 든 폴더 안의 파일만 다룹니다.$\r$\n$\r$\n계속하려면 '다음'을 누르세요."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "${APP_NAME} 실행"
!define MUI_FINISHPAGE_TEXT "설치가 끝났습니다.$\r$\n$\r$\n.md 파일을 더블클릭하면 ${APP_NAME}(으)로 열립니다. 다른 프로그램으로 열리면 파일 오른쪽 단추 → 연결 프로그램 → 다른 앱 선택 → ${APP_NAME} → '항상 이 앱 사용'.$\r$\n$\r$\n제거는 설정 > 앱 > '${APP_NAME}'에서 합니다."

; 쪽: 시작 → 범위 → 폴더 → 구성 요소(바로 가기) → 설치 → 끝
!insertmacro MUI_PAGE_WELCOME
!insertmacro MULTIUSER_PAGE_INSTALLMODE
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"
; MultiUser 범위 쪽의 한국어 글(Korean.nsh에 없음)
LangString MULTIUSER_TEXT_INSTALLMODE_TITLE ${LANG_KOREAN} "설치 범위"
LangString MULTIUSER_TEXT_INSTALLMODE_SUBTITLE ${LANG_KOREAN} "이 PC의 모든 사용자에게 설치할지, 지금 사용자에게만 설치할지 고르세요."
LangString MULTIUSER_INNERTEXT_INSTALLMODE_TOP ${LANG_KOREAN} "설치 범위를 고르고 '다음'을 누르세요."
LangString MULTIUSER_INNERTEXT_INSTALLMODE_ALLUSERS ${LANG_KOREAN} "모든 사용자 (Program Files - 관리자 권한 필요)"
LangString MULTIUSER_INNERTEXT_INSTALLMODE_CURRENTUSER ${LANG_KOREAN} "현재 사용자만 (권한 불필요)"

Function .onInit
  !insertmacro MULTIUSER_INIT
FunctionEnd
Function un.onInit
  !insertmacro MULTIUSER_UNINIT
FunctionEnd

Section "프로그램(필수)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File "..\dist\${APP_EXE}"
  File "..\dist\WebView2Loader.dll"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; 파일 연결(.md/.markdown). 기본 프로그램이 아직 없을 때만 기본으로 둔다
  WriteRegStr SHCTX "Software\Classes\${PROG_ID}" "" "마크다운 문서"
  WriteRegStr SHCTX "Software\Classes\${PROG_ID}" "FriendlyTypeName" "마크다운 문서"
  WriteRegStr SHCTX "Software\Classes\${PROG_ID}\DefaultIcon" "" "$INSTDIR\${APP_EXE},-2"
  WriteRegStr SHCTX "Software\Classes\${PROG_ID}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${PROG_ID}\shell\open" "" "농막으로 열기"
  WriteRegStr SHCTX "Software\Classes\${PROG_ID}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXE}" "FriendlyAppName" "${APP_NAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXE}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXE}\SupportedTypes" ".md" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXE}\SupportedTypes" ".markdown" ""
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "${PROG_ID}" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "${PROG_ID}" ""
  ReadRegStr $0 SHCTX "Software\Classes\.md" ""
  ${If} $0 == ""
    WriteRegStr SHCTX "Software\Classes\.md" "" "${PROG_ID}"
  ${EndIf}
  ReadRegStr $0 SHCTX "Software\Classes\.markdown" ""
  ${If} $0 == ""
    WriteRegStr SHCTX "Software\Classes\.markdown" "" "${PROG_ID}"
  ${EndIf}
  ; 옛 이름(Nongmak)으로 남은 등록 정리
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "Nongmak.Markdown"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "Nongmak.Markdown"
  DeleteRegKey HKCU "Software\Classes\Nongmak.Markdown"
  DeleteRegKey HKCU "Software\Classes\Applications\nongmak.exe"

  ; "앱 및 기능" 항목
  WriteRegStr SHCTX "${REG_UNINST}" "DisplayName" "${APP_NAME}"
  WriteRegStr SHCTX "${REG_UNINST}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr SHCTX "${REG_UNINST}" "Publisher" "${PUBLISHER}"
  WriteRegStr SHCTX "${REG_UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHCTX "${REG_UNINST}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr SHCTX "${REG_UNINST}" "UninstallString" '"$INSTDIR\uninstall.exe" /$MultiUser.InstallMode'
  WriteRegStr SHCTX "${REG_UNINST}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /$MultiUser.InstallMode /S'
  WriteRegStr SHCTX "${REG_UNINST}" "InstallMode" "$MultiUser.InstallMode"
  WriteRegDWORD SHCTX "${REG_UNINST}" "NoModify" 1
  WriteRegDWORD SHCTX "${REG_UNINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${REG_UNINST}" "EstimatedSize" "$0"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

Section "시작 메뉴 바로 가기" SecStart
  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "농촌진흥청 마크다운 편집기"
SectionEnd

Section "바탕화면 바로 가기" SecDesktop
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "농촌진흥청 마크다운 편집기"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "프로그램 파일과 .md 파일 연결(필수)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStart} "시작 메뉴에 '${APP_NAME}' 바로 가기를 만듭니다."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "바탕화면에 '${APP_NAME}' 바로 가기를 만듭니다."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "${PROG_ID}"
  DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "${PROG_ID}"
  ReadRegStr $0 SHCTX "Software\Classes\.md" ""
  ${If} $0 == "${PROG_ID}"
    DeleteRegValue SHCTX "Software\Classes\.md" ""
  ${EndIf}
  ReadRegStr $0 SHCTX "Software\Classes\.markdown" ""
  ${If} $0 == "${PROG_ID}"
    DeleteRegValue SHCTX "Software\Classes\.markdown" ""
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\${PROG_ID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXE}"
  DeleteRegKey SHCTX "${REG_UNINST}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd
