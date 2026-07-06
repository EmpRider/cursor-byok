<script setup>
import Button from "@/components/ui/Button.vue";
import Card from "@/components/ui/Card.vue";
import Input from "@/components/ui/Input.vue";
import ModelAdapterTestCard from "@/components/ModelAdapterTestCard.vue";
import { showModal } from "@/composables/useModal";
import { fetchModelIDs } from "@/services/clientApi";
import {
  appState,
  createEmptyModelAdapter,
  deleteModelAdapterAt,
  duplicateModelAdapterAt,
  getModelAdapterTestResultByID,
  normalizeModelAdapter,
  openModelEditorWindow,
  reloadUserConfig,
  runModelAdapterTest,
  saveModelAdapterAt,
  startModelAdapterTest,
  toUserError,
} from "@/state/appState";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

const BATCH_TEST_CONCURRENCY = 10;

const typeTabs = [
  { label: "OpenAI", value: "openai", icon: "icon-[bxl--openai]" },
  { label: "Anthropic", value: "anthropic", icon: "icon-[logos--claude-icon]" },
];

const activeType = ref("openai");
const batchTesting = ref(false);
const batchStopping = ref(false);
const batchTotal = ref(0);
const batchCompleted = ref(0);
const batchActiveCalls = new Set();
let batchStopRequested = false;

const importModalVisible = ref(false);
const importFetching = ref(false);
const importMessage = ref("");
const importError = ref("");
const importForm = reactive({
  apiType: "openai",
  baseURL: "",
  apiKey: "",
});
const selectedModelKeys = ref(new Set());

const filteredAdapters = computed(() =>
  appState.modelAdapters.filter((adapter) => adapter.type === activeType.value),
);
const batchButtonText = computed(() => {
  if (batchStopping.value) {
    return "停止中...";
  }
  if (!batchTesting.value) {
    return "测试全部";
  }
  return `停止测试 ${batchCompleted.value}/${batchTotal.value}`;
});
const importFetchButtonText = computed(() => (importFetching.value ? "Fetching..." : "Fetch All Models"));
const selectedFilteredAdapters = computed(() =>
  filteredAdapters.value.filter((adapter) => selectedModelKeys.value.has(getAdapterSelectionKey(adapter))),
);
const selectedFilteredCount = computed(() => selectedFilteredAdapters.value.length);
const allFilteredSelected = computed(() =>
  filteredAdapters.value.length > 0 && selectedFilteredCount.value === filteredAdapters.value.length,
);
const selectAllButtonText = computed(() => (allFilteredSelected.value ? "Clear Selection" : "Select All"));

watch(
  () => appState.modelAdapters,
  (adapters) => {
    if (adapters.some((adapter) => adapter.type === activeType.value)) {
      return;
    }
    const fallback = typeTabs.find((tab) => adapters.some((adapter) => adapter.type === tab.value));
    activeType.value = fallback?.value ?? "openai";
  },
  { deep: true, immediate: true },
);

watch(
  () => appState.modelAdapters,
  (adapters) => {
    const validKeys = new Set(adapters.map((adapter) => getAdapterSelectionKey(adapter)));
    selectedModelKeys.value = new Set(
      Array.from(selectedModelKeys.value).filter((key) => validKeys.has(key)),
    );
  },
  { deep: true },
);

async function showActionError(title, error) {
  await showModal({
    title,
    content: String(error || "服务错误").trim() || "服务错误",
  });
}

function maskSecret(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "-";
  }
  if (text.length <= 8) {
    return `${"*".repeat(Math.max(text.length - 2, 0))}${text.slice(-2)}`;
  }
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function typeLabel(type) {
  return type === "anthropic" ? "Anthropic" : "OpenAI";
}

function formatHost(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "-";
  }
  try {
    const parsed = new URL(text);
    return parsed.host || text;
  } catch {
    return text.replace(/^https?:\/\//, "");
  }
}

