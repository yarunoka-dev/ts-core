// The rules the annotation fields (label / description) are held to:
// at least one non-whitespace character, a length cap counted in code
// points, no control characters (description may break lines with LF),
// and none of the invisible characters that can spoof what a reader sees.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { labelProblem, descriptionProblem } from '../src/annotations.ts';

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
    assert.notEqual(labelProblem('ab'), null, 'DEL');
    assert.notEqual(labelProblem('ab'), null, 'C1 control');
  });

  it('rejects invisible characters that can spoof the reading', () => {
    assert.notEqual(labelProblem('a​b'), null, 'zero-width space');
    assert.notEqual(labelProblem('a⁠b'), null, 'word joiner');
    assert.notEqual(labelProblem('a﻿b'), null, 'BOM');
    assert.notEqual(labelProblem('a‮b'), null, 'bidi override');
    assert.notEqual(labelProblem('a⁦b'), null, 'bidi isolate');
  });

  it('keeps ZWJ, ZWNJ, and the bidi marks legal', () => {
    assert.equal(labelProblem('👩‍💻'), null, 'ZWJ emoji sequence');
    assert.equal(labelProblem('a‌b'), null, 'ZWNJ');
    assert.equal(labelProblem('a‎b'), null, 'LRM');
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
