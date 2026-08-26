<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  emailSettingsApi,
  type EmailProvider,
  type EmailSettingsInput,
  type TestEmailResult,
} from '@/api/email-settings';
import { toast } from '@/composables/useToast';

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const testResult = ref<TestEmailResult | null>(null);

const provider = ref<EmailProvider>('stub');
const fromName = ref('');
const fromAddress = ref('');
const replyTo = ref('');
const smtpHost = ref('');
const smtpPort = ref(587);
const smtpUser = ref('');
const smtpPass = ref('');
const resendApiKey = ref('');
const brevoApiKey = ref('');
const notifyOnReview = ref(true);
const notifyOnApproval = ref(true);
const notifyOnReaderSubmission = ref(false);
const isConfigured = ref(false);

// Originals for secret fields — a secret is only sent on save when its value
// differs from what we loaded (so the unchanged MASK is never re-submitted).
const origSmtpPass = ref('');
const origResendKey = ref('');
const origBrevoKey = ref('');

// Per-field show/hide for the password inputs.
const showSmtpPass = ref(false);
const showResendKey = ref(false);
const showBrevoKey = ref(false);

const PROVIDERS = [
  {
    id: 'smtp',
    label: 'SMTP',
    desc: 'Brevo, Mailgun, Gmail, any SMTP server',
    badge: 'Recommended',
    badgeKind: 'good',
  },
  {
    id: 'resend',
    label: 'Resend',
    desc: 'API key · 3,000 free emails/month',
  },
  {
    id: 'brevo',
    label: 'Brevo API',
    desc: 'API key · 9,000 free emails/month',
  },
  {
    id: 'stub',
    label: 'Stub (dev only)',
    desc: 'Logs to worker console, nothing sends',
    badge: 'Dev',
    badgeKind: 'warn',
  },
] as const;

// Notification events that exist as real triggers today.
const WIRED_TOGGLES = [
  {
    model: notifyOnReview,
    label: 'Article submitted for review',
    desc: 'Notifies all editors and admins',
  },
  {
    model: notifyOnApproval,
    label: 'Article approved or rejected',
    desc: 'Notifies the article author',
  },
  {
    model: notifyOnReaderSubmission,
    label: 'Reader submission received',
    desc: 'Notifies all editors and admins',
  },
];

// Events with no trigger yet — shown disabled so no one expects mail to send.
const INERT_TOGGLES = [
  { label: 'Article published', desc: 'Notifies the article author' },
  {
    label: 'System health alerts',
    desc: 'Notifies super_admin if a service goes down',
  },
];

const status = computed<{ kind: string; text: string }>(() => {
  if (provider.value === 'stub') {
    return {
      kind: 'dev',
      text: 'Dev mode — emails are logged to the worker console, nothing is sent.',
    };
  }
  if (testResult.value?.success) {
    return {
      kind: 'connected',
      text: `Connected — ${provider.value.toUpperCase()} · tested just now`,
    };
  }
  if (isConfigured.value) {
    return {
      kind: 'saved',
      text: 'Credentials saved — send a test email to verify delivery.',
    };
  }
  return {
    kind: 'unconfigured',
    text: 'Not configured yet — enter credentials, save, then send a test.',
  };
});

function selectProvider(p: EmailProvider): void {
  provider.value = p;
  // Switching provider invalidates the last test result.
  testResult.value = null;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await emailSettingsApi.get();
    provider.value = data.provider;
    fromName.value = data.fromName;
    fromAddress.value = data.fromAddress;
    replyTo.value = data.replyTo;
    smtpHost.value = data.smtpHost;
    smtpPort.value = data.smtpPort;
    smtpUser.value = data.smtpUser;
    smtpPass.value = data.smtpPass;
    origSmtpPass.value = data.smtpPass;
    resendApiKey.value = data.resendApiKey;
    origResendKey.value = data.resendApiKey;
    brevoApiKey.value = data.brevoApiKey;
    origBrevoKey.value = data.brevoApiKey;
    notifyOnReview.value = data.notifyOnReview;
    notifyOnApproval.value = data.notifyOnApproval;
    notifyOnReaderSubmission.value = data.notifyOnReaderSubmission;
    isConfigured.value = data.isConfigured;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to load email settings');
  } finally {
    loading.value = false;
  }
}

