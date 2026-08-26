<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  storageSettingsApi,
  type StorageProvider,
  type StorageSettingsInput,
  type TestStorageResult,
} from '@/api/storage-settings';
import {
  monitoringSettingsApi,
  type MonitoringSettingsInput,
} from '@/api/monitoring-settings';
import { aiSettingsApi, type AiSettingsInput } from '@/api/ai-settings';
import {
  systemSettingsApi,
  type SystemSettingsInput,
  type RateLimitUnit,
} from '@/api/system-settings';
import {
  siteSettingsApi,
  type SiteSettings,
  type SiteSettingsInput,
} from '@/api/site-settings';
import { toast } from '@/composables/useToast';
import { formatApiError } from '@/lib/api';

// Tabbed Infrastructure settings page. Mirrors the email-settings UX (load on
// mount, dirty-track secrets so the MASK never round-trips back to the API,
// inline save+test result chips). The Monitoring and System tabs ship as
// stubs labelled "Coming next" — they get wired in Steps 3b and 3c of the
// env-categorization plan.
type TabKey = 'storage' | 'monitoring' | 'ai' | 'system';
const activeTab = ref<TabKey>('storage');

// ─── Storage tab state ───────────────────────────────────────────────────────
const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const testResult = ref<TestStorageResult | null>(null);

const provider = ref<StorageProvider>('minio');
const bucket = ref('');
const region = ref('');
const forcePathStyle = ref(true);
const accessKeyId = ref('');
const secretAccessKey = ref('');
const publicMediaUrl = ref('');
const publicApiEndpoint = ref('');
const isConfigured = ref(false);

// Original secret — only retransmit when the user actually retypes it.
const origSecret = ref('');
const showSecret = ref(false);

const PROVIDERS: ReadonlyArray<{
  id: StorageProvider;
  label: string;
  hint: string;
  /** Where to create the access-key pair on this provider's console. */
  credentialsHint: string;
  /** Example region values for this provider (or "leave blank" guidance). */
  regionHint: string;
  /** Whether path-style should be ON for this provider. */
  pathStyleHint: string;
  /** Example public-endpoint value, or when to leave blank. */
  endpointHint: string;
}> = [
  {
    id: 'minio',
    label: 'MinIO (Self-hosted)',
    hint: 'Running MinIO inside your Docker stack. Console at http://localhost:9001 (login: minioadmin / minioadmin). Recommended for self-hosted installs.',
    credentialsHint:
      'For dev, the defaults are minioadmin / minioadmin. For production, create a new user in the MinIO Console → Identity → Users and use those credentials here.',
    regionHint: 'Leave blank — MinIO ignores region.',
    pathStyleHint:
      'Leave ON. MinIO requires path-style URLs (https://endpoint/bucket/key).',
    endpointHint:
      'Set to MinIO\'s public HTTPS URL (e.g. https://minio.yoursite.com). For local dev leave blank — the browser reaches MinIO at the same host the API does.',
  },
  {
    id: 'aws',
    label: 'Amazon S3',
    hint: 'Standard Amazon S3. Console: console.aws.amazon.com/s3. Region matters — set it to the bucket\'s region.',
    credentialsHint:
      'AWS Console → IAM → Users → (your user) → Security credentials → Create access key. The secret is shown ONCE — save it before closing the dialog.',
    regionHint:
      'The bucket\'s region. Examples: us-east-1, eu-west-1, ap-south-1. Shown on the bucket\'s Properties tab in the S3 console.',
    pathStyleHint:
      'Turn OFF for AWS S3 — it uses virtual-hosted-style (https://bucket.s3.region.amazonaws.com/key).',
    endpointHint:
      'Leave blank — AWS S3 endpoints are browser-reachable by default.',
  },
  {
    id: 'r2',
    label: 'Cloudflare R2',
    hint: 'Cloudflare R2 — no egress fees. Console: dash.cloudflare.com → R2.',
    credentialsHint:
      'Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token. The secret is shown once on creation.',
    regionHint: 'Leave as "auto" (or blank) — R2 is single-region.',
    pathStyleHint: 'Leave ON. R2 is path-style by default.',
    endpointHint:
      'Your R2 account endpoint: https://<account-id>.r2.cloudflarestorage.com. Find it on the R2 dashboard.',
  },
  {
    id: 'do',
    label: 'DigitalOcean Spaces',
    hint: 'DigitalOcean Spaces. Console: cloud.digitalocean.com → Spaces Object Storage.',
    credentialsHint:
      'DO Cloud Panel → API → Spaces Keys → Generate New Key. Shown once.',
    regionHint:
      'The region slug your Space lives in: nyc3, sfo3, sgp1, fra1, ams3, blr1, syd1, tor1.',
    pathStyleHint:
      'Turn OFF — DO Spaces uses virtual-hosted-style by default.',
    endpointHint:
      'Region-scoped Spaces endpoint: https://<region>.digitaloceanspaces.com (e.g. https://nyc3.digitaloceanspaces.com).',
  },
  {
    id: 'gcs',
    label: 'Google Cloud Storage',
    hint: 'Google Cloud Storage in S3-interoperability mode. Console: console.cloud.google.com/storage.',
    credentialsHint:
      'GCS Console → Settings → Interoperability → Service account HMAC keys → Create a key. Required for S3-compatible access.',
    regionHint:
      'The bucket\'s location: us-central1, europe-west1, asia-southeast1, etc.',
    pathStyleHint: 'Leave ON for the S3-interop endpoint.',
    endpointHint:
      'Use the S3-compatible endpoint: https://storage.googleapis.com.',
  },
];

const currentProvider = computed(() =>
  PROVIDERS.find((p) => p.id === provider.value) ?? PROVIDERS[0]!,
);
const providerHint = computed<string>(() => currentProvider.value.hint);
const regionHintText = computed<string>(() => currentProvider.value.regionHint);
const pathStyleHintText = computed<string>(
  () => currentProvider.value.pathStyleHint,
);
const credentialsHintText = computed<string>(
  () => currentProvider.value.credentialsHint,
);
const endpointHintText = computed<string>(
  () => currentProvider.value.endpointHint,
);

