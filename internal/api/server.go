package api

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"

	"pjkr/internal/store"
)

// New はAPI+静的配信のハンドラを構築する。appURL は通知クリックで開くURL。
func New(st *store.Store, webFS fs.FS, version, appURL string) http.Handler {
	h := &handlers{st: st, version: version, appURL: appURL}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/ping", h.ping)
	mux.HandleFunc("GET /api/state", h.state)
	mux.HandleFunc("POST /api/backup", h.backup)
	mux.HandleFunc("POST /api/open", h.open)
	mux.HandleFunc("POST /api/settings", h.updateSettings)
	mux.HandleFunc("POST /api/startup", h.setStartup)
	mux.HandleFunc("POST /api/notify-test", h.notifyTest)
	mux.HandleFunc("GET /api/export/json", h.exportJSON)
	mux.HandleFunc("POST /api/export/report", h.exportReport)
	mux.HandleFunc("GET /api/export/{kind}", h.export)
	mux.HandleFunc("GET /api/template/{kind}", h.template)
	mux.HandleFunc("POST /api/import/{kind}", h.importXLSX)
	mux.HandleFunc("POST /api/restore", h.restore)
	mux.HandleFunc("POST /api/inbox/{id}/convert", h.convert)
	mux.HandleFunc("POST /api/tasks/{id}/log", h.appendLog)
	mux.HandleFunc("POST /api/{entity}", h.create)
	mux.HandleFunc("PATCH /api/{entity}/{id}", h.patch)
	mux.HandleFunc("DELETE /api/{entity}/{id}", h.remove)
	mux.Handle("GET /", http.FileServerFS(webFS))

	return csrfGuard(mux)
}

// csrfGuard は他サイトのページからlocalhostへの書き込みを拒否する(設計書§3)。
// ブラウザは Sec-Fetch-Site を自動付与する。直接のツール(curl等)はヘッダなし=noneとして許可。
func csrfGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			switch r.Header.Get("Sec-Fetch-Site") {
			case "", "same-origin", "none":
			default:
				http.Error(w, `{"error":"cross-site request rejected"}`, http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type handlers struct {
	st      *store.Store
	version string
	appURL  string
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, store.ErrNotFound) {
		status = http.StatusNotFound
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func readBody(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 10<<20))
	return dec.Decode(v)
}

func readAll(r io.Reader) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r, 64<<20))
}
