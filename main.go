package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/getlantern/systray"

	"pjkr/internal/api"
	"pjkr/internal/icon"
	"pjkr/internal/notify"
	"pjkr/internal/store"
)

const appVersion = "0.3.0 (Phase 3)"

//go:embed all:web
var webFiles embed.FS

func main() {
	var (
		port      = flag.Int("port", 8760, "待ち受けポート(使用中なら+19まで自動探索)")
		dataDir   = flag.String("data", "", "データフォルダ(既定: exeと同じ場所のdata)")
		noBrowser = flag.Bool("nobrowser", false, "起動時にブラウザを開かない")
		noTray    = flag.Bool("notray", false, "タスクトレイに常駐しない(開発・検証用)")
	)
	flag.Parse()

	if *dataDir == "" {
		exe, err := os.Executable()
		if err != nil {
			log.Fatal(err)
		}
		*dataDir = filepath.Join(filepath.Dir(exe), "data")
	}

	st, err := store.Open(*dataDir)
	if err != nil {
		log.Fatal(err)
	}

	ln, actualPort, alreadyURL := listen(*port)
	if alreadyURL != "" { // 二重起動: 既存の画面を開いて終了(要件N10)
		fmt.Println("PJKRは既に起動しています:", alreadyURL)
		openBrowser(alreadyURL)
		return
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", actualPort)

	webFS, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatal(err)
	}
	handler := api.New(st, webFS, appVersion, url)

	// 終了時に未保存分をフラッシュ(要件N5)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	go func() {
		<-sig
		shutdown(st)
	}()

	go func() {
		if err := http.Serve(ln, handler); err != nil {
			log.Fatal(err)
		}
	}()
	notify.StartScheduler(st, url) // 朝の定時通知(F11-2)

	fmt.Printf("PJKR %s\n  URL:    %s\n  データ: %s\n", appVersion, url, *dataDir)
	if !*noBrowser {
		openBrowser(url)
	}

	if *noTray {
		fmt.Println("  終了:   Ctrl+C(またはウィンドウを閉じる)")
		select {} // サーバゴルーチンで動作継続
	}

	// タスクトレイ常駐(F11-1)。ブラウザを閉じてもサーバは動き続ける。
	systray.Run(func() {
		systray.SetIcon(icon.Data)
		systray.SetTitle("PJKR")
		systray.SetTooltip("PJKR — " + url)
		openItem := systray.AddMenuItem("開く", "ブラウザでPJKRを開く")
		systray.AddSeparator()
		quitItem := systray.AddMenuItem("終了", "PJKRを終了する")
		go func() {
			for {
				select {
				case <-openItem.ClickedCh:
					openBrowser(url)
				case <-quitItem.ClickedCh:
					systray.Quit()
				}
			}
		}()
	}, func() {
		shutdown(st)
	})
}

func shutdown(st *store.Store) {
	_ = st.Flush()
	os.Exit(0)
}

// listen は既定ポートで待ち受けを試み、使用中なら二重起動判定の上で代替ポートを探す。
func listen(prefer int) (net.Listener, int, string) {
	for p := prefer; p < prefer+20; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p)) // localhost限定(要件N7)
		if err == nil {
			return ln, p, ""
		}
		if url := pjkrRunningAt(p); url != "" {
			return nil, 0, url
		}
	}
	log.Fatalf("ポート %d〜%d がすべて使用中です", prefer, prefer+19)
	return nil, 0, ""
}

// pjkrRunningAt は指定ポートでPJKR自身が応答するか確認する。
func pjkrRunningAt(port int) string {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	resp, err := client.Get(url + "api/ping")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var body struct {
		App string `json:"app"`
	}
	if json.NewDecoder(resp.Body).Decode(&body) == nil && body.App == "pjkr" {
		return url
	}
	return ""
}

func openBrowser(url string) {
	if err := exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start(); err != nil {
		fmt.Fprintln(os.Stderr, "ブラウザを開けませんでした。手動で開いてください:", url)
	}
}
