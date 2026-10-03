//go:build windows

package main

import (
	"os"
	"path/filepath"
	"syscall"
)

// sysDLL: 시스템 DLL을 System32의 전체 경로로만 불러온다 - 현재 폴더에 같은 이름의 가짜 DLL을 두는 공격(DLL 하이재킹)을 막는다.
func sysDLL(name string) *syscall.LazyDLL {
	root := os.Getenv("SystemRoot")
	if root == "" || !filepath.IsAbs(root) {
		root = `C:\Windows`
	}
	return syscall.NewLazyDLL(filepath.Join(root, "System32", name))
}
