//go:build windows

// Package windows: golang.org/x/sys/windows 대신 쓰는 아주 작은 대용품. 들여온 WebView2 래퍼가 쓰던 함수 몇 개만
// 표준 syscall 위에 다시 만들었다. x/sys/windows는 net 패키지를 끌고 들어와 exe에 통신 코드가 섞인다 -
// 이 프로그램에는 통신 코드를 아예 넣지 않으려고 바꿨다. DLL은 System32 전체 경로로만 불러온다.
package windows

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

type Handle = syscall.Handle

const (
	ERROR_SUCCESS syscall.Errno = 0
	MAX_PATH                    = 260
)

func NewLazySystemDLL(name string) *syscall.LazyDLL {
	root := os.Getenv("SystemRoot")
	if root == "" || !filepath.IsAbs(root) {
		root = `C:\Windows`
	}
	if filepath.Ext(name) == "" {
		name += ".dll"
	}
	return syscall.NewLazyDLL(filepath.Join(root, "System32", name))
}

var (
	ole32                 = NewLazySystemDLL("ole32")
	kernel32              = NewLazySystemDLL("kernel32")
	procCoTaskMemFree     = ole32.NewProc("CoTaskMemFree")
	procGetModuleHandleEx = kernel32.NewProc("GetModuleHandleExW")
	procGetModuleFileName = kernel32.NewProc("GetModuleFileNameW")
)

func UTF16PtrFromString(s string) (*uint16, error) { return syscall.UTF16PtrFromString(s) }
func UTF16FromString(s string) ([]uint16, error)   { return syscall.UTF16FromString(s) }
func UTF16ToString(s []uint16) string              { return syscall.UTF16ToString(s) }

// StringToUTF16Ptr: NUL이 든 문자열이면 빈 문자열로(원래 x/sys는 패닉).
func StringToUTF16Ptr(s string) *uint16 {
	p, err := syscall.UTF16PtrFromString(s)
	if err != nil {
		p, _ = syscall.UTF16PtrFromString("")
	}
	return p
}

// UTF16PtrToString: NUL로 끝나는 UTF-16 포인터 → 문자열.
func UTF16PtrToString(p *uint16) string {
	if p == nil {
		return ""
	}
	n := 0
	for ptr := unsafe.Pointer(p); *(*uint16)(ptr) != 0; n++ {
		ptr = unsafe.Add(ptr, 2)
	}
	return syscall.UTF16ToString(unsafe.Slice(p, n))
}

func NewCallback(fn any) uintptr { return syscall.NewCallback(fn) }

func CoTaskMemFree(p unsafe.Pointer) { procCoTaskMemFree.Call(uintptr(p)) }

func GetModuleHandleEx(flags uint32, moduleName *uint16, module *Handle) error {
	r, _, e := procGetModuleHandleEx.Call(uintptr(flags), uintptr(unsafe.Pointer(moduleName)), uintptr(unsafe.Pointer(module)))
	if r == 0 {
		return e
	}
	return nil
}

func GetModuleFileName(module Handle, filename *uint16, size uint32) (uint32, error) {
	r, _, e := procGetModuleFileName.Call(uintptr(module), uintptr(unsafe.Pointer(filename)), uintptr(size))
	if r == 0 {
		return 0, e
	}
	return uint32(r), nil
}
