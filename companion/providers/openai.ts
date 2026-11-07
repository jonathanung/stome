// Live OpenAI (ChatGPT) and xAI (Grok) providers. Both use the official `openai`
// SDK and the Responses API: xAI serves the same API at https://api.x.ai/v1.
// Lives under companion/ so Metro never bundles the SDK.
//
// Request shape notes (checked against openai SDK 7.53 types and the vendors'
// structured-output guides):
// - JSON comes from Structured Outputs: `text.format` with type 'json_schema',
//   `strict: true`. The shared schemas already mark every key required and set
//   additionalProperties: false, which strict mode needs.
// - OpenAI takes `reasoning.effort`. xAI documents no effort control for its
//   Responses API, so it is sent to xAI only when STOME_EFFORT is set.
// - No temperature/top_p: reasoning models reject or ignore them.
// - `store: false` goes to OpenAI only; xAI does not document it.
import OpenAI from 'openai';

import { HarnessError } from '../../src/harness/contract.ts';
import type { Provider } from '../../src/harness/provider.ts';
import type { ProviderKind } from '../../src/harness/tools.ts';
import { abortHarnessError, createStructuredProvider, parseJsonObject } from './shared.ts';

export type CompatibleVendor = Extract<ProviderKind, 'openai' | 'xai'>;

export const VENDORS: Record<
  CompatibleVendor,
  { label: string; baseURL: string | undefined; keyEnv: string; defaultModel: string; sendsEffort: boolean; sendsStore: boolean }
> = {
  openai: { label: 'OpenAI', baseURL: undefined, keyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-6-astra', sendsEffort: true, sendsStore: true },
  xai: { label: 'xAI', baseURL: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY', defaultModel: 'grok-4.7', sendsEffort: false, sendsStore: false },
};

export const OPENAI_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenAiEffort = (typeof OPENAI_EFFORTS)[number];
export const MAX_OUTPUT_TOKENS = 16_000;
export const MAX_RETRIES = 1;

/** The subset of the SDK the provider uses. A test injects a fake. */
export type ResponsesClient = {
  create(params: Record<string, unknown>, options: { signal: AbortSignal }): Promise<LiveResponse>;
};

export type LiveResponse = {
  status?: string | null;
  output_text?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  output?: readonly { type: string; content?: readonly { type: string; refusal?: string }[] }[] | null;
};

export function parseOpenAiEffort(raw: string | undefined): OpenAiEffort | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  const found = OPENAI_EFFORTS.find((effort) => effort === value);
  if (!found) {
    throw new Error(`STOME_EFFORT must be one of ${OPENAI_EFFORTS.join(', ')}`);
  }
  return found;
}

/** Wrap the SDK's Responses endpoint in the minimal client shape. The key comes from the vendor's env var. */
export function sdkResponsesClient(vendor: CompatibleVendor, apiKey: string | undefined): ResponsesClient {
  // Built on first use: the SDK constructor throws without a key, and a missing
  // key should fail the first question, not the companion's startup.
  let sdk: OpenAI | null = null;
  return {
    async create(params, options) {
      if (!apiKey) {
        throw new HarnessError('provider_error', noCredentialsMessage(vendor));
      }
      sdk ??= new OpenAI({ apiKey, baseURL: VENDORS[vendor].baseURL, maxRetries: MAX_RETRIES });
      const response = await sdk.responses.create(
        params as unknown as Parameters<typeof sdk.responses.create>[0] & { stream?: false },
        options,
      );
      return response as unknown as LiveResponse;
    },
  };
}

export function noCredentialsMessage(vendor: CompatibleVendor): string {
  return `No ${VENDORS[vendor].label} credentials: set ${VENDORS[vendor].keyEnv}`;
}

export function normalizeCompatibleError(error: unknown, signal: AbortSignal, vendor: CompatibleVendor): HarnessError {
  const label = VENDORS[vendor].label;
  if (error instanceof HarnessError) {
    return error;
  }
  if (signal.aborted || error instanceof OpenAI.APIUserAbortError) {
    return abortHarnessError(signal);
  }
  if (error instanceof OpenAI.AuthenticationError) {
    return new HarnessError('provider_error', `The ${label} API key was rejected`);
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return new HarnessError('provider_error', `The ${label} API key is not allowed to use this model`);
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new HarnessError('provider_error', `${label} does not know that model; check STOME_MODEL`);
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new HarnessError('provider_error', `Rate limited by ${label}, try again shortly`);
  }
  if (error instanceof OpenAI.BadRequestError) {
    return new HarnessError('provider_error', `${label} rejected the request`);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new HarnessError('provider_error', `Could not reach the ${label} API`);
  }
  if (error instanceof OpenAI.APIError) {
    return new HarnessError('provider_error', `The ${label} API failed before answering`);
  }
  return new HarnessError('provider_error', 'The provider failed before answering');
}

function parseResponseJson(response: LiveResponse): Record<string, unknown> {
  const refused = (response.output ?? []).some((item) =>
    (item.content ?? []).some((part) => part.type === 'refusal'),
  );
  if (refused) {
    throw new HarnessError('provider_error', 'The model declined this request');
  }
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    if (reason === 'content_filter') {
      throw new HarnessError('provider_error', 'The model declined this request');
    }
    throw new HarnessError('output_limit', 'The model ran out of room before finishing its answer');
  }
  if (response.status === 'failed') {
    throw new HarnessError('provider_error', 'The model failed before answering');
  }
  return parseJsonObject(response.output_text ?? '');
}

export type CompatibleProviderOptions = {
  vendor: CompatibleVendor;
  client: ResponsesClient;
  model?: string;
  effort?: OpenAiEffort;
};

export function createCompatibleProvider(options: CompatibleProviderOptions): Provider {
  const vendor = VENDORS[options.vendor];
  const model = options.model ?? vendor.defaultModel;
  const effort = options.effort ?? (vendor.sendsEffort ? 'medium' : undefined);

  return createStructuredProvider(async (tool, system, user, schema, signal) => {
    if (signal.aborted) {
      throw abortHarnessError(signal);
    }
    const params: Record<string, unknown> = {
      model,
      instructions: system,
      input: user,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      text: { format: { type: 'json_schema', name: tool.replaceAll('.', '_'), schema, strict: true } },
    };
    if (effort) {
      params.reasoning = { effort };
    }
    if (vendor.sendsStore) {
      // OpenAI keeps Responses for 30 days by default; notes should not be stored.
      params.store = false;
    }
    let response: LiveResponse;
    try {
      response = await options.client.create(params, { signal });
    } catch (error) {
      throw normalizeCompatibleError(error, signal, options.vendor);
    }
    if (signal.aborted) {
      throw abortHarnessError(signal);
    }
    return parseResponseJson(response);
  });
}