const storageStatus = computed<'configured' | 'unconfigured'>(() =>
  isConfigured.value ? 'configured' : 'unconfigured',
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await storageSettingsApi.get();
    provider.value = data.provider;
    bucket.value = data.bucket;
    region.value = data.region;
    forcePathStyle.value = data.forcePathStyle;
    accessKeyId.value = data.accessKeyId;
    secretAccessKey.value = data.secretAccessKey;
    origSecret.value = data.secretAccessKey;
    publicMediaUrl.value = data.publicMediaUrl;
    publicApiEndpoint.value = data.publicApiEndpoint;
    isConfigured.value = data.isConfigured;
  } catch (e) {
    toast.error(formatApiError(e, 'Failed to load storage settings'));
  } finally {
    loading.value = false;
  }
}

async function saveStorage(): Promise<void> {
  saving.value = true;
  testResult.value = null;
  try {
    const input: StorageSettingsInput = {
      provider: provider.value,
      bucket: bucket.value,
      region: region.value === '' ? null : region.value,
      forcePathStyle: forcePathStyle.value,
      accessKeyId: accessKeyId.value === '' ? null : accessKeyId.value,
      publicMediaUrl: publicMediaUrl.value === '' ? null : publicMediaUrl.value,
      publicApiEndpoint:
        publicApiEndpoint.value === '' ? null : publicApiEndpoint.value,
    };
    // Only send the secret if the user retyped it.
    if (secretAccessKey.value !== origSecret.value) {
      input.secretAccessKey = secretAccessKey.value;
    }
    const { data } = await storageSettingsApi.update(input);
    provider.value = data.provider;
    bucket.value = data.bucket;
    region.value = data.region;
    forcePathStyle.value = data.forcePathStyle;
    accessKeyId.value = data.accessKeyId;
    secretAccessKey.value = data.secretAccessKey;
    origSecret.value = data.secretAccessKey;
    publicMediaUrl.value = data.publicMediaUrl;
    publicApiEndpoint.value = data.publicApiEndpoint;
    isConfigured.value = data.isConfigured;
    toast.success('Storage settings saved');
  } catch (e) {
    toast.error(formatApiError(e, 'Failed to save'));
  } finally {
    saving.value = false;
  }
}

async function testConnection(): Promise<void> {
  testing.value = true;
  testResult.value = null;
  try {
    const { data } = await storageSettingsApi.test();
    testResult.value = data;
  } catch (e) {
    testResult.value = {
      success: false,
      message: formatApiError(e, 'Test failed'),
    };
  } finally {
    testing.value = false;
  }
}

// ─── Monitoring tab state ────────────────────────────────────────────────────
const monLoading = ref(true);
const monSaving = ref(false);

const sentryDsn = ref('');
const monEnvironment = ref('');
const monRelease = ref('');
const tracesSampleRate = ref(0); // 0-100 for the slider; resolver divides
const captureUnhandled = ref(true);
const includeUserCtx = ref(false);
const monConfigured = ref(false);
const monPartial = ref(false);
const origDsn = ref('');
const showDsn = ref(false);

const ENV_OPTIONS = [
  { value: '', label: '— Not set —' },
  { value: 'production', label: 'production' },
  { value: 'staging', label: 'staging' },
  { value: 'development', label: 'development' },
] as const;

const monStatus = computed<'configured' | 'partial' | 'off'>(() => {
  if (!monConfigured.value) return 'off';
  if (monPartial.value) return 'partial';
  return 'configured';
});

async function loadMonitoring(): Promise<void> {
  monLoading.value = true;
  try {
    const { data } = await monitoringSettingsApi.get();
    sentryDsn.value = data.sentryDsn;
    origDsn.value = data.sentryDsn;
    monEnvironment.value = data.environment;
    monRelease.value = data.releaseTag;
    tracesSampleRate.value = data.tracesSampleRate;
    captureUnhandled.value = data.captureUnhandledErrors;
    includeUserCtx.value = data.includeUserContext;
    monConfigured.value = data.isConfigured;
    monPartial.value = data.isPartial;
  } catch (e) {
    toast.error(formatApiError(e, 'Failed to load monitoring settings'));
  } finally {
    monLoading.value = false;
  }
}

async function saveMonitoring(): Promise<void> {
  monSaving.value = true;
  try {
    const input: MonitoringSettingsInput = {
      environment: monEnvironment.value === '' ? null : monEnvironment.value,
      releaseTag: monRelease.value === '' ? null : monRelease.value,
      tracesSampleRate: tracesSampleRate.value,
      captureUnhandledErrors: captureUnhandled.value,
      includeUserContext: includeUserCtx.value,
    };
    if (sentryDsn.value !== origDsn.value) {
      input.sentryDsn = sentryDsn.value;
    }
    const { data } = await monitoringSettingsApi.update(input);
    sentryDsn.value = data.sentryDsn;
    origDsn.value = data.sentryDsn;
    monEnvironment.value = data.environment;
    monRelease.value = data.releaseTag;
    tracesSampleRate.value = data.tracesSampleRate;
    captureUnhandled.value = data.captureUnhandledErrors;
    includeUserCtx.value = data.includeUserContext;
    monConfigured.value = data.isConfigured;
    monPartial.value = data.isPartial;
    toast.success(
      'Monitoring settings saved. Restart the API service for changes to take effect.',
    );
  } catch (e) {
    toast.error(formatApiError(e, 'Failed to save'));
  } finally {
    monSaving.value = false;
  }
}

// ─── AI Assistant tab state ──────────────────────────────────────────────────
const aiLoading = ref(true);
const aiSaving = ref(false);

const aiEnabled = ref(false);
const aiProvider = ref('');
const aiModel = ref('');
const aiBaseUrl = ref('');
const aiApiKey = ref('');
const aiConfigured = ref(false);
const origAiKey = ref('');
const showAiKey = ref(false);

