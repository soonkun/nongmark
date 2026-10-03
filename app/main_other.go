//go:build !windows

// 리눅스·맥에서는 창을 띄우지 않는다 - 파일 작업(files.go)의 시험용으로만 빌드된다.
package main

import "fmt"

func main() { fmt.Println("새싹이의 농막은 Windows 10·11용입니다.") }
