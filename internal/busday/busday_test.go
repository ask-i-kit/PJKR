package busday

import (
	"testing"
	"time"
)

func date(s string) time.Time {
	t, _ := time.ParseInLocation("2006-01-02", s, time.Local)
	return t
}

func TestIsBusinessDay(t *testing.T) {
	cases := []struct {
		day  string
		want bool
	}{
		{"2026-07-13", true},  // 月曜
		{"2026-07-11", false}, // 土曜
		{"2026-07-12", false}, // 日曜
		{"2026-07-20", false}, // 海の日
		{"2026-01-01", false}, // 元日
		{"2026-05-06", false}, // 振替休日
	}
	for _, c := range cases {
		if got := IsBusinessDay(date(c.day), nil); got != c.want {
			t.Errorf("IsBusinessDay(%s) = %v, want %v", c.day, got, c.want)
		}
	}
	custom := map[string]bool{"2026-12-29": true}
	if IsBusinessDay(date("2026-12-29"), custom) {
		t.Error("独自休日が営業日扱いになっています")
	}
}

func TestSince(t *testing.T) {
	cases := []struct {
		from, today string
		want        int
	}{
		{"2026-07-10", "2026-07-13", 1}, // 金曜依頼→月曜 = 1営業日
		{"2026-07-13", "2026-07-13", 0}, // 当日 = 0
		{"2026-07-13", "2026-07-17", 4}, // 月→金 = 4
		{"2026-07-16", "2026-07-21", 2}, // 木→火(月曜は海の日) = 金・火の2
		{"", "2026-07-13", 0},           // 不正な入力
	}
	for _, c := range cases {
		if got := Since(c.from, date(c.today), nil); got != c.want {
			t.Errorf("Since(%s, %s) = %d, want %d", c.from, c.today, got, c.want)
		}
	}
}
