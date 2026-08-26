<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '@/lib/api';
import { setupApi } from '@/api/setup';
import { setSetupStatus } from '@/router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const step = ref<1 | 2>(1);

// Step 1 fields
const siteName = ref('');
const displayName = ref('');
const email = ref('');
const password = ref('');
const passwordConfirm = ref('');

// Step 2 choice
const choice = ref<'fresh' | 'samples'>('samples');

const submitting = ref(false);
const formError = ref<string | null>(null);

// Per-field errors keyed by field name. Cleared on input.
const fieldErrors = ref<Record<string, string>>({});

function emailValid(value: string): boolean {
  // Permissive client check; the server does the strict validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const passwordStrength = computed(() => {
  const v = password.value;
  let score = 0;
  if (v.length >= 12) score += 1;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score += 1;
  if (/\d/.test(v)) score += 1;
  if (/[^A-Za-z0-9]/.test(v)) score += 1;
  return score; // 0-4
});

const step1Valid = computed(
  () =>
    siteName.value.trim().length > 0 &&
    displayName.value.trim().length > 0 &&
    emailValid(email.value) &&
    password.value.length >= 12 &&
    password.value === passwordConfirm.value,
);

function clearError(key: string): void {
  if (fieldErrors.value[key]) {
    const { [key]: _omit, ...rest } = fieldErrors.value;
    void _omit;
    fieldErrors.value = rest;
  }
}

function goToStep2(): void {
  fieldErrors.value = {};
  if (!siteName.value.trim()) fieldErrors.value['siteName'] = 'Required.';
  if (!displayName.value.trim()) fieldErrors.value['displayName'] = 'Required.';
  if (!emailValid(email.value)) {
    fieldErrors.value['email'] = 'Enter a valid email address.';
  }
  if (password.value.length < 12) {
    fieldErrors.value['password'] = 'Use at least 12 characters.';
  } else if (password.value !== passwordConfirm.value) {
    fieldErrors.value['passwordConfirm'] = 'Passwords do not match.';
  }
  if (Object.keys(fieldErrors.value).length > 0) return;
  step.value = 2;
}