async function onSave(): Promise<void> {
  saving.value = true;
  const payload: EmailSettingsInput = {
    provider: provider.value,
    fromName: fromName.value || null,
    fromAddress: fromAddress.value || null,
    replyTo: replyTo.value || null,
    smtpHost: smtpHost.value || null,
    smtpPort: smtpPort.value,
    // Port 465 implies implicit TLS; 587/25 use STARTTLS/none.
    smtpSecure: smtpPort.value === 465,
    smtpUser: smtpUser.value || null,
    notifyOnReview: notifyOnReview.value,
    notifyOnApproval: notifyOnApproval.value,
    notifyOnReaderSubmission: notifyOnReaderSubmission.value,
  };
  // Only send a secret when the user actually changed it.
  if (smtpPass.value !== origSmtpPass.value) payload.smtpPass = smtpPass.value;
  if (resendApiKey.value !== origResendKey.value)
    payload.resendApiKey = resendApiKey.value;
  if (brevoApiKey.value !== origBrevoKey.value)
    payload.brevoApiKey = brevoApiKey.value;

  try {
    const { data } = await emailSettingsApi.update(payload);
    // Re-sync from the masked response so the next save doesn't resend secrets.
    smtpPass.value = data.smtpPass;
    origSmtpPass.value = data.smtpPass;
    resendApiKey.value = data.resendApiKey;
    origResendKey.value = data.resendApiKey;
    brevoApiKey.value = data.brevoApiKey;
    origBrevoKey.value = data.brevoApiKey;
    isConfigured.value = data.isConfigured;
    testResult.value = null;
    toast.success('Email settings saved');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

async function onTest(): Promise<void> {
  testing.value = true;
  testResult.value = null;
  try {
    const { data } = await emailSettingsApi.test();
    testResult.value = data;
    if (data.success) toast.success(data.message);
    else toast.error(data.message);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Test failed';
    testResult.value = { success: false, message };
    toast.error(message);
  } finally {
    testing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Email</h1>
        <p class="page-subtitle">
          How the CMS sends notification emails — review requests, approvals, and
          rejections.
        </p>
      </div>
      <div class="header-actions">
        <button
          type="button"
          class="btn btn-primary"
          :disabled="saving || loading"
          @click="onSave"
        >
          {{ saving ? 'Saving…' : 'Save Changes' }}
        </button>
      </div>
    </header>

    <p v-if="loading" class="state-msg">Loading…</p>

    <div v-else class="card">
      <!-- Status -->
      <div class="settings-section">
        <div class="settings-section-title">Email delivery</div>
        <div class="settings-section-desc">
          Current provider status. Sending a test uses the
          <strong>saved</strong> settings — save first if you've made changes.
        </div>
        <div class="status-bar" :class="status.kind">
          <span class="status-dot" :class="status.kind" />
          <span>{{ status.text }}</span>
          <button
            v-if="provider !== 'stub'"
            type="button"
            class="btn btn-secondary btn-sm test-btn"
            :disabled="testing"
            @click="onTest"
          >
            {{ testing ? 'Sending…' : 'Send test email' }}
          </button>
        </div>
        <p
          v-if="testResult"
          class="test-result"
          :class="testResult.success ? 'ok' : 'err'"
        >
          {{ testResult.success ? '✓' : '✕' }} {{ testResult.message }}
        </p>
      </div>

      <!-- Provider picker -->
      <div class="settings-section">
        <div class="settings-section-title">Email provider</div>
        <div class="settings-section-desc">
          Choose how emails are sent. Switching only changes the credentials
          section below.
        </div>
        <div class="provider-grid">
          <button
            v-for="p in PROVIDERS"
            :key="p.id"
            type="button"
            class="provider-card"
            :class="{ selected: provider === p.id }"
            @click="selectProvider(p.id)"
          >
            <span class="provider-radio" aria-hidden="true" />
            <span class="provider-meta">
              <span class="provider-label">{{ p.label }}</span>
              <span class="provider-desc">{{ p.desc }}</span>
            </span>
            <span
              v-if="'badge' in p && p.badge"
              class="provider-badge"
              :class="p.badgeKind"
              >{{ p.badge }}</span
            >
          </button>
        </div>
      </div>

      <!-- SMTP credentials -->
      <div v-if="provider === 'smtp'" class="settings-section">
        <div class="settings-section-title">SMTP credentials</div>
        <div class="settings-section-desc">
          Your SMTP server details. For Brevo: host
          <code>smtp-relay.brevo.com</code>, port 587.
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">SMTP host</label>
            <input
              v-model="smtpHost"
              class="form-input"
              type="text"
              placeholder="smtp.example.com"
            />
          </div>
          <div class="form-group">
            <label class="form-label">Port</label>
            <select v-model.number="smtpPort" class="form-select">
              <option :value="587">587 — TLS (recommended)</option>
              <option :value="465">465 — SSL</option>
              <option :value="25">25 — Unencrypted</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input
              v-model="smtpUser"
              class="form-input"
              type="text"
              placeholder="your@email.com"
            />
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <div class="pass-wrap">
              <input
                v-model="smtpPass"
                class="form-input"
                :type="showSmtpPass ? 'text' : 'password'"
                placeholder="SMTP password or API key"
              />
              <button
                type="button"
                class="pass-toggle"
                @click="showSmtpPass = !showSmtpPass"
              >
                {{ showSmtpPass ? 'Hide' : 'Show' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Resend credentials -->
      <div v-else-if="provider === 'resend'" class="settings-section">
        <div class="settings-section-title">Resend API key</div>
        <div class="settings-section-desc">
          Create a key at resend.com and verify your sending domain.
        </div>
        <div class="form-group">
          <label class="form-label">API key</label>
          <div class="pass-wrap">
            <input
              v-model="resendApiKey"
              class="form-input"
              :type="showResendKey ? 'text' : 'password'"
              placeholder="re_xxxxxxxxxxxxxxxx"
            />
            <button
              type="button"
              class="pass-toggle"
              @click="showResendKey = !showResendKey"
            >
              {{ showResendKey ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Brevo credentials -->
      <div v-else-if="provider === 'brevo'" class="settings-section">
        <div class="settings-section-title">Brevo API key</div>
        <div class="settings-section-desc">
          Find your key in Brevo under Settings → API keys.
        </div>
        <div class="form-group">
          <label class="form-label">API key</label>
          <div class="pass-wrap">
            <input
              v-model="brevoApiKey"
              class="form-input"
              :type="showBrevoKey ? 'text' : 'password'"
              placeholder="xkeysib-xxxxxxxxxxxxxxxx"
            />
            <button
              type="button"
              class="pass-toggle"
              @click="showBrevoKey = !showBrevoKey"
            >
              {{ showBrevoKey ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Sender identity -->
      <div class="settings-section">
        <div class="settings-section-title">Sender identity</div>
        <div class="settings-section-desc">
          How emails appear to recipients. The From address must be verified
          with your provider.
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">From name</label>
            <input
              v-model="fromName"
              class="form-input"
              type="text"
              placeholder="Your Publication"
            />
          </div>
          <div class="form-group">
            <label class="form-label">From address</label>
            <input
              v-model="fromAddress"
              class="form-input"
              type="email"
              placeholder="noreply@yourdomain.com"
            />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Reply-to address (optional)</label>
          <input
            v-model="replyTo"
            class="form-input"
            type="email"
            placeholder="editorial@yourdomain.com"
          />
          <div class="form-hint">
            Where replies go. Leave blank to use the From address.
          </div>
        </div>
      </div>

      <!-- Notification triggers -->
      <div class="settings-section">
        <div class="settings-section-title">Notification triggers</div>
        <div class="settings-section-desc">
          Which events send email notifications to your team.
        </div>
        <div class="toggle-list">
          <div v-for="t in WIRED_TOGGLES" :key="t.label" class="toggle-wrap">
            <button
              type="button"
              class="toggle"
              :class="{ on: t.model.value }"
              role="switch"
              :aria-checked="t.model.value"
              @click="t.model.value = !t.model.value"
            />
            <div>
              <div class="toggle-label">{{ t.label }}</div>
              <div class="toggle-desc">{{ t.desc }}</div>
            </div>
          </div>
        </div>

        <div class="inert-group">
          <div class="inert-heading">Not available yet</div>
          <div class="toggle-list">
            <div
              v-for="t in INERT_TOGGLES"
              :key="t.label"
              class="toggle-wrap is-disabled"
            >
              <button
                type="button"
                class="toggle"
                disabled
                aria-disabled="true"
              />
              <div>
                <div class="toggle-label">
                  {{ t.label }}
                  <span class="soon-badge">Coming soon</span>
                </div>
                <div class="toggle-desc">
                  {{ t.desc }} — not sending yet (no trigger exists for this
                  event).
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="save-row">
        <button
          type="button"
          class="btn btn-primary"
          :disabled="saving"
          @click="onSave"
        >
          {{ saving ? 'Saving…' : 'Save Changes' }}
        </button>
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
.state-msg {
  color: var(--muted);
  font-size: 0.9rem;
}

.settings-section {
  padding-bottom: 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border);
}
.settings-section:last-of-type {
  border-bottom: none;
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
.settings-section-desc code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  background: var(--bg);
  padding: 1px 5px;
  border-radius: 4px;
}

/* Status bar */
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 13px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
}
.status-bar.connected {
  background: var(--success-soft);
  color: var(--success);
  border-color: var(--success);
}
.status-bar.dev,
.status-bar.unconfigured {
  background: var(--warning-soft);
  color: var(--warning);
  border-color: var(--warning);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
  flex-shrink: 0;
}
.status-dot.connected {
  background: var(--success);
}
.status-dot.dev,
.status-dot.unconfigured {
  background: var(--warning);
}
.test-btn {
  margin-left: auto;
}
.btn-sm {
  padding: 5px 10px;
  font-size: 12px;
}
.test-result {
  margin-top: 10px;
  font-size: 12.5px;
}
.test-result.ok {
  color: var(--success);
}
.test-result.err {
  color: var(--danger);
}

/* Provider cards */
.provider-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 640px) {
  .provider-grid {
    grid-template-columns: 1fr;
  }
}
.provider-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  cursor: pointer;
  background: var(--surface);
  font-family: inherit;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.provider-card:hover {
  border-color: var(--text-tertiary);
  background: var(--bg);
}
.provider-card.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.provider-radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--border);
  flex-shrink: 0;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.provider-card.selected .provider-radio {
  border-color: var(--accent);
  background: var(--accent);
}
.provider-card.selected .provider-radio::after {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #fff;
}
.provider-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.provider-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}
.provider-desc {
  font-size: 11px;
  color: var(--muted);
}
.provider-badge {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
  background: var(--bg);
  color: var(--muted);
}
.provider-badge.good {
  background: var(--success-soft);
  color: var(--success);
}
.provider-badge.warn {
  background: var(--warning-soft);
  color: var(--warning);
}

/* Password field */
.pass-wrap {
  position: relative;
}
.pass-wrap .form-input {
  padding-right: 56px;
}
.pass-toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  font-family: inherit;
  font-weight: 500;
  padding: 2px 4px;
}
.pass-toggle:hover {
  color: var(--fg);
}

/* Toggles */
.toggle-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.toggle-wrap {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
}
.toggle-wrap.is-disabled {
  opacity: 0.6;
}
.toggle-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
  display: flex;
  align-items: center;
  gap: 8px;
}
.toggle-desc {
  font-size: 11px;
  color: var(--muted);
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
  margin-top: 1px;
}
.toggle.on {
  background: var(--success);
}
.toggle:disabled {
  cursor: not-allowed;
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

.inert-group {
  margin-top: 20px;
  border-top: 1px dashed var(--border);
  padding-top: 16px;
}
.inert-heading {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}
.soon-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 8px;
  background: var(--warning-soft);
  color: var(--warning);
}

.save-row {
  display: flex;
  justify-content: flex-end;
}
</style>