// Provider is a UX preset that fills the base URL; the wire format is the
// OpenAI-compatible Chat Completions API for all of them. Model stays free
// text.
const AI_PROVIDERS = [
  { value: '', label: '— Not set —', baseUrl: '' },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  {
    value: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    value: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { value: 'custom', label: 'Custom / Local', baseUrl: '' },
] as const;

const aiStatus = computed<'configured' | 'off'>(() =>
  aiEnabled.value && aiConfigured.value ? 'configured' : 'off',
);

// Pick a provider → fill its base URL, but never clobber a hand-edited URL:
// only auto-fill when the field is empty or still holds another preset.
function onAiProviderChange(): void {
  const preset = AI_PROVIDERS.find((p) => p.value === aiProvider.value);
  if (!preset || !preset.baseUrl) return;
  const presetUrls: string[] = AI_PROVIDERS.map((p) => p.baseUrl).filter(
    Boolean,
  );
  if (aiBaseUrl.value === '' || presetUrls.includes(aiBaseUrl.value)) {
    aiBaseUrl.value = preset.baseUrl;
  }
}

async function loadAi(): Promise<void> {
  aiLoading.value = true;
  try {
    const { data } = await aiSettingsApi.get();
    aiEnabled.value = data.enabled;
    aiProvider.value = data.provider;
    aiModel.value = data.model;
    aiBaseUrl.value = data.baseUrl;
    aiApiKey.value = data.apiKey;
    origAiKey.value = data.apiKey;
    aiConfigured.value = data.isConfigured;
  } catch (e) {
    toast.error(formatApiError(e, 'Failed to load AI settings'));
  } finally {
    aiLoading.value = false;
  }
}

async function saveAi(): Promise<void> {
  aiSaving.value = true;
  try {
    const input: AiSettingsInput = {
      enabled: aiEnabled.value,
      provider: aiProvider.value === '' ? null : aiProvider.value,
      model: aiModel.value.trim() === '' ? null : aiModel.value.trim(),
      baseUrl: aiBaseUrl.value.trim() === '' ? null : aiBaseUrl.value.trim(),
    };
    // Only retransmit the key when the user actually retyped it.
    if (aiApiKey.value !== origAiKey.value) {
      input.apiKey = aiApiKey.value;
    }
    const { data } = await aiSettingsApi.update(input);
    aiEnabled.value = data.enabled;
    aiProvider.value = data.provider;
    aiModel.value = data.model;
    aiBaseUrl.value = data.baseUrl;
    aiApiKey.value = data.apiKey;
    origAiKey.value = data.apiKey;
    aiConfigured.value = data.isConfigured;
    toast.success('AI settings saved');
  } catch (e) {
    toast.error(formatApiError(e, 'Failed to save'));
  } finally {
    aiSaving.value = false;
  }
}

// ─── System tab state ────────────────────────────────────────────────────────
const sysLoading = ref(true);
const sysSaving = ref(false);

const rateLimitMax = ref(100);
const rateLimitWindowValue = ref(1);
const rateLimitWindowUnit = ref<RateLimitUnit>('minute');
const workerImage = ref(2);
const workerWebhook = ref(16);
const workerSearch = ref(8);
const workerSchedule = ref(4);
const workerEmailC = ref(4);

// Site URL lives in siteSettings.siteUrl — load the full row, PUT with all
// existing fields + the (possibly edited) siteUrl. siteSettings.PUT requires
// siteName too, so we round-trip the loaded values rather than reinventing.
const siteUrl = ref('');
const siteSettingsRow = ref<SiteSettings | null>(null);

// Empty is fine (Site URL is optional). Non-empty must have a scheme + "//" —
// `http:localhost:3001` would parse as a valid URL with `localhost:3001` as the
// path, so we check the prefix explicitly before handing off to the URL ctor.
const siteUrlError = computed<string | null>(() => {
  const v = siteUrl.value.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) {
    return 'Must be a full URL, e.g. http://localhost:3001 or https://news.example.com';
  }
  try {
    new URL(v);
    return null;
  } catch {
    return 'Must be a full URL, e.g. http://localhost:3001 or https://news.example.com';
  }
});

const rateLimitSummary = computed<string>(() => {
  const noun = rateLimitWindowUnit.value === 'second' ? 'second' : 'minute';
  const plural = rateLimitWindowValue.value === 1 ? noun : `${noun}s`;
  return `${rateLimitMax.value} requests per ${rateLimitWindowValue.value} ${plural}`;
});

async function loadSystem(): Promise<void> {
  sysLoading.value = true;
  try {
    const [{ data: sys }, site] = await Promise.all([
      systemSettingsApi.get(),
      siteSettingsApi.get(),
    ]);
    rateLimitMax.value = sys.rateLimitMax;
    rateLimitWindowValue.value = sys.rateLimitWindowValue;
    rateLimitWindowUnit.value = sys.rateLimitWindowUnit;
    workerImage.value = sys.workerImageConcurrency;
    workerWebhook.value = sys.workerWebhookConcurrency;
    workerSearch.value = sys.workerSearchIndexConcurrency;
    workerSchedule.value = sys.workerSchedulePublishConcurrency;
    workerEmailC.value = sys.workerEmailConcurrency;

    siteSettingsRow.value = site.data;
    siteUrl.value = site.data?.siteUrl ?? '';
  } catch (e) {
    toast.error(formatApiError(e, 'Failed to load system settings'));
  } finally {
    sysLoading.value = false;
  }
}

