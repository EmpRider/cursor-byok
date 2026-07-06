import { computed, reactive, watchSyncEffect } from "vue";
import { Events } from "@wailsio/runtime";
import dayjs from "dayjs";
import {
  checkForUpdates,
  getAppVersion,
  getHomeMetricsSummary,
  getModelAdapterTestResults,
  installReadyUpdate,
  getProxyState,
  openConfigWindow as openConfig,
  loadUserConfig,
  openLogsDirectory,
  openModelConfig,
  openModelEditor,
  saveUserConfig,
  startProxyService,
  stopProxyService,
  testModelAdapter,
} from "@/services/clientApi";

const APP_STATE_STORAGE_KEY = "cursor-client:runtime-state:v2";
const GENERIC_SERVICE_ERROR = "服务错误";
const SUPPORTED_MODEL_ADAPTER_TYPES = new Set(["openai", "anthropic"]);
const SUPPORTED_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const SUPPORTED_ANTHROPIC_THINKING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
export const ANTHROPIC_THINKING_EFFORT_DEFAULT = "xhigh";
export const OPENAI_ENDPOINT_RESPONSES = "/v1/responses";
export const OPENAI_ENDPOINT_CHAT_COMPLETIONS = "/v1/chat/completions";
export const OPENAI_EXTRA_PARAMS_DEFAULT_JSON = `{
  "service_tier": "priority"
}`;
export const EXTRA_PARAMS_DEFAULT_JSON = `{
}`;
export const CUSTOM_HEADERS_DEFAULT_JSON = `{
}`;
const SUPPORTED_OPENAI_ENDPOINTS = new Set([OPENAI_ENDPOINT_RESPONSES, OPENAI_ENDPOINT_CHAT_COMPLETIONS]);
const SUPPORTED_ROUTE_MODES = new Set(["local", "upstream"]);
const PROXY_STATE_EVENT = "proxy:state";
const USER_CONFIG_CHANGED_EVENT = "user-config:changed";
const UPDATE_STATE_EVENT = "update:state";
const UPDATE_PROGRESS_EVENT = "update:progress";
const UPDATE_READY_EVENT = "update:ready";
const UPDATE_ERROR_EVENT = "update:error";
const MODEL_ADAPTER_TEST_UPDATED_EVENT = "model-adapter-test:updated";
const SUPPORTED_MODEL_ADAPTER_TEST_STATUSES = new Set(["idle", "running", "success", "error"]);
const HOME_METRICS_MIN_LOADING_MS = 600;

export const ROUTE_MODE_OPTIONS = [
  { label: "本地服务模式", value: "local" },
  { label: "直连 Cursor 模式", value: "upstream" },
];

