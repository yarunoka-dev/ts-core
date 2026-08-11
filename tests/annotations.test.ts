// The rules the annotation fields (label / description) are held to:
// at least one non-whitespace character, a length cap counted in code
// points, no control characters (description may break lines with LF),
// and none of the invisible characters that can spoof what a reader sees.
// Invisible characters are spelled as escapes throughout: embedded raw,
// they could be silently stripped by tooling and leave assertions that
// prove nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { descriptionProblem, labelProblem } from '../src/annotations.ts';

describe('labelProblem', () => {
  it('accepts an ordinary line', () => {
    assert.equal(labelProblem('Payday transfer'), null);
  });

  it('rejects whitespace-only values', () => {
    assert.notEqual(labelProblem('  '), null);
  });

  it('caps the length at 100 code points', () => {
    assert.equal(labelProblem('あ'.repeat(100)), null);
    assert.notEqual(labelProblem('あ'.repeat(101)), null);
  });

  it('counts astral characters as one code point', () => {
    // 100 emoji are 200 UTF-16 code units but exactly 100 code points.
    assert.equal(labelProblem('😀'.repeat(100)), null);
  });

  it('rejects control characters including LF', () => {
    assert.notEqual(labelProblem('two\nlines'), null);
    assert.notEqual(labelProblem('tab\there'), null);
    assert.notEqual(labelProblem('a\u007Fb'), null, 'DEL');
    assert.notEqual(labelProblem('a\u0085b'), null, 'C1 control');
  });

  it('rejects invisible characters that can spoof the reading', () => {
    assert.notEqual(labelProblem('a\u200Bb'), null, 'zero-width space');
    assert.notEqual(labelProblem('a\u2060b'), null, 'word joiner');
    assert.notEqual(labelProblem('a\uFEFFb'), null, 'BOM');
    assert.notEqual(labelProblem('a\u202Eb'), null, 'bidi override');
    assert.notEqual(labelProblem('a\u2066b'), null, 'bidi isolate');
  });

  it('keeps ZWJ, ZWNJ, and the bidi marks legal', () => {
    assert.equal(labelProblem('\u{1F469}\u200D\u{1F4BB}'), null, 'ZWJ emoji sequence');
    assert.equal(labelProblem('a\u200Cb'), null, 'ZWNJ');
    assert.equal(labelProblem('a\u200Eb'), null, 'LRM');
  });
});

describe('descriptionProblem', () => {
  it('permits LF as the one line break', () => {
    assert.equal(descriptionProblem('first line\nsecond line'), null);
  });

  it('rejects the other control characters', () => {
    assert.notEqual(descriptionProblem('a\tb'), null);
    assert.notEqual(descriptionProblem('a\rb'), null);
  });

  it('caps the length at 1000 code points', () => {
    assert.equal(descriptionProblem('x'.repeat(1000)), null);
    assert.notEqual(descriptionProblem('x'.repeat(1001)), null);
  });

  it('rejects whitespace-only values', () => {
    assert.notEqual(descriptionProblem('\n\n'), null);
  });
});
