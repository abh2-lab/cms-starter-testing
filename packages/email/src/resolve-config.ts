import { eq, isNull } from 'drizzle-orm';
import { env } from '@cms/config';
import { db, schema } from '@cms/db';
import { decryptWebhookSecret } from '@cms/queue';
import type { EmailProviderConfig, EmailProviderName } from './types.js';

// A resolved config plus a change-token so callers can cache the built
// transport and rebuild only when settings actually change. `version` is the
// settings row's updatedAt epoch-ms (0 for the env fallback, which never
// changes at runtime).
export interface ResolvedEmailConfig {
  config: EmailProviderConfig;
  version: number;
}

function decryptOrUndefined(buf: Buffer | null): string | undefined {
  if (!buf || buf.length === 0) return undefined;
  try {
    return decryptWebhookSecret(buf);
  } catch {
    // A decrypt failure (e.g. the encryption key was rotated) shouldn't crash
    // the worker — treat the secret as unset so the provider surfaces a clean
    // auth error instead.
    return undefined;
  }
}

// Read + decrypt the per-tenant email_settings row into a transport config.
// Falls back to the legacy env-based config when no row exists, so installs
// that configured email via env before this feature keep working untouched.
export async function resolveEmailConfig(args: {
  tenantId: string | null;
}): Promise<ResolvedEmailConfig> {
  const where =
    args.tenantId == null
      ? isNull(schema.emailSettings.tenantId)
      : eq(schema.emailSettings.tenantId, args.tenantId);

  const [row] = await db
    .select()
    .from(schema.emailSettings)
    .where(where)
    .limit(1);

  if (!row) {
    return { config: envFallbackConfig(), version: 0 };
  }

  const fromAddress =
    row.fromAddress && row.fromAddress.length > 0
      ? row.fromAddress
      : env.EMAIL_FROM;

  const config: EmailProviderConfig = {
    provider: row.provider,
    fromName: row.fromName,
    fromAddress,
    replyTo: row.replyTo,
    smtp:
      row.smtpHost && row.smtpHost.length > 0
        ? {
            host: row.smtpHost,
            port: row.smtpPort,
            secure: row.smtpSecure,
            user: row.smtpUser ?? undefined,
            pass: decryptOrUndefined(row.smtpPassEncrypted),
          }
        : undefined,
    resendApiKey: decryptOrUndefined(row.resendKeyEncrypted),
    brevoApiKey: decryptOrUndefined(row.brevoKeyEncrypted),
  };

  return { config, version: row.updatedAt.getTime() };
}

// Legacy path: build a config from the env block (EMAIL_PROVIDER + SMTP_*/…).
function envFallbackConfig(): EmailProviderConfig {
  const provider: EmailProviderName =
    env.EMAIL_PROVIDER === 'sendinblue' ? 'brevo' : env.EMAIL_PROVIDER;
  return {
    provider,
    fromAddress: env.EMAIL_FROM,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
    },
    resendApiKey: env.RESEND_API_KEY || undefined,
    brevoApiKey: env.SENDINBLUE_API_KEY || undefined,
    http: {
      endpoint: env.EMAIL_HTTP_ENDPOINT,
      method: env.EMAIL_HTTP_METHOD,
      authHeader: env.EMAIL_HTTP_AUTH_HEADER,
      authValue: env.EMAIL_HTTP_AUTH_VALUE,
      contentType: env.EMAIL_HTTP_CONTENT_TYPE,
    },
  };
}
