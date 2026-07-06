<script setup>
import { computed } from "vue";
import Tooltip from "@/components/ui/Tooltip.vue";
import { localized, localizedTemplate } from "@/i18n/runtime";
import { formatDuration } from "@/state/appState";

const props = defineProps({
  result: {
    type: Object,
    default: null,
  },
  stale: {
    type: Boolean,
    default: false,
  },
  compact: {
    type: Boolean,
    default: false,
  },
  showMetrics: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: "",
  },
  emptyText: {
    type: String,
    default: "",
  },
});

const normalizedStatus = computed(() => {
  const status = String(props.result?.status || "").trim().toLowerCase();
  return ["running", "success", "error"].includes(status) ? status : "idle";
});

const resolvedTitle = computed(() =>
  String(props.title || "").trim() || String(localized("8c1935935600e336", "Model Test")),
);

const resolvedEmptyText = computed(() =>
  String(props.emptyText || "").trim() || String(localized("092b520558eff5f2", "Not tested")),
);

const summaryText = computed(() => {
  if (normalizedStatus.value === "running") {
    return String(localized("7b6187c41e88b70c", "Testing..."));
  }
  if (normalizedStatus.value === "success") {
    const roundedTPS = Math.max(0, Math.round(Number(props.result?.tokensPerSecond || 0)));
    return String(localizedTemplate("ec3b17a75db49e24", "{0} t/s | First token {1}", [
      roundedTPS,
      formatDuration(props.result?.firstTextTokenMS),
    ]));
  }
  if (normalizedStatus.value === "error") {
    return String(props.result?.error || "").trim() || String(localized("d3b1da3088ddd334", "Model test failed"));
  }
  return resolvedEmptyText.value;
});

const rawResponseText = computed(() => {
  const raw = String(props.result?.rawResponse || "").trim();
  if (raw) {
    return raw;
  }
  if (normalizedStatus.value === "error") {
    return String(props.result?.error || "").trim();
  }
  return "";
});

const panelClass = computed(() => {
  if (props.stale) {
    return "border-[#6b5b1e] bg-[#2c2612]";
  }
  if (normalizedStatus.value === "running") {
    return "border-[#164e63] bg-[#0b2530]";
  }
  if (normalizedStatus.value === "error") {
    return "border-[#4b1d1d] bg-[#2a1313]";
  }
  if (normalizedStatus.value === "success" && props.result?.tokensEstimated) {
    return "border-[#5a4314] bg-[#2f2612]";
  }
  if (normalizedStatus.value === "success") {
    return "border-[#14532d] bg-[#102418]";
  }
  return "border-[#343434] bg-[#232323]";
});

const summaryClass = computed(() => {
  if (props.stale) {
    return "text-[#f6d77a]";
  }
  if (normalizedStatus.value === "running") {
    return "text-[#67e8f9]";
  }
  if (normalizedStatus.value === "error") {
    return "text-[#fca5a5]";
  }
  if (normalizedStatus.value === "success" && props.result?.tokensEstimated) {
    return "text-[#fcd34d]";
  }
  if (normalizedStatus.value === "success") {
    return "text-[#86efac]";
  }
  return "text-[#a3a3a3]";
});
</script>

<template>
  <div class="rounded-[8px] border px-3 py-3" :class="panelClass">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <div
            :class="compact ? 'text-[11px] uppercase tracking-[0.08em] text-[#666]' : 'text-sm font-medium text-white'"
          >
            {{ resolvedTitle }}
          </div>
          <div v-if="rawResponseText" class="center-row gap-1 text-[11px] text-[#8f8f8f]">
            <span>{{ localized("64d2730f2ae37997", "Raw Response") }}</span>
            <Tooltip :content="rawResponseText" copyable />
          </div>
        </div>
        <div class="mt-1 text-sm leading-relaxed" :class="summaryClass">
          {{ summaryText }}
        </div>
      </div>
      <span
        v-if="stale"
        class="shrink-0 rounded-[999px] border border-[#8a6d1a] px-2 py-1 text-xs text-[#f6d77a]"
      >
        {{ localized("51194c3ad014fb29", "Retest required") }}
      </span>
    </div>

    <div v-if="stale" class="mt-2 text-xs text-[#f6d77a]">
      {{ localized("35076178fe79a210", "Configuration changed. Please test again.") }}
    </div>

    <div
      v-if="showMetrics && normalizedStatus === 'success'"
      class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2"
    >
      <div class="rounded-[8px] bg-[#1c1c1c] px-3 py-2">
        <div class="text-[11px] uppercase tracking-[0.08em] text-[#666]">{{ localized("42aa8e01e98c0d8c", "Total Duration") }}</div>
        <div class="mt-1 text-sm text-[#d4d4d4]">{{ formatDuration(result?.totalDurationMS) }}</div>
      </div>
      <div class="rounded-[8px] bg-[#1c1c1c] px-3 py-2">
        <div class="text-[11px] uppercase tracking-[0.08em] text-[#666]">{{ localized("a026f37e613cf48b", "Output Tokens") }}</div>
        <div class="mt-1 text-sm text-[#d4d4d4]">{{ result?.outputTokens ?? 0 }}</div>
      </div>
    </div>

    <div
      v-if="normalizedStatus === 'success' && result?.tokensEstimated"
      class="mt-2 text-xs text-[#8f8f8f]"
    >
      {{ localized("32b3c9a50003f77a", "Output tokens are estimated") }}
    </div>
  </div>
</template>