function asString(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value instanceof String) {
    return value.toString().trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = asString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asPositiveIntegerString(value) {
  const text = asString(value);
  if (!text) {
    return "";
  }
  if (!/^\d+$/.test(text)) {
    return "";
  }
  return Number(text) > 0 ? text : "";
}

function asPositiveInteger(value) {
  const text = asPositiveIntegerString(value);
  if (!text) {
    return 0;
  }
  return Number(text);
}

function asNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = asString(value);
  if (!text) {
    return fallback;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatReleaseDate(value) {
  const text = asString(value);
  if (!text) {
    return "未知";
  }
  const parsed = dayjs(text);
  if (!parsed.isValid()) {
    return text;
  }
  return parsed.format("YYYY-MM-DD HH:mm");
}

function normalizeRouteMode(value, fallback = "local") {
  const text = asString(value).toLowerCase();
  if (SUPPORTED_ROUTE_MODES.has(text)) {
    return text;
  }
  return fallback;
}

function normalizeBaseURL(value) {
  const text = asString(value);
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    const normalized = parsed.toString().replace(/\/+$/, "");
    return normalized || parsed.toString();
  } catch (_error) {
    return text;
  }
}

function buildModelAdapterIdentityKey(adapter) {
  return [
    normalizeBaseURL(adapter.baseURL),
    asString(adapter.modelID),
    asString(adapter.apiKey),
    asString(adapter.displayName),
    adapter.type === "openai" ? normalizeOpenAIEndpoint(adapter.openAIEndpoint) : "",
  ].join("\n");
}

function hashStringFNV32a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function buildModelAdapterTestRequestHash(source) {
  const adapter = normalizeModelAdapter(source);
  return hashStringFNV32a([
    asString(adapter.type),
    normalizeBaseURL(adapter.baseURL),
    asString(adapter.apiKey),
    asString(adapter.modelID),
    adapter.type === "openai" ? asString(adapter.reasoningEffort || "medium") : "",
    adapter.type === "openai" ? normalizeOpenAIEndpoint(adapter.openAIEndpoint) : "",
    adapter.type === "openai" ? String(Boolean(adapter.openAIExtraParamsEnabled)) : "false",
    adapter.type === "openai" && adapter.openAIExtraParamsEnabled ? asString(adapter.openAIExtraParamsJSON) : "",
    String(Boolean(adapter.customHeadersEnabled)),
    adapter.customHeadersEnabled ? asString(adapter.customHeadersJSON) : "",
    adapter.type === "anthropic" ? String(Boolean(adapter.anthropicExtraParamsEnabled)) : "false",
    adapter.type === "anthropic" && adapter.anthropicExtraParamsEnabled ? asString(adapter.anthropicExtraParamsJSON) : "",
    String(asPositiveInteger(adapter.contextWindowTokens)),
    String(asPositiveInteger(adapter.maxCompletionTokens)),
    String(asPositiveInteger(adapter.anthropicMaxTokens)),
    adapter.type === "anthropic" ? asString(adapter.anthropicThinkingEffort || ANTHROPIC_THINKING_EFFORT_DEFAULT) : "",
  ].join("\n"));
}

export function formatDuration(value) {
  const durationMS = Math.max(0, Math.round(asNumber(value)));
  if (durationMS < 1000) {
    return `${durationMS} ms`;
  }
  return `${(durationMS / 1000).toFixed(1)} s`;
}

function normalizeModelAdapterTestStatus(value) {
  const text = asString(value).toLowerCase();
  return SUPPORTED_MODEL_ADAPTER_TEST_STATUSES.has(text) ? text : "idle";
}

export function formatModelAdapterTestSummary(source) {
  const result = source && typeof source === "object" ? source : {};
  const status = normalizeModelAdapterTestStatus(result.status);
  if (status === "running") {
    return "Testing...";
  }
  if (status === "error") {
    return asString(result.error) || "Model test failed";
  }
  if (status !== "success") {
    return "";
  }
  const roundedTPS = Math.max(0, Math.round(asNumber(result.tokensPerSecond)));
  return `${roundedTPS} t/s | First token ${formatDuration(result.firstTextTokenMS)}`;
}

function normalizeModelAdapterTestResult(source) {
  const raw = source && typeof source === "object" ? source : {};
  const status = normalizeModelAdapterTestStatus(raw.status);
  const normalized = {
    adapterID: asString(raw.adapterID),
    requestHash: asString(raw.requestHash),
    status,
    tokensPerSecond: Math.max(0, asNumber(raw.tokensPerSecond)),
    firstTextTokenMS: Math.max(0, Math.round(asNumber(raw.firstTextTokenMS))),
    totalDurationMS: Math.max(0, Math.round(asNumber(raw.totalDurationMS))),
    outputTokens: Math.max(0, Math.round(asNumber(raw.outputTokens))),
    tokensEstimated: asBoolean(raw.tokensEstimated),
    summaryText: status === "error" ? asString(raw.summaryText) : "",
    error: asString(raw.error),
    rawResponse: asString(raw.rawResponse),
    testedAt: asString(raw.testedAt),
  };
  if (status === "error" && !normalized.summaryText) {
    normalized.summaryText = normalized.error || "Model test failed";
  }
  return normalized;
}

function normalizeModelAdapterTestResults(source) {
  const raw = source && typeof source === "object" && !Array.isArray(source)
    ? source.results
    : source;
  return asArray(raw)
    .map((item) => normalizeModelAdapterTestResult(item))
    .filter((item) => item.adapterID);
}

export function createEmptyModelAdapter() {
  return {
    id: "",
    displayName: "",
    type: "openai",
    baseURL: "",
    apiKey: "",
    tooltipData: "备注",
    modelID: "",
    reasoningEffort: "medium",
    openAIEndpoint: OPENAI_ENDPOINT_RESPONSES,
    openAIExtraParamsEnabled: false,
    openAIExtraParamsJSON: OPENAI_EXTRA_PARAMS_DEFAULT_JSON,
    customHeadersEnabled: false,
    customHeadersJSON: CUSTOM_HEADERS_DEFAULT_JSON,
    anthropicExtraParamsEnabled: false,
    anthropicExtraParamsJSON: EXTRA_PARAMS_DEFAULT_JSON,
    contextWindowTokens: 0,
    maxCompletionTokens: 0,
    anthropicMaxTokens: 0,
    anthropicThinkingEffort: ANTHROPIC_THINKING_EFFORT_DEFAULT,
    thinkingBudgetTokens: 0,
  };
}

function normalizeOpenAIEndpoint(value) {
  const text = asString(value).toLowerCase();
  if (!text) {
    return OPENAI_ENDPOINT_RESPONSES;
  }
  return SUPPORTED_OPENAI_ENDPOINTS.has(text) ? text : "";
}

function validateJSONObject(value, label) {
  const text = asString(value);
  if (!text) {
    return `${label}不能为空`;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `${label}必须是 JSON 对象`;
    }
  } catch (_error) {
    return `${label}必须是合法 JSON 对象`;
  }
  return "";
}

