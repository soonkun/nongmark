//go:build windows

package main

// 설치·해제. 두 범위 중 하나를 고른다(설치 때 물어본다):
//   모든 사용자: %ProgramFiles%\Nongmark + HKEY_LOCAL_MACHINE - 관리자 승인(UAC) 창이 뜬다
//   현재 사용자: %LOCALAPPDATA%\Programs\Nongmark + HKEY_CURRENT_USER - 권한 불필요
// 하는 일: 프로그램·WebView2Loader.dll 복사, .md/.markdown 파일 연결, "앱 및 기능"에 보이도록 Uninstall 항목, 시작 메뉴 바로 가기,
// (물어보고) 바탕화면 바로 가기. 해제는 그 반대. 레지스트리는 advapi32.dll 함수만 직접 부른다(외부 라이브러리 없음).
//   nongmark.exe --install                     : 범위·바탕화면 바로 가기를 물어보고 설치
//   nongmark.exe --install-all [--desktop]     : 관리자 승인 뒤 다시 실행되는 '모든 사용자' 설치(물어본 답을 인수로 받는다)
//   nongmark.exe --uninstall                   : 설치된 범위를 찾아 지운다(모든 사용자면 관리자 승인)

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	hkcu         = 0x80000001
	hklm         = 0x80000002
	keyAllAccess = 0xF003F
	regSZ        = 1
	regDWORD     = 4
	progID       = "Nongmark.Markdown"
	appExe       = "nongmark.exe"
	appVersion   = "1.0.0"
	shcneAssoc   = 0x08000000
	uninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\Nongmark`
)

var (
	advapi32        = sysDLL("advapi32.dll")
	regCreateKeyEx  = advapi32.NewProc("RegCreateKeyExW")
	regOpenKeyEx    = advapi32.NewProc("RegOpenKeyExW")
	regSetValueEx   = advapi32.NewProc("RegSetValueExW")
	regQueryValueEx = advapi32.NewProc("RegQueryValueExW")
	regDeleteTree   = advapi32.NewProc("RegDeleteTreeW")
	regDeleteKey    = advapi32.NewProc("RegDeleteKeyW")
	regDeleteValue  = advapi32.NewProc("RegDeleteValueW")
	regCloseKey     = advapi32.NewProc("RegCloseKey")
	getTokenInfo    = advapi32.NewProc("GetTokenInformation")
	shell32         = sysDLL("shell32.dll")
	shChangeNotify  = shell32.NewProc("SHChangeNotify")
	shellExecute    = shell32.NewProc("ShellExecuteW")
	user32          = sysDLL("user32.dll")
	messageBox      = user32.NewProc("MessageBoxW")
)

// scope: 설치 범위.
type scope struct {
	root           uintptr // HKCU 또는 HKLM
	dir            string  // 설치 폴더
	desktop, start int     // 바로 가기 폴더(CSIDL)
	label          string
}

func perUser() scope {
	return scope{hkcu, filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Nongmark"), csidlDesktopDir, csidlPrograms, "현재 사용자"}
}

func allUsers() scope {
	pf := os.Getenv("ProgramFiles")
	if pf == "" {
		pf = `C:\Program Files`
	}
	return scope{hklm, filepath.Join(pf, "Nongmark"), csidlCommonDesktop, csidlCommonPrograms, "모든 사용자"}
}

func u16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func setString(root uintptr, path, name, value string) error {
	var key syscall.Handle
	if r, _, _ := regCreateKeyEx.Call(root, uintptr(unsafe.Pointer(u16(path))), 0, 0, 0, keyAllAccess, 0, uintptr(unsafe.Pointer(&key)), 0); r != 0 {
		return syscall.Errno(r)
	}
	defer regCloseKey.Call(uintptr(key))
	data, _ := syscall.UTF16FromString(value)
	var namePtr uintptr
	if name != "" {
		namePtr = uintptr(unsafe.Pointer(u16(name)))
	}
	if r, _, _ := regSetValueEx.Call(uintptr(key), namePtr, 0, regSZ, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)*2)); r != 0 {
		return syscall.Errno(r)
	}
	return nil
}

func setDword(root uintptr, path, name string, value uint32) error {
	var key syscall.Handle
	if r, _, _ := regCreateKeyEx.Call(root, uintptr(unsafe.Pointer(u16(path))), 0, 0, 0, keyAllAccess, 0, uintptr(unsafe.Pointer(&key)), 0); r != 0 {
		return syscall.Errno(r)
	}
	defer regCloseKey.Call(uintptr(key))
	if r, _, _ := regSetValueEx.Call(uintptr(key), uintptr(unsafe.Pointer(u16(name))), 0, regDWORD, uintptr(unsafe.Pointer(&value)), 4); r != 0 {
		return syscall.Errno(r)
	}
	return nil
}

// getString: 값 읽기(키가 없으면 ""). 읽기만 하므로 키를 만들지 않는다.
func getString(root uintptr, path, name string) string {
	var key syscall.Handle
	if r, _, _ := regOpenKeyEx.Call(root, uintptr(unsafe.Pointer(u16(path))), 0, 0x20019 /*KEY_READ*/, uintptr(unsafe.Pointer(&key))); r != 0 {
		return ""
	}
	defer regCloseKey.Call(uintptr(key))
	var namePtr uintptr
	if name != "" {
		namePtr = uintptr(unsafe.Pointer(u16(name)))
	}
	buf := make([]uint16, 1024)
	size := uint32(len(buf) * 2)
	if r, _, _ := regQueryValueEx.Call(uintptr(key), namePtr, 0, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size))); r != 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

func deleteTree(root uintptr, path string) {
	regDeleteTree.Call(root, uintptr(unsafe.Pointer(u16(path))))
	regDeleteKey.Call(root, uintptr(unsafe.Pointer(u16(path)))) // RegDeleteTree는 하위만 지우므로 키 자체도
}

func deleteValue(root uintptr, path, name string) {
	var key syscall.Handle
	if r, _, _ := regOpenKeyEx.Call(root, uintptr(unsafe.Pointer(u16(path))), 0, keyAllAccess, uintptr(unsafe.Pointer(&key))); r != 0 {
		return
	}
	defer regCloseKey.Call(uintptr(key))
	regDeleteValue.Call(uintptr(key), uintptr(unsafe.Pointer(u16(name))))
}

// isElevated: 관리자 권한으로 돌고 있는가(UAC 승인 뒤).
func isElevated() bool {
	var tok syscall.Token
	if syscall.OpenProcessToken(syscall.Handle(^uintptr(0)) /*현재 프로세스*/, syscall.TOKEN_QUERY, &tok) != nil {
		return false
	}
	defer tok.Close()
	var elev uint32
	var n uint32
	if r, _, _ := getTokenInfo.Call(uintptr(tok), 20 /*TokenElevation*/, uintptr(unsafe.Pointer(&elev)), 4, uintptr(unsafe.Pointer(&n))); r == 0 {
		return false
	}
	return elev != 0
}

// relaunchElevated: 관리자 승인(UAC) 창을 띄워 자신을 다시 실행한다. 사용자가 거절하면 false.
func relaunchElevated(args string) bool {
	self, err := os.Executable()
	if err != nil {
		return false
	}
	r, _, _ := shellExecute.Call(0, uintptr(unsafe.Pointer(u16("runas"))), uintptr(unsafe.Pointer(u16(self))), uintptr(unsafe.Pointer(u16(args))), 0, 1 /*SW_SHOWNORMAL*/)
	return r > 32
}

// installed: 설치된 범위(없으면 nil). "앱 및 기능" 항목(Uninstall 키)으로 판단한다.
func installed() *scope {
	if getString(hklm, uninstallKey, "InstallLocation") != "" {
		s := allUsers()
		s.dir = getString(hklm, uninstallKey, "InstallLocation")
		return &s
	}
	if getString(hkcu, uninstallKey, "InstallLocation") != "" {
		s := perUser()
		s.dir = getString(hkcu, uninstallKey, "InstallLocation")
		return &s
	}
	return nil
}

func install(sc scope, desktop bool) error {
	// 옛 이름(Nongmak)의 연결 등록이 남아 있으면 먼저 지운다(설치 폴더 Programs\Nongmak은 사용자가 지운다)
	for _, ext := range []string{".md", ".markdown"} {
		deleteValue(hkcu, `Software\Classes\`+ext+`\OpenWithProgids`, "Nongmak.Markdown")
	}
	deleteTree(hkcu, `Software\Classes\Nongmak.Markdown`)
	deleteTree(hkcu, `Software\Classes\Applications\nongmak.exe`)
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(sc.dir, 0o755); err != nil {
		return errors.New("설치 폴더를 만들지 못했습니다: " + sc.dir + ": " + err.Error())
	}
	target := filepath.Join(sc.dir, appExe)
	if !sameFile(self, target) {
		// 프로그램과, 화면을 띄우는 데 필요한 마이크로소프트의 WebView2Loader.dll을 함께 옮긴다
		for _, name := range []string{appExe, "WebView2Loader.dll"} {
			src := filepath.Join(filepath.Dir(self), name)
			if name == appExe {
				src = self
			}
			if err := copyFile(src, filepath.Join(sc.dir, name)); err != nil {
				return errors.New("설치 폴더에 복사하지 못했습니다(이미 농막이 열려 있으면 닫고 다시 하세요): " + name + ": " + err.Error())
			}
		}
	}
	cmd := `"` + target + `" "%1"`
	root := sc.root
	steps := [][3]string{
		{`Software\Classes\` + progID, "", "마크다운 문서"},
		{`Software\Classes\` + progID, "FriendlyTypeName", "마크다운 문서"},
		{`Software\Classes\` + progID + `\DefaultIcon`, "", target + ",-2"}, // 음수 = 리소스 ID 2(문서 아이콘). 0은 프로그램 아이콘
		{`Software\Classes\` + progID + `\shell`, "", "open"},
		{`Software\Classes\` + progID + `\shell\open`, "", "농막으로 열기"},
		{`Software\Classes\` + progID + `\shell\open\command`, "", cmd},
		{`Software\Classes\Applications\` + appExe, "FriendlyAppName", "새싹이의 농막"},
		{`Software\Classes\Applications\` + appExe + `\shell\open\command`, "", cmd},
		{`Software\Classes\Applications\` + appExe + `\SupportedTypes`, ".md", ""},
		{`Software\Classes\Applications\` + appExe + `\SupportedTypes`, ".markdown", ""},
		// "앱 및 기능"(설정 > 앱)에 보이는 항목 - 여기서 제거할 수 있다
		{uninstallKey, "DisplayName", "새싹이의 농막"},
		{uninstallKey, "DisplayVersion", appVersion},
		{uninstallKey, "Publisher", "농촌진흥청"},
		{uninstallKey, "InstallLocation", sc.dir},
		{uninstallKey, "DisplayIcon", target + ",0"},
		{uninstallKey, "UninstallString", `"` + target + `" --uninstall`},
	}
	for _, ext := range []string{".md", ".markdown"} {
		steps = append(steps, [3]string{`Software\Classes\` + ext + `\OpenWithProgids`, progID, ""})
		// 기본 프로그램이 아직 없을 때만 우리를 기본으로 둔다(사용자가 이미 고른 연결은 건드리지 않는다)
		if getString(root, `Software\Classes\`+ext, "") == "" && getString(hkcu, `Software\Classes\`+ext, "") == "" {
			steps = append(steps, [3]string{`Software\Classes\` + ext, "", progID})
		}
	}
	for _, s := range steps {
		if err := setString(root, s[0], s[1], s[2]); err != nil {
			return errors.New("레지스트리에 쓰지 못했습니다: " + s[0] + ": " + err.Error())
		}
	}
	_ = setDword(root, uninstallKey, "NoModify", 1)
	_ = setDword(root, uninstallKey, "NoRepair", 1)
	if st, err := os.Stat(target); err == nil {
		_ = setDword(root, uninstallKey, "EstimatedSize", uint32(st.Size()/1024)+200) // KB
	}
	shChangeNotify.Call(shcneAssoc, 0, 0, 0)
	shortcutProblems = installShortcuts(target, sc.start, desktop, sc.desktop) // 시작 메뉴는 늘, 바탕화면은 물어본 대로
	return nil
}

var shortcutProblems []string

func uninstall(sc scope) {
	removeShortcuts(sc.desktop, sc.start)
	// 옛 이름(Nongmak.Markdown, nongmak.exe)으로 등록된 것도 함께 지운다 - 이름을 nongmark로 바꾸기 전 설치분
	for _, root := range []uintptr{sc.root, hkcu} {
		for _, id := range []string{progID, "Nongmak.Markdown"} {
			for _, ext := range []string{".md", ".markdown"} {
				deleteValue(root, `Software\Classes\`+ext+`\OpenWithProgids`, id)
				if getString(root, `Software\Classes\`+ext, "") == id {
					deleteValue(root, `Software\Classes\`+ext, "")
				}
			}
			deleteTree(root, `Software\Classes\`+id)
		}
		deleteTree(root, `Software\Classes\Applications\`+appExe)
		deleteTree(root, `Software\Classes\Applications\nongmak.exe`)
	}
	deleteTree(sc.root, uninstallKey)
	shChangeNotify.Call(shcneAssoc, 0, 0, 0)
	// 설치 폴더: 실행 중인 자신은 지울 수 없으니 잠깐 뒤 cmd가 지운다(경로는 우리가 정한 설치 폴더뿐)
	if sc.dir != "" && strings.HasSuffix(strings.ToLower(sc.dir), `\nongmark`) {
		args := `/c ping -n 3 127.0.0.1 >nul & rd /s /q "` + sc.dir + `"`
		shellExecute.Call(0, uintptr(unsafe.Pointer(u16("open"))), uintptr(unsafe.Pointer(u16("cmd.exe"))), uintptr(unsafe.Pointer(u16(args))), 0, 0 /*SW_HIDE*/)
	}
}

func sameFile(a, b string) bool {
	sa, errA := os.Stat(a)
	sb, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(sa, sb)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

func showInfo(msg string) {
	messageBox.Call(0, uintptr(unsafe.Pointer(u16(msg))), uintptr(unsafe.Pointer(u16("새싹이의 농막"))), 0x40) // MB_ICONINFORMATION
}

// askYesNoCancel: 6=예, 7=아니요, 2=취소
func askYesNoCancel(msg string, cancel bool) uintptr {
	flags := uintptr(0x20 | 0x4) // MB_ICONQUESTION | MB_YESNO
	if cancel {
		flags = 0x20 | 0x3 // MB_YESNOCANCEL
	}
	r, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(u16(msg))), uintptr(unsafe.Pointer(u16("새싹이의 농막 설치"))), flags)
	return r
}

func finishInstall(sc scope, desktop bool) {
	note := "시작 메뉴"
	if desktop {
		note = "바탕화면과 시작 메뉴"
	}
	note += "에 '새싹이의 농막' 바로 가기를 만들었습니다."
	if len(shortcutProblems) > 0 {
		note = "바로 가기를 만들지 못했습니다(" + strings.Join(shortcutProblems, "; ") + ") - 설치 폴더의 nongmark.exe를 직접 실행하세요."
	}
	showInfo("농막을 설치했습니다(" + sc.label + ").\n\n설치 위치: " + sc.dir + "\n" + note + "\n\n.md 파일을 더블클릭하면 농막으로 열립니다.\n다른 프로그램으로 열리면: 파일 오른쪽 단추 → 연결 프로그램 → 다른 앱 선택 → 농막 → '항상 이 앱 사용'.\n제거는 설정 > 앱 > '새싹이의 농막'에서.")
}

// handleFlags: 설치·해제 인수를 처리했으면 true(프로그램을 끝낸다).
func handleFlags(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "--install":
		if prev := installed(); prev != nil {
			if askYesNoCancel("이미 설치되어 있습니다("+prev.label+", "+prev.dir+").\n\n다시 설치할까요?", false) != 6 {
				return true
			}
		}
		r := askYesNoCancel("새싹이의 농막을 설치합니다.\n\n모든 사용자용으로 설치할까요?\n\n  예: Program Files에 설치 - 관리자 승인 창이 뜹니다\n  아니요: 현재 사용자만 - 승인 없이 바로 설치\n  취소: 설치하지 않음", true)
		if r == 2 {
			return true
		}
		desktop := askYesNoCancel("바탕화면에 바로 가기를 만들까요?\n\n(시작 메뉴에는 항상 만듭니다)", false) == 6
		if r == 6 { // 모든 사용자
			if !isElevated() {
				flag := "--no-desktop"
				if desktop {
					flag = "--desktop"
				}
				if !relaunchElevated("--install-all " + flag) {
					showInfo("관리자 승인이 취소되어 설치하지 않았습니다.\n다시 실행해 '아니요(현재 사용자만)'를 고르면 승인 없이 설치됩니다.")
				}
				return true
			}
			sc := allUsers()
			if err := install(sc, desktop); err != nil {
				showError("농막: " + err.Error())
				os.Exit(1)
			}
			finishInstall(sc, desktop)
			return true
		}
		sc := perUser()
		if err := install(sc, desktop); err != nil {
			showError("농막: " + err.Error())
			os.Exit(1)
		}
		finishInstall(sc, desktop)
		return true
	case "--install-all": // 관리자 승인 뒤 다시 실행된 자신
		desktop := len(args) > 1 && args[1] == "--desktop"
		if !isElevated() {
			showError("농막: 관리자 권한이 없어 모든 사용자용으로 설치할 수 없습니다.")
			os.Exit(1)
		}
		sc := allUsers()
		if err := install(sc, desktop); err != nil {
			showError("농막: " + err.Error())
			os.Exit(1)
		}
		finishInstall(sc, desktop)
		return true
	case "--uninstall":
		sc := installed()
		if sc == nil {
			s := perUser() // 옛 판(Uninstall 항목 없이 설치된 것)을 위해 현재 사용자 범위로 정리한다
			sc = &s
		}
		if sc.root == hklm && !isElevated() {
			if !relaunchElevated("--uninstall") {
				showInfo("관리자 승인이 취소되어 제거하지 않았습니다.")
			}
			return true
		}
		if askYesNoCancel("새싹이의 농막을 제거할까요?("+sc.label+")\n\n문서 파일(.md)은 지우지 않습니다.", false) != 6 {
			return true
		}
		uninstall(*sc)
		showInfo("농막을 제거했습니다.\n\n설치 폴더는 잠시 뒤 지워집니다: " + sc.dir)
		return true
	}
	return false
}
