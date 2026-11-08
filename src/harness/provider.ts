import {
  EDIT_TOOL_NAME,
  MOCK_SCENARIOS,
  PROVIDER_LIMITS,
  STROKE_TOOL_NAME,
  STUDY_DECK_TOOL_NAME,
  STUDY_OUTLINE_TOOL_NAME,
  STUDY_QUIZ_TOOL_NAME,
  TOOL_NAME,
  HarnessError,
  isStudyToolName,
  parseEditOutput,
  parseProposeInput,
  parseProposeOutput,
  parseStrokeOutput,
  parseStudyDeckOutput,
  parseStudyDraft,
  parseStudyOutlineOutput,
  parseStudyProposeInput,
  parseStudyQuizOutput,
  requestCharCount,
  type EditProposeOutput,
  type MockScenario,
  type ProposeInput,
  type ProposeOutput,
  type StrokeProposeOutput,
  type StudyDeckDraft,
  type StudyQuizDraft,
  type StudySlideOutlineDraft,
  type StudyToolName,
} from './contract.ts';
import {
  StudyGeneratorError,
  generateDeck,
  generateQuiz,
  generateSlideOutline,
} from '../features/study/generator.ts';
import { isReadTool, mockReadToolOutput, parseReadToolInput, parseReadToolOutput, type ReadToolName } from './tools.ts';

export type NoteToolName = typeof TOOL_NAME | typeof EDIT_TOOL_NAME | typeof STROKE_TOOL_NAME;

export type ProviderRequest = {
  tool: NoteToolName | ReadToolName;
  input: unknown;
  scenario: MockScenario;
};

/**
 * STUDY.5 (#135) request. Notes and read tools keep their request shape so
 * the live companion dispatch is untouched; study proposals enter through
 * the same `complete` method but only the mock provider answers them.
 */
export type StudyProviderRequest = {
  tool: StudyToolName;
  input: unknown;
  scenario: MockScenario;
};

/** Anything that answers study proposals. The live providers do not implement this. */
export type StudyProvider = {
  complete(request: StudyProviderRequest, signal: AbortSignal): Promise<unknown>;
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
  const deepMarker = 'DEEP-ANCHOR.';
  const deepAt = input.prompt.trim() === 'Cite the deep passage.' ? chunk.text.indexOf(deepMarker) : -1;
  return {
    roomId: input.roomId,
    chunkId: chunk.id,
    type: 'ai_answer',
    body: `Mock answer (${ids}; messages=${input.priorMessages.length}): ${input.prompt.trim()}`,
    anchorStart: deepAt >= 0 ? deepAt : 0,
    anchorEnd: deepAt >= 0 ? deepAt + deepMarker.length : anchorEnd,
  };
}

export function mockEditOutput(input: ProposeInput): EditProposeOutput {
  const chunk = input.chunks[0];
  if (!chunk || input.chunks.length !== 1) {
    throw new HarnessError('invalid_output', 'A note edit needs exactly one chunk');
  }
  const prompt = input.prompt.trim();
  const rewrite = /^Replace the first 12 characters with (.{12})\.$/.exec(prompt);
  const suffix = `\n\nMock edit (${chunk.id}; messages=${input.priorMessages.length}): ${prompt}`;
  const body = rewrite ? `${rewrite[1]}${chunk.text.slice(Math.min(12, chunk.text.length))}` : `${chunk.text}${suffix}`;
  return {
    roomId: chunk.roomId,
    chunkId: chunk.id,
    type: 'chunk_edit',
    body,
  };
}

/** Deterministic mock stroke: a short diagonal on the first selected chunk. */
export function mockStrokeOutput(input: ProposeInput): StrokeProposeOutput {
  const chunk = [...input.chunks].sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!chunk) {
    throw new HarnessError('invalid_output', 'The mock provider received no chunks');
  }
  return {
    roomId: input.roomId,
    chunkId: chunk.id,
    type: 'stroke',
    points: [
      [8, 8],
      [48, 32],
      [88, 56],
    ],
  };
}

