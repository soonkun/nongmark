//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

// showError: 창 없는 프로그램(-H=windowsgui)이라 오류는 메시지 상자로 알린다. user32.dll의 MessageBoxW만 부른다.
func showError(msg string) {
	user32 := sysDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	text, _ := syscall.UTF16PtrFromString(msg)
	title, _ := syscall.UTF16PtrFromString("새싹이의 농막")
	_, _, _ = box.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10) // MB_ICONERROR
}
