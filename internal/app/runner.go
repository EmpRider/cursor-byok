package app

import (
	"context"
	"io/fs"
	"net"
	goruntime "runtime"
	"strings"
	"time"

	"cursor/internal/ads"
	"cursor/internal/appdata"
	serverconfig "cursor/internal/backend/server/config"
	"cursor/internal/buildinfo"
	"cursor/internal/cursor"
	"cursor/internal/historymetrics"

	"github.com/leaanthony/u"

	bridge "cursor/internal/bridge"
	"cursor/internal/certs"
	"cursor/internal/logger"
	"cursor/internal/mitm"
	"cursor/internal/netproxy"
	"cursor/internal/updater"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	appName = "Cursor助手"
	adRefreshInterval = 3 * time.Minute
)

type EmbeddedResources struct {
	Assets fs.FS
	AppIcon []byte
	TrayIcon []byte
}

func init() {
	application.RegisterEvent[bridge.ProxyState]("proxy:state")
	application.RegisterEvent[bridge.UserConfig]("user-config:changed")
	application.RegisterEvent[bridge.ModelAdapterTestResultsPayload]("model-adapter-test:updated")
	application.RegisterEvent[bridge.AdRuntime](ads.EventUpdated)
	application.RegisterEvent[updater.StatePayload](updater.EventState)
	application.RegisterEvent[updater.ProgressPayload](updater.EventProgress)
	application.RegisterEvent[updater.ReadyPayload](updater.EventReady)
	application.RegisterEvent[updater.ErrorPayload](updater.EventError)
}

