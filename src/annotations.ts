/**
 * The rules the annotation fields (label / description) are held to, at
 * the document and schedule levels alike. Annotations are inert — the
 * language never reads them — so the rules protect only their reading by
 * humans: no control characters (description may break lines with LF),
 * none of the invisible characters that can spoof what a reader sees,
 * and a generous length cap.
 */
export const LABEL_MAX = 100;

export const DESCRIPTION_MAX = 1000;

/**
 * ZWSP, the word joiner, the BOM, and the bidi embedding / override /
 * isolate controls. ZWJ/ZWNJ and the bidi marks stay legal: emoji
 * sequences and several scripts cannot be written without them.
 */
const INVISIBLES = /[\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/u;

// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control characters is this expression's whole job
const LABEL_CONTROLS = /[\u0000-\u001F\u007F-\u009F]/u;

// LF is carved out of the C0 range: the one permitted line break.
// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control characters is this expression's whole job
const DESCRIPTION_CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;

/**
 * Why the string cannot be a label, or null when it can: at least one
 * non-whitespace character, at most 100 code points, and no control
 * characters or invisible characters that can spoof what a reader sees.
 */
export function labelProblem(value: string): string | null {
  return problemWith('label', value, LABEL_MAX, LABEL_CONTROLS);
}

/**
 * Why the string cannot be a description, or null when it can: the
 * label rules with a 1000 code point cap, and LF permitted as the one
 * line break.
 */
export function descriptionProblem(value: string): string | null {
  return problemWith('description', value, DESCRIPTION_MAX, DESCRIPTION_CONTROLS);
}

function problemWith(field: string, value: string, max: number, controls: RegExp): string | null {
  if (!/\S/u.test(value)) {
    return `${field} must contain a non-whitespace character (omit the key for no annotation)`;
  }

  // Counted in code points, the unit the spec counts in.
  const length = [...value].length;

  if (length > max) {
    return `${field} cannot be longer than ${max} characters: ${length}`;
  }

  if (controls.test(value)) {
    const lineBreak = field === 'description' ? ' (LF is the only permitted line break)' : '';

    return `${field} cannot contain control characters${lineBreak}`;
  }

  if (INVISIBLES.test(value)) {
    return `${field} cannot contain invisible characters (ZWSP, word joiner, BOM, or bidi controls)`;
  }

  return null;
}