function normalizeURLText(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getAdapterSelectionKey(adapter) {
  if (adapter?.id) {
    return `id:${adapter.id}`;
  }
  return [
    "adapter",
    adapter?.type || "",
    normalizeURLText(adapter?.baseURL),
    adapter?.modelID || "",
    adapter?.displayName || "",
    adapter?.apiKey || "",
  ].join("\n");
}

function isAdapterSelected(adapter) {
  return selectedModelKeys.value.has(getAdapterSelectionKey(adapter));
}

function toggleAdapterSelection(adapter) {
  const key = getAdapterSelectionKey(adapter);
  const next = new Set(selectedModelKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  selectedModelKeys.value = next;
}

function handleSelectAllFilteredAdapters() {
  const next = new Set(selectedModelKeys.value);
  const keys = filteredAdapters.value.map((adapter) => getAdapterSelectionKey(adapter));
  if (allFilteredSelected.value) {
    keys.forEach((key) => next.delete(key));
  } else {
    keys.forEach((key) => next.add(key));
  }
  selectedModelKeys.value = next;
}

function buildImportDedupeKey(adapter) {
  const normalized = normalizeModelAdapter(adapter);
  return [normalized.type, normalizeURLText(normalized.baseURL), normalized.modelID].join("\n");
}

function createImportedModelAdapter(modelID, apiType, baseURL, apiKey) {
  return normalizeModelAdapter({
    ...createEmptyModelAdapter(),
    type: apiType,
    displayName: modelID,
    modelID,
    baseURL,
    apiKey,
  });
}

function openFetchModelsModal() {
  importForm.apiType = activeType.value || "openai";
  importForm.baseURL = "";
  importForm.apiKey = "";
  importMessage.value = "";
  importError.value = "";
  importModalVisible.value = true;
}

function closeFetchModelsModal() {
  if (importFetching.value) {
    return;
  }
  importModalVisible.value = false;
}

async function handleFetchModelsFromModal() {
  if (importFetching.value) {
    return;
  }

  importMessage.value = "";
  importError.value = "";

  const apiType = importForm.apiType === "anthropic" ? "anthropic" : "openai";
  const apiKey = String(importForm.apiKey || "").trim();
  if (!apiKey) {
    importError.value = "API key is required.";
    return;
  }

  importFetching.value = true;
  try {
    const result = await fetchModelIDs({
      apiType,
      baseURL: importForm.baseURL,
      apiKey,
    });
    const baseURL = normalizeURLText(result?.baseURL || importForm.baseURL);
    const modelIDs = Array.isArray(result?.modelIDs) ? result.modelIDs : [];
    if (modelIDs.length === 0) {
      throw new Error("No model IDs found in the models response.");
    }

    const existingKeys = new Set(appState.modelAdapters.map((adapter) => buildImportDedupeKey(adapter)));
    let addedCount = 0;
    let skippedCount = 0;

    for (const modelID of modelIDs) {
      const adapter = createImportedModelAdapter(modelID, apiType, baseURL, apiKey);
      const key = buildImportDedupeKey(adapter);
      if (existingKeys.has(key)) {
        skippedCount += 1;
        continue;
      }

      const saveResult = await saveModelAdapterAt(-1, adapter);
      if (!saveResult.ok) {
        throw new Error(saveResult.error || `Failed to save model ${modelID}`);
      }
      existingKeys.add(key);
      addedCount += 1;
    }

    activeType.value = apiType;
    importForm.baseURL = baseURL;
    importMessage.value = `Added ${addedCount} model(s).${skippedCount ? ` Skipped ${skippedCount} existing model(s).` : ""}`;
  } catch (error) {
    importError.value = toUserError(error);
  } finally {
    importFetching.value = false;
  }
}

async function openEditor(index = -1) {
  const adapter = index >= 0
    ? appState.modelAdapters[index]
    : {
        ...createEmptyModelAdapter(),
        type: activeType.value,
      };
  try {
    await openModelEditorWindow(index, adapter);
  } catch (error) {
    await showActionError("打开失败", toUserError(error));
  }
}

async function handleDeleteModelAdapter(index) {
  const target = appState.modelAdapters[index];
  if (!target) {
    await showActionError("删除失败", "模型配置不存在，无法删除");
    return;
  }
  const result = await deleteModelAdapterAt(index);
  if (!result.ok) {
    await showActionError("删除失败", result.error);
  } else {
    const next = new Set(selectedModelKeys.value);
    next.delete(getAdapterSelectionKey(target));
    selectedModelKeys.value = next;
  }
}

async function handleDeleteSelectedModelAdapters() {
  const targets = selectedFilteredAdapters.value
    .map((adapter) => ({
      adapter,
      index: appState.modelAdapters.indexOf(adapter),
      key: getAdapterSelectionKey(adapter),
    }))
    .filter((target) => target.index >= 0)
    .sort((left, right) => right.index - left.index);

  if (targets.length === 0) {
    return;
  }

  const confirmed = await showModal({
    title: "Delete selected models?",
    content: `This will delete ${targets.length} selected ${typeLabel(activeType.value)} model(s). This action cannot be undone.`,
    confirmText: "Delete",
    cancelText: "Cancel",
  });
  if (!confirmed) {
    return;
  }

  const removedKeys = new Set();
  for (const target of targets) {
    const result = await deleteModelAdapterAt(target.index);
    if (!result.ok) {
      await showActionError("删除失败", result.error);
      break;
    }
    removedKeys.add(target.key);
  }

  if (removedKeys.size > 0) {
    selectedModelKeys.value = new Set(
      Array.from(selectedModelKeys.value).filter((key) => !removedKeys.has(key)),
    );
  }
}

async function handleDuplicateModelAdapter(index) {
  const target = appState.modelAdapters[index];
  if (!target) {
    await showActionError("复制失败", "模型配置不存在，无法复制");
    return;
  }
  const result = await duplicateModelAdapterAt(index);
  if (!result.ok) {
    await showActionError("复制失败", result.error);
  }
}

function getAdapterTestResult(adapter) {
  return getModelAdapterTestResultByID(adapter?.id);
}

function isAdapterTesting(adapter) {
  return getAdapterTestResult(adapter)?.status === "running";
}

async function handleTestModelAdapter(adapter) {
  try {
    await runModelAdapterTest(adapter);
  } catch (_error) {
    // 失败结果会通过事件同步到界面，这里不再额外弹窗打断用户。
  }
}

function isCancelError(error) {
  return String(error?.name || "").trim() === "CancelError";
}

async function stopBatchTesting() {
  if (!batchTesting.value || batchStopping.value) {
    return;
  }
  batchStopRequested = true;
  batchStopping.value = true;
  const activeCalls = Array.from(batchActiveCalls);
  await Promise.allSettled(
    activeCalls.map((call) => (typeof call?.cancel === "function" ? call.cancel("batch-stop") : undefined)),
  );
}

async function handleTestAllModelAdapters() {
  if (batchTesting.value) {
    await stopBatchTesting();
    return;
  }
  const adapters = filteredAdapters.value.slice();
  if (adapters.length === 0) {
    return;
  }
  batchStopRequested = false;
  batchTesting.value = true;
  batchStopping.value = false;
  batchTotal.value = adapters.length;
  batchCompleted.value = 0;
  let nextIndex = 0;
  try {
    const workers = Array.from({ length: Math.min(BATCH_TEST_CONCURRENCY, adapters.length) }, async () => {
      while (!batchStopRequested) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= adapters.length) {
          return;
        }
        const adapter = adapters[currentIndex];
        const call = startModelAdapterTest(adapter);
        batchActiveCalls.add(call);
        try {
          await call;
        } catch (error) {
          if (!isCancelError(error) && !batchStopRequested) {
            // 单个失败结果由卡片自行展示，这里继续后续测试。
          }
        } finally {
          batchActiveCalls.delete(call);
          batchCompleted.value += 1;
        }
      }
    });
    await Promise.allSettled(workers);
  } finally {
    batchActiveCalls.clear();
    batchStopRequested = false;
    batchTesting.value = false;
    batchStopping.value = false;
  }
}