function validateHeadersJSON(value) {
  const objectError = validateJSONObject(value, "自定义请求头 JSON");
  if (objectError) {
    return objectError;
  }
  const parsed = JSON.parse(asString(value));
  for (const [key, item] of Object.entries(parsed)) {
    if (!asString(key)) {
      return "自定义请求头名称不能为空";
    }
    if (typeof item !== "string") {
      return `自定义请求头 ${key} 的值必须是字符串`;
    }
  }
  return "";
}

function validateOpenAIExtraParamsJSON(value) {
  return validateJSONObject(value, "额外参数 JSON");
}

function validateAnthropicExtraParamsJSON(value) {
  return validateJSONObject(value, "Anthropic 额外参数 JSON");
}

export function normalizeModelAdapter(source) {
  const raw = source && typeof source === "object" ? source : {};
  const normalizedType = asString(raw.type).toLowerCase();
  const normalizedReasoningEffort = asString(raw.reasoningEffort || raw.reasoning_effort).toLowerCase();
  const normalizedAnthropicThinkingEffort = asString(
    raw.anthropicThinkingEffort
      ?? raw.anthropic_thinking_effort
      ?? raw.outputConfigEffort
      ?? raw.output_config_effort,
  ).toLowerCase();
  const normalizedOpenAIEndpoint = normalizeOpenAIEndpoint(
    raw.openAIEndpoint ?? raw.openaiEndpoint ?? raw.open_ai_endpoint ?? raw.endpoint,
  );
  const openAIExtraParamsEnabled = normalizedType === "openai"
    ? asBoolean(raw.openAIExtraParamsEnabled ?? raw.openaiExtraParamsEnabled ?? raw.open_ai_extra_params_enabled)
    : false;
  const openAIExtraParamsJSON = normalizedType === "openai"
    ? asString(raw.openAIExtraParamsJSON ?? raw.openaiExtraParamsJSON ?? raw.open_ai_extra_params_json) || OPENAI_EXTRA_PARAMS_DEFAULT_JSON
    : "";
  const customHeadersEnabled = asBoolean(raw.customHeadersEnabled ?? raw.custom_headers_enabled);
  const customHeadersJSON = asString(raw.customHeadersJSON ?? raw.custom_headers_json) || CUSTOM_HEADERS_DEFAULT_JSON;
  const anthropicExtraParamsEnabled = normalizedType === "anthropic"
    ? asBoolean(raw.anthropicExtraParamsEnabled ?? raw.anthropic_extra_params_enabled)
    : false;
  const anthropicExtraParamsJSON = normalizedType === "anthropic"
    ? asString(raw.anthropicExtraParamsJSON ?? raw.anthropic_extra_params_json) || EXTRA_PARAMS_DEFAULT_JSON
    : "";
  return {
    id: asString(raw.id),
    displayName: asString(raw.displayName || raw.name),
    type: SUPPORTED_MODEL_ADAPTER_TYPES.has(normalizedType) ? normalizedType : "",
    baseURL: normalizeBaseURL(raw.baseURL || raw.url),
    apiKey: asString(raw.apiKey || raw.key),
    tooltipData: asString(raw.tooltipData),
    modelID: asString(raw.modelID),
    reasoningEffort: SUPPORTED_REASONING_EFFORTS.has(normalizedReasoningEffort)
      ? normalizedReasoningEffort
      : "medium",
    openAIEndpoint: normalizedType === "openai" ? normalizedOpenAIEndpoint : "",
    openAIExtraParamsEnabled,
    openAIExtraParamsJSON,
    customHeadersEnabled,
    customHeadersJSON,
    anthropicExtraParamsEnabled,
    anthropicExtraParamsJSON,
    contextWindowTokens: asPositiveInteger(
      raw.contextWindowTokens ?? raw.context_window_tokens ?? raw.maxInputTokens ?? raw.max_input_tokens,
    ),
    maxCompletionTokens: asPositiveInteger(
      raw.maxCompletionTokens ?? raw.max_completion_tokens ?? raw.max_tokens ?? raw.max_token,
    ),
    anthropicMaxTokens: asPositiveInteger(
      raw.anthropicMaxTokens ?? raw.anthropic_max_tokens ?? raw.max_tokens,
    ),
    anthropicThinkingEffort: normalizedType === "anthropic"
      ? (SUPPORTED_ANTHROPIC_THINKING_EFFORTS.has(normalizedAnthropicThinkingEffort)
        ? normalizedAnthropicThinkingEffort
        : ANTHROPIC_THINKING_EFFORT_DEFAULT)
      : "",
    thinkingBudgetTokens: asPositiveInteger(
      raw.thinkingBudgetTokens ?? raw.thinking_budget_tokens,
    ),
  };
}

