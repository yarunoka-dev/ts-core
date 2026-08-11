// YrnkError: the single error class of the library. Every failure the
// library reports about documents, values, or definitions is a YrnkError
// telling its kind through `code`; environment problems (a missing
// Temporal) are deliberately not YrnkErrors.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { YrnkError } from '../src/error.ts';

describe('YrnkError', () => {
  it('is an Error', () => {
    const error = new YrnkError('invalid-document', 'broken');

    assert.ok(error instanceof Error);
    assert.ok(error instanceof YrnkError);
  });

  it('carries the code and the message', () => {
    const error = new YrnkError('undefined-name', 'Undefined name: closures');

    assert.equal(error.code, 'undefined-name');
    assert.equal(error.message, 'Undefined name: closures');
  });

  it('names itself YrnkError', () => {
    assert.equal(new YrnkError('invalid-value', 'x').name, 'YrnkError');
  });
});
