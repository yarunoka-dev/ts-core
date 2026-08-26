import { invalid } from './shared.ts';

/**
 * Rejection of duplicate member names, from the document text. JSON
 * decoding keeps only the last of equally named members, so a decoded
 * value cannot carry the evidence — the check reads the authored bytes
 * instead, before decoding gets to collapse them. Names compare after
 * escape resolution ("timezone" and "\u0074imezone" are the same name):
 * JSON decides member equality on the resolved characters, never on the
 * written bytes.
 *
 * The scan runs on text that JSON.parse has already accepted, so it
 * assumes well-formed JSON and walks structure without re-validating it.
 */
export function ensureNoDuplicateMembers(text: string): void {
  let pos = 0;

  function skipWhitespace(): void {
    while (pos < text.length && ' \t\n\r'.includes(text[pos] as string)) {
      pos++;
    }
  }

  function scanValue(): void {
    skipWhitespace();

    const char = text[pos];

    if (char === '{') {
      scanObject();
    } else if (char === '[') {
      scanArray();
    } else if (char === '"') {
      scanString();
    } else {
      // A number, true, false, or null — runs to the next delimiter.
      while (pos < text.length && !',]} \t\n\r'.includes(text[pos] as string)) {
        pos++;
      }
    }
  }

  function scanObject(): void {
    pos++; // {

    const seen = new Set<string>();

    skipWhitespace();

    if (text[pos] === '}') {
      pos++;

      return;
    }

    for (;;) {
      skipWhitespace();

      const name = scanString();

      if (seen.has(name)) {
        invalid(`Duplicate member name: ${name}`);
      }

      seen.add(name);

      skipWhitespace();
      pos++; // :
      scanValue();
      skipWhitespace();

      if (text[pos] === '}') {
        pos++;

        return;
      }

      pos++; // ,
    }
  }

  function scanArray(): void {
    pos++; // [

    skipWhitespace();

    if (text[pos] === ']') {
      pos++;

      return;
    }

    for (;;) {
      scanValue();
      skipWhitespace();

      if (text[pos] === ']') {
        pos++;

        return;
      }

      pos++; // ,
    }
  }

  /** The string at pos, with its escapes resolved to characters. */
  function scanString(): string {
    pos++; // "

    let value = '';

    while (text[pos] !== '"') {
      if (text[pos] === '\\') {
        const escaped = text[pos + 1] as string;

        if (escaped === 'u') {
          // A surrogate half resolves as its lone code unit, which is
          // exactly how JSON member equality reads it.
          value += String.fromCharCode(Number.parseInt(text.slice(pos + 2, pos + 6), 16));
          pos += 6;
        } else {
          value += SHORT_ESCAPES[escaped] ?? escaped;
          pos += 2;
        }
      } else {
        value += text[pos];
        pos++;
      }
    }

    pos++; // "

    return value;
  }

  scanValue();
}

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};
