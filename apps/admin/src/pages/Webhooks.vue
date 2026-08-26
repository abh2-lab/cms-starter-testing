<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { onMounted, ref } from 'vue';
import {
  webhooksApi,
  WEBHOOK_EVENTS,
  type Webhook,
  type WebhookDelivery,
} from '@/api/webhooks';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { confirm } = useConfirm();
const items = ref<Webhook[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const newName = ref('');
const newUrl = ref('');
const newEvents = ref<string[]>([]);
const creating = ref(false);
// Holds the secret to surface once after either a create or a rotate. The
// banner template at the top of the page reads from this; clearing it hides
// the banner.
const revealedSecret = ref<string | null>(null);
const rotatingId = ref<string | null>(null);

const testResult = ref<Record<string, string>>({});
const deliveriesFor = ref<string | null>(null);
const deliveries = ref<WebhookDelivery[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await webhooksApi.list();
    items.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

function toggleEvent(ev: string): void {
  const i = newEvents.value.indexOf(ev);
  if (i === -1) newEvents.value.push(ev);
  else newEvents.value.splice(i, 1);
}

async function onCreate(): Promise<void> {
  if (!newName.value || !newUrl.value) return;
  creating.value = true;
  error.value = null;
  try {
    const res = await webhooksApi.create({
      name: newName.value,
      url: newUrl.value,
      events: [...newEvents.value],
    });
    revealedSecret.value = res.data.secret;
    items.value.unshift(res.data);
    newName.value = '';
    newUrl.value = '';
    newEvents.value = [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Create failed';
  } finally {
    creating.value = false;
  }
}

async function onTest(w: Webhook): Promise<void> {
  testResult.value = { ...testResult.value, [w.id]: 'Testing…' };
  try {
    const { data } = await webhooksApi.test(w.id);
    testResult.value = {
      ...testResult.value,
      [w.id]: data.ok
        ? `OK (${data.status ?? '?'})`
        : `Failed (${data.status ?? 'no response'})`,
    };
  } catch (e) {
    testResult.value = {
      ...testResult.value,
      [w.id]: e instanceof Error ? e.message : 'Test failed',
    };
  }
}

async function toggleDeliveries(w: Webhook): Promise<void> {
  if (deliveriesFor.value === w.id) {
    deliveriesFor.value = null;
    return;
  }
  deliveriesFor.value = w.id;
  deliveries.value = [];
  try {
    const { data } = await webhooksApi.deliveries(w.id);
    deliveries.value = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load deliveries';
  }
}

async function onToggleActive(w: Webhook): Promise<void> {
  try {
    const { data } = await webhooksApi.update(w.id, { isActive: !w.isActive });
    const idx = items.value.findIndex((x) => x.id === w.id);
    if (idx !== -1) items.value[idx] = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Update failed';
  }
}

async function onRotate(w: Webhook): Promise<void> {
  const ok = await confirm({
    title: 'Rotate signing secret',
    message:
      `Rotate the signing secret for "${w.name}"? The previous secret stops working immediately. ` +
      `Update your receiver with the new value before the next event fires.`,
    confirmLabel: 'Rotate',
    tone: 'danger',
  });
  if (!ok) return;
  rotatingId.value = w.id;
  try {
    const { data } = await webhooksApi.rotateSecret(w.id);
    revealedSecret.value = data.secret;
    const idx = items.value.findIndex((x) => x.id === w.id);
    if (idx !== -1) {
      // Strip the secret field for the in-memory list — it's only meant to
      // be surfaced via the banner once.
      const { secret: _secret, ...row } = data;
      items.value[idx] = row;
    }
    toast.success('Secret rotated');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Rotate failed');
  } finally {
    rotatingId.value = null;
  }
}

async function onDelete(w: Webhook): Promise<void> {
  const ok = await confirm({
    title: 'Delete webhook',
    message: `Delete webhook "${w.name}"?`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await webhooksApi.remove(w.id);
    items.value = items.value.filter((x) => x.id !== w.id);
    toast.success('Webhook deleted');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-header"><h1>Webhooks</h1></header>

    <div v-if="revealedSecret" class="key-banner">
      <p><strong>Signing secret — copy it now, it won't be shown again.</strong></p>
      <code class="key">{{ revealedSecret }}</code>
      <button type="button" class="btn btn--small" @click="revealedSecret = null">Dismiss</button>
    </div>

    <form class="create" @submit.prevent="onCreate">
      <div class="create-row">
        <input v-model="newName" type="text" placeholder="Name" maxlength="100" />
        <input v-model="newUrl" type="url" placeholder="https://example.com/hook" class="grow" />
      </div>
      <div class="events">
        <label v-for="ev in WEBHOOK_EVENTS" :key="ev" class="event">
          <input type="checkbox" :checked="newEvents.includes(ev)" @change="toggleEvent(ev)" />
          <code>{{ ev }}</code>
        </label>
        <button type="submit" class="btn btn--primary" :disabled="creating">
          {{ creating ? 'Creating…' : 'Create webhook' }}
        </button>
      </div>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="items.length === 0" class="muted">No webhooks yet.</p>

    <ul v-else class="hooks">
      <li v-for="w in items" :key="w.id" class="hook">
        <div class="hook-head">
          <div class="hook-info">
            <strong>{{ w.name }}</strong>
            <span class="url mono">{{ w.url }}</span>
            <span class="events-list mono muted">{{ w.events.join(', ') || 'no events' }}</span>
          </div>
          <div class="hook-actions">
            <span v-if="testResult[w.id]" class="test-result">{{ testResult[w.id] }}</span>
            <button type="button" class="btn btn--small" @click="onTest(w)">Test</button>
            <button type="button" class="btn btn--small" @click="toggleDeliveries(w)">
              {{ deliveriesFor === w.id ? 'Hide log' : 'Log' }}
            </button>
            <button type="button" class="btn btn--small" @click="onToggleActive(w)">
              {{ w.isActive ? 'Active' : 'Off' }}
            </button>
            <button
              type="button"
              class="btn btn--small"
              :disabled="rotatingId === w.id"
              title="Rotate signing secret"
              @click="onRotate(w)"
            >
              {{ rotatingId === w.id ? 'Rotating…' : 'Rotate' }}
            </button>
            <button type="button" class="btn btn--small btn--danger" title="Delete" aria-label="Delete" @click="onDelete(w)">
              <Icon name="trash" />
            </button>
          </div>
        </div>
        <div v-if="deliveriesFor === w.id" class="deliveries">
          <p v-if="deliveries.length === 0" class="muted">No deliveries yet.</p>
          <table v-else class="dtable">
            <thead>
              <tr><th>When</th><th>Event</th><th>Status</th><th>Result</th></tr>
            </thead>
            <tbody>
              <tr v-for="d in deliveries" :key="d.id">
                <td>{{ formatDate(d.createdAt) }}</td>
                <td class="mono">{{ d.eventName }}</td>
                <td>{{ d.responseStatus ?? '—' }}</td>
                <td class="mono snippet">{{ d.responseBody ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.page-header {
  margin-bottom: 1rem;
}
.key-banner {
  border: 1px solid var(--accent);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}
.key {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.875rem;
  word-break: break-all;
  background: var(--border);
  padding: 0.5rem;
  border-radius: 0.375rem;
}
.create {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}
.create-row {
  display: flex;
  gap: 0.5rem;
}
.create input {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
}
.grow {
  flex: 1;
}
.events {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}
.event {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
}
.hooks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.hook {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
.hook-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.hook-info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.url {
  font-size: 0.8125rem;
}
.events-list {
  font-size: 0.75rem;
}
.hook-actions {
  display: flex;
  gap: 0.375rem;
  align-items: center;
}
.test-result {
  font-size: 0.75rem;
  color: var(--muted);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.deliveries {
  margin-top: 0.75rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}
.dtable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.dtable th,
.dtable td {
  padding: 0.375rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.snippet {
  max-width: 20rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--muted);
}
.error {
  color: #dc2626;
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.btn--small {
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
}
.btn--primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn--primary:hover {
  background: transparent;
  color: var(--accent);
}
.btn--primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn--danger:hover {
  border-color: #dc2626;
  color: #dc2626;
}
</style>
