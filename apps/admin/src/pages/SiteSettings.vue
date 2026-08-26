<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { siteSettingsApi, type SiteSettingsInput } from '@/api/site-settings';
import MediaKeyField from '@/components/MediaKeyField.vue';

interface SocialRow {
  platform: string;
  url: string;
}

const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const savedMsg = ref<string | null>(null);

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'seo', label: 'SEO Defaults' },
  { id: 'social', label: 'Social Media' },
  { id: 'branding', label: 'Branding' },
  { id: 'advanced', label: 'Advanced' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];
const activeSection = ref<SectionId>('general');

const siteName = ref('');
const siteUrl = ref('');
const siteDescription = ref('');
const logoKey = ref('');
const faviconKey = ref('');
const defaultOgImageKey = ref('');
// Resolved display URLs from the API for thumbnails (the keys above are what we save).
const logoUrl = ref<string | null>(null);
const faviconUrl = ref<string | null>(null);
const ogImageUrl = ref<string | null>(null);
const contactEmail = ref('');
const socialRows = ref<SocialRow[]>([]);
const defaultMetaTitleSuffix = ref('');
const defaultRobots = ref('index,follow');
const googleSiteVerification = ref('');
const analyticsId = ref('');
const commentsEnabled = ref(false);
const registrationEnabled = ref(false);
const maintenanceMode = ref(false);
const customHeadScripts = ref('');
const customBodyScripts = ref('');
const extra = ref(''); // JSON

function toJson(v: unknown): string {
  if (v === null || v === undefined) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}
