package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func newWS(t *testing.T) (*workspace, string) {
	t.Helper()
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.md"), []byte("# A\n"), 0o644)
	os.MkdirAll(filepath.Join(dir, "sub"), 0o755)
	os.WriteFile(filepath.Join(dir, "sub", "b.md"), []byte("# B\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("no"), 0o644)
	ws := &workspace{}
	if err := ws.openTarget(filepath.Join(dir, "a.md")); err != nil {
		t.Fatal(err)
	}
	return ws, dir
}

func TestOpenAndList(t *testing.T) {
	ws, _ := newWS(t)
	i, _ := ws.Info()
	if i.Open != "a.md" {
		t.Fatalf("열 파일 %q", i.Open)
	}
	list, err := ws.List()
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, e := range list {
		got = append(got, e.Path)
	}
	if strings.Join(got, ",") != "a.md,sub,sub/b.md" {
		t.Fatalf("목록 %v", got)
	}
}

func TestPathEscapesAreRejected(t *testing.T) {
	ws, dir := newWS(t)
	outside := filepath.Join(filepath.Dir(dir), "outside.md")
	os.WriteFile(outside, []byte("outside"), 0o644)
	bad := []string{
		"../outside.md", "sub/../../outside.md", "/etc/passwd.md", "sub\\..\\..\\outside.md", "C:/Windows/x.md",
		"a.md:stream.md", "CON.md", "con .md", "COM¹.md", "nul.md", "sub/./b.md", "a.md.", "a.md ", "", "secret.txt",
	}
	for _, p := range bad {
		if _, err := ws.Read(p); err == nil {
			t.Errorf("읽혔다: %q", p)
		}
		if err := ws.Write(p, "pwned"); err == nil {
			t.Errorf("써졌다: %q", p)
		}
	}
	if b, _ := os.ReadFile(outside); string(b) != "outside" {
		t.Fatal("폴더 밖 파일이 바뀌었다")
	}
	if runtime.GOOS != "windows" {
		// 링크(Windows에서는 정션도 같은 길)로 폴더 밖에 닿는 것을 os.Root가 막는다
		os.Symlink(filepath.Dir(dir), filepath.Join(dir, "link"))
		if _, err := ws.Read("link/outside.md"); err == nil {
			t.Error("링크로 폴더 밖을 읽었다")
		}
		if err := ws.Write("link/new.md", "x"); err == nil {
			t.Error("링크로 폴더 밖에 썼다")
		}
		if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "new.md")); err == nil {
			t.Error("폴더 밖에 파일이 생겼다")
		}
	}
}

func TestReadWriteRenameDelete(t *testing.T) {
	ws, dir := newWS(t)
	if err := ws.Write("new/c.md", "# C"); err != nil {
		t.Fatal(err)
	}
	if s, _ := ws.Read("new/c.md"); s != "# C" {
		t.Fatalf("읽기 %q", s)
	}
	if err := ws.Rename("new/c.md", "new/d.md"); err != nil {
		t.Fatal(err)
	}
	if err := ws.Rename("new/d.md", "a.md"); err == nil {
		t.Fatal("있는 파일을 덮어썼다")
	}
	if err := ws.Rename("new/d.md", "../escape.md"); err == nil {
		t.Fatal("폴더 밖으로 옮겼다")
	}
	if err := ws.Remove("new/d.md"); err != nil {
		t.Fatal(err)
	}
	if err := ws.Remove("sub"); err == nil {
		t.Fatal("폴더를 지웠다")
	}
	if _, err := os.Stat(filepath.Join(dir, "sub", "b.md")); err != nil {
		t.Fatal(err)
	}
	ents, _ := os.ReadDir(filepath.Join(dir, "new"))
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatal("임시 파일이 남았다")
		}
	}
}

func TestAssetsOnlyRealImages(t *testing.T) {
	ws, _ := newWS(t)
	png := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 32)))
	rel, err := ws.SaveAsset("p.png", png)
	if err != nil || rel != "assets/p.png" {
		t.Fatalf("그림 %q %v", rel, err)
	}
	for _, c := range []struct{ name, body string }{
		{"x.png", "<script>alert(1)</script>"}, {"x.svg", "<svg/>"}, {"x.html", "\x89PNG\r\n\x1a\n"}, {"../x.png", "\x89PNG\r\n\x1a\n"}, {"x.exe", "MZ"},
	} {
		if _, err := ws.SaveAsset(c.name, base64.StdEncoding.EncodeToString([]byte(c.body))); err == nil {
			t.Errorf("받아들였다: %s", c.name)
		}
	}
	if uri, err := ws.Image("assets/p.png"); err != nil || !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Fatalf("그림 읽기 %v", err)
	}
	if _, err := ws.Image("a.md"); err == nil {
		t.Fatal("그림이 아닌 파일을 보냈다")
	}
}

func TestDeviceNames(t *testing.T) {
	for _, n := range []string{"CON.md", "con .md", "COM1.md", "COM¹.md", "LPT³.md", "AUX.txt.md", "nul"} {
		if !reservedName(n) {
			t.Errorf("장치 이름을 놓침: %q", n)
		}
	}
	for _, n := range []string{"CONTRACT.md", "COM10.md", "회의.md", "console.md"} {
		if reservedName(n) {
			t.Errorf("보통 이름을 막음: %q", n)
		}
	}
}

func TestNetworkPathRefused(t *testing.T) {
	ws := &workspace{}
	if err := ws.setDir(`\\server\share`, ""); err == nil {
		t.Fatal("네트워크 경로를 열었다")
	}
}
