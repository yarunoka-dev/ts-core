---
title: Requirements
description: The runtimes the package supports, and why it carries no runtime dependencies.
sidebar:
  order: 2
---

## Runtime

The engine does all date-time work through the
[Temporal API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)
(ES2026) and references the global `Temporal` object — it ships no
polyfill of its own.

- **Node.js 26 or newer** has Temporal built in.
- **Browsers**: Firefox, Chrome, and Edge ship Temporal natively. For
  runtimes without it (Safari stable, older Node.js), your application
  installs a polyfill once — see
  [Installation](installation#the-temporal-polyfill).

When `Temporal` is missing, the first call into the library throws an
error that points at the polyfill instead of failing somewhere deep
inside.

## Module format

**ESM only.** Browsers load ESM natively, and Node.js 22 and newer can
`require()` a synchronous ESM module graph — one free of top-level
`await`, which this package is — from CommonJS code, so CommonJS
applications on the supported Node.js versions are not excluded.

## Runtime dependencies

**None.** The package requires nothing but the runtime itself.

The engine is pure: it reads a document, answers questions about it, and
writes it back out. It executes no jobs, opens no connections, and
persists no state, so there is nothing for a dependency to do. Keeping
the requirement empty means the package can sit in any application
without pulling a tree of its own behind it.

## TypeScript

TypeScript is optional — the package is plain ESM and works from
JavaScript as it is. For TypeScript users: Temporal is not yet part of a
versioned `lib` entry, so enable it explicitly in your `tsconfig.json`
until it lands in `es2026`:

```jsonc
{
  "compilerOptions": {
    "lib": ["es2025", "esnext.temporal"]
  }
}
```

## Timezone data

Interpretation follows the timezone declared in the document, resolved
against **the timezone database available to your runtime** (the ICU
data of Node.js, or the browser's own). Whether a zone name exists, and
where its transitions fall, is therefore a property of the host rather
than of the document. Keeping the runtime current is what keeps the
timezone data current.
