package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/xuri/excelize/v2"

	"pjkr/internal/xlsx"
)

func sendXLSX(w http.ResponseWriter, f *excelize.File, name string) {
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s-%s.xlsx"`, name, time.Now().Format("20060102")))
	_ = f.Write(w)
}

// GET /api/export/{kind} — 一覧のExcelエクスポート(F9-1)
func (h *handlers) export(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	var (
		f   *excelize.File
		err error
	)
	switch kind {
	case "tasks":
		f, err = xlsx.ExportTasks(h.st)
	case "issues":
		f, err = xlsx.ExportIssues(h.st)
	case "balls":
		f, err = xlsx.ExportBalls(h.st)
	case "qa":
		f, err = xlsx.ExportQA(h.st)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "不明なエクスポート種別: " + kind})
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	sendXLSX(w, f, "pjkr-"+kind)
}

// POST /api/export/report — 週報Excel(F8-5)
func (h *handlers) exportReport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title string           `json:"title"`
		Rows  []xlsx.ReportRow `json:"rows"`
	}
	if err := readBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	f, err := xlsx.ExportReport(body.Title, body.Rows)
	if err != nil {
		writeErr(w, err)
		return
	}
	sendXLSX(w, f, "週報")
}

// GET /api/template/{kind} — インポート用テンプレート
func (h *handlers) template(w http.ResponseWriter, r *http.Request) {
	var (
		f   *excelize.File
		err error
	)
	switch r.PathValue("kind") {
	case "tasks":
		f, err = xlsx.TemplateTasks()
	case "issues":
		f, err = xlsx.TemplateIssues()
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "不明なテンプレート種別"})
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	sendXLSX(w, f, "取込テンプレート-"+r.PathValue("kind"))
}

// POST /api/import/{kind} — Excel一括インポート(F9-2)。multipart/form-data の file フィールド。
func (h *handlers) importXLSX(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ファイルを受け取れません: " + err.Error()})
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file フィールドが必要です"})
		return
	}
	defer file.Close()

	var created, rowErrs []string
	switch r.PathValue("kind") {
	case "tasks":
		created, rowErrs, err = xlsx.ImportTasks(h.st, file)
	case "issues":
		created, rowErrs, err = xlsx.ImportIssues(h.st, file)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "不明なインポート種別"})
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	if created == nil {
		created = []string{}
	}
	if rowErrs == nil {
		rowErrs = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"created": created, "errors": rowErrs})
}

// GET /api/export/json — 全データのJSONバックアップをダウンロード(F9-3)
func (h *handlers) exportJSON(w http.ResponseWriter, r *http.Request) {
	raw, err := h.st.Snapshot()
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="pjkr-backup-%s.json"`, time.Now().Format("20060102-150405")))
	w.Write(raw)
}

// POST /api/restore — JSONバックアップからの復元(F9-3)
func (h *handlers) restore(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ファイルを受け取れません: " + err.Error()})
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file フィールドが必要です"})
		return
	}
	defer file.Close()
	raw, err := readAll(file)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := h.st.Replace(raw); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