export function normalizeModelAdapters(source) {
  return asArray(source).map((item) => normalizeModelAdapter(item));
}

export function validateModelAdapters(source) {
  const adapters = normalizeModelAdapters(source);
  const seenIdentityKeys = new Set();
  for (const [index, adapter] of adapters.entries()) {
    const prefix = `模型 ${index + 1}`;
    if (!adapter.displayName) {
      return `${prefix} 的显示名称不能为空`;
    }
    if (!SUPPORTED_MODEL_ADAPTER_TYPES.has(adapter.type)) {
      return `${prefix} 的类型仅支持 OpenAI 或 Anthropic`;
    }
    if (!adapter.baseURL) {
      return `${prefix} 的接口地址不能为空`;
    }
    if (!adapter.apiKey) {
      return `${prefix} 的访问密钥不能为空`;
    }
    if (!adapter.tooltipData) {
      return `${prefix} 的悬停提示不能为空`;
    }
    if (!adapter.modelID) {
      return `${prefix} 的模型标识不能为空`;
    }
    if (adapter.type === "openai" && !SUPPORTED_REASONING_EFFORTS.has(adapter.reasoningEffort)) {
      return `${prefix} 的推理强度仅支持 low、medium、high、xhigh`;
    }
    if (adapter.type === "openai" && !SUPPORTED_OPENAI_ENDPOINTS.has(adapter.openAIEndpoint)) {
      return `${prefix} 的 OpenAI 端点仅支持 /v1/responses 或 /v1/chat/completions`;
    }
    if (adapter.type === "openai" && adapter.openAIExtraParamsEnabled) {
      const error = validateOpenAIExtraParamsJSON(adapter.openAIExtraParamsJSON);
      if (error) {
        return `${prefix} ${error}`;
      }
    }
    if (adapter.customHeadersEnabled) {
      const error = validateHeadersJSON(adapter.customHeadersJSON);
      if (error) {
        return `${prefix} ${error}`;
      }
    }
    if (adapter.type === "anthropic" && adapter.anthropicExtraParamsEnabled) {
      const error = validateAnthropicExtraParamsJSON(adapter.anthropicExtraParamsJSON);
      if (error) {
        return `${prefix} ${error}`;
      }
    }
    if (adapter.type === "anthropic" && !SUPPORTED_ANTHROPIC_THINKING_EFFORTS.has(adapter.anthropicThinkingEffort)) {
      return `${prefix} 的 Anthropic 思考强度仅支持 low、medium、high、xhigh、max`;
    }
    const identityKey = buildModelAdapterIdentityKey(adapter);
    if (seenIdentityKeys.has(identityKey)) {
      return "模型渠道重复，请检查 url、modelID、apiKey、displayName 组合";
    }
    seenIdentityKeys.add(identityKey);
  }
  return "";
}

