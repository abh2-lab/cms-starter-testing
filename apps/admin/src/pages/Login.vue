<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const formError = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  submitting.value = true;
  formError.value = null;
  try {
    await auth.login(email.value, password.value);
    const redirect =
      typeof route.query['redirect'] === 'string' ? route.query['redirect'] : '/';
    await router.push(redirect);
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Login failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="login">
    <h1>Sign in</h1>
    <form @submit.prevent="onSubmit">
      <label>
        <span>Email</span>
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          required
          autofocus
        />
      </label>
      <label>
        <span>Password</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <button type="submit" :disabled="submitting">
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
      <p v-if="formError" class="error">{{ formError }}</p>
    </form>
  </main>
</template>

<style scoped>
.login {
  max-width: 24rem;
  margin: 6rem auto;
  padding: 0 1.5rem;
}
.login form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1.5rem;
}
.login label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.login label span {
  font-size: 0.875rem;
  color: var(--muted);
}
.login input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 1rem;
}
.login button {
  padding: 0.625rem 0.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: var(--accent);
  color: white;
  font-size: 1rem;
  cursor: pointer;
}
.login button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.login .error {
  color: #dc2626;
  margin: 0;
}
</style>