func Run(resources EmbeddedResources) error {
	logger.Init()
	netproxy.InstallDefaultTransport()

	embeddedCACertPEM := certs.EmbeddedCACertPEM()
	certManager, err := certs.NewEmbeddedManager()
	if err != nil {
		return err
	}

	defaultBackendBaseURL := "http://" + serverconfig.DefaultBackendListenAddr
	proxyServer, err := mitm.NewProxyServer(serverconfig.DefaultProxyListenAddr, defaultBackendBaseURL, "", "", certManager)
	if err != nil {
		return err
	}
	proxyService := bridge.NewProxyService(proxyServer, certManager, embeddedCACertPEM)
	adAssetBaseURL := defaultBackendBaseURL
	if cfg, err := proxyService.LoadUserConfig(); err == nil {
		adAssetBaseURL = browserReachableLoopbackBaseURL(cfg.BackendListenAddr)
	}
	metricsService := bridge.NewMetricsService()
	windowService := bridge.NewWindowService()
	adCore := ads.NewService(ads.Options{
		StoreRoot:    appdata.AdsRootPath(),
		HTTPClient:   netproxy.NewHTTPClient(30 * time.Second),
		AppVersion:   buildinfo.CurrentVersion(),
		AssetBaseURL: adAssetBaseURL + ads.RoutePrefix,
		DeviceID:     cursor.GetDeviceID,
		Metrics: func(context.Context) (ads.MetricsSnapshot, error) {
			if err := appdata.EnsureAssistantHome(); err != nil {
				return ads.MetricsSnapshot{}, err
			}
			summary, err := historymetrics.LoadUsageSummary(appdata.UsageFilePath())
			if err != nil {
				return ads.MetricsSnapshot{}, err
			}
			return ads.MetricsSnapshot{
				TurnsTotal:         summary.TurnsTotal,
				RequestTokensTotal: summary.RequestTokensTotal,
				PromptTokensTotal:  summary.PromptTokensTotal,
				CacheReadTokens:    summary.CacheReadTokens,
				CacheWriteTokens:   summary.CacheWriteTokens,
			}, nil
		},
		ProviderCount: func(context.Context) (int, error) {
			cfg, err := proxyService.LoadUserConfig()
			if err != nil {
				return 0, err
			}
			return len(cfg.ModelAdapters), nil
		},
	})
	adService := bridge.NewAdService(adCore)
	var updateManager *updater.Manager

	var mainWindow *application.WebviewWindow
	adRefreshCtx, stopAdRefresh := context.WithCancel(context.Background())

	app := application.New(application.Options{
		Name:        appName,
		Description: appName,
		Services: []application.Service{
			application.NewService(proxyService),
			application.NewService(metricsService),
			application.NewService(windowService),
			application.NewService(adService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(resources.Assets),
		},
		Mac: application.MacOptions{
			ActivationPolicy: application.ActivationPolicyAccessory,
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		OnShutdown: func() {
			stopAdRefresh()
			if updateManager != nil {
				updateManager.Shutdown()
			}
			proxyService.ShutdownForQuit()
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.cursor-assistant.single-instance",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				logger.Infof("检测到实例请求，已忽略")
			}
		},
	})

	refreshAdAssetBaseURL := func() bool {
		state := proxyService.GetState()
		backendListenAddr := strings.TrimSpace(state.BackendListenAddr)
		if backendListenAddr == "" {
			backendListenAddr = serverconfig.DefaultBackendListenAddr
		}
		return adCore.SetAssetBaseURL(browserReachableLoopbackBaseURL(backendListenAddr) + ads.RoutePrefix)
	}
	refreshAdRuntime := func() {
		runtimeState, err := adCore.GetRuntime(context.Background())
		if err != nil {
			return
		}
		app.Event.Emit(ads.EventUpdated, runtimeState)
	}
	refreshAd := func(ctx context.Context) {
		if ctx == nil {
			ctx = context.Background()
		}
		runtimeState, changed, err := adCore.Refresh(ctx)
		if err != nil || !changed {
			return
		}
		app.Event.Emit(ads.EventUpdated, runtimeState)
	}
	refreshAdAsync := func() {
		go func() {
			refreshAd(context.Background())
		}()
	}
	startAdRefreshLoop := func(ctx context.Context) {
		go func() {
			refreshAd(ctx)
			ticker := time.NewTicker(adRefreshInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					refreshAd(ctx)
				}
			}
		}()
	}

	updateManager = updater.NewManager(app)
	windowService.SetApp(app)
	windowService.SetUpdater(updateManager)

	mainWindow = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:               appName,
		Width:               700,
		Height:              520,
		MinWidth:            640,
		MinHeight:           480,
		DisableResize:       false,
		Frameless:           goruntime.GOOS == "windows",
		URL:                 "/",
		Hidden:              false,
		HideOnEscape:        false,
		MinimiseButtonState: application.ButtonEnabled,
		MaximiseButtonState: application.ButtonHidden,
		CloseButtonState:    application.ButtonEnabled,
		BackgroundColour:    application.RGBA{Red: 25, Green: 25, Blue: 25, Alpha: 255},
		Mac: application.MacWindow{
			Backdrop:      application.MacBackdropLiquidGlass,
			DisableShadow: false,
			TitleBar: application.MacTitleBar{
				AppearsTransparent:   true,
				Hide:                 false,
				HideTitle:            true,
				FullSizeContent:      true,
				UseToolbar:           false,
				HideToolbarSeparator: true,
			},
			WebviewPreferences: application.MacWebviewPreferences{
				FullscreenEnabled:                   u.True,
				TextInteractionEnabled:              u.True,
				AllowsBackForwardNavigationGestures: u.False,
			},
		},
		Windows: application.WindowsWindow{HiddenOnTaskbar: false},
	})

	window := mainWindow
	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		window.Hide()
		e.Cancel()
	})
	window.RegisterHook(events.Common.WindowFocus, func(e *application.WindowEvent) { refreshAdAsync() })

	showMainWindow := func() { window.Show().Focus() }
	toggleMainWindow := func() {
		if window.IsVisible() {
			window.Hide()
			return
		}
		showMainWindow()
	}

	labels := currentTrayMenuText(proxyService)
	systray := app.SystemTray.New()
	menu := app.Menu.New()
	statusItem := menu.Add(labels.statusStopped).SetEnabled(false)
	menu.AddSeparator()
	startItem := menu.Add(labels.startService)
	stopItem := menu.Add(labels.stopService)
	checkUpdateItem := menu.Add(labels.checkUpdates)
	checkUpdateItem.OnClick(func(ctx *application.Context) { updateManager.CheckNow(true) })
	menu.AddSeparator()
	showWindowItem := menu.Add(labels.showWindow)
	showWindowItem.OnClick(func(ctx *application.Context) { showMainWindow() })
	hideWindowItem := menu.Add(labels.hideWindow)
	hideWindowItem.OnClick(func(ctx *application.Context) { window.Hide() })
	menu.AddSeparator()
	quitItem := menu.Add(labels.quit)
	quitItem.OnClick(func(ctx *application.Context) {
		proxyService.ShutdownForQuit()
		app.Quit()
	})

	refreshTray := func() {
		labels := currentTrayMenuText(proxyService)
		startItem.SetLabel(labels.startService)
		stopItem.SetLabel(labels.stopService)
		checkUpdateItem.SetLabel(labels.checkUpdates)
		showWindowItem.SetLabel(labels.showWindow)
		hideWindowItem.SetLabel(labels.hideWindow)
		quitItem.SetLabel(labels.quit)
		state := proxyService.GetState()
		if state.Running {
			statusItem.SetLabel(labels.statusRunning)
			startItem.SetEnabled(false)
			stopItem.SetEnabled(true)
		} else {
			statusItem.SetLabel(labels.statusStopped)
			startItem.SetEnabled(true)
			stopItem.SetEnabled(false)
		}
		systray.SetTooltip(labels.tooltip)
		if refreshAdAssetBaseURL() { refreshAdRuntime() }
	}
	app.Event.On("proxy:state", func(event *application.CustomEvent) { refreshTray() })
	app.Event.On("user-config:changed", func(event *application.CustomEvent) { refreshTray() })
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(event *application.ApplicationEvent) {
		logger.Infof("应用版本：v%s", buildinfo.CurrentVersion())
		updateManager.Start()
		startAdRefreshLoop(adRefreshCtx)
		go func() {
			logger.Infof("application started, begin auto start service in background")
			if _, err := proxyService.StartProxy(); err != nil {
				logger.Errorf("自动启动服务失败: %v", err)
			} else {
				state := proxyService.GetState()
				if refreshAdAssetBaseURL() { refreshAdRuntime() }
				logger.Infof("代理已自动启动: %s", state.ProxyListenAddr)
			}
		}()
	})

	startItem.OnClick(func(ctx *application.Context) {
		if _, err := proxyService.StartProxy(); err != nil {
			logger.Errorf("启动服务失败: %v", err)
		} else if refreshAdAssetBaseURL() {
			refreshAdRuntime()
		}
		refreshTray()
	})
	stopItem.OnClick(func(ctx *application.Context) {
		if _, err := proxyService.StopProxy(); err != nil { logger.Errorf("停止服务失败: %v", err) }
		refreshTray()
	})

	if len(resources.AppIcon) > 0 {
		switch goruntime.GOOS {
		case "darwin":
			systray.SetTemplateIcon(resources.TrayIcon)
		case "windows":
			systray.SetIcon(resources.AppIcon)
		default:
			systray.SetIcon(resources.TrayIcon)
		}
	}
	systray.SetTooltip(labels.tooltip)
	systray.OnClick(toggleMainWindow).SetMenu(menu)
	refreshTray()

	return app.Run()
}

func browserReachableLoopbackBaseURL(listenAddr string) string {
	host, port, err := net.SplitHostPort(strings.TrimSpace(listenAddr))
	if err != nil || strings.TrimSpace(port) == "" {
		return "http://" + serverconfig.DefaultBackendListenAddr
	}
	host = strings.TrimSpace(host)
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}