function adaptersEqual(left, right) {
  return JSON.stringify(normalizeModelAdapters(left)) === JSON.stringify(normalizeModelAdapters(right));
}

function cloneConfig(config) {
  return {
    ...config,
    modelAdapters: normalizeModelAdapters(config?.modelAdapters),
    routing: {
      ...(config?.routing && typeof config.routing === "object" ? config.routing : {}),
    },
    homeMetrics: {
      ...(config?.homeMetrics && typeof config.homeMetrics === "object" ? config.homeMetrics : {}),
    },
  };
}

function loadPersistedRuntimeState() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(APP_STATE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

export const appState = reactive({
  bootstrapped: false,
  bootstrapping: false,
  backendReady: false,
  serviceRunning: false,
  serviceStarting: false,
  serviceStopping: false,
  configSaving: false,
  configLoadError: "",
  configSaveError: "",
  configSaveSuccess: false,
  configData: null,
  modelAdapters: [],
  routingMode: "local",
  homeMetrics: {
    includeCacheWriteInHitRate: false,
  },
  proxyState: {
    proxyURL: "",
    proxyHost: "",
    proxyPort: 0,
    backendURL: "",
    backendPort: 0,
    running: false,
    starting: false,
    stopping: false,
    lastError: "",
  },
  proxyStateLoading: false,
  modeSwitchBusy: false,
  modelAdapterTestResults: [],
  modelAdapterTestingIDs: new Set(),
  configPath: "",
  logsPath: "",
  configWindowOpening: false,
  updatePromptVisible: false,
  updatePromptBusy: false,
  updateState: {
    busy: false,
    downloading: false,
    ready: false,
    updateAvailable: false,
    latestVersion: "",
    currentVersion: "",
    releaseNotes: "",
    releaseDate: "",
    downloadProgress: 0,
    error: "",
  },
  footerAuthorInfo: null,
});

export const proxyViewState = {
  get lastError() {
    return appState.proxyState.lastError;
  },
  get statusLabel() {
    if (appState.serviceStarting) {
      return "启动中...";
    }
    if (appState.serviceStopping) {
      return "停止中...";
    }
    if (appState.serviceRunning) {
      return "服务运行中";
    }
    return "服务未启动";
  },
  get modeLabel() {
    return appState.routingMode === "upstream" ? "直连模式" : "本地服务模式";
  },
  get modeDescription() {
    return appState.routingMode === "upstream" ? "当前为直连模式" : "当前为本地服务模式";
  },
  get toggleModeLabel() {
    return appState.routingMode === "upstream" ? "本地服务模式" : "直连 Cursor 模式";
  },
  get toggleModeDescription() {
    return appState.routingMode === "upstream"
      ? "控制白名单主链路请求走本地服务，还是回到原始 Cursor 上游地址"
      : "开启后，Cursor将直接接通官方，请勿开启";
  },
};

export const configViewState = {
  get routeModeOptions() {
    return ROUTE_MODE_OPTIONS;
  },
  get adapterCount() {
    return appState.modelAdapters.length;
  },
};

export const updateViewState = {
  get footerBusy() {
    return appState.updateState.busy;
  },
  get footerDownloading() {
    return appState.updateState.downloading;
  },
  get footerVersionLabel() {
    return appState.updateState.currentVersion
      ? `版本：v${appState.updateState.currentVersion}`
      : "版本：v0.0.0";
  },
  get footerProgressText() {
    return `${Math.round(appState.updateState.downloadProgress)}%`;
  },
  get footerProgressStyle() {
    return { width: `${Math.max(0, Math.min(100, appState.updateState.downloadProgress))}%` };
  },
  get promptTitle() {
    if (appState.updateState.ready) {
      return "发现新版本";
    }
    if (appState.updateState.error) {
      return "更新失败";
    }
    return "检查更新";
  },
  get promptContent() {
    if (appState.updateState.ready) {
      const notes = appState.updateState.releaseNotes || "无更新说明";
      const dateLine = appState.updateState.releaseDate
        ? `\n发布时间：${formatReleaseDate(appState.updateState.releaseDate)}`
        : "";
      return `新版本 v${appState.updateState.latestVersion} 已下载完成。${dateLine}\n\n${notes}`;
    }
    if (appState.updateState.error) {
      return appState.updateState.error;
    }
    return "检查更新中...";
  },
  get promptConfirmText() {
    if (appState.updateState.ready) {
      return "立即重启更新";
    }
    return "确定";
  },
  get promptCancelText() {
    if (appState.updateState.ready) {
      return "稍后";
    }
    return "取消";
  },
  get promptShowCancel() {
    return appState.updateState.ready;
  },
};

function persistRuntimeState() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify({
    routingMode: appState.routingMode,
    homeMetrics: appState.homeMetrics,
  }));
}

