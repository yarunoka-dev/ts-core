---
title: "@yarunoka/core"
description: The TypeScript implementation of the Yrnk schedule DSL — reading and writing documents, and asking queries about them.
sidebar:
  order: 1
---

`@yarunoka/core` is the TypeScript implementation of **Yrnk**, the JSON
DSL for calendar-aware schedules. It parses a document into a typed
model, writes that model back out as a document, and answers questions
about the occurrences a schedule denotes.

The language itself — what a document may say and what it means — is
defined in the [spec repository](https://github.com/yarunoka-dev/spec/tree/1.1).
This documentation is about the TypeScript package only.

- **Guides** — what the package needs, how to install it, and how to use
  it
- **Reference** — the public functions and types, generated from the
  source

The PHP implementation lives in the separate `yarunoka/core` package.
