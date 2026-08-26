import { apiFetch } from '@/lib/api';

export type EmailProvider = 'smtp' | 'resend' | 'brevo' | 'stub';

// Secrets are always masked strings on the wire ('••••••••' when set, '' when
// not). The page only sends a secret back when the user actually retypes it.
export interface EmailSettings {
  provider: EmailProvider;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  resendApiKey: string;
  brevoApiKey: string;
  notifyOnReview: boolean;
  notifyOnApproval: boolean;
  notifyOnPublish: boolean;
  notifyOnReaderSubmission: boolean;
  notifyOnHealthAlerts: boolean;
  isConfigured: boolean;
}

// Every field optional — PATCH accepts any subset. Secret fields are omitted
// unless retyped.
export type EmailSettingsInput = Partial<{
  provider: EmailProvider;
  fromName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string;
  resendApiKey: string;
  brevoApiKey: string;
  notifyOnReview: boolean;
  notifyOnApproval: boolean;
  notifyOnReaderSubmission: boolean;
}>;

export interface TestEmailResult {
  success: boolean;
  message: string;
}

export const emailSettingsApi = {
  get: () => apiFetch<{ data: EmailSettings }>('/admin/settings/email'),
  update: (input: EmailSettingsInput) =>
    apiFetch<{ data: EmailSettings }>('/admin/settings/email', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  test: () =>
    apiFetch<{ data: TestEmailResult }>('/admin/settings/email/test', {
      method: 'POST',
    }),
};
