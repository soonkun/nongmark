//go:build windows

package main

// 설치·해제 - 관리자 권한 없이 "현재 사용자"에게만 적용한다(HKEY_CURRENT_USER, %LOCALAPPDATA%).
//   nongmark.exe --install   : 자신을 %LOCALAPPDATA%\Programs\Nongmark\ 에 복사하고 .md/.markdown 연결을 등록한다.
//   nongmark.exe --uninstall : 등록을 지운다(설치 폴더는 안내만 - 실행 중인 자신은 지울 수 없다).
// 레지스트리는 advapi32.dll의 함수만 직접 부른다(외부 라이브러리 없음). 건드리는 키는 아래 classesKeys가 전부다.

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
	keyAllAccess = 0xF003F
	regSZ        = 1
	progID       = "Nongmark.Markdown"
	appExe       = "nongmark.exe"
	shcneAssoc   = 0x08000000
)

var (
	advapi32        = sysDLL("advapi32.dll")
	regCreateKeyEx  = advapi32.NewProc("RegCreateKeyExW")
	regSetValueEx   = advapi32.NewProc("RegSetValueExW")
	regQueryValueEx = advapi32.NewProc("RegQueryValueExW")
	regDeleteTree   = advapi32.NewProc("RegDeleteTreeW")
	regDeleteValue  = advapi32.NewProc("RegDeleteValueW")
	regCloseKey     = advapi32.NewProc("RegCloseKey")
	shell32         = sysDLL("shell32.dll")
	shChangeNotify  = shell32.NewProc("SHChangeNotify")
)

func u16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func setString(path, name, value string) error {
	var key syscall.Handle
	if r, _, _ := regCreateKeyEx.Call(hkcu, uintptr(unsafe.Pointer(u16(path))), 0, 0, 0, keyAllAccess, 0, uintptr(unsafe.Pointer(&key)), 0); r != 0 {
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

func getDefault(path string) string {
	var key syscall.Handle
	if r, _, _ := regCreateKeyEx.Call(hkcu, uintptr(unsafe.Pointer(u16(path))), 0, 0, 0, 0x20019 /*KEY_READ*/, 0, uintptr(unsafe.Pointer(&key)), 0); r != 0 {
		return ""
	}
	defer regCloseKey.Call(uintptr(key))
	buf := make([]uint16, 256)
	size := uint32(len(buf) * 2)
	if r, _, _ := regQueryValueEx.Call(uintptr(key), 0, 0, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size))); r != 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

func deleteTree(path string) {
	regDeleteTree.Call(hkcu, uintptr(unsafe.Pointer(u16(path))))
	// RegDeleteTree는 하위만 지우므로 키 자체도 지운다
	advapi32.NewProc("RegDeleteKeyW").Call(hkcu, uintptr(unsafe.Pointer(u16(path))))
}

func deleteValue(path, name string) {
	var key syscall.Handle
	if r, _, _ := regCreateKeyEx.Call(hkcu, uintptr(unsafe.Pointer(u16(path))), 0, 0, 0, keyAllAccess, 0, uintptr(unsafe.Pointer(&key)), 0); r != 0 {
		return
	}
	defer regCloseKey.Call(uintptr(key))
	regDeleteValue.Call(uintptr(key), uintptr(unsafe.Pointer(u16(name))))
}

func installDir() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Nongmark")
}

