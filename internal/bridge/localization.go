package bridge

import (
	"context"

	"cursor/internal/appdata"
	serverconfig "cursor/internal/backend/server/config"
)

var bridgeMessages = map[string]map[string]string{
	"zh-CN": {
		"adServiceNotInitialized":       "广告服务未初始化",
		"unsupportedExternalURLScheme":   "仅支持打开 http/https 地址",
		"externalURLMissingHost":         "地址缺少主机名",
		"updateManagerNotInitialized":    "更新管理器未初始化",
		"modelConfigTitle":              "模型配置",
		"addModelConfigTitle":           "新增模型配置",
		"editModelConfigTitle":          "编辑模型配置",
		"footerAuthorButton":            "作者 leookun",
		"footerAuthorDialogTitle":       "作者寄语",
		"footerAuthorDialogContent":     "本软件是纯免费软件，如果你被收费，那大概率就是被骗了。\n欢迎点击访问作者主页 https://space.bilibili.com/311706663/upload/video\n查看更多更新动态、使用分享和后续内容。",
		"footerAuthorDialogConfirmText": "访问主页",
		"footerAuthorDialogCancelText":  "关闭",
	},
	"en-US": {
		"adServiceNotInitialized":       "Ad service is not initialized",
		"unsupportedExternalURLScheme":   "Only http/https URLs are supported",
		"externalURLMissingHost":         "URL is missing a host name",
		"updateManagerNotInitialized":    "Update manager is not initialized",
		"modelConfigTitle":              "Model Settings",
		"addModelConfigTitle":           "Add Model Settings",
		"editModelConfigTitle":          "Edit Model Settings",
		"footerAuthorButton":            "Author leookun",
		"footerAuthorDialogTitle":       "Message from the author",
		"footerAuthorDialogContent":     "This software is completely free. If someone charged you for it, you were probably scammed.\nYou can visit the author's homepage at https://space.bilibili.com/311706663/upload/video\nfor more updates, usage tips, and future content.",
		"footerAuthorDialogConfirmText": "Visit Homepage",
		"footerAuthorDialogCancelText":  "Close",
	},
	"ja-JP": {
		"adServiceNotInitialized":       "広告サービスが初期化されていません",
		"unsupportedExternalURLScheme":   "http/https URL のみ開けます",
		"externalURLMissingHost":         "URL にホスト名がありません",
		"updateManagerNotInitialized":    "更新マネージャーが初期化されていません",
		"modelConfigTitle":              "モデル設定",
		"addModelConfigTitle":           "モデル設定を追加",
		"editModelConfigTitle":          "モデル設定を編集",
		"footerAuthorButton":            "作者 leookun",
		"footerAuthorDialogTitle":       "作者からのメッセージ",
		"footerAuthorDialogContent":     "このソフトウェアは完全に無料です。料金を請求された場合は、詐欺の可能性が高いです。\n作者のホームページ https://space.bilibili.com/311706663/upload/video にアクセスすると、更新情報、使い方の共有、今後のコンテンツを確認できます。",
		"footerAuthorDialogConfirmText": "ホームページを開く",
		"footerAuthorDialogCancelText":  "閉じる",
	},
}

func currentBridgeLocale() string {
	store := serverconfig.NewStore(appdata.ConfigFilePath(), appdata.LogsRootPath())
	cfg, err := store.Load(context.Background())
	if err != nil {
		return serverconfig.DefaultLocale
	}
	return serverconfig.NormalizeLocale(cfg.Locale)
}

func bridgeText(key string) string {
	return bridgeTextForLocale(currentBridgeLocale(), key)
}

func bridgeTextForLocale(locale string, key string) string {
	normalizedLocale := serverconfig.NormalizeLocale(locale)
	if messages, ok := bridgeMessages[normalizedLocale]; ok {
		if value := messages[key]; value != "" {
			return value
		}
	}
	if messages, ok := bridgeMessages[serverconfig.DefaultLocale]; ok {
		if value := messages[key]; value != "" {
			return value
		}
	}
	if messages, ok := bridgeMessages["zh-CN"]; ok {
		if value := messages[key]; value != "" {
			return value
		}
	}
	return key
}
