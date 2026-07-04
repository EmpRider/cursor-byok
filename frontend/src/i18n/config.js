export const LOCALE_STORAGE_KEY = "cursor-client:locale:v1";
export const LOCALE_STORAGE_SOURCE_KEY = "cursor-client:locale-source:v1";
export const SOURCE_LOCALE = "zh-CN";
export const DEFAULT_LOCALE = "en-US";
export const SUPPORTED_LOCALES = ["zh-CN", "en-US", "ja-JP"];
export const LOCALE_OPTIONS = [
  { label: "简体中文", value: "zh-CN" },
  { label: "English", value: "en-US" },
  { label: "日本語", value: "ja-JP" },
];

export const LOCALE_RESPONSE_INSTRUCTIONS = {
  "zh-CN": "请始终使用简体中文回答，除非用户明确要求使用其他语言。",
  "en-US": "Always respond in English unless the user explicitly asks for another language.",
  "ja-JP": "ユーザーが別の言語を明示的に指定しない限り、常に日本語で回答してください。",
};
