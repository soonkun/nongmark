//go:build windows

// Package loader: WebView2 환경을 만든다. go-webview2의 원래 로더는 WebView2Loader.dll을 실행 파일 안에 넣어 두었다가
// 메모리에서 직접 올렸다(go-winloader). 백신이 악성코드 수법으로 보는 방식이라 버리고, 마이크로소프트가 서명한
// WebView2Loader.dll을 실행 파일과 같은 폴더에서 "전체 경로로만" 불러온다(다른 폴더의 같은 이름 DLL을 끼워 넣지 못하게).
package loader

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	dll      *syscall.LazyDLL
	errNoDLL = errors.New("WebView2Loader.dll을 찾지 못했습니다 - nongmak.exe와 같은 폴더에 있어야 합니다")
)

func load() (*syscall.LazyDLL, error) {
	if dll != nil {
		return dll, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(filepath.Dir(exe), "WebView2Loader.dll")
	if _, err := os.Stat(path); err != nil {
		return nil, errNoDLL
	}
	d := syscall.NewLazyDLL(path)
	if err := d.Load(); err != nil {
		return nil, err
	}
	dll = d
	return d, nil
}

// CreateCoreWebView2EnvironmentWithOptions: WebView2Loader.dll의 같은 이름 함수를 부른다(HRESULT를 돌려준다).
func CreateCoreWebView2EnvironmentWithOptions(browserExecutableFolder, userDataFolder *uint16, environmentOptions uintptr, environmentCompletedHandle uintptr) (uintptr, error) {
	d, err := load()
	if err != nil {
		return 0, err
	}
	res, _, _ := d.NewProc("CreateCoreWebView2EnvironmentWithOptions").Call(
		uintptr(unsafe.Pointer(browserExecutableFolder)), uintptr(unsafe.Pointer(userDataFolder)), environmentOptions, environmentCompletedHandle)
	return res, nil
}

// RuntimeVersion: 설치된 WebView2 런타임 버전("" = 없음).
func RuntimeVersion() (string, error) {
	d, err := load()
	if err != nil {
		return "", err
	}
	var out *uint16
	hr, _, _ := d.NewProc("GetAvailableCoreWebView2BrowserVersionString").Call(0, uintptr(unsafe.Pointer(&out)))
	if hr != 0 || out == nil {
		return "", nil
	}
	return syscall.UTF16ToString(unsafe.Slice(out, 64)), nil
}