function parseJsonObject(s: string): Record<string, unknown> | null {
  if (!s.trim()) return null;
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function socialLinksToRows(v: Record<string, unknown> | null): SocialRow[] {
  if (!v || typeof v !== 'object') return [];
  return Object.entries(v).map(([platform, url]) => ({
    platform,
    url: typeof url === 'string' ? url : '',
  }));
}

function rowsToSocialLinks(rows: SocialRow[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const platform = r.platform.trim();
    const url = r.url.trim();
    if (platform && url) out[platform] = url;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function addSocialRow(): void {
  socialRows.value.push({ platform: '', url: '' });
}

function removeSocialRow(i: number): void {
  socialRows.value.splice(i, 1);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const { data } = await siteSettingsApi.get();
    if (data) {
      siteName.value = data.siteName;
      siteUrl.value = data.siteUrl;
      siteDescription.value = data.siteDescription ?? '';
      logoKey.value = data.logoKey ?? '';
      faviconKey.value = data.faviconKey ?? '';
      defaultOgImageKey.value = data.defaultOgImageKey ?? '';
      logoUrl.value = data.logoUrl ?? null;
      faviconUrl.value = data.faviconUrl ?? null;
      ogImageUrl.value = data.ogImageUrl ?? null;
      contactEmail.value = data.contactEmail ?? '';
      socialRows.value = socialLinksToRows(data.socialLinks);
      defaultMetaTitleSuffix.value = data.defaultMetaTitleSuffix ?? '';
      defaultRobots.value = data.defaultRobots;
      googleSiteVerification.value = data.googleSiteVerification ?? '';
      analyticsId.value = data.analyticsId ?? '';
      commentsEnabled.value = data.commentsEnabled;
      registrationEnabled.value = data.registrationEnabled;
      maintenanceMode.value = data.maintenanceMode;
      customHeadScripts.value = data.customHeadScripts ?? '';
      customBodyScripts.value = data.customBodyScripts ?? '';
      extra.value = toJson(data.extra);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function onSave(): Promise<void> {
  saving.value = true;
  error.value = null;
  savedMsg.value = null;
  const payload: SiteSettingsInput = {
    siteName: siteName.value,
    siteUrl: siteUrl.value,
    siteDescription: siteDescription.value || null,
    logoKey: logoKey.value || null,
    faviconKey: faviconKey.value || null,
    defaultOgImageKey: defaultOgImageKey.value || null,
    contactEmail: contactEmail.value || null,
    socialLinks: rowsToSocialLinks(socialRows.value),
    defaultMetaTitleSuffix: defaultMetaTitleSuffix.value || null,
    defaultRobots: defaultRobots.value,
    googleSiteVerification: googleSiteVerification.value || null,
    analyticsId: analyticsId.value || null,
    commentsEnabled: commentsEnabled.value,
    registrationEnabled: registrationEnabled.value,
    maintenanceMode: maintenanceMode.value,
    customHeadScripts: customHeadScripts.value || null,
    customBodyScripts: customBodyScripts.value || null,
    extra: parseJsonObject(extra.value),
  };
  try {
    await siteSettingsApi.put(payload);
    savedMsg.value = 'Saved';
    setTimeout(() => (savedMsg.value = null), 2500);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Site Settings</h1>
        <p class="page-subtitle">Configure your publication</p>
      </div>
      <div class="header-actions">
        <span v-if="error" class="msg error">{{ error }}</span>
        <span v-else-if="savedMsg" class="msg ok">✓ {{ savedMsg }}</span>
        <button type="button" class="btn btn-primary" :disabled="saving || loading" @click="onSave">
          {{ saving ? 'Saving…' : 'Save Changes' }}
        </button>
      </div>
    </header>

    <p v-if="loading" class="state-msg">Loading…</p>

    <div v-else class="settings-row">
      <!-- Section nav -->
      <aside class="settings-nav">
        <div class="card nav-card">
          <button
            v-for="s in SECTIONS"
            :key="s.id"
            type="button"
            class="nav-item"
            :class="{ active: activeSection === s.id }"
            @click="activeSection = s.id"
          >
            {{ s.label }}
          </button>
        </div>
      </aside>

      <!-- Section content -->
      <div class="settings-main">
        <div class="card">
          <!-- General -->
          <template v-if="activeSection === 'general'">
            <div class="settings-section-title">General Information</div>
            <div class="settings-section-desc">Basic details about your publication</div>
            <div class="form-group">
              <label class="form-label">Site Name</label>
              <input v-model="siteName" class="form-input" type="text" maxlength="200" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Site URL</label>
                <input v-model="siteUrl" class="form-input" type="url" />
              </div>
              <div class="form-group">
                <label class="form-label">Contact Email</label>
                <input v-model="contactEmail" class="form-input" type="email" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Site Description</label>
              <textarea v-model="siteDescription" class="form-textarea" rows="3" />
            </div>

            <div class="sub-section">
              <div class="settings-section-title">Features</div>
              <div class="settings-section-desc">Toggle site-wide behaviour</div>
              <div class="toggle-wrap">
                <button type="button" class="toggle" :class="{ on: commentsEnabled }" role="switch" :aria-checked="commentsEnabled" @click="commentsEnabled = !commentsEnabled" />
                <span>Enable commenting</span>
              </div>
              <div class="toggle-wrap">
                <button type="button" class="toggle" :class="{ on: registrationEnabled }" role="switch" :aria-checked="registrationEnabled" @click="registrationEnabled = !registrationEnabled" />
                <span>Allow public registration</span>
              </div>
              <div class="toggle-wrap">
                <button type="button" class="toggle" :class="{ on: maintenanceMode }" role="switch" :aria-checked="maintenanceMode" @click="maintenanceMode = !maintenanceMode" />
                <span>Maintenance mode</span>
              </div>
            </div>
          </template>

          <!-- SEO -->
          <template v-else-if="activeSection === 'seo'">
            <div class="settings-section-title">SEO Defaults</div>
            <div class="settings-section-desc">Defaults applied across pages</div>
            <div class="form-group">
              <label class="form-label">Meta Title Suffix</label>
              <input v-model="defaultMetaTitleSuffix" class="form-input" type="text" placeholder=" | My Site" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Default Robots</label>
                <input v-model="defaultRobots" class="form-input" type="text" />
              </div>
              <div class="form-group">
                <label class="form-label">Analytics ID (GA4)</label>
                <input v-model="analyticsId" class="form-input" type="text" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Google Site Verification</label>
              <input v-model="googleSiteVerification" class="form-input" type="text" />
            </div>
          </template>

          <!-- Social -->
          <template v-else-if="activeSection === 'social'">
            <div class="settings-section-title">Social Media</div>
            <div class="settings-section-desc">Links shown across the site</div>
            <p v-if="socialRows.length === 0" class="form-hint">No links yet — add one below.</p>
            <div v-for="(row, i) in socialRows" :key="i" class="social-row">
              <input v-model="row.platform" class="form-input" type="text" placeholder="Platform (e.g. twitter)" />
              <input v-model="row.url" class="form-input" type="url" placeholder="https://…" />
              <button type="button" class="icon-btn" aria-label="Remove link" title="Remove" @click="removeSocialRow(i)">✕</button>
            </div>
            <button type="button" class="add-social" @click="addSocialRow">+ Add link</button>
          </template>

          <!-- Branding -->
          <template v-else-if="activeSection === 'branding'">
            <div class="settings-section-title">Branding</div>
            <div class="settings-section-desc">Logo, favicon and default share image</div>
            <div class="form-group">
              <label class="form-label">Logo</label>
              <MediaKeyField v-model="logoKey" :preview-url="logoUrl" />
            </div>
            <div class="form-group">
              <label class="form-label">Favicon</label>
              <MediaKeyField v-model="faviconKey" :preview-url="faviconUrl" />
            </div>
            <div class="form-group">
              <label class="form-label">Default OG Image</label>
              <MediaKeyField v-model="defaultOgImageKey" :preview-url="ogImageUrl" />
            </div>
          </template>

          <!-- Advanced -->
          <template v-else>
            <div class="settings-section-title">Advanced</div>
            <div class="settings-section-desc">Custom scripts and extra configuration</div>
            <div class="form-group">
              <label class="form-label">Custom &lt;head&gt; Scripts</label>
              <textarea v-model="customHeadScripts" class="form-textarea code" rows="4" spellcheck="false" />
            </div>
            <div class="form-group">
              <label class="form-label">Custom Body Scripts</label>
              <textarea v-model="customBodyScripts" class="form-textarea code" rows="4" spellcheck="false" />
            </div>
            <div class="form-group">
              <label class="form-label">Extra (JSON)</label>
              <textarea v-model="extra" class="form-textarea code" rows="4" spellcheck="false" />
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.msg {
  font-size: 13px;
}
.msg.error {
  color: var(--danger);
}
.msg.ok {
  color: var(--success);
}
.state-msg {
  color: var(--muted);
  font-size: 0.9rem;
}

.settings-row {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.settings-nav {
  width: 200px;
  flex-shrink: 0;
}
.settings-main {
  flex: 1;
  min-width: 0;
}
@media (max-width: 760px) {
  .settings-row {
    flex-direction: column;
  }
  .settings-nav {
    width: 100%;
  }
}

.nav-card {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  text-align: left;
  padding: 8px 10px;
  border: none;
  background: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  color: var(--muted);
  transition:
    background 0.15s,
    color 0.15s;
}
.nav-item:hover {
  background: var(--bg);
  color: var(--fg);
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 600;
}

.settings-section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 4px;
}
.settings-section-desc {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
}
.sub-section {
  border-top: 1px solid var(--border);
  margin-top: 24px;
  padding-top: 24px;
}

.toggle-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  margin-top: 10px;
}
.toggle {
  width: 36px;
  height: 20px;
  background: var(--border);
  border: none;
  border-radius: 10px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
  padding: 0;
}
.toggle.on {
  background: var(--success);
}
.toggle::after {
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
.toggle.on::after {
  transform: translateX(16px);
}

.mono,
.code {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.code {
  font-size: 12.5px;
}

.social-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.icon-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: var(--radius);
  cursor: pointer;
  padding: 8px 11px;
  flex-shrink: 0;
  font-family: inherit;
}
.icon-btn:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.add-social {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}
.add-social:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