async function mockReadComplete(request: ProviderRequest & { tool: ReadToolName }, signal: AbortSignal): Promise<unknown> {
  if (!MOCK_SCENARIOS.includes(request.scenario)) {
    throw new HarnessError('invalid_shape', 'The mock scenario is unknown');
  }
  if (signal.aborted) {
    throw abortError(signal);
  }
  const input = parseReadToolInput(request.tool, request.input);
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
    throw new HarnessError('output_limit', 'The mock provider answered over the output limit');
  }
  return parseReadToolOutput(request.tool, mockReadToolOutput(request.tool, input), input);
}

/**
 * STUDY.5 (#135) mock: deterministic STUDY.2 generator calls, no network.
 * Generator failures map onto the shared harness codes: scope and shape stay
 * invalid_shape/scope_rejected, corpus bounds become request_limit, and the
 * error/timeout/oversize scenarios exercise the same paths as the notes tools.
 */
function mapStudyGeneratorError(error: StudyGeneratorError): HarnessError {
  switch (error.code) {
    case 'timeout':
      return new HarnessError('timeout', error.message);
    case 'provider_error':
      return new HarnessError('provider_error', error.message);
    case 'oversize':
      return new HarnessError('output_limit', error.message);
    case 'scope_rejected':
      return new HarnessError('scope_rejected', error.message);
    case 'too_many_chunks':
    case 'input_too_large':
      return new HarnessError('request_limit', error.message);
    default:
      return new HarnessError('invalid_shape', error.message);
  }
}

export async function mockStudyComplete(request: StudyProviderRequest, signal: AbortSignal): Promise<unknown> {
  if (!MOCK_SCENARIOS.includes(request.scenario)) {
    throw new HarnessError('invalid_shape', 'The mock scenario is unknown');
  }
  if (signal.aborted) {
    throw abortError(signal);
  }
  const input = parseStudyProposeInput(request.input);
  if (request.scenario === 'cancel') {
    return await waitForCancel(signal);
  }
  const scenario = request.scenario === 'success' ? undefined : request.scenario;
  // The prompt and history travel with the request for parity with the notes
  // tools (and count toward the request budget), but generation itself is a
  // pure function of the selected chunks, so the mock stays deterministic.
  const chunks = input.chunks.map((chunk) => ({
    id: chunk.id,
    roomId: chunk.roomId,
    revision: chunk.revision,
    text: chunk.text,
  }));
  const options = { ...input.options, ...(scenario === undefined ? {} : { scenario }) };
  try {
    switch (request.tool) {
      case STUDY_DECK_TOOL_NAME:
        return parseStudyDeckOutput(generateDeck(chunks, options));
      case STUDY_QUIZ_TOOL_NAME:
        return parseStudyQuizOutput(generateQuiz(chunks, options));
      case STUDY_OUTLINE_TOOL_NAME:
        return parseStudyOutlineOutput(generateSlideOutline(chunks, options));
    }
  } catch (error) {
    if (error instanceof StudyGeneratorError) {
      throw mapStudyGeneratorError(error);
    }
    throw error;
  }
}

export async function mockComplete(
  request: ProviderRequest | StudyProviderRequest,
  signal: AbortSignal,
): Promise<unknown> {
  if (isStudyToolName(request.tool)) {
    return mockStudyComplete(request as StudyProviderRequest, signal);
  }
  if (isReadTool(request.tool)) {
    return mockReadComplete(request as ProviderRequest & { tool: ReadToolName }, signal);
  }
  if (request.tool !== TOOL_NAME && request.tool !== EDIT_TOOL_NAME && request.tool !== STROKE_TOOL_NAME) {
    throw new HarnessError('invalid_shape', 'The mock provider only runs the allowed tools');
  }
  if (!MOCK_SCENARIOS.includes(request.scenario)) {
    throw new HarnessError('invalid_shape', 'The mock scenario is unknown');
  }
  if (signal.aborted) {
    throw abortError(signal);
  }
  if (request.scenario === 'cancel') {
    const input = parseProposeInput(request.input);
    if (requestCharCount(input) > PROVIDER_LIMITS.maxRequestChars) {
      throw new HarnessError('request_limit', 'The question and selected notes are over the request limit');
    }
    return await waitForCancel(signal);
  }
  return settleMockRequest(request);
}

