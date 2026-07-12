package store

// currentVersion はデータ構造のバージョン(要件N13)。
// 構造を変える際は migrations に v(n)→v(n+1) の関数を追加する。
const currentVersion = 1

var migrations = map[int]func(map[string]any){
	// 例: 1: func(d map[string]any) { ... v1→v2 の変換 ... },
}

func (s *Store) migrate() error {
	v := toInt(s.data["version"])
	if v == 0 {
		v = 1
		s.data["version"] = 1
	}
	if v >= currentVersion {
		return nil
	}
	// 移行前バックアップ(起動時バックアップ済みだが念のため)
	if err := s.BackupNow(); err != nil {
		return err
	}
	for ; v < currentVersion; v++ {
		if fn := migrations[v]; fn != nil {
			fn(s.data)
		}
		s.data["version"] = v + 1
	}
	return s.writeFile()
}
