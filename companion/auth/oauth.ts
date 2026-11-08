// "Sign in with ChatGPT" and xAI Grok OAuth for the companion: authorization
// code + PKCE with a fixed loopback redirect, and refresh-token rotation.
//
// Both flows reuse the vendors' public desktop CLI client registrations (the
// Codex CLI's for OpenAI, the Grok CLI's for xAI), as Strike and opencode do.
// Those registrations pin the redirect host and port, so they cannot change.
// This is not an officially supported third-party integration: either vendor
// can change or block it.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { getCredential, setCredential, type OAuthCredential, type SubscriptionVendor } from './store.ts';

export type FlowConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  redirectHost: string;
  redirectPort: number;
  redirectPath: string;
  extraParams: Record<string, string>;
  includeNonce: boolean;
};

export const FLOWS: Record<SubscriptionVendor, FlowConfig> = {
  openai: {
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scope: 'openid profile email offline_access',
    redirectHost: 'localhost',
    redirectPort: 1455,
    redirectPath: '/auth/callback',
    extraParams: { id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: 'codex_cli_rs' },
    includeNonce: false,
  },
  xai: {
    authorizeUrl: 'https://auth.x.ai/oauth2/authorize',
    tokenUrl: 'https://auth.x.ai/oauth2/token',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    scope: 'openid profile email offline_access grok-cli:access api:access',
    redirectHost: '127.0.0.1',
    redirectPort: 56121,
    redirectPath: '/callback',
    // plan=generic is required for loopback OAuth with this client.
    extraParams: { plan: 'generic', referrer: 'stome' },
    includeNonce: true,
  },
};

/** Refresh this long before expiry so a question never meets a stale token. */
export const REFRESH_SKEW_MS = 2 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function redirectUri(flow: FlowConfig): string {
  return `http://${flow.redirectHost}:${flow.redirectPort}${flow.redirectPath}`;
}

export function authorizeUrl(flow: FlowConfig, state: string, challenge: string, nonce?: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: flow.clientId,
    redirect_uri: redirectUri(flow),
    scope: flow.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  if (flow.includeNonce && nonce) params.set('nonce', nonce);
  for (const [key, value] of Object.entries(flow.extraParams)) params.set(key, value);
  return `${flow.authorizeUrl}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function postForm(tokenUrl: string, form: Record<string, string>, fetcher: FetchLike): Promise<TokenResponse> {
  const response = await fetcher(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  let body: TokenResponse;
  try {
    body = (await response.json()) as TokenResponse;
  } catch {
    throw new Error(`The sign-in server returned an unreadable reply (HTTP ${response.status})`);
  }
  if (body.error || !response.ok) {
    // Error codes and descriptions from the auth server, never token values.
    throw new Error(`Sign-in failed: ${body.error_description || body.error || `HTTP ${response.status}`}`);
  }
  if (!body.access_token) {
    throw new Error('Sign-in failed: no access token in the reply');
  }
  return body;
}

/** Unverified JWT claims, read only to route requests (never for trust decisions). */
export function accountIdFromToken(token: string | undefined): string | undefined {
  const payload = token?.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      chatgpt_account_id?: string;
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
      organizations?: { id?: string }[];
    };
    return (
      claims.chatgpt_account_id ||
      claims['https://api.openai.com/auth']?.chatgpt_account_id ||
      claims.organizations?.[0]?.id ||
      undefined
    );
  } catch {
    return undefined;
  }
}

function toCredential(vendor: SubscriptionVendor, body: TokenResponse, previous?: OAuthCredential): OAuthCredential {
  const idToken = body.id_token || previous?.idToken;
  const expiresIn = body.expires_in && body.expires_in > 0 ? body.expires_in : 3600;
  const credential: OAuthCredential = {
    type: 'oauth',
    access: body.access_token as string,
    refresh: body.refresh_token || previous?.refresh || '',
    expiresAt: Date.now() + expiresIn * 1000,
  };
  if (idToken) credential.idToken = idToken;
  if (vendor === 'openai') {
    const accountId = accountIdFromToken(idToken) || accountIdFromToken(credential.access) || previous?.accountId;
    if (accountId) credential.accountId = accountId;
  }
  return credential;
}

export async function exchangeCode(
  vendor: SubscriptionVendor,
  code: string,
  verifier: string,
  fetcher: FetchLike = fetch,
): Promise<OAuthCredential> {
  const flow = FLOWS[vendor];
  const body = await postForm(
    flow.tokenUrl,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri(flow), client_id: flow.clientId, code_verifier: verifier },
    fetcher,
  );
  return toCredential(vendor, body);
}

export async function refreshCredential(
  vendor: SubscriptionVendor,
  previous: OAuthCredential,
  fetcher: FetchLike = fetch,
): Promise<OAuthCredential> {
  const flow = FLOWS[vendor];
  const body = await postForm(
    flow.tokenUrl,
    { grant_type: 'refresh_token', refresh_token: previous.refresh, client_id: flow.clientId },
    fetcher,
  );
  return toCredential(vendor, body, previous);
}

/**
 * The stored sign-in for a vendor, refreshed and persisted when it is close to
 * expiry. Throws a plain Error the provider turns into a provider_error.
 */
export function credentialSource(
  vendor: SubscriptionVendor,
  options: { path?: string; fetcher?: FetchLike; now?: () => number } = {},
): () => Promise<OAuthCredential> {
  let inflight: Promise<OAuthCredential> | null = null;
  return async () => {
    const stored = getCredential(vendor, options.path);
    if (!stored) {
      throw new Error(`Not signed in to ${vendor === 'openai' ? 'ChatGPT' : 'Grok'}: run npm run companion:login -- ${vendor}`);
    }
    const now = options.now?.() ?? Date.now();
    if (stored.expiresAt - now > REFRESH_SKEW_MS || !stored.refresh) {
      return stored;
    }
    // Concurrent questions share one refresh, so a rotated refresh token is used once.
    inflight ??= refreshCredential(vendor, stored, options.fetcher)
      .then((fresh) => {
        setCredential(vendor, fresh, options.path);
        return fresh;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

function callbackPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Stome sign-in</title><body style="font-family:system-ui;padding:2rem">${message}</body>`;
}

