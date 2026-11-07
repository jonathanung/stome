export const ROOM_STAGES = ['stonehenge', 'brick'] as const;

export type RoomStage = (typeof ROOM_STAGES)[number];

export const ANNOTATION_TYPES = ['highlight', 'ai_answer', 'stroke'] as const;

export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

/** Human review ratings. These are not annotation types. */
export const REVIEW_STATES = ['missed', 'unclear', 'got_it'] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

export type AnnotationPayload = Record<string, unknown>;

export type Room = {
  id: string;
  name: string;
  stage: RoomStage;
  createdAt: number;
  updatedAt: number;
};

export type Chunk = {
  id: string;
  roomId: string;
  position: number;
  content: string;
  subjectTags: string[];
  sourceLink: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Annotation = {
  id: string;
  chunkId: string;
  type: AnnotationType;
  payload: AnnotationPayload;
  createdAt: number;
  updatedAt: number;
};

export type RoomRow = {
  id: string;
  name: string;
  stage: string;
  created_at: number;
  updated_at: number;
};

export type ChunkRow = {
  id: string;
  room_id: string;
  position: number;
  content: string;
  subject_tags: string;
  source_link: string | null;
  created_at: number;
  updated_at: number;
};

export type AnnotationRow = {
  id: string;
  chunk_id: string;
  type: string;
  payload: string;
  created_at: number;
  updated_at: number;
};

function parseTags(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== 'string')) {
    throw new Error('Stored subject tags are not a list of strings');
  }
  return parsed;
}

function parsePayload(value: string): AnnotationPayload {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored annotation payload is not an object');
  }
  return parsed as AnnotationPayload;
}

function toRoomStage(value: string): RoomStage {
  const stage = ROOM_STAGES.find((candidate) => candidate === value);
  if (stage === undefined) {
    throw new Error(`Stored room stage is not supported: ${value}`);
  }
  return stage;
}

function toAnnotationType(value: string): AnnotationType {
  const type = ANNOTATION_TYPES.find((candidate) => candidate === value);
  if (type === undefined) {
    throw new Error(`Stored annotation type is not supported: ${value}`);
  }
  return type;
}

export function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    stage: toRoomStage(row.stage),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    roomId: row.room_id,
    position: row.position,
    content: row.content,
    subjectTags: parseTags(row.subject_tags),
    sourceLink: row.source_link,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    chunkId: row.chunk_id,
    type: toAnnotationType(row.type),
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
