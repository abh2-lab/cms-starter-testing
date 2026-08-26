<script setup lang="ts">

// Contact Form block — the /contact page body ("Ping Us!"). POSTs to
// /api/public/submissions, saving a draft of `content_type_slug` (which must
// allow public submissions) for review. The six inputs (first/last name,
// company email, phone, and the two message fields) are sent as named `fields`
// so the admin "information" table shows one column each; submitter_name/email
// + title are also set so the submission list stays readable.
interface Fields {
  heading?: string;
  lede?: string;
  button_label?: string;
  success_message?: string;
  // Reach Out sidebar (all optional — sensible PING defaults are used below).
  reach_heading?: string;
  contact_email?: string;
  studio_location?: string;
  facebook_url?: string;
  x_url?: string;
  youtube_url?: string;
  instagram_url?: string;
  linkedin_url?: string;
}
interface Options {
  content_type_slug?: string;
}

const props = defineProps<{
  fields: Fields;
  options: Options;
  data: unknown;
}>();

const contentTypeSlug = computed(() =>
  typeof props.options.content_type_slug === 'string' &&
  props.options.content_type_slug.length > 0
    ? props.options.content_type_slug
    : 'contact-submission',
);

const heading = computed(() => props.fields.heading ?? 'Ping Us!');
const lede = computed(
  () =>
    props.fields.lede ??
    'Simply submit the contact form and our sales team will get in touch within a business day. They can walk you through:',
);
const buttonLabel = computed(() => props.fields.button_label ?? 'Submit');
const successMessage = computed(
  () =>
    props.fields.success_message ??
    'Thanks — our sales team will get in touch within a business day.',
);

// Reach Out sidebar — content with PING defaults, each overridable by a field.
const reachHeading = computed(() => props.fields.reach_heading ?? 'Reach Out');
const reachEmail = computed(
  () => props.fields.contact_email ?? 'hello@pingnetwork.in',
);
const reachStudio = computed(
  () => props.fields.studio_location ?? 'Mumbai, India',
);
// No live links yet, so each falls back to '#'.
const socials = computed(() => [
  { id: 'facebook', label: 'Facebook', url: props.fields.facebook_url ?? '#' },
  { id: 'x', label: 'X', url: props.fields.x_url ?? '#' },
  { id: 'youtube', label: 'YouTube', url: props.fields.youtube_url ?? '#' },
  { id: 'instagram', label: 'Instagram', url: props.fields.instagram_url ?? '#' },
  { id: 'linkedin', label: 'LinkedIn', url: props.fields.linkedin_url ?? '#' },
]);

interface FormState {
  first_name: string;
  last_name: string;
  company_email: string;
  phone: string;
  discuss: string;
  help: string;
}

const form = reactive<FormState>({
  first_name: '',
  last_name: '',
  company_email: '',
  phone: '',
  discuss: '',
  help: '',
});

type Status = 'idle' | 'submitting' | 'success' | 'rate-limited' | 'error';
const status = ref<Status>('idle');
const errorMessage = ref<string | null>(null);

interface SubmissionResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

