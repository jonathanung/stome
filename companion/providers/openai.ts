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
//
// Subscription mode (after `npm run companion:login -- openai|xai`):
// - Grok: the OAuth access token is the bearer for the same api.x.ai API.
// - ChatGPT: requests go to the ChatGPT backend (chatgpt.com/backend-api/codex,
//   Responses API) with the access token, a ChatGPT-Account-Id header, and the
//   Codex CLI's originator headers, billed to the ChatGPT plan. That backend
//   always streams and is stateless (store: false). Structured Outputs support
//   there is undocumented, so the schema goes in the instructions instead and
//   the shared parsers still validate every reply. Only the Codex model set is
//   served (default gpt-5.5).
import { randomUUID } from 'node:crypto';

import OpenAI from 'openai';

import { HarnessError } from '../../src/harness/contract.ts';
import type { Provider } from '../../src/harness/provider.ts';
import type { ProviderKind } from '../../src/harness/tools.ts';
import type { OAuthCredential } from '../auth/store.ts';
import { abortHarnessError, createStructuredProvider, parseJsonObject } from './shared.ts';

export type CompatibleVendor = Extract<ProviderKind, 'openai' | 'xai'>;

export const VENDORS: Record<
  CompatibleVendor,
  { label: string; baseURL: string | undefined; keyEnv: string; defaultModel: string; sendsEffort: boolean; sendsStore: boolean }
> = {
  openai: { label: 'OpenAI', baseURL: undefined, keyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-6-astra', sendsEffort: true, sendsStore: true },
  xai: { label: 'xAI', baseURL: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY', defaultModel: 'grok-4.7', sendsEffort: false, sendsStore: false },
};

export const CHATGPT_BACKEND = 'https://chatgpt.com/backend-api/codex';
/** Subscription defaults: the ChatGPT backend serves the Codex model set only. */
export const SUBSCRIPTION_DEFAULT_MODEL: Record<CompatibleVendor, string> = { openai: 'gpt-5.5', xai: 'grok-4.7' };

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
  output?: readonly { type: string; content?: readonly { type: string; refusal?: string; text?: string }[] }[] | null;
};

export type CredentialSource = () => Promise<OAuthCredential>;

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

/**
 * A client that signs requests with a stored subscription sign-in, refreshed as
 * needed. A failed sign-in lookup or refresh becomes a provider_error.
 */
export function subscriptionResponsesClient(vendor: CompatibleVendor, source: CredentialSource): ResponsesClient {
  const sessionId = randomUUID();
  return {
    async create(params, options) {
      let credential: OAuthCredential;
      try {
        credential = await source();
      } catch (error) {
        throw new HarnessError('provider_error', error instanceof Error ? error.message : 'The sign-in could not be read');
      }
      if (vendor === 'xai') {
        const sdk = new OpenAI({ apiKey: credential.access, baseURL: VENDORS.xai.baseURL, maxRetries: MAX_RETRIES });
        const response = await sdk.responses.create(
          params as unknown as Parameters<typeof sdk.responses.create>[0] & { stream?: false },
          options,
        );
        return response as unknown as LiveResponse;
      }
      if (!credential.accountId) {
        throw new HarnessError('provider_error', 'The ChatGPT sign-in has no account id: run npm run companion:login -- openai again');
      }
      const sdk = new OpenAI({
        apiKey: credential.access,
        baseURL: CHATGPT_BACKEND,
        maxRetries: MAX_RETRIES,
        defaultHeaders: { 'OpenAI-Beta': 'responses=experimental', originator: 'codex_cli_rs', session_id: sessionId },
      });
      const stream = sdk.responses.stream(params as unknown as Parameters<typeof sdk.responses.stream>[0], {
        signal: options.signal,
        headers: { 'ChatGPT-Account-Id': credential.accountId },
      });
      return (await stream.finalResponse()) as unknown as LiveResponse;
    },
  };
}

export function noCredentialsMessage(vendor: CompatibleVendor): string {
  return `No ${VENDORS[vendor].label} credentials: set ${VENDORS[vendor].keyEnv} or run npm run companion:login -- ${vendor}`;
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
  const text =
    response.output_text ??
    (response.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('');
  return parseJsonObject(text);
}

export type CompatibleProviderOptions = {
  vendor: CompatibleVendor;
  client: ResponsesClient;
  model?: string;
  effort?: OpenAiEffort;
  /** Signed in with a ChatGPT or Grok subscription instead of an API key. */
  subscription?: boolean;
};

/** ChatGPT backend request: no text.format or max_output_tokens, schema in the instructions. */
function chatGptParams(model: string, system: string, user: string, schema: Record<string, unknown>): Record<string, unknown> {
  return {
    model,
    instructions: `${system}\nReply with only a JSON object, no prose and no code fence, that matches this JSON schema exactly:\n${JSON.stringify(schema)}`,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: user }] }],
    store: false,
    include: ['reasoning.encrypted_content'],
  };
}

export function createCompatibleProvider(options: CompatibleProviderOptions): Provider {
  const vendor = VENDORS[options.vendor];
  const chatGpt = options.subscription === true && options.vendor === 'openai';
  const model = options.model ?? (options.subscription ? SUBSCRIPTION_DEFAULT_MODEL[options.vendor] : vendor.defaultModel);
  const effort = options.effort ?? (vendor.sendsEffort ? 'medium' : undefined);

  return createStructuredProvider(async (tool, system, user, schema, signal) => {
    if (signal.aborted) {
      throw abortHarnessError(signal);
    }
    const params: Record<string, unknown> = chatGpt ? chatGptParams(model, system, user, schema) : {
      model,
      instructions: system,
      input: user,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      text: { format: { type: 'json_schema', name: tool.replaceAll('.', '_'), schema, strict: true } },
    };
    if (effort) {
      params.reasoning = { effort };
    }
    if (vendor.sendsStore && !chatGpt) {
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