async function submit(): Promise<void> {
  submitting.value = true;
  formError.value = null;
  try {
    const res = await setupApi.bootstrap({
      siteName: siteName.value.trim(),
      displayName: displayName.value.trim(),
      email: email.value.trim().toLowerCase(),
      password: password.value,
      loadSampleData: choice.value === 'samples',
    });
    // Bring the local state in sync so the router guard sees us as signed in.
    auth.setUser(res.user);
    setSetupStatus(false);
    await router.replace({ name: 'home' });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) {
        // Setup is already complete (or email already taken). Send the user
        // to /login — they can sign in with the credentials they intended.
        setSetupStatus(false);
        await router.replace({ name: 'login' });
        return;
      }
      if (e.status === 400 && e.body && typeof e.body === 'object') {
        const body = e.body as { issues?: Array<{ path: string; message: string }> };
        if (body.issues) {
          for (const issue of body.issues) {
            fieldErrors.value[issue.path] = issue.message;
          }
          step.value = 1; // surface inline errors next to the offending field
          formError.value = 'Please fix the highlighted fields.';
          return;
        }
      }
      formError.value = e.message;
    } else {
      formError.value = e instanceof Error ? e.message : 'Setup failed.';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="setup">
    <div class="setup-card">
      <header class="setup-head">
        <div class="brand">
          <span class="logo-mark" aria-hidden="true">◆</span>
          <span>Set up your CMS</span>
        </div>
        <span class="step-badge" aria-label="Setup progress">Step {{ step }} / 2</span>
      </header>

      <!-- ── Step 1 ── -->
      <form v-if="step === 1" class="setup-form" @submit.prevent="goToStep2">
        <h1>Welcome. Let's create your first admin.</h1>
        <p class="lede">
          You're seeing this because no admin account exists yet. The account
          you create here is the Super Admin — it can do everything, and
          can't be deleted.
        </p>

        <label class="field">
          <span class="field-label">Site name</span>
          <input
            v-model="siteName"
            type="text"
            maxlength="200"
            required
            autofocus
            placeholder="e.g. Acme Daily News"
            @input="clearError('siteName')"
          />
          <span v-if="fieldErrors['siteName']" class="field-error">{{ fieldErrors['siteName'] }}</span>
        </label>

        <label class="field">
          <span class="field-label">Your display name</span>
          <input
            v-model="displayName"
            type="text"
            maxlength="200"
            required
            placeholder="e.g. Alex Editor"
            @input="clearError('displayName')"
          />
          <span v-if="fieldErrors['displayName']" class="field-error">{{ fieldErrors['displayName'] }}</span>
        </label>

        <label class="field">
          <span class="field-label">Email</span>
          <input
            v-model="email"
            type="email"
            autocomplete="username"
            maxlength="320"
            required
            placeholder="you@example.com"
            @input="clearError('email')"
          />
          <span v-if="fieldErrors['email']" class="field-error">{{ fieldErrors['email'] }}</span>
        </label>

        <label class="field">
          <span class="field-label">Password</span>
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            required
            placeholder="At least 12 characters"
            @input="clearError('password')"
          />
          <div class="strength" :data-score="passwordStrength" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <span v-if="fieldErrors['password']" class="field-error">{{ fieldErrors['password'] }}</span>
        </label>

        <label class="field">
          <span class="field-label">Confirm password</span>
          <input
            v-model="passwordConfirm"
            type="password"
            autocomplete="new-password"
            required
            @input="clearError('passwordConfirm')"
          />
          <span v-if="fieldErrors['passwordConfirm']" class="field-error">{{ fieldErrors['passwordConfirm'] }}</span>
        </label>

        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>

        <div class="actions">
          <button type="submit" class="btn-primary" :disabled="!step1Valid">
            Next
          </button>
        </div>
      </form>

      <!-- ── Step 2 ── -->
      <form v-else class="setup-form" @submit.prevent="submit">
        <h1>How do you want to start?</h1>
        <p class="lede">
          Pick one. You can always add or delete content later — this is just
          about what's already there on day one.
        </p>

        <div class="choice-grid" role="radiogroup" aria-label="Starting data">
          <label
            class="choice"
            :class="{ 'choice--selected': choice === 'fresh' }"
          >
            <input
              v-model="choice"
              type="radio"
              name="start-choice"
              value="fresh"
            />
            <span class="choice-title">Start fresh</span>
            <span class="choice-body">
              An empty CMS. You'll create your first content type, then your
              first post.
            </span>
          </label>
          <label
            class="choice"
            :class="{ 'choice--selected': choice === 'samples' }"
          >
            <input
              v-model="choice"
              type="radio"
              name="start-choice"
              value="samples"
            />
            <span class="choice-title">Load sample data</span>
            <span class="choice-body">
              Adds Article and Review content types with demo posts, a few
              pages (About, Contact, Privacy), menus, and taxonomies. Great
              for exploring.
            </span>
          </label>
        </div>

        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>

        <div class="actions">
          <button
            type="button"
            class="btn-ghost"
            :disabled="submitting"
            @click="step = 1"
          >
            Back
          </button>
          <button type="submit" class="btn-primary" :disabled="submitting">
            {{ submitting ? 'Creating your CMS…' : 'Create my CMS' }}
          </button>
        </div>
      </form>
    </div>
  </main>
</template>

<style scoped>
.setup {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg);
}
.setup-card {
  width: 100%;
  max-width: 520px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px 28px 24px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
}
.setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fg);
  font-weight: 600;
}
.logo-mark {
  width: 28px;
  height: 28px;
  background: var(--accent-gradient);
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #fff;
}
.step-badge {
  font-size: 12px;
  color: var(--text-tertiary);
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 999px;
}

.setup-form h1 {
  font-size: 22px;
  margin: 0 0 6px;
}
.lede {
  color: var(--muted);
  margin: 0 0 18px;
  font-size: 14px;
  line-height: 1.5;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.field-label {
  font-size: 13px;
  color: var(--fg);
  font-weight: 500;
}
.field input {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.field input:focus {
  border-color: var(--accent);
}
.field-error {
  color: var(--danger);
  font-size: 12px;
}

.strength {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-top: 2px;
}
.strength span {
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  transition: background 0.15s;
}
.strength[data-score="1"] span:nth-child(-n+1),
.strength[data-score="2"] span:nth-child(-n+2),
.strength[data-score="3"] span:nth-child(-n+3),
.strength[data-score="4"] span:nth-child(-n+4) {
  background: var(--accent);
}

.choice-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.choice {
  display: grid;
  grid-template-columns: 24px 1fr;
  grid-template-rows: auto auto;
  column-gap: 10px;
  row-gap: 4px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  background: var(--bg);
  transition: border-color 0.15s, background 0.15s;
}
.choice:hover { border-color: var(--accent); }
.choice--selected {
  border-color: var(--accent);
  background: var(--surface);
}
.choice input[type="radio"] {
  grid-row: 1 / span 2;
  margin-top: 2px;
  accent-color: var(--accent);
}
.choice-title {
  font-weight: 600;
  color: var(--fg);
}
.choice-body {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
.btn-primary,
.btn-ghost {
  padding: 9px 16px;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  color: var(--fg);
  border-color: var(--border);
}
.btn-ghost:hover { background: var(--bg); }

.form-error {
  color: var(--danger);
  font-size: 13px;
  margin: 4px 0 0;
}
</style>
