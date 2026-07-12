package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("見つかりません")

// Store は pjkr.json 全体をメモリに保持し、変更をデバウンス書き込みする。
type Store struct {
	mu   sync.Mutex
	path string
	data map[string]any

	saveMu     sync.Mutex
	timer      *time.Timer
	firstDirty time.Time
	lastBackup string // 日次バックアップ済みの日付 "2006-01-02"
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dataDir, "pjkr.json")}
	raw, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		s.data = defaultData()
		if err := s.writeFile(); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(raw, &s.data); err != nil {
			return nil, fmt.Errorf("%s の読み込みに失敗しました(破損の可能性。backup/から復元してください): %w", s.path, err)
		}
	}
	if err := s.startupBackup(); err != nil {
		return nil, err
	}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) DataDir() string { return filepath.Dir(s.path) }

// Snapshot は全データのJSONを返す(GET /api/state 用)。
func (s *Store) Snapshot() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return json.Marshal(s.data)
}

// Replace はJSONバックアップからの全データ復元(F9-3)。
// 現行データをバックアップしてから置き換え、必要ならバージョン移行して即保存する。
func (s *Store) Replace(raw []byte) error {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return fmt.Errorf("JSONとして読み込めません: %w", err)
	}
	if toInt(data["version"]) == 0 || data["tasks"] == nil {
		return errors.New("PJKRのバックアップファイルではないようです(version/tasksがありません)")
	}
	if v := toInt(data["version"]); v > currentVersion {
		return fmt.Errorf("このデータはより新しいPJKR(データv%d)で作成されています", v)
	}
	if err := s.BackupNow(); err != nil { // 復元前に現行データを退避
		return err
	}
	s.mu.Lock()
	s.data = data
	for _, e := range Entities { // 欠けているコレクションを補完
		if s.data[e.Key] == nil {
			s.data[e.Key] = []any{}
		}
	}
	s.mu.Unlock()
	if err := s.migrate(); err != nil {
		return err
	}
	return s.writeFile()
}

// ---- コレクション操作(呼び出し側はロック不要。各メソッドが排他する) ----

func (s *Store) col(key string) []any {
	list, _ := s.data[key].([]any)
	return list
}

func find(list []any, id string) (int, map[string]any) {
	for i, v := range list {
		if m, ok := v.(map[string]any); ok && m["id"] == id {
			return i, m
		}
	}
	return -1, nil
}

func now() string { return time.Now().Format(time.RFC3339) }

// nextID は接頭辞+連番のIDを採番する。restore(ID指定作成)時はカウンタを追い越さないよう繰り上げる。
func (s *Store) nextID(def EntityDef) string {
	counters, _ := s.data["counters"].(map[string]any)
	if counters == nil {
		counters = map[string]any{}
		s.data["counters"] = counters
	}
	n := toInt(counters[def.Key]) + 1
	counters[def.Key] = n
	return def.Prefix + strconv.Itoa(n)
}

func (s *Store) bumpCounter(def EntityDef, id string) {
	numPart := strings.TrimPrefix(id, def.Prefix)
	n, err := strconv.Atoi(numPart)
	if err != nil {
		return
	}
	counters, _ := s.data["counters"].(map[string]any)
	if counters == nil {
		counters = map[string]any{}
		s.data["counters"] = counters
	}
	if n > toInt(counters[def.Key]) {
		counters[def.Key] = n
	}
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	}
	return 0
}

