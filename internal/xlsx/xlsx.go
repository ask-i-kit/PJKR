// Package xlsx はExcel入出力(F8-5, F9)を提供する。
package xlsx

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	"pjkr/internal/busday"
	"pjkr/internal/store"
)

const sheet = "Sheet1"

// snapshot はストアの現在データをレースなしで読み取る。
func snapshot(st *store.Store) (map[string]any, error) {
	raw, err := st.Snapshot()
	if err != nil {
		return nil, err
	}
	var data map[string]any
	return data, json.Unmarshal(raw, &data)
}

func items(data map[string]any, key string) []map[string]any {
	list, _ := data[key].([]any)
	out := make([]map[string]any, 0, len(list))
	for _, v := range list {
		if m, ok := v.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func str(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

func nameMap(data map[string]any, key string) map[string]string {
	out := map[string]string{}
	for _, m := range items(data, key) {
		out[str(m, "id")] = str(m, "name")
	}
	return out
}

func customHolidays(data map[string]any) map[string]bool {
	out := map[string]bool{}
	if settings, ok := data["settings"].(map[string]any); ok {
		if arr, ok := settings["customHolidays"].([]any); ok {
			for _, v := range arr {
				if d, ok := v.(string); ok {
					out[d] = true
				}
			}
		}
	}
	return out
}

// newFile はヘッダー行つきのワークブックを作る。
func newFile(headers []string) (*excelize.File, error) {
	f := excelize.NewFile()
	style, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"1E3A5F"}},
	})
	if err != nil {
		return nil, err
	}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	end, _ := excelize.CoordinatesToCellName(len(headers), 1)
	f.SetCellStyle(sheet, "A1", end, style)
	return f, nil
}

func setRow(f *excelize.File, row int, values []any) {
	for i, v := range values {
		cell, _ := excelize.CoordinatesToCellName(i+1, row)
		f.SetCellValue(sheet, cell, v)
	}
}

// ---- エクスポート(F9-1) ----

var statusJa = map[string]string{"todo": "未着手", "doing": "進行中", "waiting": "返答待ち", "done": "完了", "hold": "保留"}
var istatusJa = map[string]string{"open": "未対応", "doing": "対応中", "done": "完了", "hold": "保留"}
var levelJa = map[string]string{"high": "高", "mid": "中", "low": "低"}

func contactLabel(contacts map[string]string, id string) string {
	if id == "" {
		return "自分"
	}
	if n, ok := contacts[id]; ok {
		return n
	}
	return "?"
}

func ExportTasks(st *store.Store) (*excelize.File, error) {
	data, err := snapshot(st)
	if err != nil {
		return nil, err
	}
	projects := nameMap(data, "projects")
	contacts := nameMap(data, "contacts")
	f, err := newFile([]string{"ID", "案件", "件名", "状態", "担当", "相手", "開始日", "期限", "優先度", "被依頼", "発生日", "待ち開始", "回答希望", "詳細", "回答概要", "更新日時"})
	if err != nil {
		return nil, err
	}
	row := 2
	for _, t := range items(data, "tasks") {
		asked := ""
		if b, _ := t["isAsked"].(bool); b {
			asked = "○"
		}
		setRow(f, row, []any{
			str(t, "id"), projects[str(t, "projectId")], str(t, "title"),
			statusJa[str(t, "status")], contactLabel(contacts, str(t, "assignee")),
			contactLabel(contacts, str(t, "contactId")),
			str(t, "start"), str(t, "due"), levelJa[str(t, "priority")],
			asked, str(t, "askedOn"), str(t, "waitSince"), str(t, "replyHope"),
			str(t, "detail"), str(t, "answer"), str(t, "updatedAt"),
		})
		row++
	}
	return f, nil
}

func ExportIssues(st *store.Store) (*excelize.File, error) {
	data, err := snapshot(st)
	if err != nil {
		return nil, err
	}
	projects := nameMap(data, "projects")
	contacts := nameMap(data, "contacts")
	f, err := newFile([]string{"番号", "案件", "件名", "内容", "重要度", "対応者", "状態", "発生日", "期限", "更新日時"})
	if err != nil {
		return nil, err
	}
	row := 2
	for _, i := range items(data, "issues") {
		setRow(f, row, []any{
			strings.Replace(str(i, "id"), "q", "課-", 1), projects[str(i, "projectId")],
			str(i, "title"), str(i, "detail"), levelJa[str(i, "severity")],
			contactLabel(contacts, str(i, "assignee")), istatusJa[str(i, "status")],
			str(i, "openedOn"), str(i, "due"), str(i, "updatedAt"),
		})
		row++
	}
	return f, nil
}