const onSubmit = async (e: Event): Promise<void> => {
  e.preventDefault();
  if (status.value === 'submitting') return;
  status.value = 'submitting';
  errorMessage.value = null;

  const fullName = `${form.first_name} ${form.last_name}`.trim();
  const body = [
    form.phone ? `Phone: ${form.phone}` : '',
    form.discuss ? `What would you like to discuss?\n${form.discuss}` : '',
    form.help ? `How can our team help you?\n${form.help}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    await $fetch<SubmissionResponse>('/api/public/submissions/', {
      method: 'POST',
      body: {
        title: form.discuss
          ? form.discuss.slice(0, 200)
          : `Contact: ${fullName}`,
        body,
        submitter_name: fullName,
        submitter_email: form.company_email,
        content_type_slug: contentTypeSlug.value,
        // The actual fields this form collects — stored by name so the admin
        // "information" table shows one column each. Names match the Contact Us
        // content type's fields.
        fields: {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          company_email: form.company_email.trim(),
          phone: form.phone.trim(),
          discuss: form.discuss.trim(),
          help: form.help.trim(),
        },
      },
    });
    status.value = 'success';
    form.first_name = '';
    form.last_name = '';
    form.company_email = '';
    form.phone = '';
    form.discuss = '';
    form.help = '';
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
  <section class="ping-contact">
    <!-- Two hand-drawn swoosh lines behind the form (Figma "Vector 2"), in the
         theme blue at the shared weight. `fit` + `sequence` draws them like the
         About team ribbon: one line then the other, measure-first so neither
         flashes thick. They draw at the shared length-based pace (see ThemeCurve). -->
    <ThemeCurve class="contact-art" shape="contact-lines" reveal="left" trigger="fit" sequence />
    <div class="container-custom ping-contact-inner">
      <h1>{{ heading }}</h1>
      <p class="lede">{{ lede }}</p>

      <div class="ping-contact-cols">
        <form class="ping-form" novalidate @submit="onSubmit">
          <div class="ping-field">
            <input
              v-model="form.first_name"
              type="text"
              placeholder="First Name:"
              required
              maxlength="200"
              aria-label="First Name"
            />
          </div>
          <div class="ping-field">
            <input
              v-model="form.last_name"
              type="text"
              placeholder="Last Name:"
              maxlength="200"
              aria-label="Last Name"
            />
          </div>
          <div class="ping-field">
            <input
              v-model="form.company_email"
              type="email"
              placeholder="Company Email:"
              required
              maxlength="320"
              aria-label="Company Email"
            />
          </div>
          <div class="ping-field">
            <input
              v-model="form.phone"
              type="tel"
              placeholder="Phone Number:"
              maxlength="40"
              aria-label="Phone Number"
            />
          </div>
          <div class="ping-field">
            <textarea
              v-model="form.discuss"
              rows="4"
              placeholder="What would you like to discuss?"
              maxlength="20000"
              aria-label="What would you like to discuss?"
            ></textarea>
          </div>
          <div class="ping-field">
            <textarea
              v-model="form.help"
              rows="4"
              placeholder="How can our team help you?"
              maxlength="20000"
              aria-label="How can our team help you?"
            ></textarea>
          </div>

          <div class="ping-form-actions">
            <button
              type="submit"
              class="ping-submit"
              :disabled="status === 'submitting'"
            >
              {{ status === 'submitting' ? 'Sending…' : buttonLabel }}
            </button>
          </div>

          <p v-if="status === 'success'" class="form-success">
            {{ successMessage }}
          </p>
          <p v-else-if="status === 'rate-limited'" class="form-error">
            Too many submissions from this address. Please try again later.
          </p>
          <p v-else-if="status === 'error'" class="form-error">
            {{ errorMessage }}
          </p>
        </form>

        <aside class="ping-reachout">
          <h2 class="ping-reachout-title">{{ reachHeading }}</h2>

          <div class="ping-reachout-item">
            <svg
              class="ping-reachout-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <path d="M3.5 7.5 12 13l8.5-5.5" />
            </svg>
            <div>
              <p class="ping-reachout-label">Email Us</p>
              <a class="ping-reachout-value" :href="`mailto:${reachEmail}`">{{
                reachEmail
              }}</a>
            </div>
          </div>

          <div class="ping-reachout-item">
            <svg
              class="ping-reachout-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M12 21.5S18.5 15.7 18.5 11a6.5 6.5 0 1 0-13 0c0 4.7 6.5 10.5 6.5 10.5Z"
              />
              <circle cx="12" cy="10.5" r="2.5" />
            </svg>
            <div>
              <p class="ping-reachout-label">Our Studio</p>
              <p class="ping-reachout-value">{{ reachStudio }}</p>
            </div>
          </div>

          <div class="ping-reachout-socials">
            <a
              v-for="s in socials"
              :key="s.id"
              :href="s.url"
              class="ping-social"
              :aria-label="s.label"
            >
              <svg v-if="s.id === 'facebook'" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" /></svg>
              <svg v-else-if="s.id === 'x'" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              <svg v-else-if="s.id === 'youtube'" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
              <svg v-else-if="s.id === 'instagram'" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14zM8.339 18.337V9.925H5.552v8.412h2.787zM6.945 8.777a1.615 1.615 0 1 0 0-3.23 1.615 1.615 0 0 0 0 3.23zm11.395 9.56v-4.615c0-2.42-.517-4.28-3.343-4.28-1.36 0-2.272.745-2.647 1.45h-.038V9.925H9.635v8.412h2.786v-4.164c0-1.098.208-2.16 1.567-2.16 1.34 0 1.358 1.253 1.358 2.23v4.094h2.994z" /></svg>
            </a>
          </div>
        </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ping-contact {
  position: relative;
  overflow: hidden;
  background: #92deff;
  padding: var(--section-y) 0;
}
/* The heading and form sit on z-index 1 (below) so they stay readable over the
   art. Draw pace is universal now (length-based; see ThemeCurve). */
.ping-contact-inner {
  position: relative;
  z-index: 1;
}
.ping-contact h1 {
  color: #0f2d96;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  margin: 0 0 var(--space-4);
}
.ping-contact .lede {
  color: #0f2d96;
  font-size: var(--fs-lead);
  font-weight: var(--fw-regular);
  line-height: var(--lh-body);
  max-width: 620px;
  margin: 0 0 var(--space-7);
}
/* Form on the left, the Reach Out details on the right. */
.ping-contact-cols {
  display: flex;
  gap: var(--space-9);
  align-items: flex-start;
}
.ping-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  /* Cap the form so it doesn't stretch the full content width — a wall of
     full-width inputs read too wide. */
  max-width: 720px;
  flex: 1 1 0;
  min-width: 0;
}

/* Reach Out sidebar — PING colours on the light-blue band (dark-blue text,
   orange icon accents, dark-blue social pills). */
.ping-reachout {
  flex: 0 0 320px;
}
.ping-reachout-title {
  color: #0f2d96;
  font-size: var(--fs-h3);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  margin: 0 0 var(--space-6);
}
.ping-reachout-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.ping-reachout-icon {
  color: #ff6a4d;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  margin-top: 2px;
}
.ping-reachout-label {
  color: #0f2d96;
  font-weight: var(--fw-semibold);
  font-size: var(--fs-body);
  margin: 0 0 2px;
}
.ping-reachout-value {
  color: #0f2d96;
  font-size: var(--fs-body);
  opacity: 0.85;
  text-decoration: none;
}
a.ping-reachout-value:hover {
  text-decoration: underline;
}
.ping-reachout-socials {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
.ping-social {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  background: #0f2d96;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.ping-social:hover {
  background: #ff6a4d;
}
.ping-social svg {
  width: 20px;
  height: 20px;
  display: block;
}
/* Stack the two columns on narrow screens (Reach Out drops below the form). */
@media (max-width: 860px) {
  .ping-contact-cols {
    flex-direction: column;
  }
  /* Stacked layout: the form fills the full width — drop both its 720px
     desktop cap and the shrink-to-fit width it gets under align-items:
     flex-start. The Reach Out sidebar keeps its own width, unchanged. */
  .ping-form {
    width: 100%;
    max-width: none;
  }
  .ping-reachout {
    flex-basis: auto;
    width: 100%;
    max-width: 620px;
  }
}
.ping-field input,
.ping-field textarea {
  width: 100%;
  background: #fff;
  border: none;
  border-radius: 20px;
  padding: var(--space-5) var(--space-6);
  font-size: var(--fs-body);
  font-weight: var(--fw-regular);
  color: #0f2d96;
  font-family: inherit;
  outline: none;
  box-shadow: 0 2px 8px rgba(15, 45, 150, 0.06);
  box-sizing: border-box;
}
.ping-field input::placeholder,
.ping-field textarea::placeholder {
  color: #0f2d96;
  opacity: 0.85;
}
.ping-field textarea {
  resize: vertical;
  min-height: 150px;
}
/* The focus ring below appeared instantly. Easing it in makes tabbing through
   the form feel less abrupt; the ring itself is unchanged, so nothing about
   the focus indicator's visibility or contrast is affected. */
.ping-field input,
.ping-field textarea {
  transition: box-shadow var(--motion-fast) var(--ease-out);
}
.ping-field input:focus,
.ping-field textarea:focus {
  box-shadow: 0 0 0 3px rgba(242, 111, 76, 0.45);
}
.ping-form-actions {
  display: flex;
  justify-content: flex-end;
}
.ping-submit {
  background: #ff6a4d;
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: var(--pill-pad-y, calc(var(--space-4) - 1px)) var(--pill-pad-x, calc(var(--space-8) + 4px));
  /* Orange pill label = header nav size + 1px. */
  font-size: var(--pill-font);
  font-weight: var(--fw-medium);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s;
}
.ping-submit:hover {
  background: #e05a37;
}
.ping-submit:disabled {
  opacity: 0.6;
  cursor: default;
}
.form-success {
  color: #0a7d3c;
  font-weight: var(--fw-semibold);
  font-size: var(--fs-sm);
}
.form-error {
  color: #b91c1c;
  font-weight: var(--fw-semibold);
  font-size: var(--fs-sm);
}

@media (max-width: 768px) {
  .ping-field input,
  .ping-field textarea {
    padding: 10px 20px;
  }
}
/* Tablet and phone: give the submit the header orange button's size/spacing
   (11/28px) instead of the smaller shared pill sizing, so it doesn't read as
   tiny next to the tall inputs. */
@media (max-width: 1024px) {
  .ping-submit {
    padding: calc(var(--space-3) - 1px) calc(var(--space-5) + 4px);
  }
}
</style>
