import { mockBoardReply, parseBoardReply, type BoardReply, type BoardRequest } from '../src/whiteboard/assistant.ts';

export interface BoardProvider {
  readonly name: 'mock' | 'openai';
  respond(request: BoardRequest, signal: AbortSignal): Promise<BoardReply>;
}

export const mockBoardProvider: BoardProvider = {
  name: 'mock',
  async respond(request) { return mockBoardReply(request); },
};

const BOARD_REPLY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    message: { type: 'string' },
    correction: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['none', 'add_text', 'replace_text'] },
        targetId: { type: 'string' }, text: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' },
      },
      required: ['kind', 'targetId', 'text', 'x', 'y'],
    },
  },
  required: ['message', 'correction'],
} as const;

function outputText(response: unknown): string {
  if (!response || typeof response !== 'object') throw new Error('Model returned no response');
  const value = response as { status?: unknown; output?: unknown };
  if (value.status !== 'completed' || !Array.isArray(value.output)) throw new Error('Model response was incomplete');
  const text = value.output.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content)) return [];
    return item.content.filter((part: unknown) => part && typeof part === 'object' && 'type' in part && part.type === 'output_text')
      .map((part: { text?: unknown }) => part.text).filter((part: unknown): part is string => typeof part === 'string');
  }).join('');
  if (!text) throw new Error('Model returned no text');
  return text;
}

export function openAiBoardProvider(options: { apiKey: string; model: string; fetcher?: typeof fetch }): BoardProvider {
  const fetcher = options.fetcher ?? fetch;
  return {
    name: 'openai',
    async respond(request, signal) {
      const response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', signal,
        headers: { 'authorization': `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          store: false,
          max_output_tokens: 800,
          instructions: 'You are a study assistant reviewing a whiteboard. Use only the supplied board data. Do not invent facts that the board does not contain. Explain concisely, check for missing or doubtful labels without pretending certainty, or ask one clear quiz question. You may suggest at most one text correction. For no correction use kind none, empty targetId and text, and x=y=0. For add_text use empty targetId. For replace_text use the exact ID of an existing text item. Keep suggested text under 500 characters and positions inside a 1000 by 700 board.',
          input: JSON.stringify(request),
          text: { format: { type: 'json_schema', name: 'board_study_reply', strict: true, schema: BOARD_REPLY_SCHEMA } },
        }),
      });
      if (!response.ok) throw new Error(`Model request failed (${response.status})`);
      return parseBoardReply(JSON.parse(outputText(await response.json())), request);
    },
  };
}
