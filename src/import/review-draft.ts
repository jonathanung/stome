import { LIMITS } from '../data/operations.ts';
import { normalizePath } from './markdown.ts';

export interface SubjectReview {
  path: string;
  /** Subjects inferred from the selected file, before a reviewed folder is added. */
  fileSubjects: readonly string[];
  subjects: string;
  subjectsEdited: boolean;
  folderWarning: string | null;
}

function suggestedSubjects(fileSubjects: readonly string[], rawPath: string): Pick<SubjectReview, 'subjects' | 'folderWarning'> {
  const candidates = [...fileSubjects];
  let folderIndex = -1;
  try {
    const folders = normalizePath(rawPath).split('/');
    if (folders.length > 1) {
      folderIndex = candidates.length;
      candidates.push(folders[folders.length - 2]);
    }
  } catch {
    // A source path can be incomplete while typing. Validation still runs on save.
  }
  const subjects: string[] = [];
  const seen = new Set<string>();
  let folderWarning: string | null = null;
  for (const [index, candidate] of candidates.entries()) {
    const subject = candidate.trim().replace(/\s+/g, ' ');
    const key = subject.toLowerCase();
    if (index === folderIndex && subject.includes(',')) {
      folderWarning = 'The folder contains a comma and was not suggested because subjects are comma-separated. Review the subjects.';
      continue;
    }
    if (!subject || seen.has(key)) continue;
    if (subject.length > LIMITS.subject || subjects.length >= LIMITS.subjects) {
      if (index === folderIndex) folderWarning = 'The folder suggestion exceeds the subject limits and was omitted. Review the subjects.';
      continue;
    }
    seen.add(key);
    subjects.push(subject);
  }
  return { subjects: subjects.join(', '), folderWarning };
}

export function createSubjectReview(path: string, fileSubjects: readonly string[]): SubjectReview {
  return { path, fileSubjects: [...fileSubjects], ...suggestedSubjects(fileSubjects, path), subjectsEdited: false };
}

/** Recompute from the original file suggestions, never from a previous folder. */
export function changeSourcePath<T extends SubjectReview>(draft: T, path: string): T {
  return draft.subjectsEdited ? { ...draft, path } : { ...draft, path, ...suggestedSubjects(draft.fileSubjects, path) };
}

/** An explicit empty value is an override too; later path edits must retain it. */
export function changeSubjects<T extends SubjectReview>(draft: T, subjects: string): T {
  return { ...draft, subjects, subjectsEdited: true, folderWarning: null };
}
