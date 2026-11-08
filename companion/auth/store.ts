// Subscription sign-in credentials for the companion.
//
// Lives in ~/.stome/auth.json (directory 0700, file 0600), or STOME_AUTH_FILE.
// Only the companion process reads it. The app never sees these tokens: it
// holds the pairing token, and /v1/status reports no credential.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SubscriptionVendor = 'openai' | 'xai';

export type OAuthCredential = {
  type: 'oauth';
  access: string;
  refresh: string;
  idToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** ChatGPT account id, read from the id token. OpenAI only. */
  accountId?: string;
};

type StoreFile = { version: 1; credentials: Partial<Record<SubscriptionVendor, OAuthCredential>> };

export function authFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.STOME_AUTH_FILE?.trim() || join(homedir(), '.stome', 'auth.json');
}

function readStore(path: string): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoreFile>;
    if (parsed && parsed.version === 1 && parsed.credentials && typeof parsed.credentials === 'object') {
      return { version: 1, credentials: parsed.credentials };
    }
  } catch {
    // Missing or unreadable: treat as empty. A corrupt file is replaced on the next login.
  }
  return { version: 1, credentials: {} };
}

function writeStore(path: string, store: StoreFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

export function getCredential(vendor: SubscriptionVendor, path: string = authFilePath()): OAuthCredential | null {
  const credential = readStore(path).credentials[vendor];
  return credential && credential.type === 'oauth' && credential.access ? credential : null;
}

export function setCredential(vendor: SubscriptionVendor, credential: OAuthCredential, path: string = authFilePath()): void {
  const store = readStore(path);
  store.credentials[vendor] = credential;
  writeStore(path, store);
}

export function deleteCredential(vendor: SubscriptionVendor, path: string = authFilePath()): boolean {
  const store = readStore(path);
  if (!store.credentials[vendor]) return false;
  delete store.credentials[vendor];
  writeStore(path, store);
  return true;
}
