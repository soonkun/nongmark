//go:build windows

// nongmak.exe - 새싹이의 농막. 한글·워드처럼 .md 파일을 더블클릭하면 이 프로그램 창에서 열린다.
//
// 창 안의 화면은 Windows에 들어 있는 WebView2(Edge 엔진)로 그린다. 서버도 포트도 없다 - 화면과 이 프로그램은
// 같은 프로세스 안에서 직접 함수를 주고받는다(WebView2의 postMessage). 이 프로그램에는 통신 패키지(net/http 등)가 없다.
// 화면의 CSP는 connect-src 'none' - 화면도 어디에도 연결하지 못한다.
package main

import (
	_ "embed"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"nongmak/internal/loader"
	"nongmak/internal/webview"
)

//go:embed nongmak.html
var page string

func main() {
	if handleFlags(os.Args[1:]) {
		return
	}
	if v, err := loader.RuntimeVersion(); err != nil || v == "" {
		msg := "이 PC에 Microsoft Edge WebView2 런타임이 없어 농막을 열 수 없습니다.\n\nWindows 11에는 기본으로 들어 있고, Windows 10은 전산 담당자에게 'WebView2 런타임(오프라인 설치 파일)' 설치를 요청하세요."
		if err != nil {
			msg = err.Error()
		}
		showError(msg)
		return
	}
	// 연 폴더 등록부: 탭마다 문서가 다른 폴더에 있을 수 있어, 사용자가 대화상자(또는 더블클릭)로 연 폴더마다 os.Root를 하나씩 둔다.
	// 화면은 info.dir 문자열로 폴더를 가리키고, 등록되지 않은 폴더는 어떤 함수도 받지 않는다.
	var mu sync.Mutex
	opened := map[string]*workspace{}
	register := func(ws *workspace) (info, error) {
		i, _ := ws.Info()
		mu.Lock()
		defer mu.Unlock()
		if old, ok := opened[i.Dir]; ok && old != ws {
			ws.fsroot.Close() // 같은 폴더는 하나만
			return info{Root: i.Root, Dir: i.Dir, Open: i.Open}, nil
		}
		opened[i.Dir] = ws
		return i, nil
	}
	get := func(dir string) (*workspace, error) {
		mu.Lock()
		defer mu.Unlock()
		if ws, ok := opened[dir]; ok {
			return ws, nil
		}
		return nil, errors.New("열지 않은 폴더입니다")
	}
	ws := &workspace{}
	first := info{}
	if len(os.Args) > 1 && os.Args[1] != "" {
		if err := ws.openTarget(os.Args[1]); err != nil {
			showError(err.Error())
			return
		}
		first, _ = register(ws)
	}
	data := filepath.Join(os.Getenv("LOCALAPPDATA"), "Nongmak", "WebView2")
	w := webview.NewWithOptions(webview.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  data,
		WindowOptions: webview.WindowOptions{
			Title: title(first), Width: 1280, Height: 860, IconId: 1, Center: true,
		},
	})
	if w == nil {
		showError("창을 만들지 못했습니다(WebView2).")
		return
	}
	defer w.Destroy()

	// 화면이 부르는 함수들. 이름은 nm_로 시작한다. 인수·반환은 JSON.
	must := func(name string, f any) {
		if err := w.Bind(name, f); err != nil {
			showError(err.Error())
			os.Exit(1)
		}
	}
	must("nm_info", func() (info, error) { return first, nil })
	must("nm_read", func(dir, rel string) (string, error) {
		ws, err := get(dir)
		if err != nil {
			return "", err
		}
		return ws.Read(rel)
	})
	must("nm_write", func(dir, rel, text string) error {
		ws, err := get(dir)
		if err != nil {
			return err
		}
		return ws.Write(rel, text)
	})
	must("nm_saveAsset", func(dir, file, b64 string) (string, error) {
		ws, err := get(dir)
		if err != nil {
			return "", err
		}
		return ws.SaveAsset(file, b64)
	})
	must("nm_image", func(dir, rel string) (string, error) {
		ws, err := get(dir)
		if err != nil {
			return "", err
		}
		return ws.Image(rel)
	})
	must("nm_setTitle", func(t string) { w.SetTitle(cut(t, 120) + " - 새싹이의 농막") })
	// 창 조작(제목 줄 없는 창이라 화면의 탭 줄이 끌기·최소/최대화·닫기를 맡는다). 허용된 명령 외에는 아무 일도 하지 않는다.
	must("nm_win", func(cmd string) bool {
		switch cmd {
		case "drag", "resize-top", "resize-top-left", "resize-top-right", "min", "max", "close", "state":
			return w.WindowCommand(cmd)
		}
		return false
	})
	must("nm_openFile", func() (info, error) {
		p := openFileDialog(hwnd(w))
		if p == "" {
			return info{}, nil
		}
		ws := &workspace{}
		if err := ws.openTarget(p); err != nil {
			return info{}, err
		}
		return register(ws)
	})
	// 대문의 "최근 문서": 화면이 기억해 둔 전체 경로를 다시 연다. 더블클릭으로 연 것과 같은 길(.md만, 그 폴더를 등록).
	must("nm_openRecent", func(full string) (info, error) {
		ws := &workspace{}
		if err := ws.openTarget(full); err != nil {
			return info{}, err
		}
		return register(ws)
	})
	// 다른 이름으로 저장: 어디든 고른 곳에 쓰고, 그 폴더를 등록한다.
	must("nm_saveAs", func(suggest, text string) (info, error) {
		p := saveFileDialog(hwnd(w), suggest)
		if p == "" {
			return info{}, nil
		}
		if !strings.EqualFold(filepath.Ext(p), ".md") && !strings.EqualFold(filepath.Ext(p), ".markdown") {
			p += ".md"
		}
		ws := &workspace{}
		if err := ws.setDir(filepath.Dir(p), filepath.Base(p)); err != nil {
			return info{}, err
		}
		i, err := register(ws)
		if err != nil {
			return info{}, err
		}
		ws, _ = get(i.Dir)
		if err := ws.Write(filepath.Base(p), text); err != nil {
			return info{}, err
		}
		return i, nil
	})
	must("nm_alert", func(text string) { showInfo(cut(text, 2000)) })
	// 내보내기(hwpx 등): 사용자가 저장 창에서 고른 곳에만 쓴다. 확장자는 hwpx·pdf만.
	must("nm_saveBytes", func(suggest, ext, b64 string) (string, error) {
		if ext != "hwpx" && ext != "pdf" {
			return "", errors.New("내보낼 수 없는 형식입니다")
		}
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil || len(data) > 200<<20 {
			return "", errors.New("내보낼 내용을 읽지 못했습니다")
		}
		p := fileDialog(hwnd(w), true, suggest, ext)
		if p == "" {
			return "", nil
		}
		if !strings.EqualFold(filepath.Ext(p), "."+ext) {
			p += "." + ext
		}
		return p, os.WriteFile(p, data, 0o644)
	})
	w.Init("window.NONGMAK_NATIVE = true; window.NONGMAK_FRAMELESS = true;")
	w.SetFrameless(true)
	w.SetHtml(page)
	w.Run()
}

func title(i info) string {
	if i.Open != "" {
		return strings.TrimSuffix(i.Open, filepath.Ext(i.Open)) + " - 새싹이의 농막"
	}
	return "새싹이의 농막"
}

func cut(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func hwnd(w webview.WebView) uintptr { return uintptr(w.Window()) }
