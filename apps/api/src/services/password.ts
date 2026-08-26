import { hash, verify } from '@node-rs/argon2';

// OWASP 2024 minimums for argon2id are memoryCost=19MiB, timeCost=2,
// parallelism=1. We sit comfortably above that: 64 MiB / 3 iterations.
// Tuning higher trades login latency for offline-cracking cost.
//
// algorithm=2 is Algorithm.Argon2id in @node-rs/argon2. We use the numeric
// literal because Algorithm is exported as an ambient const enum, which
// conflicts with TypeScript's `verbatimModuleSyntax: true`.
const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  plain: string,
  storedHash: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS);
  } catch {
    // Malformed hash, bad encoding, version mismatch — treat as a non-match
    // rather than letting the error propagate to the caller. Constant-ish
    // failure is what we want for an auth flow.
    return false;
  }
}
