//go:build windows

package main

// 파일 고르기 창 - Windows 기본 대화상자(comdlg32 GetOpenFileNameW/GetSaveFileNameW).

import (
	"syscall"
	"unsafe"
)

var (
	comdlg32        = sysDLL("comdlg32.dll")
	getOpenFileName = comdlg32.NewProc("GetOpenFileNameW")
	getSaveFileName = comdlg32.NewProc("GetSaveFileNameW")
)

type openFileNameW struct {
	structSize    uint32
	owner         uintptr
	instance      uintptr
	filter        *uint16
	customFilter  *uint16
	maxCustFilter uint32
	filterIndex   uint32
	file          *uint16
	maxFile       uint32
	fileTitle     *uint16
	maxFileTitle  uint32
	initialDir    *uint16
	title         *uint16
	flags         uint32
	fileOffset    uint16
	fileExtension uint16
	defExt        *uint16
	custData      uintptr
	hook          uintptr
	templateName  *uint16
	reserved      uintptr
	reserved2     uint32
	flagsEx       uint32
}

const (
	ofnFileMustExist   = 0x00001000
	ofnPathMustExist   = 0x00000800
	ofnOverwritePrompt = 0x00000002
	ofnNoChangeDir     = 0x00000008
	ofnExplorer        = 0x00080000
)

// 필터 문자열: "설명\0패턴\0…\0\0" - UTF16FromString은 NUL을 거절하므로 직접 만든다
func filter(ext string) *uint16 {
	pairs := map[string][2]string{
		"md":   {"마크다운 문서 (*.md)", "*.md;*.markdown"},
		"hwpx": {"한글 문서 (*.hwpx)", "*.hwpx"},
		"pdf":  {"PDF 문서 (*.pdf)", "*.pdf"},
	}
	p := pairs[ext]
	var u []uint16
	for _, part := range []string{p[0], p[1], "모든 파일", "*.*"} {
		u = append(u, utf16(part)...)
		u = append(u, 0)
	}
	return &append(u, 0)[0]
}

func utf16(s string) []uint16 {
	u, _ := syscall.UTF16FromString(s)
	return u[:len(u)-1]
}

func fileDialog(owner uintptr, save bool, suggest, ext string) string {
	buf := make([]uint16, 4096)
	if suggest != "" {
		s, _ := syscall.UTF16FromString(suggest)
		copy(buf, s)
	}
	defExt, _ := syscall.UTF16PtrFromString(ext)
	ofn := openFileNameW{
		owner: owner, filter: filter(ext), filterIndex: 1, file: &buf[0], maxFile: uint32(len(buf)), defExt: defExt,
		flags: ofnExplorer | ofnPathMustExist | ofnNoChangeDir,
	}
	ofn.structSize = uint32(unsafe.Sizeof(ofn))
	proc := getOpenFileName
	if save {
		ofn.flags |= ofnOverwritePrompt
		proc = getSaveFileName
	} else {
		ofn.flags |= ofnFileMustExist
	}
	if r, _, _ := proc.Call(uintptr(unsafe.Pointer(&ofn))); r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

func openFileDialog(owner uintptr) string { return fileDialog(owner, false, "", "md") }
func saveFileDialog(owner uintptr, suggest string) string {
	return fileDialog(owner, true, suggest, "md")
}
