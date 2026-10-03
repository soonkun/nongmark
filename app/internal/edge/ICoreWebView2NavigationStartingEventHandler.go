//go:build windows

// 농막 추가: 최상위 이동(navigation)을 가로채 about:blank(SetHtml) 말고는 전부 취소한다 - 이 창은 어디로도 가지 않는다.
package edge

import (
	"unsafe"

	"nongmark/internal/windows"
)

// ICoreWebView2NavigationStartingEventArgs: IUnknown + get_Uri, get_IsUserInitiated, get_IsRedirected, get_RequestHeaders, get_Cancel, put_Cancel, get_NavigationId
type _ICoreWebView2NavigationStartingEventArgsVtbl struct {
	_IUnknownVtbl
	GetUri             ComProc
	GetIsUserInitiated ComProc
	GetIsRedirected    ComProc
	GetRequestHeaders  ComProc
	GetCancel          ComProc
	PutCancel          ComProc
	GetNavigationId    ComProc
}

type ICoreWebView2NavigationStartingEventArgs struct {
	vtbl *_ICoreWebView2NavigationStartingEventArgsVtbl
}

func (a *ICoreWebView2NavigationStartingEventArgs) GetUri() (string, error) {
	var uri *uint16
	_, _, err := a.vtbl.GetUri.Call(uintptr(unsafe.Pointer(a)), uintptr(unsafe.Pointer(&uri)))
	if uri == nil {
		return "", err
	}
	defer windows.CoTaskMemFree(unsafe.Pointer(uri))
	return windows.UTF16PtrToString(uri), nil
}

func (a *ICoreWebView2NavigationStartingEventArgs) PutCancel(cancel bool) error {
	v := uintptr(0)
	if cancel {
		v = 1
	}
	_, _, err := a.vtbl.PutCancel.Call(uintptr(unsafe.Pointer(a)), v)
	return err
}

type _ICoreWebView2NavigationStartingEventHandlerVtbl struct {
	_IUnknownVtbl
	Invoke ComProc
}

type ICoreWebView2NavigationStartingEventHandler struct {
	vtbl *_ICoreWebView2NavigationStartingEventHandlerVtbl
	impl _ICoreWebView2NavigationStartingEventHandlerImpl
}

func _ICoreWebView2NavigationStartingEventHandlerIUnknownQueryInterface(this *ICoreWebView2NavigationStartingEventHandler, refiid, object uintptr) uintptr {
	return this.impl.QueryInterface(refiid, object)
}

func _ICoreWebView2NavigationStartingEventHandlerIUnknownAddRef(this *ICoreWebView2NavigationStartingEventHandler) uintptr {
	return this.impl.AddRef()
}

func _ICoreWebView2NavigationStartingEventHandlerIUnknownRelease(this *ICoreWebView2NavigationStartingEventHandler) uintptr {
	return this.impl.Release()
}

func _ICoreWebView2NavigationStartingEventHandlerInvoke(this *ICoreWebView2NavigationStartingEventHandler, sender *ICoreWebView2, args *ICoreWebView2NavigationStartingEventArgs) uintptr {
	return this.impl.NavigationStarting(sender, args)
}

type _ICoreWebView2NavigationStartingEventHandlerImpl interface {
	_IUnknownImpl
	NavigationStarting(sender *ICoreWebView2, args *ICoreWebView2NavigationStartingEventArgs) uintptr
}

var _ICoreWebView2NavigationStartingEventHandlerFn = _ICoreWebView2NavigationStartingEventHandlerVtbl{
	_IUnknownVtbl{
		NewComProc(_ICoreWebView2NavigationStartingEventHandlerIUnknownQueryInterface),
		NewComProc(_ICoreWebView2NavigationStartingEventHandlerIUnknownAddRef),
		NewComProc(_ICoreWebView2NavigationStartingEventHandlerIUnknownRelease),
	},
	NewComProc(_ICoreWebView2NavigationStartingEventHandlerInvoke),
}

func newICoreWebView2NavigationStartingEventHandler(impl _ICoreWebView2NavigationStartingEventHandlerImpl) *ICoreWebView2NavigationStartingEventHandler {
	return &ICoreWebView2NavigationStartingEventHandler{vtbl: &_ICoreWebView2NavigationStartingEventHandlerFn, impl: impl}
}
