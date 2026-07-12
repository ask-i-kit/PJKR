// Package startup はWindowsスタートアップへの登録(F11-4)を管理する。
// スタートアップフォルダに PJKR.lnk を作成/削除する方式。
package startup

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func shortcutPath() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return "", fmt.Errorf("APPDATA が取得できません")
	}
	return filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "PJKR.lnk"), nil
}

// Enabled はスタートアップ登録済みかを返す。
func Enabled() bool {
	p, err := shortcutPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// Enable はスタートアップにショートカットを作成する。
func Enable() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	lnk, err := shortcutPath()
	if err != nil {
		return err
	}
	// .lnk の作成にはCOMが必要なためPowerShell経由で行う。
	// パスはシングルクォートで囲み、内部のクォートは二重化してエスケープする。
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	script := fmt.Sprintf(
		"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut(%s); $s.TargetPath = %s; $s.WorkingDirectory = %s; $s.Save()",
		q(lnk), q(exe), q(filepath.Dir(exe)))
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ショートカット作成に失敗: %v: %s", err, out)
	}
	return nil
}

// Disable はスタートアップのショートカットを削除する。
func Disable() error {
	p, err := shortcutPath()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
