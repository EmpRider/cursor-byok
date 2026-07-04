<script setup>
import Button from "@/components/ui/Button.vue";
import Card from "@/components/ui/Card.vue";
import Switch from "@/components/ui/Switch.vue";
import HomeMetricsCard from "@/components/HomeMetricsCard.vue";
import { useMessage } from "@/composables/useMessage";
import { showModal } from "@/composables/useModal";
import { localized } from "@/i18n/runtime";
import { getAdRuntime } from "@/services/clientApi";
import {
  appState,
  openConfigWindow,
  openModelConfigWindow,
  saveRoutingMode,
  syncHomeMetrics,
  syncServiceState,
  toUserError,
  toggleService,
} from "@/state/appState";
import { Events } from "@wailsio/runtime";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const directModeEnabled = computed(() => appState.routingMode === "upstream");
const message = useMessage();
const AD_UPDATED_EVENT = "ad:updated";
const OPEN_AD_EVENT = "cursor:open-ad";

const adRuntime = ref(null);
let unsubscribeAdUpdated = null;

const serviceStatusText = computed(() => {
  if (appState.proxyRunning && appState.backendRunning) {
    return String(localized("86df7ec743047234", "Service running"));
  }
  if (appState.backendRunning) {
    return String(localized("65cc5fd2e6ce6e75", "Backend started, proxy not started"));
  }
  return String(localized("26a3855aed1d8d17", "Service not running"));
});
const serviceStatusClass = computed(() => (appState.serviceRunning ? "text-[#22c55e]" : "text-[#f59e0b]"));
const serviceButtonText = computed(() => {
  if (appState.serviceBusy) {
    return appState.serviceRunning
      ? String(localized("5d1687a4a41883fd", "Stopping..."))
      : String(localized("ca00a39fcea70dc6", "Starting..."));
  }
  return appState.serviceRunning
    ? String(localized("f474a4108aba4c4c", "Stop Service"))
    : String(localized("18b7312022cd1840", "Start Service"));
});

