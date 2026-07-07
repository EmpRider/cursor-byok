package app

import (
	"strings"

	serverconfig "cursor/internal/backend/server/config"
	bridge "cursor/internal/bridge"
)

type trayMenuText struct {
	tooltip       string
	statusRunning string
	statusStopped string
	startService  string
	stopService   string
	checkUpdates  string
	showWindow    string
	hideWindow    string
	quit          string
}

func currentTrayMenuText(proxyService *bridge.ProxyService) trayMenuText {
	locale := serverconfig.DefaultLocale
	if proxyService != nil {
		if cfg, err := proxyService.LoadUserConfig(); err == nil {
			locale = cfg.Locale
		}
	}
	return trayMenuTextForLocale(locale)
}

func trayMenuTextForLocale(locale string) trayMenuText {
	switch strings.TrimSpace(locale) {
	case "zh-CN":
		return trayMenuText{
			tooltip:       appName,
			statusRunning: "状态：运行中",
			statusStopped: "状态：未启动",
			startService:  "启动服务",
			stopService:   "停止服务",
			checkUpdates:  "检查更新",
			showWindow:    "显示窗口",
			hideWindow:    "隐藏窗口",
			quit:          "退出",
		}
	case "ja-JP":
		return trayMenuText{
			tooltip:       "Cursor Assistant",
			statusRunning: "状態: 実行中",
			statusStopped: "状態: 停止中",
			startService:  "サービスを開始",
			stopService:   "サービスを停止",
			checkUpdates:  "アップデートを確認",
			showWindow:    "ウィンドウを表示",
			hideWindow:    "ウィンドウを非表示",
			quit:          "終了",
		}
	default:
		return trayMenuText{
			tooltip:       "Cursor Assistant",
			statusRunning: "Status: Running",
			statusStopped: "Status: Stopped",
			startService:  "Start Service",
			stopService:   "Stop Service",
			checkUpdates:  "Check for Updates",
			showWindow:    "Show Window",
			hideWindow:    "Hide Window",
			quit:          "Quit",
		}
	}
}
