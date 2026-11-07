// Live Anthropic provider. Lives under companion/ so Metro never bundles the SDK.
//
// Request shape notes (claude-opus-5-5):
// - The model always thinks. `thinking` is omitted; depth is `output_config.effort`.
// - No temperature/top_p/top_k, no assistant prefill, no forced tool_choice.
// - JSON comes from structured outputs (`output_config.format`), parsed from the text block.
// - Refusal fallback is the server-side-fallback beta, on by default.
import Anthropic from '@anthropic-ai/sdk';

import { HarnessError } from '../../src/harness/contract.ts';
import type { Provider } from '../../src/harness/provider.ts';
import { abortHarnessError, createStructuredProvider, parseJsonObject } from './shared.ts';

export { abortHarnessError, anchorFor } from './shared.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = 'medium';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const MAX_TOKENS = 16_000;
export const MAX_RETRIES = 1;
export const NO_CREDENTIALS_MESSAGE = 'No Anthropic credentials: set ANTHROPIC_API_KEY or run ant auth login';

/** The subset of the SDK the provider uses. A test injects a fake. */
export type MessageClient = {
  create(params: Record<string, unknown>, options: { signal: AbortSignal }): Promise<LiveMessage>;
};

export type LiveMessage = {
  stop_reason?: string | null;
  content?: readonly { type: string; text?: string }[];
};

export type AnthropicProviderOptions = {
  client: MessageClient;
  model?: string;
  effort?: Effort;
  /** Turns the server-side refusal fallback off. On by default. */
  fallbacks?: boolean;
};

export function parseEffort(raw: string | undefined): Effort {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_EFFORT;
  }
  const value = raw.trim().toLowerCase();
  const found = EFFORTS.find((effort) => effort === value);
  if (!found) {
    throw new Error(`STOME_EFFORT must be one of ${EFFORTS.join(', ')}`);
  }
  return found;
}

/** Wrap the SDK's beta messages endpoint in the minimal client shape. */
export function sdkMessageClient(sdk: Anthropic = new Anthropic({ maxRetries: MAX_RETRIES })): MessageClient {
  return {
    async create(params, options) {
      const message = await sdk.beta.messages.create(
        params as unknown as Parameters<typeof sdk.beta.messages.create>[0] & { stream?: false },
        options,
      );
      return message as unknown as LiveMessage;
    },
  };
}

// ---------------------------------------------------------------------------
// Errors.

export function normalizeError(error: unknown, signal: AbortSignal): HarnessError {
  if (error instanceof HarnessError) {
    return error;
  }
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) {
    return abortHarnessError(signal);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new HarnessError('provider_error', 'The Anthropic API key was rejected');
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new HarnessError('provider_error', 'The Anthropic API key is not allowed to use this model');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new HarnessError('provider_error', 'Rate limited by Anthropic, try again shortly');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new HarnessError('provider_error', 'Anthropic rejected the request');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new HarnessError('provider_error', 'Could not reach the Anthropic API');
  }
  if (error instanceof Anthropic.APIError) {
    return new HarnessError('provider_error', 'The Anthropic API failed before answering');
  }
  if (error instanceof Error && /Could not resolve authentication method/i.test(error.message)) {
    return new HarnessError('provider_error', NO_CREDENTIALS_MESSAGE);
  }
  return new HarnessError('provider_error', 'The provider failed before answering');
}

// ---------------------------------------------------------------------------

function parseModelJson(message: LiveMessage): Record<string, unknown> {
  if (message.stop_reason === 'refusal') {
    throw new HarnessError('provider_error', 'The model declined this request');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new HarnessError('output_limit', 'The model ran out of room before finishing its answer');
  }
  const text = (message.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('');
  return parseJsonObject(text);
}

export function createAnthropicProvider(options: AnthropicProviderOptions): Provider {
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  const fallbacks = options.fallbacks ?? true;

  function params(system: string, user: string, schema: Record<string, unknown>): Record<string, unknown> {
    const base: Record<string, unknown> = {
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    };
    if (fallbacks) {
      base.betas = [FALLBACK_BETA];
      base.fallbacks = 'default';
    }
    return base;
  }

  return createStructuredProvider(async (_tool, system, user, schema, signal) => {
    if (signal.aborted) {
      throw abortHarnessError(signal);
    }
    let message: LiveMessage;
    try {
      message = await options.client.create(params(system, user, schema), { signal });
    } catch (error) {
      throw normalizeError(error, signal);
    }
    if (signal.aborted) {
      throw abortHarnessError(signal);
    }
    return parseModelJson(message);
  });
}
