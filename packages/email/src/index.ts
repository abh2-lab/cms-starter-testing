export type {
  EmailLogger,
  EmailMessage,
  EmailProviderConfig,
  EmailProviderName,
  EmailTransport,
} from './types.js';
export {
  BrevoTransport,
  HttpTransport,
  ResendTransport,
  SmtpTransport,
  StubTransport,
} from './transports.js';
export { buildTransport } from './build-transport.js';
export { resolveEmailConfig } from './resolve-config.js';
export type { ResolvedEmailConfig } from './resolve-config.js';