watchSyncEffect(() => {
  persistRuntimeState();
});

export function toUserError(error, fallback = GENERIC_SERVICE_ERROR) {
  if (!error) {
    return fallback;
  }
  if (typeof error === "string") {
    return error.trim() || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return String(error).trim() || fallback;
}

function applyProxyState(rawState) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  appState.proxyState.proxyURL = asString(state.proxyURL);
  appState.proxyState.proxyHost = asString(state.proxyHost);
  appState.proxyState.proxyPort = asNumber(state.proxyPort);
  appState.proxyState.backendURL = asString(state.backendURL);
  appState.proxyState.backendPort = asNumber(state.backendPort);
  appState.proxyState.running = asBoolean(state.running);
  appState.proxyState.starting = asBoolean(state.starting);
  appState.proxyState.stopping = asBoolean(state.stopping);
  appState.proxyState.lastError = asString(state.lastError);
  appState.serviceRunning = appState.proxyState.running;
  appState.serviceStarting = appState.proxyState.starting;
  appState.serviceStopping = appState.proxyState.stopping;
}

function applyUserConfig(config) {
  const cloned = cloneConfig(config);
  appState.configData = cloned;
  appState.modelAdapters = cloned.modelAdapters;
  appState.routingMode = normalizeRouteMode(cloned.routing?.mode, appState.routingMode);
  appState.homeMetrics.includeCacheWriteInHitRate = asBoolean(cloned.homeMetrics?.includeCacheWriteInHitRate);
}

function applyModelAdapterTestResults(results) {
  appState.modelAdapterTestResults = normalizeModelAdapterTestResults(results);
  appState.modelAdapterTestingIDs = new Set(
    appState.modelAdapterTestResults
      .filter((item) => item.status === "running")
      .map((item) => item.adapterID),
  );
}

function applyUpdateState(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};
  appState.updateState.busy = asBoolean(raw.busy);
  appState.updateState.downloading = asBoolean(raw.downloading);
  appState.updateState.ready = asBoolean(raw.ready);
  appState.updateState.updateAvailable = asBoolean(raw.updateAvailable);
  appState.updateState.latestVersion = asString(raw.latestVersion);
  appState.updateState.currentVersion = asString(raw.currentVersion) || appState.updateState.currentVersion;
  appState.updateState.releaseNotes = asString(raw.releaseNotes);
  appState.updateState.releaseDate = asString(raw.releaseDate);
  appState.updateState.downloadProgress = Math.max(0, Math.min(100, asNumber(raw.downloadProgress)));
  appState.updateState.error = asString(raw.error);
}

export async function reloadUserConfig(options = {}) {
  appState.configLoadError = "";
  try {
    const config = await loadUserConfig();
    if (!options.modelAdaptersOnly) {
      applyUserConfig(config);
    } else {
      appState.modelAdapters = normalizeModelAdapters(config?.modelAdapters);
    }
    return appState.configData;
  } catch (error) {
    appState.configLoadError = toUserError(error, "加载配置失败");
    return null;
  }
}

export async function reloadProxyState() {
  appState.proxyStateLoading = true;
  try {
    const state = await getProxyState();
    applyProxyState(state);
    return state;
  } finally {
    appState.proxyStateLoading = false;
  }
}

export async function reloadModelAdapterTestResults() {
  try {
    const results = await getModelAdapterTestResults();
    applyModelAdapterTestResults(results);
    return results;
  } catch (_error) {
    return [];
  }
}

