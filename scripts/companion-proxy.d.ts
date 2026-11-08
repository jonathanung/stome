import type { IncomingMessage, ServerResponse } from 'node:http';

export function proxyCompanion(
  request: IncomingMessage,
  response: ServerResponse,
  options: { secure: boolean; companionPort: number },
): boolean;
