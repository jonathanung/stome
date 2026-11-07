import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LIMITS } from '../src/data/operations.ts';
import { createSubjectReview, changeSourcePath, changeSubjects } from '../src/import/review-draft.ts';

test('a folder supplied during review adds a subject without changing the file-derived suggestions', () => {
  const initial = createSubjectReview('Cells.md', ['revision']);
  const next = changeSourcePath(initial, 'Biology/Cells.md');
  assert.equal(initial.subjects, 'revision');
  assert.equal(next.path, 'Biology/Cells.md');
  assert.equal(next.subjects, 'revision, Biology');
  assert.deepEqual(next.fileSubjects, ['revision']);
});

test('changing or removing the reviewed folder replaces only its automatic suggestion', () => {
  const initial = createSubjectReview('Cells.md', ['revision']);
  const biology = changeSourcePath(initial, 'Biology/Cells.md');
  const chemistry = changeSourcePath(biology, 'School/Chemistry/Cells.md');
  assert.equal(chemistry.subjects, 'revision, Chemistry');
  assert.equal(changeSourcePath(chemistry, 'Cells.md').subjects, 'revision');
  assert.equal(changeSourcePath(chemistry, '').subjects, 'revision');
});

test('reviewed paths use the same slash and whitespace normalization as source identity', () => {
  const initial = createSubjectReview('Cells.md', []);
  const next = changeSourcePath(initial, '  .\\School\\  Cell   biology  \\Cells.MD  ');
  assert.equal(next.subjects, 'Cell biology');
  assert.equal(next.path, '  .\\School\\  Cell   biology  \\Cells.MD  '); // keep editable input verbatim
});

test('invalid and transient paths do not throw or leave an obsolete folder suggestion', () => {
  const initial = changeSourcePath(createSubjectReview('Cells.md', ['revision']), 'Biology/Cells.md');
  for (const path of ['', 'Biology/', '../Cells.md', '/Cells.md', 'C:\\Cells.md', 'A//Cells.md', 'Cells.pdf', 'A\0/Cells.md']) {
    const next = changeSourcePath(initial, path);
    assert.equal(next.path, path);
    assert.equal(next.subjects, 'revision');
  }
});

test('suggestions keep order, collapse whitespace and deduplicate folders case-insensitively', () => {
  const initial = createSubjectReview('Cells.md', [' Biology ', 'biology', 'Cell   study']);
  assert.equal(changeSourcePath(initial, 'BIOLOGY/Cells.md').subjects, 'Biology, Cell study');
  assert.equal(changeSourcePath(initial, 'Cell study/Cells.md').subjects, 'Biology, Cell study');
});

test('folder suggestions respect Foundation subject length and count limits', () => {
  const initial = createSubjectReview('Cells.md', []);
  assert.equal(changeSourcePath(initial, `${'x'.repeat(LIMITS.subject)}/Cells.md`).subjects, 'x'.repeat(LIMITS.subject));
  assert.equal(changeSourcePath(initial, `${'x'.repeat(LIMITS.subject + 1)}/Cells.md`).subjects, '');
  assert.match(changeSourcePath(initial, `${'x'.repeat(LIMITS.subject + 1)}/Cells.md`).folderWarning ?? '', /omitted/);
  const subjects = Array.from({ length: LIMITS.subjects }, (_, i) => `subject ${i}`);
  const full = createSubjectReview('Cells.md', subjects);
  assert.equal(changeSourcePath(full, 'Biology/Cells.md').subjects, subjects.join(', '));
  assert.match(changeSourcePath(full, 'Biology/Cells.md').folderWarning ?? '', /omitted/);
  assert.equal(changeSourcePath(full, 'SUBJECT 0/Cells.md').folderWarning, null); // duplicate is not an omitted new subject
  const roomForFolder = createSubjectReview('Cells.md', subjects.slice(1));
  assert.equal(changeSourcePath(roomForFolder, 'Biology/Cells.md').subjects.split(', ').length, LIMITS.subjects);
});

test('folder omission warnings clear after a valid folder, invalid path or explicit subject edit', () => {
  const omitted = changeSourcePath(createSubjectReview('Cells.md', []), `${'x'.repeat(LIMITS.subject + 1)}/Cells.md`);
  assert.ok(omitted.folderWarning);
  assert.equal(changeSourcePath(omitted, 'Biology/Cells.md').folderWarning, null);
  assert.equal(changeSourcePath(omitted, '').folderWarning, null);
  assert.equal(changeSubjects(omitted, 'my subject').folderWarning, null);
});

test('explicit subject overrides, including empty text, survive all later path edits', () => {
  const initial = { ...createSubjectReview('Cells.md', ['revision']), id: 'draft-1', roomId: 'room-1' };
  const withFolder = changeSourcePath(initial, 'Biology/Cells.md');
  for (const subjects of ['my subject, independent choice', '', '  deliberate spacing  ']) {
    const edited = changeSubjects(withFolder, subjects);
    const next = changeSourcePath(edited, 'Chemistry/Cells.md');
    assert.equal(next.subjects, subjects);
    assert.equal(changeSourcePath(next, '').subjects, subjects);
    assert.equal(next.id, 'draft-1');
    assert.equal(next.roomId, 'room-1');
    assert.equal(next.subjectsEdited, true);
  }
});