func ExportBalls(st *store.Store) (*excelize.File, error) {
	data, err := snapshot(st)
	if err != nil {
		return nil, err
	}
	projects := nameMap(data, "projects")
	contacts := nameMap(data, "contacts")
	custom := customHolidays(data)
	now := time.Now()
	f, err := newFile([]string{"方向", "件名", "相手", "案件", "基準日", "経過営業日", "回答希望/期限", "催促回数", "状態"})
	if err != nil {
		return nil, err
	}
	row := 2
	for _, t := range items(data, "tasks") {
		status := str(t, "status")
		isAsked, _ := t["isAsked"].(bool)
		if status == "waiting" {
			base := str(t, "waitSince")
			nudges, _ := t["nudges"].([]any)
			for _, n := range nudges {
				if s, ok := n.(string); ok && s > base {
					base = s
				}
			}
			setRow(f, row, []any{
				"相手ボール", str(t, "title"), contactLabel(contacts, str(t, "contactId")),
				projects[str(t, "projectId")], base, busday.Since(base, now, custom),
				str(t, "replyHope"), len(nudges), statusJa[status],
			})
			row++
		} else if isAsked && status != "done" {
			setRow(f, row, []any{
				"自分ボール", str(t, "title"), contactLabel(contacts, str(t, "contactId")),
				projects[str(t, "projectId")], str(t, "askedOn"),
				busday.Since(str(t, "askedOn"), now, custom),
				str(t, "due"), "", statusJa[status],
			})
			row++
		}
	}
	return f, nil
}

// ExportQA は回答済みの被依頼をFAQ素材として出力する(F14-5)。
func ExportQA(st *store.Store) (*excelize.File, error) {
	data, err := snapshot(st)
	if err != nil {
		return nil, err
	}
	projects := nameMap(data, "projects")
	contacts := nameMap(data, "contacts")
	f, err := newFile([]string{"質問", "質問詳細", "回答", "相手", "案件", "回答日"})
	if err != nil {
		return nil, err
	}
	row := 2
	for _, t := range items(data, "tasks") {
		if b, _ := t["isAsked"].(bool); !b || str(t, "status") != "done" {
			continue
		}
		doneAt := str(t, "doneAt")
		if len(doneAt) >= 10 {
			doneAt = doneAt[:10]
		}
		setRow(f, row, []any{
			str(t, "title"), str(t, "detail"), str(t, "answer"),
			contactLabel(contacts, str(t, "contactId")), projects[str(t, "projectId")], doneAt,
		})
		row++
	}
	return f, nil
}

// ---- 週報エクスポート(F8-5。様式は未確定#1のため汎用形式) ----

type ReportRow struct {
	Project string `json:"project"`
	Section string `json:"section"`
	Text    string `json:"text"`
}

func ExportReport(title string, rows []ReportRow) (*excelize.File, error) {
	f, err := newFile([]string{"案件", "区分", "内容"})
	if err != nil {
		return nil, err
	}
	f.SetCellValue(sheet, "E1", title)
	f.SetColWidth(sheet, "A", "A", 24)
	f.SetColWidth(sheet, "B", "B", 14)
	f.SetColWidth(sheet, "C", "C", 90)
	wrap, _ := f.NewStyle(&excelize.Style{Alignment: &excelize.Alignment{WrapText: true, Vertical: "top"}})
	row := 2
	for _, r := range rows {
		setRow(f, row, []any{r.Project, r.Section, r.Text})
		cell, _ := excelize.CoordinatesToCellName(3, row)
		f.SetCellStyle(sheet, cell, cell, wrap)
		row++
	}
	return f, nil
}

// ---- インポート(F9-2) ----

var taskHeaders = []string{"件名", "案件", "担当", "期限", "優先度", "詳細"}
var issueHeaders = []string{"件名", "案件", "重要度", "期限", "内容"}

func TemplateTasks() (*excelize.File, error) {
	f, err := newFile(taskHeaders)
	if err != nil {
		return nil, err
	}
	setRow(f, 2, []any{"顧客マスタの移行データ作成", "(登録済みの案件名)", "(相手マスタの名前。空欄=自分)", "2026-07-31", "中", "備考など"})
	return f, nil
}

func TemplateIssues() (*excelize.File, error) {
	f, err := newFile(issueHeaders)
	if err != nil {
		return nil, err
	}
	setRow(f, 2, []any{"帳票の文字化け", "(登録済みの案件名)", "高", "2026-07-31", "詳細な内容"})
	return f, nil
}

var dateRe = regexp.MustCompile(`^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$`)

