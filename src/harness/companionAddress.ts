// Where the app is allowed to send a pairing token.
// The companion process stays on 127.0.0.1. A tablet cannot run npm, so it uses
// the laptop's https page (npm run web:lan). That page proxies /v1 to the companion.
// The token is still required. Cleartext LAN addresses and public sites are refused
// before fetch, so the token and note text are not sent there.

import { PROVIDER_LIMITS } from './contract.ts';

export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:8787';

/** Same byte cap the companion enforces on /v1/tool. */
export const COMPANION_RAW_BODY_LIMIT = PROVIDER_LIMITS.maxRequestChars + 2_000;

export type CompanionContext = {
  /** window.location.origin, or null in Node and in the installed native app. */
  pageOrigin: string | null;
  native: boolean;
};

export type CompanionPageKind = 'laptop' | 'secure-local' | 'device' | 'public';

export type CompanionAddressDecision = { ok: true; origin: string } | { ok: false; message: string };

export type CompanionProxyDecision =
  | { action: 'ignore' }
  | { action: 'reject'; status: number; message: string }
  | { action: 'forward'; method: 'GET' | 'POST'; path: '/v1/status' | '/v1/tool'; origin: string };

export type CompanionSetup = {
  kind: CompanionPageKind;
  steps: readonly string[];
  addressHint: string;
};

export function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}

/** Dotted IPv4 in canonical form on a private or link-local range. Rejects leading zeros. */
export function isCanonicalPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const parts = match.slice(1).map((part) => {
    if (part.length > 1 && part.startsWith('0')) return -1;
    const value = Number(part);
    if (!Number.isInteger(value) || value > 255 || String(value) !== part) return -1;
    return value;
  });
  if (parts.some((part) => part < 0)) return false;
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function readCompanionContext(): CompanionContext {
  const product = typeof navigator === 'undefined' ? undefined : (navigator as { product?: string }).product;
  if (product === 'ReactNative') return { pageOrigin: null, native: true };
  if (typeof window === 'undefined' || typeof window.location?.origin !== 'string') {
    return { pageOrigin: null, native: false };
  }
  const pageOrigin = window.location.origin;
  if (!pageOrigin || pageOrigin === 'null') return { pageOrigin: null, native: false };
  return { pageOrigin, native: false };
}

export function classifyCompanionPage(context: CompanionContext): CompanionPageKind {
  if (context.native) return 'device';
  if (!context.pageOrigin) return 'laptop';
  let url: URL;
  try {
    url = new URL(context.pageOrigin);
  } catch {
    return 'public';
  }
  if (url.origin !== context.pageOrigin || url.username !== '' || url.password !== '') return 'public';
  if (url.protocol === 'https:' && (isLoopbackHostname(url.hostname) || isCanonicalPrivateIpv4(url.hostname))) {
    return 'secure-local';
  }
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return 'laptop';
  return 'public';
}

export function defaultCompanionUrl(context: CompanionContext): string {
  if (classifyCompanionPage(context) === 'secure-local' && context.pageOrigin) return context.pageOrigin;
  return DEFAULT_COMPANION_URL;
}

function pageHostname(pageOrigin: string | null): string {
  if (!pageOrigin) return '';
  try {
    return new URL(pageOrigin).hostname;
  } catch {
    return '';
  }
}

export function decideCompanionAddress(baseUrl: string, context: CompanionContext): CompanionAddressDecision {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, message: 'The companion address is not a URL' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, message: 'The companion address cannot include credentials' };
  }
  const kind = classifyCompanionPage(context);
  if (kind === 'device') {
    return {
      ok: false,
      message:
        'This device cannot run the companion. npm is not available here, and 127.0.0.1 is the device itself. On the laptop run npm run companion and npm run web:lan, then open the printed https address in Safari.',
    };
  }
  if (kind === 'public') {
    return {
      ok: false,
      message:
        'This page is not a local companion address. Open the https URL from npm run web:lan. The pairing token is not sent from a public page.',
    };
  }
  if (kind === 'secure-local') {
    if (url.protocol === 'https:' && url.origin === context.pageOrigin) return { ok: true, origin: url.origin };
    if (url.protocol === 'http:' && isLoopbackHostname(url.hostname) && isCanonicalPrivateIpv4(pageHostname(context.pageOrigin))) {
      return {
        ok: false,
        message:
          'That companion address is loopback on this device, not the laptop. An iPad cannot run npm run companion. Set the companion address to this page’s https origin.',
      };
    }
    if (url.protocol === 'http:') {
      return {
        ok: false,
        message:
          'This https page cannot call an http companion. Set the companion address to this page’s https origin so the laptop proxy can reach it.',
      };
    }
    return {
      ok: false,
      message: 'The companion address must be this page’s https origin. The pairing token is not sent anywhere else.',
    };
  }
  if (url.protocol !== 'http:') return { ok: false, message: 'The companion must use http on this machine' };
  if (!isLoopbackHostname(url.hostname)) return { ok: false, message: 'The companion must stay on loopback' };
  return { ok: true, origin: url.origin };
}