onMounted(async () => {
  await reloadUserConfig({ modelAdaptersOnly: true }).catch(() => { });
});

onBeforeUnmount(() => {
  void stopBatchTesting();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col p-4 pt-0 text-[#e5e5e5] overflow-hidden">
    <div class="shrink-0 pb-4">
      <div class="flex items-center justify-between gap-4">
        <div class="center-row gap-2">
          <button
            v-for="tab in typeTabs"
            :key="tab.value"
            type="button"
            class="center-row gap-2 rounded-[8px] border px-3 py-2 text-sm transition-colors duration-150"
            :class="activeType === tab.value
              ? 'border-[#1ca35a] bg-[#123322] text-white'
              : 'border-[#343434] bg-[#252525] text-[#a3a3a3] hover:border-[#4a4a4a] hover:text-[#e5e5e5]'"
            @click="activeType = tab.value"
          >
            <span :class="[tab.icon, 'text-[16px]']"></span>
            <span>{{ tab.label }}</span>
          </button>
        </div>
        <div class="center-row flex-wrap justify-end gap-2">
          <Button
            variant="default"
            :disabled="appState.configSaving || (!batchTesting && filteredAdapters.length === 0)"
            @click="handleTestAllModelAdapters"
          >
            {{ batchButtonText }}
          </Button>
          <Button
            variant="default"
            :disabled="appState.configSaving || batchTesting || filteredAdapters.length === 0"
            @click="handleSelectAllFilteredAdapters"
          >
            {{ selectAllButtonText }}
          </Button>
          <Button
            variant="default"
            :disabled="appState.configSaving || batchTesting || selectedFilteredCount === 0"
            @click="handleDeleteSelectedModelAdapters"
          >
            Delete Selected{{ selectedFilteredCount ? ` (${selectedFilteredCount})` : "" }}
          </Button>
          <Button variant="default" :disabled="appState.configSaving || batchTesting" @click="openFetchModelsModal">
            Fetch Models
          </Button>
          <Button variant="primary" :disabled="appState.configSaving || batchTesting" @click="openEditor()">新增模型</Button>
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1">
      <div v-if="filteredAdapters.length === 0"
        class="flex h-full min-h-[220px] items-center justify-center rounded-[8px] border border-dashed border-[#3a3a3a] bg-[#232323] px-4 text-sm text-[#a3a3a3]">
        当前还没有配置任何 {{ typeLabel(activeType) }} 模型。
      </div>

      <div v-else class="h-full min-h-0 overflow-y-auto pr-1">
        <div class="grid gap-3 pb-1 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
          <Card
            v-for="(adapter, index) in filteredAdapters"
            :key="adapter.id || `${adapter.baseURL}-${adapter.modelID}-${index}`"
          >
            <div class="flex h-full min-h-[154px] flex-col justify-between gap-3">
              <div class="flex flex-col gap-2.5">
                <div class="flex items-start justify-between gap-3">
                  <label class="center-row mt-0.5 shrink-0 cursor-pointer gap-2 text-xs text-[#a3a3a3]">
                    <input
                      type="checkbox"
                      class="size-4 accent-[#10AD5D]"
                      :checked="isAdapterSelected(adapter)"
                      @change="toggleAdapterSelection(adapter)"
                      @click.stop
                    />
                  </label>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-base font-medium text-white">{{ adapter.displayName }}</div>
                    <div class="mt-1 truncate text-sm text-[#8f8f8f]">{{ adapter.modelID }}</div>
                    <div v-if="adapter.type === 'openai'" class="mt-0.5 truncate text-xs text-[#737373]">
                      {{ adapter.openAIEndpoint || "/v1/responses" }}
                    </div>
                  </div>
                  <span
                    class="center-row shrink-0 gap-1 rounded-[999px] border border-[#3f3f3f] px-[7px] py-[4px] text-[11px] font-medium text-[#cfcfcf]"
                  >
                    <span class="icon-[bxl--openai] text-[14px] !text-white" v-if="adapter.type === 'openai'"></span>
                    <span class="icon-[logos--claude-icon] text-[14px]" v-else></span>
                    <span>{{ typeLabel(adapter.type) }}</span>
                  </span>
                </div>

                <div class="grid grid-cols-2 gap-2 text-sm text-[#a3a3a3]">
                  <div class="rounded-[8px] bg-[#232323] px-3 py-2">
                    <div class="text-[11px] uppercase tracking-[0.08em] text-[#666]">Host</div>
                    <div class="mt-1 truncate text-[#d4d4d4]" :title="adapter.baseURL">{{ formatHost(adapter.baseURL) }}</div>
                  </div>
                  <div class="rounded-[8px] bg-[#232323] px-3 py-2">
                    <div class="text-[11px] uppercase tracking-[0.08em] text-[#666]">API Key</div>
                    <div class="mt-1 truncate text-[#d4d4d4]">{{ maskSecret(adapter.apiKey) }}</div>
                  </div>
                </div>

                <ModelAdapterTestCard
                  compact
                  title="测试"
                  empty-text="未测试"
                  :result="getAdapterTestResult(adapter)"
                />
              </div>

              <div class="center-row flex-wrap justify-end gap-2 border-t border-[#343434] pt-3">
                <Button
                  variant="default"
                  :disabled="appState.configSaving || batchTesting || isAdapterTesting(adapter)"
                  @click="handleTestModelAdapter(adapter)"
                >
                  {{ isAdapterTesting(adapter) ? "测试中..." : "测试" }}
                </Button>
                <Button variant="default" :disabled="appState.configSaving" @click="openEditor(appState.modelAdapters.indexOf(adapter))">编辑</Button>
                <Button variant="default" :disabled="appState.configSaving" @click="handleDuplicateModelAdapter(appState.modelAdapters.indexOf(adapter))">复制</Button>
                <Button variant="text" :disabled="appState.configSaving"
                  @click="handleDeleteModelAdapter(appState.modelAdapters.indexOf(adapter))">删除</Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>

    <div
      v-if="importModalVisible"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
      @click.self="closeFetchModelsModal"
    >
      <div class="w-full max-w-[520px] rounded-[12px] border border-[#343434] bg-[#1f1f1f] p-4 shadow-2xl">
        <div class="flex items-center justify-between gap-3 border-b border-[#343434] pb-3">
          <div>
            <h3 class="text-base font-medium text-white">Fetch Models</h3>
            <p class="mt-1 text-xs text-[#8f8f8f]">Fetch from Base URL + /models and add every returned model ID.</p>
          </div>
          <button
            type="button"
            class="rounded-[6px] px-2 py-1 text-sm text-[#a3a3a3] hover:bg-[#2a2a2a] hover:text-white"
            :disabled="importFetching"
            @click="closeFetchModelsModal"
          >
            ✕
          </button>
        </div>

        <div class="mt-4 flex flex-col gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-sm text-[#d4d4d4]">API Type</span>
            <select
              v-model="importForm.apiType"
              class="h-9 rounded-[6px] border border-[#3f3f3f] bg-[#232323] px-3 text-sm text-[#e5e5e5] outline-none focus:border-[#10AD5D]"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-sm text-[#d4d4d4]">Base URL</span>
            <input
              v-model="importForm.baseURL"
              type="text"
              placeholder="http://localhost:20128/v1"
              class="h-9 rounded-[6px] border border-[#3f3f3f] bg-[#232323] px-3 text-sm text-[#e5e5e5] outline-none focus:border-[#10AD5D]"
            />
            <span class="text-xs text-[#8f8f8f]">Do not include /models. The backend fetch URL will be Base URL + /models.</span>
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-sm text-[#d4d4d4]">API Key</span>
            <Input
              v-model="importForm.apiKey"
              type="password"
              allow-visibility-toggle
              placeholder="sk-xxxxxx"
              autocomplete="off"
            />
          </label>

          <div v-if="importMessage" class="rounded-[8px] border border-[#14532d] bg-[#102418] px-3 py-2 text-sm text-[#86efac]">
            {{ importMessage }}
          </div>
          <div v-if="importError" class="rounded-[8px] border border-[#4b1d1d] bg-[#2a1313] px-3 py-2 text-sm text-[#fca5a5]">
            {{ importError }}
          </div>
        </div>

        <div class="mt-4 flex items-center justify-end gap-2 border-t border-[#343434] pt-3">
          <Button variant="default" :disabled="importFetching" @click="closeFetchModelsModal">Cancel</Button>
          <Button variant="primary" :disabled="importFetching || appState.configSaving" @click="handleFetchModelsFromModal">
            {{ importFetchButtonText }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