func install() error {
	if os.Getenv("LOCALAPPDATA") == "" {
		return errors.New("LOCALAPPDATA를 찾지 못했습니다")
	}
	// 옛 이름(Nongmak)의 연결 등록이 남아 있으면 먼저 지운다(설치 폴더 Programs\Nongmak은 사용자가 지운다)
	for _, ext := range []string{".md", ".markdown"} {
		deleteValue(`Software\Classes\`+ext+`\OpenWithProgids`, "Nongmak.Markdown")
	}
	deleteTree(`Software\Classes\Nongmak.Markdown`)
	deleteTree(`Software\Classes\Applications\nongmak.exe`)
	self, err := os.Executable()
	if err != nil {
		return err
	}
	dir := installDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	target := filepath.Join(dir, appExe)
	if !sameFile(self, target) {
		// 프로그램과, 화면을 띄우는 데 필요한 마이크로소프트의 WebView2Loader.dll을 함께 옮긴다
		for _, name := range []string{appExe, "WebView2Loader.dll"} {
			src := filepath.Join(filepath.Dir(self), name)
			if name == appExe {
				src = self
			}
			if err := copyFile(src, filepath.Join(dir, name)); err != nil {
				return errors.New("설치 폴더에 복사하지 못했습니다(이미 농막이 열려 있으면 닫고 다시 하세요): " + name + ": " + err.Error())
			}
		}
	}
	cmd := `"` + target + `" "%1"`
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
	}
	for _, ext := range []string{".md", ".markdown"} {
		steps = append(steps, [3]string{`Software\Classes\` + ext + `\OpenWithProgids`, progID, ""})
		// 기본 프로그램이 아직 없을 때만 우리를 기본으로 둔다(사용자가 이미 고른 연결은 건드리지 않는다)
		if getDefault(`Software\Classes\`+ext) == "" {
			steps = append(steps, [3]string{`Software\Classes\` + ext, "", progID})
		}
	}
	for _, s := range steps {
		if err := setString(s[0], s[1], s[2]); err != nil {
			return errors.New("레지스트리에 쓰지 못했습니다: " + s[0] + ": " + err.Error())
		}
	}
	shChangeNotify.Call(shcneAssoc, 0, 0, 0)
	shortcutProblems = installShortcuts(target) // 바탕화면·시작 메뉴 바로 가기(실패해도 설치는 된 것)
	return nil
}

var shortcutProblems []string

func uninstall() error {
	removeShortcuts()
	// 옛 이름(Nongmak.Markdown, nongmak.exe)으로 등록된 것도 함께 지운다 - 이름을 nongmark로 바꾸기 전 설치분
	for _, id := range []string{progID, "Nongmak.Markdown"} {
		for _, ext := range []string{".md", ".markdown"} {
			deleteValue(`Software\Classes\`+ext+`\OpenWithProgids`, id)
			if getDefault(`Software\Classes\`+ext) == id {
				deleteValue(`Software\Classes\`+ext, "")
			}
		}
		deleteTree(`Software\Classes\` + id)
	}
	deleteTree(`Software\Classes\Applications\` + appExe)
	deleteTree(`Software\Classes\Applications\nongmak.exe`)
	shChangeNotify.Call(shcneAssoc, 0, 0, 0)
	return nil
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
	user32 := sysDLL("user32.dll")
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(u16(msg))), uintptr(unsafe.Pointer(u16("새싹이의 농막"))), 0x40) // MB_ICONINFORMATION
}

// handleFlags: 설치·해제 인수를 처리했으면 true(프로그램을 끝낸다).
func handleFlags(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "--install":
		if err := install(); err != nil {
			showError("농막: " + err.Error())
			os.Exit(1)
		}
		note := "바탕화면과 시작 메뉴에 '새싹이의 농막' 바로 가기를 만들었습니다."
		if len(shortcutProblems) > 0 {
			note = "바로 가기를 만들지 못했습니다(" + strings.Join(shortcutProblems, "; ") + ") - 설치 폴더의 nongmark.exe를 직접 실행하세요."
		}
		showInfo("농막을 설치했습니다.\n\n설치 위치: " + installDir() + "\n" + note + "\n\n.md 파일을 더블클릭하면 농막으로 열립니다.\n다른 프로그램으로 열리면: 파일 오른쪽 단추 → 연결 프로그램 → 다른 앱 선택 → 농막 → '항상 이 앱 사용'.")
		return true
	case "--uninstall":
		_ = uninstall()
		showInfo("농막 연결을 지웠습니다.\n\n남은 파일을 지우려면 이 폴더를 지우세요:\n" + installDir())
		return true
	}
	return false
}
