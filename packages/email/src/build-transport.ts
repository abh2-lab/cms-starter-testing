import {
  BrevoTransport,
  HttpTransport,
  ResendTransport,
  SmtpTransport,
  StubTransport,
} from './transports.js';
import type {
  EmailLogger,
  EmailProviderConfig,
  EmailTransport,
} from './types.js';

// Construct the transport for a resolved config. Pure + synchronous so callers
// can cache the result and rebuild only when the underlying settings change.
export function buildTransport(
  cfg: EmailProviderConfig,
  log?: EmailLogger,
): EmailTransport {
  switch (cfg.provider) {
    case 'smtp':
      return new SmtpTransport(cfg);
    case 'resend':
      return new ResendTransport(cfg);
    case 'brevo':
      return new BrevoTransport(cfg);
    case 'http':
      return new HttpTransport(cfg);
    case 'stub':
    default:
      return new StubTransport(cfg, log);
  }
}
