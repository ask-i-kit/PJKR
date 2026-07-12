package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const backupKeep = 20 // 保持する世代数(要件N5)

func (s *Store) backupDir() string { return filepath.Join(s.DataDir(), "backup") }

// startupBackup は起動時に現行ファイルの世代コピーを作る。
func (s *Store) startupBackup() error {
	s.lastBackup = time.Now().Format("2006-01-02")
	return s.BackupNow()
}

// maybeDailyBackup は日付が変わって最初の保存時に世代コピーを作る。
func (s *Store) maybeDailyBackup() error {
	today := time.Now().Format("2006-01-02")
	if s.lastBackup == today {
		return nil
	}
	s.lastBackup = today
	return s.BackupNow()
}

// BackupNow は data/backup/ に現行ファイルをコピーし、古い世代を削除する。
func (s *Store) BackupNow() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	dir := s.backupDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	name := fmt.Sprintf("pjkr-%s.json", time.Now().Format("20060102-150405"))
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o644); err != nil {
		return err
	}
	return s.pruneBackups()
}

func (s *Store) pruneBackups() error {
	entries, err := os.ReadDir(s.backupDir())
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names) // ファイル名に日時が入っているため辞書順=時系列
	for len(names) > backupKeep {
		if err := os.Remove(filepath.Join(s.backupDir(), names[0])); err != nil {
			return err
		}
		names = names[1:]
	}
	return nil
}
