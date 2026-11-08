import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNote } from '../src/features/notes/formatting.ts';

test('inline formatting keeps surrounding text and selects the formatted content', () => {
  assert.deepEqual(formatNote('hello world', { start: 6, end: 11 }, 'bold'), {
    text: 'hello **world**', selection: { start: 8, end: 13 },
  });
  assert.equal(formatNote('', { start: 0, end: 0 }, 'italic').text, '*text*');
});

test('block formatting affects complete selected lines and toggles off', () => {
  const selection = { start: 1, end: 5 };
  const formatted = formatNote('one\ntwo\nthree', selection, 'bullet');
  assert.equal(formatted.text, '- one\n- two\nthree');
  assert.equal(formatNote(formatted.text, formatted.selection, 'bullet').text, 'one\ntwo\nthree');
  assert.equal(formatNote('## title', { start: 4, end: 4 }, 'quote').text, '> title');
});

test('a selection ending at a line boundary leaves the next line alone', () => {
  assert.equal(formatNote('one\ntwo', { start: 0, end: 4 }, 'heading').text, '## one\ntwo');
  assert.equal(formatNote('one\ntwo', { start: 4, end: 4 }, 'heading').text, 'one\n## two');
});
