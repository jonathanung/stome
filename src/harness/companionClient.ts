import { classifyCompanionPage, decideCompanionAddress, readCompanionContext, type CompanionContext } from './companionAddress.ts';
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

export function assertCompanionUrl(baseUrl: string, context: CompanionContext = readCompanionContext()): string {
  const decision = decideCompanionAddress(baseUrl, context);
  if (!decision.ok) throw new HarnessError('provider_error', decision.message);
  return decision.origin;
}

function reachError(error: unknown, context: CompanionContext, signal?: AbortSignal): HarnessError {
  if (signal?.aborted) return new HarnessError('cancelled', 'The question was cancelled');
  const kind = classifyCompanionPage(context);
  if (kind === 'secure-local' || kind === 'device') {
    return new HarnessError(
      'provider_error',
      'The laptop companion did not answer. Keep npm run companion running on the laptop. This device cannot start it.',
    );
  }
  const message = error instanceof Error ? error.message : 'The companion could not be reached';
  return new HarnessError('provider_error', message);
}

export function companionProvider(options: { baseUrl: string; token: string; context?: CompanionContext }): Provider {
  const context = options.context ?? readCompanionContext();
  return {
    async complete(request: ProviderRequest, signal: AbortSignal): Promise<unknown> {
      const origin = assertCompanionUrl(options.baseUrl, context);
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
        throw reachError(error, context, signal);
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
  options: { baseUrl: string; token: string; context?: CompanionContext },
  signal?: AbortSignal,
): Promise<CompanionStatus> {
  const context = options.context ?? readCompanionContext();
  const origin = assertCompanionUrl(options.baseUrl, context);
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/status`, {
      method: 'GET',
      credentials: 'omit',
      signal,
      headers: { 'x-stome-token': options.token },
    });
  } catch (error) {
    throw reachError(error, context, signal);
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
