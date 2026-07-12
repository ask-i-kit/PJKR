// Package busday は営業日(土日・日本の祝日・ユーザー定義休日を除く)の計算を行う(要件N14)。
package busday

import "time"

// 日本の祝日(振替休日・国民の休日を含む)。年1回、翌年分を追加更新する。
// 会社独自の休日や祝日改正は設定画面の「独自休日」で補正できる。
var holidays = []string{
	// 2025
	"2025-01-01", "2025-01-13", "2025-02-11", "2025-02-23", "2025-02-24",
	"2025-03-20", "2025-04-29", "2025-05-03", "2025-05-04", "2025-05-05",
	"2025-05-06", "2025-07-21", "2025-08-11", "2025-09-15", "2025-09-23",
	"2025-10-13", "2025-11-03", "2025-11-23", "2025-11-24",
	// 2026
	"2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20",
	"2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
	"2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23",
	"2026-10-12", "2026-11-03", "2026-11-23",
	// 2027
	"2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-22",
	"2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19",
	"2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03",
	"2027-11-23",
}

var holidaySet = func() map[string]bool {
	m := make(map[string]bool, len(holidays))
	for _, d := range holidays {
		m[d] = true
	}
	return m
}()

// Holidays は同梱している祝日一覧を返す(クライアントへ配布用)。
func Holidays() []string { return holidays }

// IsBusinessDay は営業日かどうかを判定する。custom はユーザー定義休日(YYYY-MM-DD)。
func IsBusinessDay(t time.Time, custom map[string]bool) bool {
	if wd := t.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return false
	}
	d := t.Format("2006-01-02")
	return !holidaySet[d] && !custom[d]
}

// Since は fromISO(YYYY-MM-DD)の翌日から today までに含まれる営業日数を返す。
// 例: 金曜に依頼して月曜に確認 → 1営業日経過。fromが不正なら0。
func Since(fromISO string, today time.Time, custom map[string]bool) int {
	from, err := time.ParseInLocation("2006-01-02", fromISO, today.Location())
	if err != nil {
		return 0
	}
	n := 0
	for d := from.AddDate(0, 0, 1); !d.After(today); d = d.AddDate(0, 0, 1) {
		if IsBusinessDay(d, custom) {
			n++
		}
	}
	return n
}
