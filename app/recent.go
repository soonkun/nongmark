package main

// 최근 문서 목록 - 프로그램이 %LOCALAPPDATA%\Nongmark\recent.json에 보관한다. 화면은 번호로만 고른다(화면이 임의 경로를 넘길 수 없게).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const maxRecent = 8

type recentItem struct {
	Full string `json:"full"` // 전체 경로
	Name string `json:"name"` // 표시 이름(확장자 없이)
}

type recentList struct {
	mu   sync.Mutex
	path string
}

func newRecentList() *recentList {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return &recentList{}
	}
	return &recentList{path: filepath.Join(base, "Nongmark", "recent.json")}
}

func (r *recentList) load() []recentItem {
	if r.path == "" {
		return nil
	}
	b, err := os.ReadFile(r.path)
	if err != nil {
		return nil
	}
	var items []recentItem
	if json.Unmarshal(b, &items) != nil {
		return nil
	}
	if len(items) > maxRecent {
		items = items[:maxRecent]
	}
	return items
}

func (r *recentList) save(items []recentItem) {
	if r.path == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(r.path), 0o755)
	b, _ := json.Marshal(items)
	_ = os.WriteFile(r.path, b, 0o644)
}

// List: 지금 목록(없어진 파일은 뺀다).
func (r *recentList) List() []recentItem {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := r.load()
	out := items[:0]
	for _, it := range items {
		if st, err := os.Stat(it.Full); err == nil && !st.IsDir() {
			out = append(out, it)
		}
	}
	if len(out) != len(items) {
		r.save(out)
	}
	return append([]recentItem{}, out...)
}

// Add: 연 문서를 맨 앞에.
func (r *recentList) Add(full string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := r.load()
	name := strings.TrimSuffix(filepath.Base(full), filepath.Ext(full))
	out := []recentItem{{Full: full, Name: name}}
	for _, it := range items {
		if !strings.EqualFold(it.Full, full) && len(out) < maxRecent {
			out = append(out, it)
		}
	}
	r.save(out)
}

// Get: 번호로 하나.
func (r *recentList) Get(index int) (recentItem, bool) {
	items := r.List()
	if index < 0 || index >= len(items) {
		return recentItem{}, false
	}
	return items[index], true
}