function asString(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function asBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

const homeAds = computed(() => {
  const runtime = adRuntime.value && typeof adRuntime.value === "object" ? adRuntime.value : {};
  const slots = Array.isArray(runtime.slots) && runtime.slots.length > 0 ? runtime.slots : [runtime];
  return slots
    .map((slot, index) => {
      const item = slot && typeof slot === "object" ? slot : {};
      const home = item.home && typeof item.home === "object" ? item.home : {};
      const title = asString(home.title);
      if (
        !title ||
        !asBoolean(item.available) ||
        !asBoolean(item.enabled) ||
        !asString(item.packageHash)
      ) {
        return null;
      }
      return {
        id: asString(item.id) || String(index + 1),
        title,
        subtitle: asString(home.subtitle),
      };
    })
    .filter(Boolean);
});

async function syncAdRuntimeQuietly() {
  try {
    adRuntime.value = await getAdRuntime();
  } catch (_error) {
    adRuntime.value = null;
  }
}

function handleAdUpdated() {
  void syncAdRuntimeQuietly();
}

function handleOpenHomeAd(slotId) {
  window.dispatchEvent(new CustomEvent(OPEN_AD_EVENT, { detail: { slotId: asString(slotId) } }));
}

async function showActionError(title, error) {
  await showModal({
    title,
    content: String(error || localized("6ae23d6d7cb18592", "Service error")).trim() || String(localized("6ae23d6d7cb18592", "Service error")),
  });
}

async function handleToggleService() {
  const result = await toggleService();
  if (!result.ok) {
    await showActionError(String(localized("7e9e334aeb0bdc07", "Service operation failed")), result.error);
  }
}

async function handleRefreshState() {
  const [serviceStateResult] = await Promise.allSettled([
    syncServiceState(),
    syncHomeMetrics(),
  ]);
  if (serviceStateResult.status === "rejected") {
    await showActionError(String(localized("6106f0a12583a334", "Refresh failed")), toUserError(serviceStateResult.reason));
  }
}

async function handleRefreshMetrics() {
  await syncHomeMetrics().catch(() => {});
}

async function handleOpenConfig() {
  try {
    await openConfigWindow();
  } catch (error) {
    await showActionError(String(localized("24343a2096988d42", "Failed to open")), toUserError(error));
  }
}

async function handleOpenModelConfig() {
  try {
    await openModelConfigWindow();
  } catch (error) {
    await showActionError(String(localized("24343a2096988d42", "Failed to open")), toUserError(error));
  }
}

async function handleDirectModeChange(enabled) {
  const result = await saveRoutingMode(enabled ? "upstream" : "local");
  if (!result.ok) {
    await showActionError(String(localized("d08fd4224abcd69d", "Switch failed")), result.error);
    return;
  }
  message.success(
    enabled
      ? String(localized("9c38b6e9bf94abec", "Switched to Direct Cursor Mode"))
      : String(localized("b42049dcf8a05ef7", "Switched to Local Service Mode")),
  );
}

onMounted(() => {
  unsubscribeAdUpdated = Events.On(AD_UPDATED_EVENT, handleAdUpdated);
  void syncAdRuntimeQuietly();
});

onBeforeUnmount(() => {
  if (unsubscribeAdUpdated) {
    unsubscribeAdUpdated();
  }
});
</script>

<template>
  <div class="flex flex-col gap-4 p-4 pt-0 text-[#e5e5e5]">
    <HomeMetricsCard
      :metrics="appState.homeMetrics"
      :loading="appState.homeMetricsLoading"
      :error="appState.homeMetricsError"
      :home-ads="homeAds"
      @refresh="handleRefreshMetrics"
      @open-ad="handleOpenHomeAd"
    />

    <Card>
      <div class="flex flex-col gap-4">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-col gap-1">
            <div class="text-sm" :class="serviceStatusClass">
              {{ serviceStatusText }}
            </div>
          </div>
          <div class="center-row gap-2">
            <Button variant="primary" :disabled="appState.serviceBusy" @click="handleToggleService">
              <span class="icon-[mdi--pause] text-[16px]" v-if="appState.serviceRunning"></span>
              <span class="icon-[mdi--play] text-[16px]" v-else></span>
              <span> {{ serviceButtonText }}</span>
            </Button>
          </div>
        </div>

        <div v-if="appState.serviceLastError"
          class="rounded-[8px] border border-[#4b1d1d] bg-[#2a1313] px-3 py-2 text-sm text-[#fca5a5]">
          {{ appState.serviceLastError }}
        </div>

        <Switch
          :label="String($ls('699fe7ade5407687', 'Direct Mode'))"
          :description="String($ls('ce46f23cea3bf3c5', 'When enabled, Cursor connects directly to the official service. Do not enable this.'))"
          :enabled-text="String($ls('a55a88237df85d98', 'Currently in Direct Mode'))"
          :disabled-text="String($ls('8c0d84831a3c3d5b', 'Currently in Local Service Mode'))"
          :enabled="directModeEnabled"
          :busy="appState.configSaving"
          :disabled="appState.configSaving"
          @change="handleDirectModeChange"
        />
      </div>
    </Card>

    <Card>
      <div class="flex items-center justify-between gap-4">
        <div>
          <h2 class="text-base font-medium text-white">{{ $ls('e406825e0a72d2c2', 'Local Settings') }}</h2>
          <div class="text-sm text-[#a3a3a3]">{{ $ls('ad79540418be700a', 'Open the settings folder, or manage model settings separately') }}</div>
        </div>
        <div class="center-row gap-2">
          <Button variant="default" @click="handleOpenConfig">{{ $ls('c69f5bce63b9f14c', 'Settings Folder') }}</Button>
          <Button variant="primary" @click="handleOpenModelConfig">{{ $ls('8cbcf741e727dbf7', 'Model Settings') }}</Button>
        </div>
      </div>
    </Card>
  </div>
</template>