func normDate(s string) string {
	m := dateRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return ""
	}
	return fmt.Sprintf("%s-%02s-%02s", m[1], m[2], m[3])
}

var levelFromJa = map[string]string{"高": "high", "中": "mid", "低": "low"}

func readRows(r io.Reader) ([][]string, error) {
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, fmt.Errorf("Excelファイルを読み込めません: %w", err)
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, fmt.Errorf("シートがありません")
	}
	return f.GetRows(sheets[0])
}

func cell(row []string, i int) string {
	if i < len(row) {
		return strings.TrimSpace(row[i])
	}
	return ""
}

// 案件名・相手名 → ID の逆引き
func reverseByName(data map[string]any, key string) map[string]string {
	out := map[string]string{}
	for _, m := range items(data, key) {
		out[str(m, "name")] = str(m, "id")
	}
	return out
}

// ImportTasks は所定フォーマットのExcelからタスクを一括作成する。
// 作成したIDと行単位のエラーを返す(クライアント側でUndo登録するため)。
func ImportTasks(st *store.Store, r io.Reader) (createdIDs []string, rowErrs []string, err error) {
	rows, err := readRows(r)
	if err != nil {
		return nil, nil, err
	}
	data, err := snapshot(st)
	if err != nil {
		return nil, nil, err
	}
	projByName := reverseByName(data, "projects")
	contactByName := reverseByName(data, "contacts")

	for n, row := range rows {
		if n == 0 { // ヘッダー行
			continue
		}
		title := cell(row, 0)
		if title == "" {
			continue
		}
		projID := projByName[cell(row, 1)]
		if projID == "" {
			rowErrs = append(rowErrs, fmt.Sprintf("%d行目: 案件「%s」が見つかりません", n+1, cell(row, 1)))
			continue
		}
		var assignee any
		if a := cell(row, 2); a != "" && a != "自分" {
			id, ok := contactByName[a]
			if !ok {
				rowErrs = append(rowErrs, fmt.Sprintf("%d行目: 担当「%s」が相手マスタにありません", n+1, a))
				continue
			}
			assignee = id
		}
		pri := levelFromJa[cell(row, 4)]
		if pri == "" {
			pri = "mid"
		}
		var due any
		if d := normDate(cell(row, 3)); d != "" {
			due = d
		}
		item, cerr := st.Create("tasks", map[string]any{
			"projectId": projID, "parentId": nil, "title": title, "detail": cell(row, 5),
			"start": nil, "due": due, "priority": pri, "status": "todo", "progress": 0,
			"assignee": assignee, "contactId": nil, "waitSince": nil, "replyHope": nil,
			"nudges": []any{}, "isAsked": false, "askedOn": nil, "answer": "", "checkMemo": "",
			"todayOn": nil, "links": []any{}, "logs": []any{}, "doneAt": nil,
		})
		if cerr != nil {
			rowErrs = append(rowErrs, fmt.Sprintf("%d行目: %v", n+1, cerr))
			continue
		}
		createdIDs = append(createdIDs, item["id"].(string))
	}
	return createdIDs, rowErrs, nil
}

// ImportIssues は所定フォーマットのExcelから課題を一括作成する。
func ImportIssues(st *store.Store, r io.Reader) (createdIDs []string, rowErrs []string, err error) {
	rows, err := readRows(r)
	if err != nil {
		return nil, nil, err
	}
	data, err := snapshot(st)
	if err != nil {
		return nil, nil, err
	}
	projByName := reverseByName(data, "projects")
	today := time.Now().Format("2006-01-02")

	for n, row := range rows {
		if n == 0 {
			continue
		}
		title := cell(row, 0)
		if title == "" {
			continue
		}
		projID := projByName[cell(row, 1)]
		if projID == "" {
			rowErrs = append(rowErrs, fmt.Sprintf("%d行目: 案件「%s」が見つかりません", n+1, cell(row, 1)))
			continue
		}
		sev := levelFromJa[cell(row, 2)]
		if sev == "" {
			sev = "mid"
		}
		var due any
		if d := normDate(cell(row, 3)); d != "" {
			due = d
		}
		item, cerr := st.Create("issues", map[string]any{
			"projectId": projID, "title": title, "detail": cell(row, 4),
			"openedOn": today, "due": due, "severity": sev, "assignee": nil,
			"status": "open", "logs": []any{},
		})
		if cerr != nil {
			rowErrs = append(rowErrs, fmt.Sprintf("%d行目: %v", n+1, cerr))
			continue
		}
		createdIDs = append(createdIDs, item["id"].(string))
	}
	return createdIDs, rowErrs, nil
}
