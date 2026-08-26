import { createTransport } from 'nodemailer';
import type {
  EmailLogger,
  EmailMessage,
  EmailProviderConfig,
  EmailTransport,
} from './types.js';

// nodemailer's exported `SentMessageInfo` alias resolves to `any`; re-derive the
// real shape from createTransport's return so sendMail() flows proper types.
type SmtpTransporter = ReturnType<typeof createTransport>;
type SmtpSendResult = Awaited<ReturnType<SmtpTransporter['sendMail']>>;

// RFC 5322 From/Reply-To header: `"Display Name" <addr>` when a name is set,
// otherwise the bare address. JSON.stringify quotes + escapes the display name.
function formatAddress(name: string | null | undefined, address: string): string {
  return name && name.length > 0 ? `${JSON.stringify(name)} <${address}>` : address;
}

async function postJson(args: {
  url: string;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  body: unknown;
}): Promise<unknown> {
  const res = await fetch(args.url, {
    method: args.method,
    headers: args.headers,
    body: JSON.stringify(args.body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `email http ${args.method} ${args.url} failed ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Logs the email instead of sending — default for unconfigured installs. */
export class StubTransport implements EmailTransport {
  constructor(
    private readonly cfg: EmailProviderConfig,
    private readonly log?: EmailLogger,
  ) {}

  send(msg: EmailMessage): Promise<{ messageId: string }> {
    const messageId = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const line = {
      transport: 'stub',
      from: this.cfg.fromAddress,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      messageId,
    };
    if (this.log) this.log.info(line, 'email send (stub)');
    else console.info('email send (stub)', line);
    return Promise.resolve({ messageId });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Real SMTP delivery via nodemailer. */
export class SmtpTransport implements EmailTransport {
  private readonly transporter: SmtpTransporter;

  constructor(private readonly cfg: EmailProviderConfig) {
    const smtp = cfg.smtp;
    if (!smtp || !smtp.host) {
      throw new Error('SMTP provider selected but smtp.host is not configured');
    }
    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth:
        smtp.user || smtp.pass
          ? { user: smtp.user ?? '', pass: smtp.pass ?? '' }
          : undefined,
    });
  }

  async send(msg: EmailMessage): Promise<{ messageId: string }> {
    const info: SmtpSendResult = await this.transporter.sendMail({
      from: formatAddress(this.cfg.fromName, this.cfg.fromAddress),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(this.cfg.replyTo ? { replyTo: this.cfg.replyTo } : {}),
    });
    return { messageId: info.messageId };
  }

  close(): Promise<void> {
    this.transporter.close();
    return Promise.resolve();
  }
}

/** Resend HTTPS API (https://api.resend.com/emails). */
export class ResendTransport implements EmailTransport {
  constructor(private readonly cfg: EmailProviderConfig) {}

  async send(msg: EmailMessage): Promise<{ messageId: string }> {
    const body = await postJson({
      url: 'https://api.resend.com/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.resendApiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: {
        from: formatAddress(this.cfg.fromName, this.cfg.fromAddress),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(this.cfg.replyTo ? { reply_to: this.cfg.replyTo } : {}),
      },
    });
    const id =
      asString((body as { id?: unknown } | null)?.id) ?? `resend-${Date.now()}`;
    return { messageId: id };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Brevo (formerly SendinBlue) transactional API. */
export class BrevoTransport implements EmailTransport {
  constructor(private readonly cfg: EmailProviderConfig) {}

  async send(msg: EmailMessage): Promise<{ messageId: string }> {
    const body = await postJson({
      url: 'https://api.brevo.com/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': this.cfg.brevoApiKey ?? '',
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: {
        sender: {
          email: this.cfg.fromAddress,
          ...(this.cfg.fromName ? { name: this.cfg.fromName } : {}),
        },
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        ...(this.cfg.replyTo ? { replyTo: { email: this.cfg.replyTo } } : {}),
      },
    });
    const id =
      asString((body as { messageId?: unknown } | null)?.messageId) ??
      `brevo-${Date.now()}`;
    return { messageId: id };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Generic Resend-shape HTTP POST — legacy env-fallback only. */
export class HttpTransport implements EmailTransport {
  constructor(private readonly cfg: EmailProviderConfig) {}

  async send(msg: EmailMessage): Promise<{ messageId: string }> {
    const http = this.cfg.http;
    if (!http || !http.endpoint) {
      throw new Error('HTTP provider selected but http.endpoint is not configured');
    }
    const body = await postJson({
      url: http.endpoint,
      method: http.method,
      headers: {
        [http.authHeader]: http.authValue,
        'Content-Type': http.contentType,
      },
      body: {
        from: formatAddress(this.cfg.fromName, this.cfg.fromAddress),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      },
    });
    const obj = body as Record<string, unknown> | null;
    const id =
      asString(obj?.['id']) ??
      asString(obj?.['messageId']) ??
      asString(obj?.['message_id']) ??
      `http-${Date.now()}`;
    return { messageId: id };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
