<script setup>
import { computed, onMounted } from "vue";
import Select from "@/components/ui/Select.vue";
import { localized, matchSupportedLocale, useLocale } from "@/i18n/runtime";
import { loadUserConfig, saveUserConfig } from "@/services/clientApi";

const props = defineProps({
  border: { type: Boolean, default: true },
  ariaLabel: { type: String, default: "" },
  buttonClass: { type: String, default: "" },
  menuClass: { type: String, default: "" },
  wrapperClass: { type: String, default: "w-[180px] max-w-full" },
  placeholder: { type: String, default: "" },
});

const { locale, localeOptions, setLocale } = useLocale();
const resolvedAriaLabel = computed(() => props.ariaLabel || String(localized("3d13868593ae4eeb", "Interface Language")));
const resolvedPlaceholder = computed(() => props.placeholder || String(localized("b90a8ac9c488ce46", "Select language")));

async function loadPersistedLocale() {
  try {
    const config = await loadUserConfig();
    const storedLocale = matchSupportedLocale(config?.locale);
    if (storedLocale && storedLocale !== locale.value) {
      setLocale(storedLocale);
    }
  } catch (error) {
    console.warn("[LocaleSelect] failed to load persisted locale", error);
  }
}

async function persistLocale(nextLocale) {
  const normalizedLocale = setLocale(nextLocale);
  try {
    const config = await loadUserConfig();
    await saveUserConfig({
      ...(config && typeof config === "object" ? config : {}),
      locale: normalizedLocale,
    });
  } catch (error) {
    console.error("[LocaleSelect] failed to persist locale", error);
  }
}

onMounted(() => {
  void loadPersistedLocale();
});
</script>

<template>
  <div :class="wrapperClass">
    <Select
      :model-value="locale"
      :options="localeOptions"
      :border="border"
      :aria-label="resolvedAriaLabel"
      :button-class="buttonClass"
      :menu-class="menuClass"
      :placeholder="resolvedPlaceholder"
      @update:model-value="persistLocale"
    />
  </div>
</template>