// Create は新規作成。fields に id があれば復元(Undo)として扱う。
func (s *Store) Create(entity string, fields map[string]any) (map[string]any, error) {
	def, ok := EntityByKey(entity)
	if !ok {
		return nil, ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	item := map[string]any{}
	for k, v := range fields {
		item[k] = v
	}
	if id, _ := item["id"].(string); id != "" {
		if _, exists := find(s.col(entity), id); exists != nil {
			return nil, fmt.Errorf("id %s は既に存在します", id)
		}
		s.bumpCounter(def, id)
	} else {
		item["id"] = s.nextID(def)
	}
	if _, ok := item["createdAt"]; !ok {
		item["createdAt"] = now()
	}
	item["updatedAt"] = now()

	s.data[entity] = append(s.col(entity), item)
	s.markDirty()
	return item, nil
}

// Patch は部分更新。変更したキーの更新前の値(before)を返す(クライアントUndo用)。
// 更新前に存在しなかったキーは before で null になる。
func (s *Store) Patch(entity, id string, fields map[string]any) (before, after map[string]any, err error) {
	if _, ok := EntityByKey(entity); !ok {
		return nil, nil, ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	_, item := find(s.col(entity), id)
	if item == nil {
		return nil, nil, ErrNotFound
	}
	before = map[string]any{}
	for k, v := range fields {
		if k == "id" || k == "createdAt" {
			continue
		}
		if old, ok := item[k]; ok {
			before[k] = old
		} else {
			before[k] = nil
		}
		item[k] = v
	}
	before["updatedAt"] = item["updatedAt"]
	item["updatedAt"] = now()
	s.markDirty()
	return before, item, nil
}

// Delete は物理削除。tasks は子孫も併せて削除する。
// 削除した実体を親→子の順で返す(Undoはこの順で再POSTすれば復元できる)。
func (s *Store) Delete(entity, id string) ([]map[string]any, error) {
	if _, ok := EntityByKey(entity); !ok {
		return nil, ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	list := s.col(entity)
	if _, item := find(list, id); item == nil {
		return nil, ErrNotFound
	}
	targets := map[string]bool{id: true}
	if entity == "tasks" { // 子孫を収集(親が消える順に依存しないよう反復)
		for changed := true; changed; {
			changed = false
			for _, v := range list {
				m, _ := v.(map[string]any)
				if m == nil || targets[m["id"].(string)] {
					continue
				}
				if pid, _ := m["parentId"].(string); pid != "" && targets[pid] {
					targets[m["id"].(string)] = true
					changed = true
				}
			}
		}
	}
	var removed []map[string]any
	kept := []any{} // 空になっても null ではなく [] で永続化する
	// 親→子の順: 対象を階層の浅い順で並べるため、まず削除対象を抽出してから親子順に整列する
	for _, v := range list {
		m, _ := v.(map[string]any)
		if m != nil && targets[m["id"].(string)] {
			removed = append(removed, m)
		} else {
			kept = append(kept, v)
		}
	}
	removed = sortParentsFirst(removed, targets)
	s.data[entity] = kept
	s.markDirty()
	return removed, nil
}

// sortParentsFirst は削除された集合内で親が子より先に来るよう整列する。
func sortParentsFirst(items []map[string]any, inSet map[string]bool) []map[string]any {
	var out []map[string]any
	emitted := map[string]bool{}
	for len(out) < len(items) {
		progress := false
		for _, m := range items {
			id, _ := m["id"].(string)
			if emitted[id] {
				continue
			}
			pid, _ := m["parentId"].(string)
			if pid == "" || !inSet[pid] || emitted[pid] {
				out = append(out, m)
				emitted[id] = true
				progress = true
			}
		}
		if !progress { // 循環参照(通常発生しない)の保険
			for _, m := range items {
				if id, _ := m["id"].(string); !emitted[id] {
					out = append(out, m)
					emitted[id] = true
				}
			}
		}
	}
	return out
}

// Convert はInbox項目をタスク/案件メモへ変換する(作成+Inbox削除を1操作で)。
func (s *Store) Convert(inboxID, to string, fields map[string]any) (created, removedInbox map[string]any, err error) {
	if to != "tasks" && to != "notes" {
		return nil, nil, fmt.Errorf("変換先が不正です: %s", to)
	}
	s.mu.Lock()
	_, item := find(s.col("inbox"), inboxID)
	s.mu.Unlock()
	if item == nil {
		return nil, nil, ErrNotFound
	}
	created, err = s.Create(to, fields)
	if err != nil {
		return nil, nil, err
	}
	removed, err := s.Delete("inbox", inboxID)
	if err != nil {
		return nil, nil, err
	}
	return created, removed[0], nil
}

// AppendLog はタスクに作業ログを追記する。
func (s *Store) AppendLog(taskID, text string) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, item := find(s.col("tasks"), taskID)
	if item == nil {
		return nil, ErrNotFound
	}
	logs, _ := item["logs"].([]any)
	item["logs"] = append(logs, map[string]any{"at": now(), "text": text})
	item["updatedAt"] = now()
	s.markDirty()
	return item, nil
}

// ---- 保存(要件N4/N5: デバウンス+atomic書き込み) ----

const (
	saveDebounce = 500 * time.Millisecond
	saveMaxDelay = 3 * time.Second
)

func (s *Store) markDirty() {
	s.saveMu.Lock()
	defer s.saveMu.Unlock()
	nowT := time.Now()
	if s.firstDirty.IsZero() {
		s.firstDirty = nowT
	}
	delay := saveDebounce
	if remain := saveMaxDelay - nowT.Sub(s.firstDirty); remain < delay {
		delay = max(remain, 0)
	}
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(delay, func() {
		if err := s.Flush(); err != nil {
			fmt.Fprintln(os.Stderr, "保存エラー:", err)
		}
	})
}

// Flush は未保存の変更を即時書き込む(終了時にも呼ぶ)。
func (s *Store) Flush() error {
	s.saveMu.Lock()
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	dirty := !s.firstDirty.IsZero()
	s.firstDirty = time.Time{}
	s.saveMu.Unlock()
	if !dirty {
		return nil
	}
	if err := s.maybeDailyBackup(); err != nil {
		fmt.Fprintln(os.Stderr, "バックアップエラー:", err)
	}
	return s.writeFile()
}

func (s *Store) writeFile() error {
	s.mu.Lock()
	raw, err := json.MarshalIndent(s.data, "", " ")
	s.mu.Unlock()
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
