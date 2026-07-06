package bridge

import "github.com/pkg/browser"

const footerAuthorHomeURL = "https://space.bilibili.com/311706663/upload/video"

// FooterAuthorInfo 定义首页底部作者入口的展示信息。
type FooterAuthorInfo struct {
	ButtonText        string `json:"buttonText"`
	DialogTitle       string `json:"dialogTitle"`
	DialogContent     string `json:"dialogContent"`
	DialogConfirmText string `json:"dialogConfirmText"`
	DialogCancelText  string `json:"dialogCancelText"`
}

// GetFooterAuthorInfo 返回首页底部作者入口的展示信息。
func (s *WindowService) GetFooterAuthorInfo() FooterAuthorInfo {
	return FooterAuthorInfo{
		ButtonText:        bridgeText("footerAuthorButton"),
		DialogTitle:       bridgeText("footerAuthorDialogTitle"),
		DialogContent:     bridgeText("footerAuthorDialogContent"),
		DialogConfirmText: bridgeText("footerAuthorDialogConfirmText"),
		DialogCancelText:  bridgeText("footerAuthorDialogCancelText"),
	}
}

// OpenFooterAuthorHome 打开作者主页。
func (s *WindowService) OpenFooterAuthorHome() error {
	return browser.OpenURL(footerAuthorHomeURL)
}
