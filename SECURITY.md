# Security

Sailor handles two sensitive things: **API keys that can spend money** (Fiber, your LLM, Google, CRMs) and **personal data** about prospects and candidates. This page covers how to report a problem and what Sailor does to protect both.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately through GitHub: on this repository, go to **Security → Report a vulnerability**. Include:

- what you found and its impact,
- steps to reproduce (a minimal mock-server setup is ideal),
- the Sailor version or commit.

We'll acknowledge within a few working days and keep you updated until it's fixed. Please give us a reasonable window to release a fix before disclosing.

In scope: key or token leakage, spend that bypasses the cost guard, prompt injection that makes the agent spend, exfiltrate data or contact people, formula injection in exports, unsafe file handling, and data leaving the machine without consent.

## How Sailor protects keys

- Fiber keys are stored in the OS keychain (macOS Keychain, Linux Secret Service), or in `~/.sailor/credentials.json` with permissions `0600` when no keychain is available.
- The key is injected by the HTTP client at call time. It is never part of a tool schema, so the model can't see, echo or leak it.
- Keys pasted into chat are caught before the model sees them; Sailor offers to store the key and redacts the message.
- Fiber keys, bearer tokens, Google tokens, signed S3 URLs and `apiKey=` parameters are redacted from every tool result (including shell output) before it enters the context or Pi's session files.
- CI fails if a live Fiber key appears in any Pi session file.
- Sandbox mode never falls back to a live key.

## How Sailor protects spend

- Every paid call is estimated and checked against an auto-approve threshold, session and daily budgets, the balance and a per-turn call cap. Larger or uncertain calls ask the user.
- Buying credits, attaching cards and account sign-up are blocked for the agent. API-key admin needs an explicit `/fiber admin on`.
- Paid calls that time out are never retried automatically.
- Headless runs can't spend beyond an explicit `--fiber-max-spend`.
- Shell commands that appear to call Fiber directly (bypassing the guard) need consent.

## How Sailor protects data

- Data lives locally in SQLite (`0600`), in `~/.sailor` or a project's `.sailor/`.
- Third-party content is passed to the model as untrusted data, and the model is instructed never to follow instructions found in it or send data to URLs it mentions.
- Uploading a file for Mosaic requires consent; links are temporary and revoked or deleted once Mosaic starts.
- Google access is limited to the `drive.file` scope.
- Exports escape spreadsheet formulas and never include do-not-contact rows. `/forget` and `/wipe` delete local data.
- Telemetry is off by default and collects nothing in this version.

## Your responsibilities

- Cap your Fiber key's spend in the Fiber dashboard, and use a sandbox key for experiments.
- Comply with the laws that apply to your outreach (CAN-SPAM, GDPR, CCPA, …) and honour opt-outs; Sailor's do-not-contact list helps but doesn't make you compliant by itself.
- Scripts you run in engineer mode call Fiber directly and are outside Sailor's guard.
