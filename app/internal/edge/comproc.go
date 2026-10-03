//go:build windows

package edge

import (
	"nongmak/internal/windows"
)

// ComProc stores a COM procedure.
type ComProc uintptr

// NewComProc creates a new COM proc from a Go function.
func NewComProc(fn interface{}) ComProc {
	return ComProc(windows.NewCallback(fn))
}
