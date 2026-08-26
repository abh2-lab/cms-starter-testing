<script setup lang="ts">
// BlockSidebarContactCard — render half for the 'sidebar-contact-card' block. A
// compact "Send Us A Message" card (Full Name, Phone, Email). It POSTs to
// /api/public/submissions itself — saving a draft of `content_type_slug` (which
// must allow public submissions) — mapping the fields onto the submission
// contract (submitter_name/email + title + body). No API change.
interface Fields {
  heading?: string;
  button_label?: string;
  success_message?: string;
}
interface Options {
  content_type_slug?: string;
}

const props = defineProps<{
  fields: Fields;
  options: Options;
  data: unknown;
}>();

const route = useRoute();

const contentTypeSlug = computed(() =>
  typeof props.options.content_type_slug === 'string' &&
  props.options.content_type_slug.length > 0
    ? props.options.content_type_slug
    : 'portfolio-inquiry',
);
const heading = computed(() => props.fields.heading ?? 'Send Us A Message');
const buttonLabel = computed(() => props.fields.button_label ?? 'Send');
const successMessage = computed(
  () => props.fields.success_message ?? "Thanks — we'll be in touch soon.",
);

const form = reactive({ full_name: '', phone: '', email: '' });

type Status = 'idle' | 'submitting' | 'success' | 'rate-limited' | 'error';
const status = ref<Status>('idle');
const errorMessage = ref<string | null>(null);

const onSubmit = async (e: Event): Promise<void> => {
  e.preventDefault();
  if (status.value === 'submitting') return;
  status.value = 'submitting';
  errorMessage.value = null;

  const fullName = form.full_name.trim();

  try {
    await $fetch('/api/public/submissions/', {
      method: 'POST',
      body: {
        title: `New message${fullName ? ` from ${fullName}` : ''}`,
        submitter_name: fullName,
        submitter_email: form.email,
        content_type_slug: contentTypeSlug.value,
        // The actual fields this form collects — stored by name so the admin
        // "information" table shows one column each.
        fields: {
          full_name: fullName,
          phone: form.phone.trim(),
          email: form.email.trim(),
        },
        // Provenance only (not shown as a column): the page they came from.
        body: `From page: ${route.fullPath}`,
      },
    });
    status.value = 'success';
    form.full_name = '';
    form.phone = '';
    form.email = '';
  } catch (err: unknown) {
    const e2 = err as { statusCode?: number; data?: { error?: string } };
    if (e2?.statusCode === 429) {
      status.value = 'rate-limited';
    } else {
      status.value = 'error';
      errorMessage.value =
        e2?.data?.error ?? 'Something went wrong. Please try again.';
    }
  }
};
</script>

<template>
  <section class="block-contact-card">
    <h2 class="block-contact-card__heading">{{ heading }}</h2>
    <form class="block-contact-card__form" novalidate @submit="onSubmit">
      <input
        v-model="form.full_name"
        type="text"
        class="block-contact-card__input"
        placeholder="Full Name"
        required
        maxlength="200"
        aria-label="Full Name"
      />
      <input
        v-model="form.phone"
        type="tel"
        class="block-contact-card__input"
        placeholder="Phone"
        maxlength="40"
        aria-label="Phone"
      />
      <input
        v-model="form.email"
        type="email"
        class="block-contact-card__input"
        placeholder="Email"
        required
        maxlength="320"
        aria-label="Email"
      />
      <button
        type="submit"
        class="block-contact-card__submit"
        :disabled="status === 'submitting'"
      >
        <span>{{ status === 'submitting' ? 'Sending…' : buttonLabel }}</span>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M5 12h14M13 6l6 6-6 6"
          />
        </svg>
      </button>

      <p v-if="status === 'success'" class="block-contact-card__msg is-ok">
        {{ successMessage }}
      </p>
      <p
        v-else-if="status === 'rate-limited'"
        class="block-contact-card__msg is-err"
      >
        Too many messages from this address. Please try again later.
      </p>
      <p v-else-if="status === 'error'" class="block-contact-card__msg is-err">
        {{ errorMessage }}
      </p>
    </form>
  </section>
</template>

<style scoped>
/* PING blue panel — the same form language as the /contact page: white,
   borderless inputs with a soft navy shadow on a light-blue panel, a navy
   heading and an orange pill submit. */
.block-contact-card {
  background: #92deff;
  border-radius: var(--radius-xl);
  padding: var(--space-6) var(--space-6) var(--space-7);
}
.block-contact-card__heading {
  margin: 0 0 var(--space-5);
  color: #0f2d96;
  font-size: var(--fs-h4);
  font-weight: var(--fw-semibold);
  text-align: center;
}
.block-contact-card__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.block-contact-card__input {
  width: 100%;
  box-sizing: border-box;
  border: none;
  border-radius: 20px;
  padding: var(--space-5) var(--space-6);
  font-family: inherit;
  font-size: var(--fs-body);
  color: #0f2d96;
  background: #fff;
  outline: none;
  box-shadow: 0 2px 8px rgba(15, 45, 150, 0.06);
  transition: box-shadow var(--motion-fast) var(--ease-out);
}
.block-contact-card__input::placeholder {
  color: #0f2d96;
  opacity: 0.7;
}
.block-contact-card__input:focus {
  box-shadow: 0 0 0 3px rgba(242, 111, 76, 0.45);
}
.block-contact-card__submit {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  background: #ff6a4d;
  color: #fff;
  border: none;
  border-radius: 999px;
  /* Orange pill label = header nav size + 1px. */
  padding: var(--pill-pad-y, calc(var(--space-3) - 1px)) var(--pill-pad-x, calc(var(--space-8) + 4px));
  font-family: inherit;
  font-size: var(--pill-font);
  font-weight: var(--fw-semibold);
  cursor: pointer;
  transition: background var(--motion-fast) var(--ease-out);
}
.block-contact-card__submit:hover {
  background: #e0532f;
}
.block-contact-card__submit:disabled {
  opacity: 0.6;
  cursor: default;
}
.block-contact-card__msg {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  text-align: center;
}
.block-contact-card__msg.is-ok {
  color: #0a7d3c;
}
.block-contact-card__msg.is-err {
  color: #b91c1c;
}
@media (max-width: 768px) {
  /* Match the /contact form: tighter input padding on phones. */
  .block-contact-card__input {
    padding: 10px 20px;
  }
}
/* Tablet and phone: the send button takes the header orange button's size and
   spacing (11/28px) so it isn't tiny next to the inputs. */
@media (max-width: 1024px) {
  .block-contact-card__submit {
    padding: calc(var(--space-3) - 1px) calc(var(--space-5) + 4px);
  }
}
</style>
