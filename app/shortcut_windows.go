//go:build windows

// 바로 가기(.lnk) 만들기 - 설치 때 바탕화면과 시작 메뉴에. 셸의 IShellLinkW/IPersistFile COM을 직접 부른다(PowerShell·스크립트 없음).
package main

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	ole32Dll           = sysDLL("ole32.dll")
	procCoInitializeEx = ole32Dll.NewProc("CoInitializeEx")
	procCoCreateInst   = ole32Dll.NewProc("CoCreateInstance")
	shell32Dll         = sysDLL("shell32.dll")
	procSHGetFolder    = shell32Dll.NewProc("SHGetFolderPathW")
)

const (
	csidlDesktopDir = 0x0010 // 바탕화면(사용자)
	csidlPrograms   = 0x0002 // 시작 메뉴 > 프로그램(사용자)
	shortcutName    = "새싹이의 농막.lnk"
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

var (
	clsidShellLink  = guid{0x00021401, 0, 0, [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidIShellLinkW  = guid{0x000214F9, 0, 0, [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidIPersistFile = guid{0x0000010b, 0, 0, [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
)

// IShellLinkW vtable(MS 문서 순서)
type shellLinkVtbl struct {
	QueryInterface, AddRef, Release          uintptr
	GetPath, GetIDList, SetIDList            uintptr
	GetDescription, SetDescription           uintptr
	GetWorkingDirectory, SetWorkingDirectory uintptr
	GetArguments, SetArguments               uintptr
	GetHotkey, SetHotkey                     uintptr
	GetShowCmd, SetShowCmd                   uintptr
	GetIconLocation, SetIconLocation         uintptr
	SetRelativePath, Resolve, SetPath        uintptr
}

type shellLink struct{ vtbl *shellLinkVtbl }

// IPersistFile vtable
type persistFileVtbl struct {
	QueryInterface, AddRef, Release                            uintptr
	GetClassID, IsDirty, Load, Save, SaveCompleted, GetCurFile uintptr
}

type persistFile struct{ vtbl *persistFileVtbl }

func knownFolder(csidl int) (string, error) {
	buf := make([]uint16, syscall.MAX_PATH)
	if r, _, _ := procSHGetFolder.Call(0, uintptr(csidl), 0, 0, uintptr(unsafe.Pointer(&buf[0]))); r != 0 {
		return "", errors.New("폴더를 찾지 못했습니다")
	}
	return syscall.UTF16ToString(buf), nil
}

// writeShortcut: target을 가리키는 .lnk를 path에 쓴다. 아이콘은 exe의 첫 아이콘.
func writeShortcut(path, target, description string) error {
	_, _, _ = procCoInitializeEx.Call(0, 0x2) // COINIT_APARTMENTTHREADED - 이미 돼 있으면 S_FALSE/RPC_E_CHANGED_MODE여도 계속
	var link *shellLink
	if r, _, _ := procCoCreateInst.Call(uintptr(unsafe.Pointer(&clsidShellLink)), 0, 1 /*CLSCTX_INPROC_SERVER*/, uintptr(unsafe.Pointer(&iidIShellLinkW)), uintptr(unsafe.Pointer(&link))); r != 0 {
		return errors.New("바로 가기 개체를 만들지 못했습니다")
	}
	defer syscall.SyscallN(link.vtbl.Release, uintptr(unsafe.Pointer(link)))
	u := func(s string) uintptr { p, _ := syscall.UTF16PtrFromString(s); return uintptr(unsafe.Pointer(p)) }
	syscall.SyscallN(link.vtbl.SetPath, uintptr(unsafe.Pointer(link)), u(target))
	syscall.SyscallN(link.vtbl.SetWorkingDirectory, uintptr(unsafe.Pointer(link)), u(filepath.Dir(target)))
	syscall.SyscallN(link.vtbl.SetDescription, uintptr(unsafe.Pointer(link)), u(description))
	syscall.SyscallN(link.vtbl.SetIconLocation, uintptr(unsafe.Pointer(link)), u(target), 0)
	var pf *persistFile
	if r, _, _ := syscall.SyscallN(link.vtbl.QueryInterface, uintptr(unsafe.Pointer(link)), uintptr(unsafe.Pointer(&iidIPersistFile)), uintptr(unsafe.Pointer(&pf))); r != 0 {
		return errors.New("바로 가기를 저장할 수 없습니다")
	}
	defer syscall.SyscallN(pf.vtbl.Release, uintptr(unsafe.Pointer(pf)))
	if r, _, _ := syscall.SyscallN(pf.vtbl.Save, uintptr(unsafe.Pointer(pf)), u(path), 1); r != 0 {
		return errors.New("바로 가기를 쓰지 못했습니다: " + path)
	}
	return nil
}

// installShortcuts: 바탕화면·시작 메뉴에 바로 가기. 실패는 설치를 멈추지 않고 알려만 준다.
func installShortcuts(target string) []string {
	var problems []string
	for _, csidl := range []int{csidlDesktopDir, csidlPrograms} {
		dir, err := knownFolder(csidl)
		if err != nil {
			problems = append(problems, err.Error())
			continue
		}
		if err := writeShortcut(filepath.Join(dir, shortcutName), target, "농촌진흥청 마크다운 편집기"); err != nil {
			problems = append(problems, err.Error())
		}
	}
	return problems
}

func removeShortcuts() {
	for _, csidl := range []int{csidlDesktopDir, csidlPrograms} {
		if dir, err := knownFolder(csidl); err == nil {
			_ = os.Remove(filepath.Join(dir, shortcutName))
		}
	}
}
