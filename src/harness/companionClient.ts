import { HarnessError, type HarnessErrorCode } from './contract';
import type { Provider, ProviderRequest } from './provider';
import type { CompanionStatus } from './tools';

const ERROR_CODES: readonly HarnessErrorCode[] = [
  'invalid_shape',
  'scope_rejected',
  'bad_anchor',
  'confirmation_required',
  'stale_revision',
  'proposal_mismatch',
  'not_found',
  'already_confirmed',
  'request_limit',
  'output_limit',
  'cancelled',
  'timeout',
  'provider_error',
  'invalid_output',
  'interrupted',
  'busy',
];

function asCode(value: unknown): HarnessErrorCode {
  if (typeof value === 'string' && ERROR_CODES.some((code) => code === value)) {
    return value as HarnessErrorCode;
  }
  return 'provider_error';
}

function isLoopbackHost(hostname: string): boolean {
  // URL.hostname keeps the brackets on an IPv6 literal, so "[::1]" is the loopback host.
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}

export function assertCompanionUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new HarnessError('provider_error', 'The companion address is not a URL');
  }
  if (url.protocol !== 'http:') {
    throw new HarnessError('provider_error', 'The companion must use http on this machine');
  }
  if (url.username !== '' || url.password !== '') {
    throw new HarnessError('provider_error', 'The companion address cannot include credentials');
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new HarnessError('provider_error', 'The companion must stay on loopback');
  }
  return url.origin;
}

export function companionProvider(options: { baseUrl: string; token: string }): Provider {
  return {
    async complete(request: ProviderRequest, signal: AbortSignal): Promise<unknown> {
      const origin = assertCompanionUrl(options.baseUrl);
      let response: Response;
      try {
        response = await fetch(`${origin}/v1/tool`, {
          method: 'POST',
          credentials: 'omit',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-stome-token': options.token,
          },
          body: JSON.stringify({
            tool: request.tool,
            input: request.input,
            scenario: request.scenario,
          }),
        });
      } catch (error) {
        if (signal.aborted) {
          throw new HarnessError('cancelled', 'The question was cancelled');
        }
        const message = error instanceof Error ? error.message : 'The companion could not be reached';
        throw new HarnessError('provider_error', message);
      }
      const payload = (await response.json()) as {
        ok?: boolean;
        output?: unknown;
        error?: { code?: unknown; message?: unknown };
      };
      if (!payload.ok) {
        const message =
          typeof payload.error?.message === 'string' ? payload.error.message : 'The companion rejected the question';
        throw new HarnessError(asCode(payload.error?.code), message);
      }
      return payload.output;
    },
  };
}

/** GET /v1/status. Needs the pairing token; the reply never contains a provider key. */
export async function fetchCompanionStatus(
  options: { baseUrl: string; token: string },
  signal?: AbortSignal,
): Promise<CompanionStatus> {
  const origin = assertCompanionUrl(options.baseUrl);
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/status`, {
      method: 'GET',
      credentials: 'omit',
      signal,
      headers: { 'x-stome-token': options.token },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The companion could not be reached';
    throw new HarnessError('provider_error', message);
  }
  const payload = (await response.json()) as {
    ok?: boolean;
    status?: CompanionStatus;
    error?: { code?: unknown; message?: unknown };
  };
  if (!payload.ok || !payload.status) {
    const message = typeof payload.error?.message === 'string' ? payload.error.message : 'The companion rejected the request';
    throw new HarnessError(asCode(payload.error?.code), message);
  }
  return payload.status;
}
