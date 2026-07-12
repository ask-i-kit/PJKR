package store

// EntityDef は汎用CRUDで扱うコレクションの定義。
type EntityDef struct {
	Key    string // JSONキー兼URLセグメント(例 "tasks")
	Prefix string // IDの接頭辞(例 "t" → t42)
}

// Entities は pjkr.json のトップレベルコレクション一覧(要件定義書§7)。
// milestones以降はPhase 2以降で使用するが、スキーマとして最初から確保する。
var Entities = []EntityDef{
	{"projects", "p"},
	{"tasks", "t"},
	{"inbox", "i"},
	{"notes", "n"},
	{"contacts", "c"},
	{"milestones", "m"},
	{"issues", "q"},
	{"risks", "r"},
	{"reports", "w"},
}

// EntityByKey はURLセグメントからエンティティ定義を引く。
func EntityByKey(key string) (EntityDef, bool) {
	for _, e := range Entities {
		if e.Key == key {
			return e, true
		}
	}
	return EntityDef{}, false
}

func defaultSettings() map[string]any {
	return map[string]any{
		"waitAlertBizDays":  5,       // 返答待ち→催促候補(営業日) [P2]
		"askedAlertBizDays": 3,       // 被依頼→要回答(営業日) [P2]
		"holdAlertBizDays":  5,       // 判断保留→滞留警告(営業日) [P2]
		"notifyTime":        "09:00", // 朝の通知時刻 [P2]
		"notifyEnabled":     true,    // [P2]
		"customHolidays":    []any{}, // 会社独自の休日 [P2]
	}
}

func defaultData() map[string]any {
	m := map[string]any{
		"version":  1,
		"counters": map[string]any{},
		"settings": defaultSettings(),
	}
	for _, e := range Entities {
		m[e.Key] = []any{}
	}
	return m
}
