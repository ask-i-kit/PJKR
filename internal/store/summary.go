package store

import (
	"time"

	"pjkr/internal/busday"
)

// Settings は設定のコピーを返す。
func (s *Store) Settings() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]any{}
	if m, ok := s.data["settings"].(map[string]any); ok {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

// UpdateSettings は設定を部分更新する。
func (s *Store) UpdateSettings(fields map[string]any) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.data["settings"].(map[string]any)
	if !ok {
		m = defaultSettings()
		s.data["settings"] = m
	}
	for k, v := range fields {
		m[k] = v
	}
	s.markDirty()
	out := map[string]any{}
	for k, v := range m {
		out[k] = v
	}
	return out
}

// NotifyCounts は朝の通知(F11-2)用の件数を返す:
// 期限切れ/今日期限のタスク数、催促候補数、要回答数。
func (s *Store) NotifyCounts(now time.Time) (due, nudge, answer int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	settings, _ := s.data["settings"].(map[string]any)
	custom := map[string]bool{}
	if arr, ok := settings["customHolidays"].([]any); ok {
		for _, v := range arr {
			if d, ok := v.(string); ok {
				custom[d] = true
			}
		}
	}
	waitN := toInt(settings["waitAlertBizDays"])
	if waitN <= 0 {
		waitN = 5
	}
	askN := toInt(settings["askedAlertBizDays"])
	if askN <= 0 {
		askN = 3
	}
	holdN := toInt(settings["holdAlertBizDays"])
	if holdN <= 0 {
		holdN = 5
	}
	today := now.Format("2006-01-02")

	archived := map[string]bool{}
	for _, v := range s.col("projects") {
		if p, ok := v.(map[string]any); ok {
			if a, _ := p["archived"].(bool); a {
				archived[p["id"].(string)] = true
			}
		}
	}

	for _, v := range s.col("tasks") {
		t, ok := v.(map[string]any)
		if !ok {
			continue
		}
		status, _ := t["status"].(string)
		if status == "done" {
			continue
		}
		if pid, _ := t["projectId"].(string); archived[pid] {
			continue
		}
		if d, _ := t["due"].(string); d != "" && d <= today {
			due++
		}
		if status == "waiting" {
			base, _ := t["waitSince"].(string)
			if nudges, ok := t["nudges"].([]any); ok {
				for _, n := range nudges {
					if nd, ok := n.(string); ok && nd > base {
						base = nd
					}
				}
			}
			hope, _ := t["replyHope"].(string)
			if (hope != "" && hope < today) || (base != "" && busday.Since(base, now, custom) >= waitN) {
				nudge++
			}
		} else if asked, _ := t["isAsked"].(bool); asked {
			limit := askN
			if status == "hold" { // 判断保留の滞留(F13-4)
				limit = holdN
			}
			if a, _ := t["askedOn"].(string); a != "" && busday.Since(a, now, custom) >= limit {
				answer++
			}
		}
	}
	return due, nudge, answer
}