async function saveSystem(): Promise<void> {
  sysSaving.value = true;
  try {
    const input: SystemSettingsInput = {
      rateLimitMax: rateLimitMax.value,
      rateLimitWindowValue: rateLimitWindowValue.value,
      rateLimitWindowUnit: rateLimitWindowUnit.value,
      workerImageConcurrency: workerImage.value,
      workerWebhookConcurrency: workerWebhook.value,
      workerSearchIndexConcurrency: workerSearch.value,
      workerSchedulePublishConcurrency: workerSchedule.value,
      workerEmailConcurrency: workerEmailC.value,
    };
    const ops: Promise<unknown>[] = [systemSettingsApi.update(input)];

    // Site URL: only PUT if it changed AND we have the existing row to PUT
    // alongside the (PUT-required) siteName. If site_settings was never
    // created, surface a clear toast — user should set it up in Site Settings.
    const existing = siteSettingsRow.value;
    if (existing && siteUrl.value !== existing.siteUrl) {
      const siteInput: SiteSettingsInput = {
        siteName: existing.siteName,
        siteUrl: siteUrl.value,
        siteDescription: existing.siteDescription,
        logoKey: existing.logoKey,
        faviconKey: existing.faviconKey,
        defaultOgImageKey: existing.defaultOgImageKey,
        contactEmail: existing.contactEmail,
        socialLinks: existing.socialLinks,
        defaultMetaTitleSuffix: existing.defaultMetaTitleSuffix,
        defaultRobots: existing.defaultRobots,
        googleSiteVerification: existing.googleSiteVerification,
        analyticsId: existing.analyticsId,
        commentsEnabled: existing.commentsEnabled,
        registrationEnabled: existing.registrationEnabled,
        maintenanceMode: existing.maintenanceMode,
        customHeadScripts: existing.customHeadScripts,
        customBodyScripts: existing.customBodyScripts,
        extra: existing.extra,
      };
      ops.push(siteSettingsApi.put(siteInput));
    } else if (!existing && siteUrl.value.length > 0) {
      toast.error(
        'Site URL needs Site Name too — set both in Site Settings first.',
      );
    }

    await Promise.all(ops);
    toast.success(
      'System settings saved. Restart api + worker services for rate-limit + concurrency changes to take effect.',
    );
    // Reload to reflect any field-shape changes (e.g. site-settings row created).
    await loadSystem();
  } catch (e) {
    toast.error(formatApiError(e, 'Failed to save'));
  } finally {
    sysSaving.value = false;
  }
}

// One Save button in the page header saves the ACTIVE tab (matches the Site
// Settings layout). Each tab targets its own settings endpoint.
const activeSaving = computed(() => {
  if (activeTab.value === 'storage') return saving.value;
  if (activeTab.value === 'monitoring') return monSaving.value;
  if (activeTab.value === 'ai') return aiSaving.value;
  return sysSaving.value;
});
const saveDisabled = computed(
  () =>
    activeSaving.value ||
    (activeTab.value === 'system' && Boolean(siteUrlError.value)),
);
function saveActive(): void {
  if (activeTab.value === 'storage') void saveStorage();
  else if (activeTab.value === 'monitoring') void saveMonitoring();
  else if (activeTab.value === 'ai') void saveAi();
  else void saveSystem();
}

onMounted(() => {
  void load();
  void loadMonitoring();
  void loadAi();
  void loadSystem();
});
</script>

