// The rendered message a transport delivers. Provider-agnostic.
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// A transport sends one message and can release any pooled resources.
export interface EmailTransport {
  send(msg: EmailMessage): Promise<{ messageId: string }>;
  close(): Promise<void>;
}

// Minimal logger shape (a pino logger from the worker, or a thin console
// adapter from the API) — used by the stub transport to print what it "sent".
export interface EmailLogger {
  info(obj: unknown, msg: string): void;
}

// Providers this layer can send through. 'brevo' is the Brevo (ex-SendinBlue)
// transactional API. 'http' is reachable only via the legacy env fallback
// (the DB-backed UI exposes smtp/resend/brevo/stub); 'stub' logs and sends
// nothing.
export type EmailProviderName = 'smtp' | 'resend' | 'brevo' | 'stub' | 'http';

// Fully-resolved, decrypted email configuration handed to buildTransport().
// Secrets are already plaintext here — resolveEmailConfig decrypts them.
export interface EmailProviderConfig {
  provider: EmailProviderName;
  fromName?: string | null;
  fromAddress: string;
  replyTo?: string | null;
  smtp?:
    | {
        host: string;
        port: number;
        secure: boolean;
        user?: string | undefined;
        pass?: string | undefined;
      }
    | undefined;
  resendApiKey?: string | undefined;
  brevoApiKey?: string | undefined;
  http?:
    | {
        endpoint: string;
        method: 'POST' | 'PUT';
        authHeader: string;
        authValue: string;
        contentType: string;
      }
    | undefined;
}
