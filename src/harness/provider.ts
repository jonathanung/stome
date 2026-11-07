import {
  EDIT_TOOL_NAME,
  MOCK_SCENARIOS,
  PROVIDER_LIMITS,
  TOOL_NAME,
  HarnessError,
  parseEditOutput,
  parseProposeInput,
  parseProposeOutput,
  requestCharCount,
  type EditProposeOutput,
  type MockScenario,
  type ProposeInput,
  type ProposeOutput,
} from './contract';

export type ProviderRequest = {
  tool: typeof TOOL_NAME | typeof EDIT_TOOL_NAME;
  input: unknown;
  scenario: MockScenario;
};

export type Provider = {
  complete(request: ProviderRequest, signal: AbortSignal): Promise<unknown>;
};

export function mockSuccessOutput(input: ProposeInput): ProposeOutput {
  const chunk = [...input.chunks].sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!chunk) {
    throw new HarnessError('invalid_output', 'The mock provider received no chunks');
  }
  const anchorEnd = Math.min(chunk.text.length, 12);
  if (anchorEnd <= 0) {
    throw new HarnessError('invalid_output', 'The selected note has no text to anchor');
  }
  const ids = input.chunks.map((item) => item.id).sort().join(',');
  return {
    roomId: input.roomId,
    chunkId: chunk.id,
    type: 'ai_answer',
    body: `Mock answer (${ids}; messages=${input.priorMessages.length}): ${input.prompt.trim()}`,
    anchorStart: 0,
    anchorEnd,
  };
}

export function mockEditOutput(input: ProposeInput): EditProposeOutput {
  const chunk = input.chunks[0];
  if (!chunk || input.chunks.length !== 1) {
    throw new HarnessError('invalid_output', 'A note edit needs exactly one chunk');
  }
  const suffix = `\n\nMock edit (${chunk.id}; messages=${input.priorMessages.length}): ${input.prompt.trim()}`;
  return {
    roomId: chunk.roomId,
    chunkId: chunk.id,
    type: 'chunk_edit',
    body: `${chunk.text}${suffix}`,
  };
}

export async function mockComplete(request: ProviderRequest, signal: AbortSignal): Promise<unknown> {
  if (request.tool !== TOOL_NAME && request.tool !== EDIT_TOOL_NAME) {
    throw new HarnessError('invalid_shape', 'The mock provider only runs the notes tools');
  }
  const editing = request.tool === EDIT_TOOL_NAME;
  if (!MOCK_SCENARIOS.includes(request.scenario)) {
    throw new HarnessError('invalid_shape', 'The mock scenario is unknown');
  }
  if (signal.aborted) {
    throw abortError(signal);
  }
  const input = parseProposeInput(request.input);
  if (requestCharCount(input) > PROVIDER_LIMITS.maxRequestChars) {
    throw new HarnessError('request_limit', 'The question and selected notes are over the request limit');
  }
  if (request.scenario === 'timeout') {
    throw new HarnessError('timeout', 'The mock provider timed out before answering');
  }
  if (request.scenario === 'error') {
    throw new HarnessError('provider_error', 'The mock provider failed before answering');
  }
  if (request.scenario === 'cancel') {
    return await waitForCancel(signal);
  }
  if (request.scenario === 'oversize') {
    const body = 'x'.repeat(PROVIDER_LIMITS.maxOutputChars + 1);
    if (editing) {
      return {
        roomId: input.roomId,
        chunkId: input.chunks[0]?.id ?? '',
        type: 'chunk_edit',
        body,
      };
    }
    return {
      roomId: input.roomId,
      chunkId: input.chunks[0]?.id ?? '',
      type: 'ai_answer',
      body,
      anchorStart: 0,
      anchorEnd: 1,
    };
  }
  return editing ? parseEditOutput(mockEditOutput(input)) : parseProposeOutput(mockSuccessOutput(input));
}

function combineSignals(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const reason = new Error('The provider exceeded the time limit');
    reason.name = 'TimeoutError';
    controller.abort(reason);
  }, timeoutMs);
  const stop = () => clearTimeout(timer);
  const abortFromParent = () => {
    stop();
    controller.abort(signal.reason);
  };
  if (signal.aborted) {
    abortFromParent();
  } else {
    signal.addEventListener('abort', abortFromParent, { once: true });
  }
  controller.signal.addEventListener('abort', stop, { once: true });
  return { signal: controller.signal, stop };
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(abortError(signal));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}

function waitForCancel(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(abortError(signal));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}

function abortError(signal: AbortSignal): HarnessError {
  const reason = signal.reason;
  if (reason instanceof HarnessError) {
    return reason;
  }
  if (reason instanceof Error && reason.name === 'TimeoutError') {
    return new HarnessError('timeout', 'The provider exceeded the time limit');
  }
  return new HarnessError('cancelled', 'The provider call was cancelled');
}

export const mockProvider: Provider = {
  complete: mockComplete,
};

/** Live API-key calls are intentionally unavailable. This stub never reads a network. */
export function createProvider(kind: 'mock' | 'api-key'): Provider {
  if (kind === 'api-key') {
    return {
      async complete() {
        throw new HarnessError(
          'provider_error',
          'The API-key provider is disabled. This build only runs the deterministic mock.',
        );
      },
    };
  }
  return mockProvider;
}

export async function completeWithLimits(
  provider: Provider,
  request: ProviderRequest,
  signal: AbortSignal,
  timeoutMs: number = PROVIDER_LIMITS.timeoutMs,
): Promise<ProposeOutput | EditProposeOutput> {
  const timed = combineSignals(signal, timeoutMs);
  let raw: unknown;
  try {
    const pending = provider.complete(request, timed.signal);
    const guarded = pending.then(
      (value) => value,
      (error: unknown) => {
        throw error;
      },
    );
    void guarded.catch(() => undefined);
    raw = await Promise.race([guarded, rejectWhenAborted(timed.signal)]);
  } catch (error) {
    if (error instanceof HarnessError) {
      throw error;
    }
    if (timed.signal.aborted) {
      throw abortError(timed.signal);
    }
    throw new HarnessError('provider_error', 'The provider failed before answering');
  } finally {
    timed.stop();
  }
  if (signal.aborted || timed.signal.aborted) {
    throw abortError(signal.aborted ? signal : timed.signal);
  }
  return request.tool === EDIT_TOOL_NAME ? parseEditOutput(raw) : parseProposeOutput(raw);
}
