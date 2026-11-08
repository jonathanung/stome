import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNote } from '../src/features/notes/formatting.ts';

test('inline formatting keeps surrounding text and selects the formatted content', () => {
  assert.deepEqual(formatNote('hello world', { start: 6, end: 11 }, 'bold'), {
    text: 'hello **world**', selection: { start: 8, end: 13 },
  });
  assert.equal(formatNote('', { start: 0, end: 0 }, 'italic').text, '*text*');
  assert.deepEqual(formatNote('hello **world**', { start: 8, end: 13 }, 'bold'), {
    text: 'hello world', selection: { start: 6, end: 11 },
  });
  assert.equal(formatNote('**world**', { start: 2, end: 7 }, 'italic').text, '***world***');
  assert.equal(formatNote('**world**', { start: 0, end: 9 }, 'bold').text, 'world');
  assert.equal(formatNote('try', { start: 0, end: 3 }, 'code').text, '`try`');
  assert.deepEqual(formatNote('see docs', { start: 4, end: 8 }, 'link'), {
    text: 'see [docs](https://)', selection: { start: 11, end: 19 },
  });
});

test('block formatting affects complete selected lines and toggles off', () => {
  const selection = { start: 1, end: 5 };
  const formatted = formatNote('one\ntwo\nthree', selection, 'bullet');
  assert.equal(formatted.text, '- one\n- two\nthree');
  assert.equal(formatNote(formatted.text, formatted.selection, 'bullet').text, 'one\ntwo\nthree');
  assert.equal(formatNote('## title', { start: 4, end: 4 }, 'quote').text, '> title');
  assert.equal(formatNote('one\ntwo', { start: 0, end: 7 }, 'numbered').text, '1. one\n2. two');
  assert.equal(formatNote('1. one\n2. two', { start: 0, end: 13 }, 'checklist').text, '- [ ] one\n- [ ] two');
});

test('a selection ending at a line boundary leaves the next line alone', () => {
  assert.equal(formatNote('one\ntwo', { start: 0, end: 4 }, 'heading').text, '## one\ntwo');
  assert.equal(formatNote('one\ntwo', { start: 4, end: 4 }, 'heading').text, 'one\n## two');
});
