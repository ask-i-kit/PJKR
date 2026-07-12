package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"pjkr/internal/busday"
	"pjkr/internal/notify"
	"pjkr/internal/startup"
	"pjkr/internal/store"
)

func (h *handlers) ping(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"app": "pjkr", "version": h.version})
}

// state は全データ+実行環境情報を返す(起動時に1回)。
func (h *handlers) state(w http.ResponseWriter, r *http.Request) {
	raw, err := h.st.Snapshot()
	if err != nil {
		writeErr(w, err)
		return
	}
	meta, _ := json.Marshal(map[string]any{
		"version":        h.version,
		"dataDir":        h.st.DataDir(),
		"holidays":       busday.Holidays(),
		"startupEnabled": startup.Enabled(),
	})
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	fmt.Fprintf(w, `{"meta":%s,"data":`, meta)
	w.Write(raw)
	w.Write([]byte("}"))
}

// updateSettings は設定を部分更新する(F4-6, F11-2ほか)。
func (h *handlers) updateSettings(w http.ResponseWriter, r *http.Request) {
	var fields map[string]any
	if err := readBody(r, &fields); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, h.st.UpdateSettings(fields))
}

// setStartup はWindowsスタートアップ登録をON/OFFする(F11-4)。
func (h *handlers) setStartup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := readBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	var err error
	if body.Enabled {
		err = startup.Enable()
	} else {
		err = startup.Disable()
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": startup.Enabled()})
}

// notifyTest は現在の件数でトースト通知を即時送る(設定画面の動作確認用)。
func (h *handlers) notifyTest(w http.ResponseWriter, r *http.Request) {
	title, msg := notify.MorningMessage(h.st, time.Now())
	if title == "" {
		title, msg = "PJKR 通知テスト", "現在、通知対象の項目はありません"
	}
	if err := notify.Toast(title, msg, h.appURL); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *handlers) backup(w http.ResponseWriter, r *http.Request) {
	if err := h.st.Flush(); err != nil {
		writeErr(w, err)
		return
	}
	if err := h.st.BackupNow(); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func entityOf(r *http.Request) (store.EntityDef, error) {
	def, ok := store.EntityByKey(r.PathValue("entity"))
	if !ok {
		return def, fmt.Errorf("不明なエンティティ: %w", store.ErrNotFound)
	}
	return def, nil
}

func (h *handlers) create(w http.ResponseWriter, r *http.Request) {
	def, err := entityOf(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var fields map[string]any
	if err := readBody(r, &fields); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	item, err := h.st.Create(def.Key, fields)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (h *handlers) patch(w http.ResponseWriter, r *http.Request) {
	def, err := entityOf(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var fields map[string]any
	if err := readBody(r, &fields); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	before, after, err := h.st.Patch(def.Key, r.PathValue("id"), fields)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"before": before, "after": after})
}

func (h *handlers) remove(w http.ResponseWriter, r *http.Request) {
	def, err := entityOf(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	removed, err := h.st.Delete(def.Key, r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
}

// convert はInbox項目をタスク/案件メモへ変換する(F2-2)。
func (h *handlers) convert(w http.ResponseWriter, r *http.Request) {
	var body struct {
		To     string         `json:"to"`
		Fields map[string]any `json:"fields"`
	}
	if err := readBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	created, removed, err := h.st.Convert(r.PathValue("id"), body.To, body.Fields)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"created": created, "inbox": removed, "to": body.To})
}

func (h *handlers) appendLog(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := readBody(r, &body); err != nil || body.Text == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "text が必要です"})
		return
	}
	item, err := h.st.AppendLog(r.PathValue("id"), body.Text)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}