<template>
  <div class="infra-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Infrastructure</h1>
        <p class="page-subtitle">
          Configure storage, monitoring, AI, and system performance settings
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="saveDisabled"
        @click="saveActive"
      >
        {{ activeSaving ? 'Saving…' : 'Save Changes' }}
      </button>
    </header>

    <div class="settings-layout">
      <!-- LEFT SUB-NAV -->
      <aside class="settings-subnav">
        <nav class="subnav-card">
          <button
            type="button"
            class="subnav-item"
            :class="{ active: activeTab === 'storage' }"
            @click="activeTab = 'storage'"
          >
            <span
              class="subnav-dot"
              :class="storageStatus === 'configured' ? 'dot-ok' : 'dot-off'"
            />
            Object Storage
          </button>
          <button
            type="button"
            class="subnav-item"
            :class="{ active: activeTab === 'monitoring' }"
            @click="activeTab = 'monitoring'"
          >
            <span
              class="subnav-dot"
              :class="{
                'dot-ok': monStatus === 'configured',
                'dot-warn': monStatus === 'partial',
                'dot-off': monStatus === 'off',
              }"
            />
            Error Monitoring
          </button>
          <button
            type="button"
            class="subnav-item"
            :class="{ active: activeTab === 'ai' }"
            @click="activeTab = 'ai'"
          >
            <span
              class="subnav-dot"
              :class="aiStatus === 'configured' ? 'dot-ok' : 'dot-off'"
            />
            AI Assistant
          </button>
          <button
            type="button"
            class="subnav-item"
            :class="{ active: activeTab === 'system' }"
            @click="activeTab = 'system'"
          >
            <span class="subnav-dot dot-ok" />
            System &amp; Performance
          </button>
        </nav>

        <div class="status-card">
          <div class="status-card-label">Status</div>
          <div class="status-row">
            <span>Storage</span>
            <span
              class="chip"
              :class="
                storageStatus === 'configured' ? 'chip-ok' : 'chip-off'
              "
            >{{ storageStatus === 'configured' ? 'Configured' : 'Not configured' }}</span>
          </div>
          <div class="status-row">
            <span>Monitoring</span>
            <span
              class="chip"
              :class="{
                'chip-ok': monStatus === 'configured',
                'chip-warn': monStatus === 'partial',
                'chip-off': monStatus === 'off',
              }"
            >{{
              monStatus === 'configured'
                ? 'Active'
                : monStatus === 'partial'
                  ? 'Partial'
                  : 'Off'
            }}</span>
          </div>
          <div class="status-row">
            <span>AI Assistant</span>
            <span
              class="chip"
              :class="aiStatus === 'configured' ? 'chip-ok' : 'chip-off'"
            >{{ aiStatus === 'configured' ? 'Active' : 'Off' }}</span>
          </div>
          <div class="status-row">
            <span>System</span>
            <span class="chip chip-ok">Active</span>
          </div>
        </div>
      </aside>

      <!-- RIGHT CONTENT -->
      <section class="settings-content">
        <!-- ── STORAGE TAB ── -->
        <div v-if="activeTab === 'storage'" class="card">
          <div v-if="loading" class="loading">Loading…</div>
          <template v-else>
            <!-- Provider -->
            <section class="form-section">
              <div class="section-head">
                <div>
                  <h2 class="section-title">Object Storage</h2>
                  <p class="section-desc">
                    Where your uploaded media files and images are stored.
                  </p>
                </div>
                <span
                  class="chip"
                  :class="
                    storageStatus === 'configured' ? 'chip-ok' : 'chip-off'
                  "
                >
                  {{ storageStatus === 'configured' ? 'Configured' : 'Not configured' }}
                </span>
              </div>

              <div class="form-group">
                <label for="infra-storage-provider" class="form-label">Storage Provider</label>
                <select id="infra-storage-provider" v-model="provider" class="form-select">
                  <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">
                    {{ p.label }}
                  </option>
                </select>
                <p class="form-hint">{{ providerHint }}</p>
              </div>
            </section>

            <!-- Bucket -->
            <section class="form-section">
              <h2 class="section-title">Bucket Configuration</h2>
              <p class="section-desc">
                The bucket where all uploaded files will be stored.
              </p>
              <div class="form-row">
                <div class="form-group">
                  <label for="infra-storage-bucket" class="form-label">Bucket Name</label>
                  <input
                    id="infra-storage-bucket"
                    v-model="bucket"
                    class="form-input"
                    placeholder="e.g. cms-media"
                  />
                  <p class="form-hint">
                    The exact bucket / container name from your provider's
                    console. Must already exist — this page doesn't create
                    buckets. For MinIO dev: the bucket auto-created by
                    minio-setup is <code>cms-media</code>.
                  </p>
                </div>
                <div class="form-group">
                  <label for="infra-storage-region" class="form-label">Region</label>
                  <input
                    id="infra-storage-region"
                    v-model="region"
                    class="form-input"
                    placeholder="e.g. us-east-1"
                  />
                  <p class="form-hint">{{ regionHintText }}</p>
                </div>
              </div>
              <div class="toggle-row">
                <label class="toggle-switch">
                  <input
                    v-model="forcePathStyle"
                    type="checkbox"
                  />
                  <span class="toggle-slider" />
                </label>
                <div>
                  <div class="toggle-label">Force path-style URLs</div>
                  <div class="toggle-hint">{{ pathStyleHintText }}</div>
                </div>
              </div>
            </section>

            <!-- Credentials -->
            <section class="form-section">
              <h2 class="section-title">Access Credentials</h2>
              <p class="section-desc">
                {{ credentialsHintText }}
                The secret is encrypted at rest and never returned to the
                browser after saving.
              </p>
              <div class="form-row">
                <div class="form-group">
                  <label for="infra-storage-access-key" class="form-label">Access Key ID</label>
                  <input
                    id="infra-storage-access-key"
                    v-model="accessKeyId"
                    class="form-input mono"
                    placeholder="Your access key ID"
                  />
                  <p class="form-hint">
                    The public half of the access-key pair. Looks like
                    <code>AKIA…</code> on AWS; format varies per provider.
                    Not secret on its own — pairs with the secret below.
                  </p>
                </div>
                <div class="form-group">
                  <label for="infra-storage-secret-key" class="form-label">Secret Access Key</label>
                  <div class="secret-wrap">
                    <input
                      id="infra-storage-secret-key"
                      v-model="secretAccessKey"
                      :type="showSecret ? 'text' : 'password'"
                      class="form-input mono"
                      placeholder="Your secret key"
                    />
                    <button
                      type="button"
                      class="secret-toggle"
                      :aria-label="showSecret ? 'Hide' : 'Show'"
                      @click="showSecret = !showSecret"
                    >
                      {{ showSecret ? '🙈' : '👁' }}
                    </button>
                  </div>
                  <p class="form-hint">
                    Shown once on the provider console at access-key
                    creation — save it somewhere safe (you can't read it
                    back). Re-type here to change; leave the bullets
                    unchanged to keep the current value.
                  </p>
                </div>
              </div>
            </section>

            <!-- Public Access -->
            <section class="form-section">
              <h2 class="section-title">Public Access URLs</h2>
              <p class="section-desc">
                How browsers and your public site reach uploaded files.
                Two different URLs for two different purposes.
              </p>
              <div class="form-group">
                <label class="form-label">Public Media URL</label>
                <input
                  v-model="publicMediaUrl"
                  class="form-input"
                  placeholder="https://media.yoursite.com"
                />
                <p class="form-hint">
                  Where your readers load images from. <strong>Leave blank</strong>
                  to hand out 1-hour-signed URLs (works but invalidates
                  browser caches every hour). <strong>Set</strong> to a
                  CDN/bucket origin that serves the bucket contents at
                  <code>&lt;url&gt;/&lt;key&gt;</code> for fast, cacheable,
                  permanent public links — e.g. an AWS CloudFront
                  distribution in front of S3, a Cloudflare R2 public domain,
                  or a custom domain pointed at MinIO.
                </p>
              </div>
              <div class="form-group">
                <label class="form-label">
                  Public API Endpoint
                  <span class="optional">(optional)</span>
                </label>
                <input
                  v-model="publicApiEndpoint"
                  class="form-input"
                  placeholder="e.g. https://minio.yoursite.com"
                />
                <p class="form-hint">{{ endpointHintText }}</p>
                <p class="form-hint">
                  Different from Public Media URL: this one is used to
                  <em>sign</em> upload/download URLs the browser hits
                  directly. Required when the internal S3 endpoint isn't
                  browser-reachable — typical for Docker deploys where the
                  API talks to <code>http://minio:9000</code> internally but
                  the browser needs <code>https://minio.yoursite.com</code>.
                </p>
              </div>
            </section>

            <!-- Test + Save -->
            <div class="actions">
              <button
                type="button"
                class="btn btn-secondary"
                :disabled="testing"
                @click="testConnection"
              >
                {{ testing ? 'Testing…' : 'Test Connection' }}
              </button>
              <span class="actions-hint">
                Verifies bucket access with the saved credentials.
              </span>
            </div>
            <div
              v-if="testResult"
              class="test-result"
              :class="testResult.success ? 'ok' : 'fail'"
            >
              {{ testResult.message }}
            </div>
          </template>
        </div>

        <!-- ── MONITORING TAB ── -->
        <div v-if="activeTab === 'monitoring'" class="card">
          <div v-if="monLoading" class="loading">Loading…</div>
          <template v-else>
            <section class="form-section">
              <div class="section-head">
                <div>
                  <h2 class="section-title">Error Monitoring</h2>
                  <p class="section-desc">
                    Capture and track errors and exceptions in production.
                    Changes take effect after an API restart.
                  </p>
                </div>
                <span
                  class="chip"
                  :class="{
                    'chip-ok': monStatus === 'configured',
                    'chip-warn': monStatus === 'partial',
                    'chip-off': monStatus === 'off',
                  }"
                >{{
                  monStatus === 'configured'
                    ? 'Active'
                    : monStatus === 'partial'
                      ? 'Partial'
                      : 'Off'
                }}</span>
              </div>

              <div v-if="monStatus === 'partial'" class="info-banner">
                DSN is configured but environment is not set. Events will be
                captured but may be hard to filter in your dashboard.
              </div>

              <div class="form-group">
                <label for="infra-monitoring-dsn" class="form-label">Sentry DSN</label>
                <div class="secret-wrap">
                  <input
                    id="infra-monitoring-dsn"
                    v-model="sentryDsn"
                    :type="showDsn ? 'text' : 'password'"
                    class="form-input mono"
                    placeholder="https://...@sentry.io/..."
                  />
                  <button
                    type="button"
                    class="secret-toggle"
                    :aria-label="showDsn ? 'Hide' : 'Show'"
                    @click="showDsn = !showDsn"
                  >
                    {{ showDsn ? '🙈' : '👁' }}
                  </button>
                </div>
                <p class="form-hint">
                  Sentry: Project → Settings → Client Keys (DSN). Glitchtip
                  (self-hosted): Project → Settings → Client Keys. Format:
                  <code>https://&lt;public-key&gt;@&lt;host&gt;/&lt;project-id&gt;</code>.
                  Leave blank to disable error capture entirely.
                </p>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="infra-monitoring-environment" class="form-label">Environment</label>
                  <select
                    id="infra-monitoring-environment"
                    v-model="monEnvironment"
                    class="form-select"
                  >
                    <option
                      v-for="opt in ENV_OPTIONS"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                  <p class="form-hint">
                    Tags every event with this label so you can filter prod
                    errors from staging in the same project. Leave on
                    "Not set" to use NODE_ENV instead.
                  </p>
                </div>
                <div class="form-group">
                  <label class="form-label">
                    Release Tag <span class="optional">(optional)</span>
                  </label>
                  <input
                    v-model="monRelease"
                    class="form-input mono"
                    placeholder="e.g. v1.4.2 or git SHA"
                  />
                  <p class="form-hint">
                    A deploy identifier — typically the git SHA from CI
                    (<code>git rev-parse HEAD</code>) or a release tag.
                    Lets you spot regressions introduced by a specific
                    deploy. Updates per deploy in CI; manual entry is fine
                    for local debugging.
                  </p>
                </div>
              </div>
            </section>

            <section class="form-section">
              <h2 class="section-title">Performance Monitoring</h2>
              <p class="section-desc">
                Trace slow API responses and database queries.
              </p>
              <div class="form-group">
                <label class="form-label">
                  Traces Sample Rate
                  <span class="range-val">{{ tracesSampleRate }}%</span>
                </label>
                <input
                  v-model.number="tracesSampleRate"
                  type="range"
                  min="0"
                  max="100"
                  class="range-input"
                />
                <p class="form-hint">
                  Percentage of requests sampled for performance tracing.
                  Higher = more data, higher cost. 10–20% is typical.
                </p>
              </div>

              <div class="toggle-row">
                <label class="toggle-switch">
                  <input v-model="captureUnhandled" type="checkbox" />
                  <span class="toggle-slider" />
                </label>
                <div>
                  <div class="toggle-label">Capture unhandled errors</div>
                  <div class="toggle-hint">
                    Automatically report uncaught exceptions and promise
                    rejections.
                  </div>
                </div>
              </div>
              <div class="toggle-row">
                <label class="toggle-switch">
                  <input v-model="includeUserCtx" type="checkbox" />
                  <span class="toggle-slider" />
                </label>
                <div>
                  <div class="toggle-label">Include user context</div>
                  <div class="toggle-hint">
                    Attach the logged-in admin user id to each captured event.
                  </div>
                </div>
              </div>
            </section>
          </template>
        </div>

        <!-- ── AI ASSISTANT TAB ── -->
        <div v-if="activeTab === 'ai'" class="card">
          <div v-if="aiLoading" class="loading">Loading…</div>
          <template v-else>
            <section class="form-section">
              <div class="section-head">
                <div>
                  <h2 class="section-title">AI Assistant</h2>
                  <p class="section-desc">
                    Connect an AI provider to power the in-admin chat assistant.
                    Any OpenAI-compatible endpoint works (OpenAI, Anthropic,
                    Google, OpenRouter, or a local/self-hosted model).
                  </p>
                </div>
                <span
                  class="chip"
                  :class="aiStatus === 'configured' ? 'chip-ok' : 'chip-off'"
                >{{ aiStatus === 'configured' ? 'Active' : 'Off' }}</span>
              </div>

              <div class="toggle-row">
                <label class="toggle-switch">
                  <input v-model="aiEnabled" type="checkbox" />
                  <span class="toggle-slider" />
                </label>
                <div>
                  <div class="toggle-label">Enable AI Assistant</div>
                  <div class="toggle-hint">
                    Master switch. When off, the chat panel is hidden for
                    everyone and the chat endpoint refuses requests.
                  </div>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="infra-ai-provider" class="form-label">Provider</label>
                  <select
                    id="infra-ai-provider"
                    v-model="aiProvider"
                    class="form-select"
                    @change="onAiProviderChange"
                  >
                    <option
                      v-for="opt in AI_PROVIDERS"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                  <p class="form-hint">
                    Presets the Base URL; the assistant always uses the
                    OpenAI-compatible API.
                  </p>
                </div>
                <div class="form-group">
                  <label for="infra-ai-model" class="form-label">Model</label>
                  <input
                    id="infra-ai-model"
                    v-model="aiModel"
                    class="form-input mono"
                    placeholder="e.g. gpt-4o, claude-sonnet-4-6, gemini-2.5-pro"
                  />
                  <p class="form-hint">
                    The model id sent with each request — must match one your
                    endpoint serves.
                  </p>
                </div>
              </div>

              <div class="form-group">
                <label for="infra-ai-key" class="form-label">API Key</label>
                <div class="secret-wrap">
                  <input
                    id="infra-ai-key"
                    v-model="aiApiKey"
                    :type="showAiKey ? 'text' : 'password'"
                    class="form-input mono"
                    placeholder="sk-…"
                  />
                  <button
                    type="button"
                    class="secret-toggle"
                    :aria-label="showAiKey ? 'Hide' : 'Show'"
                    @click="showAiKey = !showAiKey"
                  >
                    {{ showAiKey ? '🙈' : '👁' }}
                  </button>
                </div>
                <p class="form-hint">
                  Encrypted at rest and never shown again after saving. Leave the
                  mask to keep the current key; retype to replace it.
                </p>
              </div>

              <div class="form-group">
                <label for="infra-ai-base-url" class="form-label">Base URL</label>
                <input
                  id="infra-ai-base-url"
                  v-model="aiBaseUrl"
                  class="form-input mono"
                  placeholder="https://api.openai.com/v1"
                />
                <p class="form-hint">
                  OpenAI-compatible endpoint including the version path (e.g.
                  <code>/v1</code>). Auto-filled from the provider; edit for
                  gateways, Azure, or local servers.
                </p>
              </div>
            </section>
          </template>
        </div>

        <!-- ── SYSTEM TAB ── -->
        <div v-if="activeTab === 'system'" class="card">
          <div v-if="sysLoading" class="loading">Loading…</div>
          <template v-else>
            <section class="form-section">
              <div class="section-head">
                <div>
                  <h2 class="section-title">Rate Limiting</h2>
                  <p class="section-desc">
                    Protect your public API from excessive requests.
                  </p>
                </div>
                <span class="chip chip-ok">Active</span>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="infra-system-rate-max" class="form-label">Max Requests</label>
                  <input
                    id="infra-system-rate-max"
                    v-model.number="rateLimitMax"
                    type="number"
                    min="1"
                    class="form-input"
                  />
                  <p class="form-hint">
                    How many requests one IP can make to the public API
                    within the time window before getting rate-limited.
                    Admin routes never throttle; programmatic /api/v1
                    routes use per-API-key limits instead.
                  </p>
                </div>
                <div class="form-group">
                  <label class="form-label">Time Window</label>
                  <div class="window-row">
                    <input
                      v-model.number="rateLimitWindowValue"
                      type="number"
                      min="1"
                      class="form-input window-num"
                    />
                    <select
                      v-model="rateLimitWindowUnit"
                      class="form-select window-unit"
                    >
                      <option value="second">seconds</option>
                      <option value="minute">minutes</option>
                    </select>
                  </div>
                  <p class="form-hint">
                    Rolling window per IP. After this elapses, the counter
                    resets and the IP gets a fresh budget.
                  </p>
                </div>
              </div>
              <div class="summary-banner">
                At current settings: each IP can make up to
                <strong>{{ rateLimitSummary }}</strong>
                to the public API. Admin routes are not rate-limited.
              </div>
            </section>

            <section class="form-section">
              <h2 class="section-title">Background Job Concurrency</h2>
              <p class="section-desc">
                How many jobs each queue processes in parallel. Changes take
                effect after the worker restarts.
              </p>
              <div class="concurrency-grid">
                <div class="concurrency-item">
                  <div class="concurrency-label">Image Processing</div>
                  <div class="concurrency-row">
                    <input
                      v-model.number="workerImage"
                      type="range"
                      min="1"
                      max="8"
                      class="range-input"
                    />
                    <span class="concurrency-num">{{ workerImage }}</span>
                  </div>
                  <p class="form-hint">Sharp image variant generation</p>
                </div>
                <div class="concurrency-item">
                  <div class="concurrency-label">Webhook Delivery</div>
                  <div class="concurrency-row">
                    <input
                      v-model.number="workerWebhook"
                      type="range"
                      min="1"
                      max="32"
                      class="range-input"
                    />
                    <span class="concurrency-num">{{ workerWebhook }}</span>
                  </div>
                  <p class="form-hint">Outbound HTTP callbacks</p>
                </div>
                <div class="concurrency-item">
                  <div class="concurrency-label">Search Indexing</div>
                  <div class="concurrency-row">
                    <input
                      v-model.number="workerSearch"
                      type="range"
                      min="1"
                      max="16"
                      class="range-input"
                    />
                    <span class="concurrency-num">{{ workerSearch }}</span>
                  </div>
                  <p class="form-hint">Meilisearch upserts on publish</p>
                </div>
                <div class="concurrency-item">
                  <div class="concurrency-label">Email Sending</div>
                  <div class="concurrency-row">
                    <input
                      v-model.number="workerEmailC"
                      type="range"
                      min="1"
                      max="16"
                      class="range-input"
                    />
                    <span class="concurrency-num">{{ workerEmailC }}</span>
                  </div>
                  <p class="form-hint">Transactional email dispatch</p>
                </div>
                <div class="concurrency-item">
                  <div class="concurrency-label">Scheduled Publishing</div>
                  <div class="concurrency-row">
                    <input
                      v-model.number="workerSchedule"
                      type="range"
                      min="1"
                      max="8"
                      class="range-input"
                    />
                    <span class="concurrency-num">{{ workerSchedule }}</span>
                  </div>
                  <p class="form-hint">Auto-publish at publish_at time</p>
                </div>
              </div>
              <div class="warn-banner">
                Higher concurrency uses more memory and CPU. On a small VPS
                (1–2 vCPU), keep image and email workers low to avoid
                resource contention.
              </div>
            </section>

            <section class="form-section">
              <h2 class="section-title">Public Site URL</h2>
              <p class="section-desc">
                Used to build preview links in the editor and outbound
                webhook payloads. Same field as Site Settings → Site URL.
              </p>
              <div class="form-group">
                <label for="infra-system-site-url" class="form-label">Site URL</label>
                <input
                  id="infra-system-site-url"
                  v-model="siteUrl"
                  class="form-input"
                  :class="{ 'form-input-invalid': siteUrlError }"
                  :aria-invalid="siteUrlError ? 'true' : 'false'"
                  placeholder="https://yoursite.com"
                />
                <p v-if="siteUrlError" class="form-error">{{ siteUrlError }}</p>
                <p class="form-hint">
                  The public origin of your Nuxt site — the URL readers
                  actually visit (e.g. <code>https://news.yoursite.com</code>,
                  not the internal Docker hostname). Used by admin Preview
                  buttons + outbound email links. No trailing slash. Same
                  value as Site Settings → Site URL.
                </p>
              </div>
            </section>

          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.infra-page {
  padding: 24px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}