/**
 * Browser sign-in: bind the registered loopback redirect, print the authorize
 * URL, wait for the code, exchange it, and store the credential.
 */
export async function login(
  vendor: SubscriptionVendor,
  options: { path?: string; open?: (url: string) => void; log?: (line: string) => void; fetcher?: FetchLike } = {},
): Promise<OAuthCredential> {
  const flow = FLOWS[vendor];
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const { verifier, challenge } = createPkce();
  const state = base64Url(randomBytes(32));
  const url = authorizeUrl(flow, state, challenge, base64Url(randomBytes(32)));

  const code = await new Promise<string>((resolve, reject) => {
    let server: Server | null = null;
    const timer = setTimeout(() => finish(new Error('Sign-in timed out waiting for the browser')), LOGIN_TIMEOUT_MS);
    function finish(result: Error | string): void {
      clearTimeout(timer);
      server?.close();
      if (typeof result === 'string') resolve(result);
      else reject(result);
    }
    server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', redirectUri(flow));
      if (requestUrl.pathname !== flow.redirectPath) {
        response.writeHead(404).end();
        return;
      }
      const params = requestUrl.searchParams;
      const error = params.get('error_description') || params.get('error');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (error) {
        response.end(callbackPage(`Sign-in failed: ${error.replace(/[<>&]/g, '')}`));
        finish(new Error(`Sign-in failed: ${error}`));
      } else if (params.get('state') !== state) {
        response.end(callbackPage('Sign-in failed: state mismatch.'));
        finish(new Error('Sign-in failed: state mismatch in the callback'));
      } else if (!params.get('code')) {
        response.end(callbackPage('Sign-in failed: no authorization code.'));
        finish(new Error('Sign-in failed: the callback had no authorization code'));
      } else {
        response.end(callbackPage('Signed in. You can close this window and return to the terminal.'));
        finish(params.get('code') as string);
      }
    });
    server.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Port ${flow.redirectPort} is in use (another sign-in, or the vendor's own CLI). Close it and try again.`
            : `Could not listen on ${redirectUri(flow)}: ${error.message}`,
        ),
      );
    });
    server.listen(flow.redirectPort, flow.redirectHost, () => {
      log(`Open this URL to sign in (it should open in your browser):\n\n  ${url}\n`);
      options.open?.(url);
    });
  });

  const credential = await exchangeCode(vendor, code, verifier, options.fetcher);
  if (vendor === 'openai' && !credential.accountId) {
    throw new Error('Signed in, but the ChatGPT account id was missing from the token. Is this account on a ChatGPT plan?');
  }
  setCredential(vendor, credential, options.path);
  return credential;
}
