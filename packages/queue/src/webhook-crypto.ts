import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { env } from '@cms/config';

/**
 * AES-256-GCM envelope encryption for webhook signing secrets.
 *
 * Layout of the resulting Buffer (what gets stored in webhooks.secret_encrypted):
 *
 *   ┌──────────────┬──────────────────┬─────────────────────┐
 *   │  12-byte IV  │ 16-byte auth tag │ ciphertext (var)    │
 *   └──────────────┴──────────────────┴─────────────────────┘
 *
 * The encryption key is derived once at module load via scryptSync from
 * env.WEBHOOK_SECRET_ENCRYPTION_KEY — operators provide any random string;
 * scrypt stretches it to a 32-byte key. The salt is fixed (versioned) so the
 * derivation is deterministic across processes; rotating the env var
 * invalidates every existing ciphertext.
 *
 * Lives in @cms/queue because the only consumers are queue-adjacent: the
 * API encrypts on webhook create/rotate, the worker decrypts to sign
 * outgoing deliveries.
 */

// Fixed salt — bumping the suffix breaks every existing ciphertext and forces
// every webhook through "Rotate secret". Useful as an emergency key-rotation
// lever if the env var ever leaks.
const KEY_SALT = 'cms-webhook-secret-v1';
const KEY_LENGTH = 32; // bytes — AES-256
const IV_LENGTH = 12; // bytes — GCM standard
const TAG_LENGTH = 16; // bytes — GCM auth tag

const derivedKey = scryptSync(
  env.WEBHOOK_SECRET_ENCRYPTION_KEY,
  KEY_SALT,
  KEY_LENGTH,
);

export function encryptWebhookSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptWebhookSecret(envelope: Buffer): string {
  if (envelope.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('webhook secret envelope is truncated');
  }
  const iv = envelope.subarray(0, IV_LENGTH);
  const tag = envelope.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = envelope.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}
