package api

import (
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

// URIスキーム(outlook: 等)。http/httsはブラウザ側で開くためここには来ない想定。
var schemeRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)

// open はローカルのファイル・フォルダ・URIをOSの関連付けで開く(設計書§5.4)。
// 引数を分離した exec.Command を使うためコマンドインジェクションは発生しない。
func (h *handlers) open(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Target string `json:"target"`
	}
	if err := readBody(r, &body); err != nil || strings.TrimSpace(body.Target) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "target が必要です"})
		return
	}
	target := strings.TrimSpace(body.Target)

	isPath := strings.HasPrefix(target, `\\`) || regexp.MustCompile(`^[a-zA-Z]:[\\/]`).MatchString(target)
	if isPath {
		if _, err := os.Stat(target); err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "パスが見つかりません: " + target})
			return
		}
	} else if !schemeRe.MatchString(target) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "パスまたはURI形式ではありません: " + target})
		return
	}

	// explorer.exe はファイル(関連付けで開く)・フォルダ・URIのいずれも扱える
	if err := exec.Command("explorer.exe", target).Start(); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