export async function bootstrapAppState() {
  if (appState.bootstrapped || appState.bootstrapping) {
    return;
  }
  appState.bootstrapping = true;
  try {
    const persisted = loadPersistedRuntimeState();
    if (persisted && typeof persisted === "object") {
      appState.routingMode = normalizeRouteMode(persisted.routingMode, appState.routingMode);
      appState.homeMetrics.includeCacheWriteInHitRate = asBoolean(persisted.homeMetrics?.includeCacheWriteInHitRate);
    }
    await Promise.allSettled([
      reloadProxyState(),
      reloadUserConfig(),
      reloadModelAdapterTestResults(),
      refreshHomeMetrics(),
      refreshAppVersion(),
    ]);
  } finally {
    appState.bootstrapped = true;
    appState.bootstrapping = false;
  }
}

export async function refreshHomeMetrics() {
  appState.homeMetrics.loading = true;
  const startedAt = Date.now();
  try {
    const metrics = await getHomeMetricsSummary();
    appState.homeMetrics.summary = metrics || null;
  } catch (_error) {
    appState.homeMetrics.summary = null;
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed < HOME_METRICS_MIN_LOADING_MS) {
      await new Promise((resolve) => setTimeout(resolve, HOME_METRICS_MIN_LOADING_MS - elapsed));
    }
    appState.homeMetrics.loading = false;
  }
}

export async function refreshAppVersion() {
  try {
    const version = await getAppVersion();
    appState.updateState.currentVersion = asString(version);
  } catch (_error) {
    appState.updateState.currentVersion = "";
  }
}

export async function saveCurrentConfig(nextConfig = appState.configData) {
  appState.configSaving = true;
  appState.configSaveError = "";
  appState.configSaveSuccess = false;
  try {
    const cloned = cloneConfig(nextConfig);
    const validationError = validateModelAdapters(cloned.modelAdapters);
    if (validationError) {
      appState.configSaveError = validationError;
      return { ok: false, error: validationError };
    }
    await saveUserConfig(cloned);
    applyUserConfig(cloned);
    appState.configSaveSuccess = true;
    return { ok: true, error: "" };
  } catch (error) {
    const userError = toUserError(error, "保存失败");
    appState.configSaveError = userError;
    return { ok: false, error: userError };
  } finally {
    appState.configSaving = false;
  }
}

export async function setRoutingMode(mode) {
  const nextMode = normalizeRouteMode(mode, appState.routingMode);
  if (nextMode === appState.routingMode) {
    return { ok: true, error: "" };
  }
  const previousMode = appState.routingMode;
  appState.modeSwitchBusy = true;
  appState.routingMode = nextMode;
  try {
    const config = cloneConfig(appState.configData || {});
    config.routing.mode = nextMode;
    const result = await saveCurrentConfig(config);
    if (!result.ok) {
      appState.routingMode = previousMode;
      return result;
    }
    return { ok: true, error: "" };
  } catch (error) {
    appState.routingMode = previousMode;
    return { ok: false, error: toUserError(error, "切换失败") };
  } finally {
    appState.modeSwitchBusy = false;
  }
}

export async function startService() {
  appState.serviceStarting = true;
  appState.proxyState.lastError = "";
  try {
    const state = await startProxyService();
    applyProxyState(state);
    return { ok: true, error: "" };
  } catch (error) {
    const userError = toUserError(error);
    appState.proxyState.lastError = userError;
    return { ok: false, error: userError };
  } finally {
    appState.serviceStarting = false;
  }
}

export async function stopService() {
  appState.serviceStopping = true;
  try {
    const state = await stopProxyService();
    applyProxyState(state);
    return { ok: true, error: "" };
  } catch (error) {
    const userError = toUserError(error, "服务操作失败");
    appState.proxyState.lastError = userError;
    return { ok: false, error: userError };
  } finally {
    appState.serviceStopping = false;
  }
}

export async function toggleRoutingMode() {
  const target = appState.routingMode === "upstream" ? "local" : "upstream";
  return setRoutingMode(target);
}

function upsertModelAdapterTestResult(result) {
  const normalized = normalizeModelAdapterTestResult(result);
  if (!normalized.adapterID) {
    return;
  }
  const index = appState.modelAdapterTestResults.findIndex((item) => item.adapterID === normalized.adapterID);
  if (index >= 0) {
    appState.modelAdapterTestResults.splice(index, 1, normalized);
  } else {
    appState.modelAdapterTestResults.unshift(normalized);
  }
  if (normalized.status === "running") {
    appState.modelAdapterTestingIDs.add(normalized.adapterID);
  } else {
    appState.modelAdapterTestingIDs.delete(normalized.adapterID);
  }
}