export function companionSetup(context: CompanionContext): CompanionSetup {
  const kind = classifyCompanionPage(context);
  if (kind === 'device') {
    return {
      kind,
      steps: [
        'This device cannot run npm or the companion. 127.0.0.1 is the device itself.',
        'On the laptop, run npm run companion and leave that process open.',
        'On the laptop, run npm run web:lan. In Safari on the iPad, open the https address it prints and trust the certificate.',
        'Paste the laptop pairing token on that Safari page. The token stays in memory, and the model key stays on the laptop.',
      ],
      addressHint: 'Pair in Safari at the laptop https address. This installed app cannot reach the laptop companion.',
    };
  }
  if (kind === 'public') {
    return {
      kind,
      steps: [
        'This page is not the laptop’s local https address, so the pairing token will not be sent.',
        'On the laptop, run npm run companion and npm run web:lan, then open the https address that command prints.',
      ],
      addressHint: 'Open the https URL from npm run web:lan.',
    };
  }
  if (kind === 'secure-local' && isCanonicalPrivateIpv4(pageHostname(context.pageOrigin))) {
    return {
      kind,
      steps: [
        'An iPad cannot run npm. The companion stays on the laptop.',
        'On the laptop, run npm run companion and leave it open. Copy the pairing token from that terminal.',
        'On the laptop, run npm run web:lan. Trust its certificate on the iPad, then open the https address in Safari.',
        'Leave the companion address as this page’s https origin. 127.0.0.1 is the iPad, and an https page cannot call the http companion port.',
      ],
      addressHint: `Use ${context.pageOrigin}. The laptop proxies that address to the companion and still requires the pairing token.`,
    };
  }
  if (kind === 'secure-local') {
    return {
      kind,
      steps: [
        'This page is https, so the companion address is this page, not http://127.0.0.1:8787.',
        'On the laptop, keep npm run companion running. This page proxies to it. The pairing token is still required.',
        'An iPad cannot run npm. On the iPad, open the https address from npm run web:lan in Safari and trust the certificate.',
      ],
      addressHint: `Use ${context.pageOrigin}. The browser blocks this https page from calling http://127.0.0.1:8787.`,
    };
  }
  return {
    kind: 'laptop',
    steps: [
      'On this computer, run npm run companion and leave it open.',
      'Paste the pairing token below. It stays in memory only.',
      'An iPad cannot run that command. For an iPad, also run npm run web:lan and open its https address in Safari.',
    ],
    addressHint: 'This browser is on the laptop, so the companion address stays http://127.0.0.1:8787.',
  };
}

/** Ports of the local web app whose origins may carry the pairing token. */
export function devWebPorts(configuredOrigin: string, extras: readonly (string | number | undefined)[] = []): number[] {
  const ports = new Set<number>();
  const add = (port: number) => {
    if (Number.isInteger(port) && port >= 1 && port <= 65535) ports.add(port);
  };
  try {
    const url = new URL(configuredOrigin);
    add(Number(url.port || (url.protocol === 'https:' ? 443 : 80)));
  } catch {
    // A non-URL configured origin is still matched as an exact string.
  }
  for (const extra of extras) {
    if (typeof extra === 'number') add(extra);
    else if (typeof extra === 'string' && extra.trim() !== '') add(Number(extra));
  }
  if (ports.size === 0) add(8081);
  return [...ports];
}

/**
 * Origins the loopback companion may answer.
 * The configured origin is always included. So are this web port's loopback http
 * origins and its https origins on loopback or a canonical private IPv4 address.
 * The socket is still loopback-only, so a tablet reaches those https origins through
 * the web proxy, not by opening the companion port on the LAN.
 */
export function companionOriginAllowed(
  origin: string | undefined,
  configured: string,
  webPorts: readonly number[],
): boolean {
  if (!origin || origin.includes('\r') || origin.includes('\n')) return false;
  if (origin === configured) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.username !== '' || url.password !== '') return false;
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!webPorts.includes(port)) return false;
  if (url.protocol === 'https:' && (isLoopbackHostname(url.hostname) || isCanonicalPrivateIpv4(url.hostname))) return true;
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return true;
  return false;
}

function isProxyHostname(hostname: string, secure: boolean): boolean {
  if (isLoopbackHostname(hostname)) return true;
  return secure && isCanonicalPrivateIpv4(hostname);
}

/** Decides whether the web host should proxy this request to the loopback companion. */
export function evaluateCompanionProxy(input: {
  method: string | undefined;
  target: string | undefined;
  host: string | undefined;
  origin: string | undefined;
  hasToken: boolean;
  secure: boolean;
  localPort: number;
}): CompanionProxyDecision {
  const target = input.target ?? '';
  const pathOnly = target.split('?')[0]?.split('#')[0] ?? '';
  const companionPath = pathOnly === '/v1/status' || pathOnly === '/v1/tool' || pathOnly.startsWith('/v1/');
  if (!companionPath) return { action: 'ignore' };
  if (target !== '/v1/status' && target !== '/v1/tool') {
    return { action: 'reject', status: 404, message: 'Unknown companion route' };
  }
  const allowedMethod = (target === '/v1/status' && input.method === 'GET') || (target === '/v1/tool' && input.method === 'POST');
  if (!allowedMethod) return { action: 'reject', status: 404, message: 'Unknown companion route' };
  if (!input.host) return { action: 'reject', status: 403, message: 'The companion rejects that host' };
  let parsed: URL;
  try {
    parsed = new URL(`${input.secure ? 'https' : 'http'}://${input.host}`);
  } catch {
    return { action: 'reject', status: 403, message: 'The companion rejects that host' };
  }
  if (parsed.host !== input.host || Number(parsed.port) !== input.localPort || !isProxyHostname(parsed.hostname, input.secure)) {
    return { action: 'reject', status: 403, message: 'The companion rejects that host' };
  }
  // Same-origin GET may omit Origin. A cross-origin browser request sends Origin, and it must match this host.
  if (input.origin && input.origin !== parsed.origin) {
    return { action: 'reject', status: 403, message: 'The companion rejects that app origin' };
  }
  if (!input.hasToken) return { action: 'reject', status: 401, message: 'The pairing token does not match' };
  return {
    action: 'forward',
    method: target === '/v1/status' ? 'GET' : 'POST',
    path: target,
    origin: parsed.origin,
  };
}
