// Package notify はWindowsトースト通知と朝の定時通知スケジューラを提供する(F11)。
package notify

import (
	"fmt"
	"strings"
	"time"

	"github.com/go-toast/toast"

	"pjkr/internal/store"
)

// Toast はトースト通知を表示する。clickURL を指定するとクリックでブラウザが開く(F11-3)。
func Toast(title, message, clickURL string) error {
	n := toast.Notification{
		AppID:   "PJKR",
		Title:   title,
		Message: message,
	}
	if clickURL != "" {
		n.ActivationType = "protocol"
		n.ActivationArguments = clickURL
	}
	return n.Push()
}

// MorningMessage は現時点の件数から通知本文を作る。0件ならすべて空を返す。
func MorningMessage(st *store.Store, now time.Time) (title, msg string) {
	due, nudge, answer := st.NotifyCounts(now)
	if due+nudge+answer == 0 {
		return "", ""
	}
	var parts []string
	if due > 0 {
		parts = append(parts, fmt.Sprintf("期限切れ・今日期限 %d件", due))
	}
	if nudge > 0 {
		parts = append(parts, fmt.Sprintf("催促候補 %d件", nudge))
	}
	if answer > 0 {
		parts = append(parts, fmt.Sprintf("要回答 %d件", answer))
	}
	return "PJKR 今日の確認", strings.Join(parts, " / ")
}

// StartScheduler は毎朝定時(settings.notifyTime)の通知を行うゴルーチンを起動する(F11-2)。
func StartScheduler(st *store.Store, appURL string) {
	go func() {
		lastSent := ""
		for {
			time.Sleep(30 * time.Second)
			settings := st.Settings()
			if enabled, _ := settings["notifyEnabled"].(bool); !enabled {
				continue
			}
			at, _ := settings["notifyTime"].(string)
			if at == "" {
				at = "09:00"
			}
			now := time.Now()
			today := now.Format("2006-01-02")
			if lastSent == today || now.Format("15:04") < at {
				continue
			}
			lastSent = today
			if title, msg := MorningMessage(st, now); title != "" {
				_ = Toast(title, msg, appURL)
			}
		}
	}()
}
