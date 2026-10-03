package main

// 파일 작업 - 화면(WebView2 안의 자바스크립트)이 부르는 함수들. 네트워크·서버 없이 같은 프로세스 안에서 직접 불린다.
// 원칙: "연 폴더(root)" 안의 .md 파일과 그림만 읽고 쓴다. 모든 작업은 os.Root를 거친다 -
// 심볼릭 링크·정션(mklink /J)으로 폴더 밖에 닿는 것을 열 때 운영체제 수준에서 막는다(Go 1.23부터 EvalSymlinks가 Windows
// 정션을 풀지 않아 문자열 검사만으로는 못 막는다 - 독립 보안 검토 지적). 지우기는 파일 하나씩만, 폴더 통째 지우기는 없다.

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const (
	maxText  = 20 << 20 // 문서 하나 20MB
	maxImage = 20 << 20 // 그림 하나 20MB
	maxDepth = 8        // 폴더 깊이
	maxFiles = 20000    // 목록 상한
)

var (
	mdExt    = map[string]bool{".md": true, ".markdown": true}
	imageExt = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}

	errBadPath  = errors.New("허용되지 않는 경로입니다")
	errNotFound = errors.New("파일이 없습니다")
	errNoFolder = errors.New("열린 폴더가 없습니다")
)

type workspace struct {
	mu     sync.Mutex
	dir    string   // 연 폴더(절대 경로)
	open   string   // 처음 열 파일(dir 기준 상대 경로, 슬래시)
	fsroot *os.Root // 모든 파일 작업의 관문
}

type entry struct {
	Path string `json:"path"`
	Dir  bool   `json:"dir"`
}

type info struct {
	Root string `json:"root"` // 폴더 이름(표시용)
	Dir  string `json:"dir"`  // 전체 경로(표시용)
	Open string `json:"open"` // 열 파일
}

// openTarget: 실행 인수(파일 또는 폴더)로 작업 폴더를 정한다. 파일이면 그 폴더를 열고 그 파일을 띄운다.
func (w *workspace) openTarget(target string) error {
	abs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return errors.New("열 수 없습니다: " + target)
	}
	if st.IsDir() {
		return w.setDir(abs, "")
	}
	if !mdExt[strings.ToLower(filepath.Ext(abs))] {
		return errors.New("마크다운 파일(.md)만 열 수 있습니다: " + target)
	}
	return w.setDir(filepath.Dir(abs), filepath.Base(abs))
}

func (w *workspace) setDir(dir, open string) error {
	if strings.HasPrefix(dir, `\\`) || strings.HasPrefix(dir, "//") {
		return errors.New("네트워크 경로(\\\\서버\\공유)는 열지 않습니다")
	}
	r, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.fsroot != nil {
		w.fsroot.Close()
	}
	w.dir, w.open, w.fsroot = dir, open, r
	return nil
}

func (w *workspace) Info() (info, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.fsroot == nil {
		return info{}, nil
	}
	return info{Root: filepath.Base(w.dir), Dir: w.dir, Open: w.open}, nil
}

// clean: 화면이 준 상대 경로(슬래시 구분)를 검사한다. 절대 경로·드라이브·UNC·".."·NUL·대체 데이터 스트림(":")·
// 장치 이름(CON, COM¹ …)·끝 점/공백을 거절하고, 링크·정션 탈출은 os.Root가 막는다.
func (w *workspace) clean(rel string) (string, *os.Root, error) {
	w.mu.Lock()
	r := w.fsroot
	w.mu.Unlock()
	if r == nil {
		return "", nil, errNoFolder
	}
	if rel == "" || len(rel) > 1024 || strings.ContainsAny(rel, "\x00:*?\"<>|\\") || strings.HasPrefix(rel, "/") {
		return "", nil, errBadPath
	}
	for _, p := range strings.Split(rel, "/") {
		if p == "" || p == "." || p == ".." || strings.HasSuffix(p, ".") || strings.HasSuffix(p, " ") || reservedName(p) {
			return "", nil, errBadPath
		}
	}
	name := filepath.FromSlash(rel)
	if !filepath.IsLocal(name) {
		return "", nil, errBadPath
	}
	return name, r, nil
}

func reservedName(name string) bool {
	base := strings.ToUpper(strings.TrimRight(strings.SplitN(name, ".", 2)[0], " "))
	switch base {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return true
	}
	if strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT") {
		switch base[3:] {
		case "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³":
			return true
		}
	}
	return false
}

func (w *workspace) mdName(rel string) (string, *os.Root, error) {
	if !mdExt[strings.ToLower(filepath.Ext(rel))] {
		return "", nil, errors.New("마크다운 파일(.md)만 다룹니다")
	}
	return w.clean(rel)
}

// openRegular: 일반 파일일 때만 연다(장치·파이프를 열어 멈추지 않게).
func openRegular(root *os.Root, name string) (*os.File, error) {
	st, err := root.Lstat(name)
	if err != nil {
		return nil, errNotFound
	}
	if !st.Mode().IsRegular() {
		return nil, errBadPath
	}
	return root.Open(name)
}