export function getModelAdapterTestResultByID(adapterID) {
  const id = asString(adapterID);
  if (!id) {
    return null;
  }
  return appState.modelAdapterTestResults.find((item) => item.adapterID === id) || null;
}

export function startModelAdapterTest(adapter) {
  const normalizedAdapter = normalizeModelAdapter(adapter);
  const optimisticResult = normalizeModelAdapterTestResult({
    adapterID: normalizedAdapter.id,
    requestHash: buildModelAdapterTestRequestHash(normalizedAdapter),
    status: "running",
  });
  upsertModelAdapterTestResult(optimisticResult);

  const call = testModelAdapter(normalizedAdapter);
  const trackedCall = Promise.resolve(call)
    .then((result) => {
      upsertModelAdapterTestResult(result);
      return result;
    })
    .catch((error) => {
      if (String(error?.name || "").trim() === "CancelError") {
        upsertModelAdapterTestResult({
          adapterID: normalizedAdapter.id,
          requestHash: buildModelAdapterTestRequestHash(normalizedAdapter),
          status: "idle",
        });
      } else {
        upsertModelAdapterTestResult({
          adapterID: normalizedAdapter.id,
          requestHash: buildModelAdapterTestRequestHash(normalizedAdapter),
          status: "error",
          error: toUserError(error, "模型测试失败"),
        });
      }
      throw error;
    });
  if (typeof call?.cancel === "function") {
    trackedCall.cancel = call.cancel.bind(call);
  }
  return trackedCall;
}

export async function runModelAdapterTest(adapter) {
  return startModelAdapterTest(adapter);
}

export async function deleteModelAdapterAt(index) {
  const targetIndex = Number(index);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= appState.modelAdapters.length) {
    return { ok: false, error: "模型配置不存在，无法删除" };
  }
  const target = appState.modelAdapters[targetIndex];
  const config = cloneConfig(appState.configData || {});
  config.modelAdapters.splice(targetIndex, 1);
  const result = await saveCurrentConfig(config);
  if (!result.ok) {
    return result;
  }
  appState.modelAdapterTestResults = appState.modelAdapterTestResults.filter((item) => item.adapterID !== target.id);
  return { ok: true, error: "" };
}

export async function duplicateModelAdapterAt(index) {
  const targetIndex = Number(index);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= appState.modelAdapters.length) {
    return { ok: false, error: "模型配置不存在，无法复制" };
  }
  const config = cloneConfig(appState.configData || {});
  const source = appState.modelAdapters[targetIndex];
  const copy = {
    ...source,
    id: "",
    displayName: `${source.displayName} Copy`,
  };
  config.modelAdapters.splice(targetIndex + 1, 0, copy);
  return saveCurrentConfig(config);
}

export function onAppEvent(name, handler) {
  return Events.On(name, handler);
}

const unsubscribeProxy = onAppEvent(PROXY_STATE_EVENT, (event) => {
  applyProxyState(event?.data);
});
const unsubscribeConfig = onAppEvent(USER_CONFIG_CHANGED_EVENT, (event) => {
  applyUserConfig(event?.data);
});
const unsubscribeUpdateState = onAppEvent(UPDATE_STATE_EVENT, (event) => {
  applyUpdateState(event?.data);
});
const unsubscribeUpdateProgress = onAppEvent(UPDATE_PROGRESS_EVENT, (event) => {
  applyUpdateState(event?.data);
});
const unsubscribeUpdateReady = onAppEvent(UPDATE_READY_EVENT, (event) => {
  applyUpdateState(event?.data);
});
const unsubscribeUpdateError = onAppEvent(UPDATE_ERROR_EVENT, (event) => {
  applyUpdateState({
    ...(event?.data || {}),
    error: asString(event?.data?.error) || "更新失败",
  });
});
const unsubscribeModelAdapterTest = onAppEvent(MODEL_ADAPTER_TEST_UPDATED_EVENT, (event) => {
  upsertModelAdapterTestResult(event?.data);
});

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    unsubscribeProxy?.();
    unsubscribeConfig?.();
    unsubscribeUpdateState?.();
    unsubscribeUpdateProgress?.();
    unsubscribeUpdateReady?.();
    unsubscribeUpdateError?.();
    unsubscribeModelAdapterTest?.();
  });
}