/**
 * One deterministic mock result. `cancel` is a terminal error here.
 * `mockComplete` waits for the abort signal instead of settling immediately.
 */
export function settleMockRequest(request: ProviderRequest): unknown {
  if (request.tool !== TOOL_NAME && request.tool !== EDIT_TOOL_NAME && request.tool !== STROKE_TOOL_NAME) {
    throw new HarnessError('invalid_shape', 'The mock provider only runs the allowed tools');
  }
  const editing = request.tool === EDIT_TOOL_NAME;
  const stroking = request.tool === STROKE_TOOL_NAME;
  if (!MOCK_SCENARIOS.includes(request.scenario)) {
    throw new HarnessError('invalid_shape', 'The mock scenario is unknown');
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
    throw new HarnessError('cancelled', 'The provider call was cancelled');
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
    if (stroking) {
      return {
        roomId: input.roomId,
        chunkId: input.chunks[0]?.id ?? '',
        type: 'stroke',
        points: Array.from({ length: 5_001 }, (_, index) => [index, index]),
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
  if (stroking) {
    return parseStrokeOutput(mockStrokeOutput(input));
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

export const mockProvider: Provider & StudyProvider = {
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
): Promise<ProposeOutput | EditProposeOutput | StrokeProposeOutput> {
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
  return request.tool === EDIT_TOOL_NAME
    ? parseEditOutput(raw)
    : request.tool === STROKE_TOOL_NAME
      ? parseStrokeOutput(raw)
      : parseProposeOutput(raw);
}

/**
 * Run one read-only tool with the shared time limit and cancel, then parse
 * and scope-check the output. Use this for review, board, and import calls.
 */
export async function completeReadTool<T>(
  provider: Provider,
  request: ProviderRequest & { tool: ReadToolName },
  signal: AbortSignal,
  timeoutMs: number = PROVIDER_LIMITS.timeoutMs,
): Promise<T> {
  const input = parseReadToolInput(request.tool, request.input);
  const timed = combineSignals(signal, timeoutMs);
  let raw: unknown;
  try {
    const pending = provider.complete(request, timed.signal);
    void pending.catch(() => undefined);
    raw = await Promise.race([pending, rejectWhenAborted(timed.signal)]);
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
  return parseReadToolOutput(request.tool, raw, input) as T;
}

/**
 * STUDY.5 (#135): run one study proposal tool with the shared time limit and
 * cancel, then validate the draft. Only the mock provider answers; the
 * api-key stub has no study path and stays disabled.
 */
export async function completeStudyWithLimits(
  provider: StudyProvider,
  request: StudyProviderRequest,
  signal: AbortSignal,
  timeoutMs: number = PROVIDER_LIMITS.timeoutMs,
): Promise<StudyDeckDraft | StudyQuizDraft | StudySlideOutlineDraft> {
  const timed = combineSignals(signal, timeoutMs);
  let raw: unknown;
  try {
    const pending = provider.complete(request, timed.signal);
    void pending.catch(() => undefined);
    raw = await Promise.race([pending, rejectWhenAborted(timed.signal)]);
  } catch (error) {
    if (error instanceof HarnessError) {
      throw error;
    }
    if (timed.signal.aborted) {
      throw abortError(timed.signal);
    }
    throw new HarnessError('provider_error', 'The study provider failed before answering');
  } finally {
    timed.stop();
  }
  if (signal.aborted || timed.signal.aborted) {
    throw abortError(signal.aborted ? signal : timed.signal);
  }
  return parseStudyDraft(request.tool, raw);
}