func (w *workspace) List() ([]entry, error) {
	w.mu.Lock()
	root := w.fsroot
	w.mu.Unlock()
	out := []entry{}
	if root == nil {
		return out, nil
	}
	err := fs.WalkDir(root.FS(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || p == "." {
			return nil
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") || name == "node_modules" || strings.Count(p, "/") >= maxDepth {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			out = append(out, entry{p, true})
		} else if d.Type().IsRegular() && mdExt[strings.ToLower(filepath.Ext(name))] {
			out = append(out, entry{p, false}) // 링크·정션·장치는 목록에 넣지 않는다
		}
		if len(out) >= maxFiles {
			return fs.SkipAll
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, err
}

func (w *workspace) Read(rel string) (string, error) {
	name, root, err := w.mdName(rel)
	if err != nil {
		return "", err
	}
	f, err := openRegular(root, name)
	if err != nil {
		return "", err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxText))
	return string(b), err
}

func (w *workspace) Write(rel, text string) error {
	name, root, err := w.mdName(rel)
	if err != nil {
		return err
	}
	if len(text) > maxText {
		return errors.New("문서가 20MB를 넘습니다")
	}
	return atomicWrite(root, name, []byte(text))
}

// atomicWrite: 같은 폴더의 새 임시 파일(O_EXCL)에 다 쓴 뒤 바꿔 끼운다 - 쓰다가 꺼져도 원래 파일이 반쪽이 되지 않는다.
func atomicWrite(root *os.Root, name string, data []byte) error {
	if st, err := root.Lstat(name); err == nil && !st.Mode().IsRegular() {
		return errBadPath
	}
	if dir := filepath.Dir(name); dir != "." {
		if err := root.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(name), ".nongmark-"+hex.EncodeToString(b)+".tmp")
	f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		root.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		root.Remove(tmp)
		return err
	}
	if err := root.Rename(tmp, name); err != nil {
		root.Remove(tmp)
		return err
	}
	return nil
}

func (w *workspace) Remove(rel string) error {
	name, root, err := w.mdName(rel)
	if err != nil {
		return err
	}
	st, err := root.Lstat(name)
	if err != nil {
		return errNotFound
	}
	if !st.Mode().IsRegular() {
		return errBadPath
	}
	return root.Remove(name)
}

func (w *workspace) Rename(from, to string) error {
	a, root, err := w.mdName(from)
	if err != nil {
		return err
	}
	b, _, err := w.mdName(to)
	if err != nil {
		return err
	}
	if st, err := root.Lstat(a); err != nil || !st.Mode().IsRegular() {
		return errNotFound
	}
	if _, err := root.Lstat(b); err == nil {
		return errors.New("같은 이름의 파일이 이미 있습니다")
	}
	if dir := filepath.Dir(b); dir != "." {
		if err := root.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return root.Rename(a, b)
}

func (w *workspace) Mkdir(rel string) error {
	name, root, err := w.clean(rel)
	if err != nil {
		return err
	}
	return root.MkdirAll(name, 0o755)
}

// SaveAsset: 붙여 넣은 그림(base64)을 assets/에 저장. 확장자·이름을 다시 검사하고 내용이 진짜 래스터 그림인지 본다.
func (w *workspace) SaveAsset(file, b64 string) (string, error) {
	ext := strings.ToLower(filepath.Ext(file))
	if _, ok := imageExt[ext]; !ok || strings.ContainsAny(file, "/\\") || len(file) > 100 {
		return "", errors.New("그림(png·jpg·gif·webp)만 저장합니다")
	}
	if len(b64) > maxImage*4/3+8 {
		return "", errors.New("그림이 20MB를 넘습니다")
	}
	body, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", errors.New("그림을 읽지 못했습니다")
	}
	if !isRaster(body) {
		return "", errors.New("그림 파일이 아닙니다")
	}
	rel := "assets/" + file
	name, root, err := w.clean(rel)
	if err != nil {
		return "", err
	}
	if _, err := root.Lstat(name); err == nil {
		return "", errors.New("같은 이름의 그림이 있습니다")
	}
	return rel, atomicWrite(root, name, body)
}

// Image: 문서가 보여 주는 그림을 data URI로(서버가 없으니 화면에 직접 건넨다). 내용이 래스터 그림일 때만.
func (w *workspace) Image(rel string) (string, error) {
	ctype, ok := imageExt[strings.ToLower(filepath.Ext(rel))]
	if !ok {
		return "", errors.New("그림만 보여 줍니다")
	}
	name, root, err := w.clean(rel)
	if err != nil {
		return "", err
	}
	f, err := openRegular(root, name)
	if err != nil {
		return "", err
	}
	defer f.Close()
	body, err := io.ReadAll(io.LimitReader(f, maxImage))
	if err != nil {
		return "", err
	}
	if !isRaster(body) {
		return "", errors.New("그림 파일이 아닙니다")
	}
	return "data:" + ctype + ";base64," + base64.StdEncoding.EncodeToString(body), nil
}

// isRaster: 파일 앞부분의 서명으로 png·jpg·gif·webp만 인정한다(SVG·HTML은 스크립트를 품을 수 있어 뺀다).
// net/http의 DetectContentType을 쓰지 않는다 - 이 프로그램에는 통신 패키지를 아예 넣지 않는다.
func isRaster(b []byte) bool {
	switch {
	case len(b) >= 8 && string(b[:8]) == "\x89PNG\r\n\x1a\n":
		return true
	case len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF:
		return true
	case len(b) >= 6 && (string(b[:6]) == "GIF87a" || string(b[:6]) == "GIF89a"):
		return true
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return true
	}
	return false
}
