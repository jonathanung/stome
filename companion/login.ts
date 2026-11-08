// npm run companion:login -- <openai|xai>          sign in with a ChatGPT or Grok subscription
// npm run companion:login -- status                show who is signed in (never prints tokens)
// npm run companion:login -- logout <openai|xai>   forget a sign-in
import { spawn } from 'node:child_process';

import { login } from './auth/oauth.ts';
import { authFilePath, deleteCredential, getCredential, type SubscriptionVendor } from './auth/store.ts';

const NAMES: Record<SubscriptionVendor, string> = { openai: 'ChatGPT', xai: 'Grok' };

function isVendor(value: string | undefined): value is SubscriptionVendor {
  return value === 'openai' || value === 'xai';
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // The URL is printed; opening it is best-effort.
  }
}

async function main(argv: string[]): Promise<void> {
  const [command, arg] = argv;
  if (command === 'status') {
    for (const vendor of ['openai', 'xai'] as const) {
      const credential = getCredential(vendor);
      const state = credential
        ? `signed in; access token ${credential.expiresAt > Date.now() ? 'valid' : 'expired, refreshes on next question'}`
        : 'not signed in';
      process.stdout.write(`${NAMES[vendor]} (${vendor}): ${state}\n`);
    }
    process.stdout.write(`Credentials file: ${authFilePath()}\n`);
    return;
  }
  if (command === 'logout') {
    if (!isVendor(arg)) throw new Error('Usage: npm run companion:login -- logout <openai|xai>');
    process.stdout.write(deleteCredential(arg) ? `Signed out of ${NAMES[arg]}.\n` : `Not signed in to ${NAMES[arg]}.\n`);
    return;
  }
  if (!isVendor(command)) {
    throw new Error('Usage: npm run companion:login -- <openai|xai|status|logout <openai|xai>>');
  }
  await login(command, { open: openBrowser });
  process.stdout.write(
    `Signed in to ${NAMES[command]}. Start the companion with STOME_PROVIDER=${command} npm run companion` +
      ` (unset ${command === 'openai' ? 'OPENAI_API_KEY' : 'XAI_API_KEY'}, or the API key is used instead).\n`,
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Sign-in failed'}\n`);
  process.exitCode = 1;
});