.page-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.settings-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.settings-subnav {
  width: 200px;
  flex-shrink: 0;
}
.subnav-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.subnav-item {
  appearance: none;
  background: none;
  border: 0;
  text-align: left;
  font: inherit;
  padding: 8px 10px 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  position: relative;
  transition: background 0.15s, color 0.15s;
}
.subnav-item:hover {
  background: rgba(120, 120, 120, 0.08);
  color: var(--text-primary);
}
.subnav-item.active {
  background: rgba(245, 158, 11, 0.12);
  color: var(--text-primary);
  font-weight: 600;
}
.subnav-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-ok { background: var(--success, #059669); }
.dot-warn { background: var(--warning, #d97706); }
.dot-off { background: var(--border, #e5e7eb); }

.status-card {
  margin-top: 16px;
  padding: 12px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.status-card-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}
.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.status-row:last-child { margin-bottom: 0; }

.settings-content {
  flex: 1;
  min-width: 0;
}
.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
}
.loading {
  color: var(--text-tertiary);
  text-align: center;
  padding: 32px 0;
}

.form-section {
  padding-bottom: 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border);
}
.form-section:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}
.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}
.section-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 4px 0 16px;
}

.form-group { margin-bottom: 16px; }
.form-group:last-child { margin-bottom: 0; }
.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
  display: block;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.form-label .optional {
  font-weight: 400;
  text-transform: none;
  font-size: 11px;
  color: var(--text-tertiary);
}
.form-input,
.form-select {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--text-primary);
  background: var(--card-bg);
  outline: none;
  transition: border 0.15s;
}
.form-input:focus,
.form-select:focus { border-color: var(--text-tertiary); }
.form-input.mono { font-family: ui-monospace, monospace; font-size: 12.5px; }
.form-select { cursor: pointer; }
.form-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
}
.form-error {
  font-size: 11px;
  color: var(--danger);
  margin-top: 4px;
  font-weight: 500;
}
.form-input-invalid {
  border-color: var(--danger);
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.secret-wrap { position: relative; }
.secret-wrap .form-input { padding-right: 40px; }
.secret-toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: 0;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-tertiary);
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
}
.toggle-slider::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  top: 3px;
  left: 3px;
  transition: transform 0.2s;
}
.toggle-switch input:checked + .toggle-slider { background: var(--success, #059669); }
.toggle-switch input:checked + .toggle-slider::after {
  transform: translateX(16px);
}
.toggle-label {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}
.toggle-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
}
.chip::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.chip-ok {
  background: var(--success-soft, #d1fae5);
  color: var(--success);
}
.chip-ok::before { background: var(--success, #059669); }
.chip-warn {
  background: var(--warning-soft, #fef3c7);
  color: var(--warning);
}
.chip-warn::before { background: var(--warning, #d97706); }
.chip-off {
  background: var(--surface-2);
  color: var(--muted);
}
.chip-off::before { background: var(--muted); }

.info-banner {
  background: var(--info-soft, #dbeafe);
  border: 1px solid var(--info-soft);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 12.5px;
  color: var(--info);
  margin-bottom: 16px;
}

.range-input {
  width: 100%;
  accent-color: var(--text-primary);
}
.range-val {
  font-weight: 700;
  color: var(--text-primary);
  margin-left: 8px;
  text-transform: none;
}

.window-row {
  display: flex;
  gap: 8px;
}
.window-num { flex: 1; }
.window-unit { width: 110px; flex-shrink: 0; }

.summary-banner {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--page-bg);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.warn-banner {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--warning-soft, #fef3c7);
  border: 1px solid #fde68a;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--warning);
}

.concurrency-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.concurrency-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
}
.concurrency-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}
.concurrency-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.concurrency-num {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 24px;
  text-align: center;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.actions-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.actions-spacer { flex: 1; }
.btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  border: 1px solid transparent;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
/* .btn-primary colors come from global styles.css (dark mode → amber). Don't
   re-skin here — the old override used background: var(--fg), which is light in
   dark mode and made the white label invisible. */
.btn-secondary {
  background: var(--card-bg);
  color: var(--text-primary);
  border-color: var(--border);
}
.btn-secondary:hover:not(:disabled) { background: var(--page-bg); }

.test-result {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}
.test-result.ok {
  background: var(--success-soft, #d1fae5);
  color: var(--success);
}
.test-result.fail {
  background: var(--danger-soft, #fee2e2);
  color: var(--danger);
}

.placeholder {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}
</style>
