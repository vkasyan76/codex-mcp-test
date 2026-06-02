# AGENTS.md

## IONOS Inbox MCP

This folder contains a Node-based MCP server for read-only processing of
multiple IMAP mailboxes used by Infinisimo and private email accounts.

The practical goal is a safe mail-processing assistant that can:

- list configured mailboxes
- summarize unread and recently received emails
- classify messages into action-oriented buckets
- highlight what needs attention or reply
- save readable Markdown and structured JSON reports
- later draft replies only after full email/thread context is read
- send only after explicit user approval in a later phase

## Current State

Implemented:

- `server.mjs` runs the MCP server over stdio.
- `.env` is loaded from this folder.
- `mailbox-config.mjs` resolves legacy profiles and `MAILBOXES=...` mailboxes.
- `imap-reader.mjs` opens IMAP folders read-only.
- `email-normalizer.mjs` parses raw messages into `EmailItem` objects.
- `email-triage.mjs` classifies messages through the V1 heuristic boundary.
- `report-writer.mjs` writes Markdown and JSON triage reports.
- `mail-tools.mjs` orchestrates the V1 MCP tool behavior.
- Node built-in tests cover config, IMAP reader behavior, normalization,
  triage classification, report writing, and V1 tool orchestration.

Verified local history:

- All configured mailboxes previously connected with strict TLS.
- Norton TLS interception was removed by uninstalling Norton; Windows Defender is active.

Legacy tools still exist temporarily:

- `email_list_unread(profile, limit)`
- `email_digest_today(profile, limit)`
- `email_digest_today_save(profile, limit)`

Do not refactor or remove the legacy tools in the same patch as V1 live
verification. Handle legacy cleanup as a separate follow-up after V1 is accepted.

## V1 MCP Tools

- `email_list_mailboxes(includeEmail?)`
- `email_list_unread_all(limitPerMailbox, maxTotalEmails, includeEmail?)`
- `email_list_recent(mailboxIds?, days, limitPerMailbox, maxTotalEmails, unreadOnly, includeEmail?)`
- `email_read(mailboxId, folder?, uid, includeEmail?)`
- `email_triage_report(days, limitPerMailbox, maxTotalEmails, save)`

List tools omit full message bodies and full mailbox email addresses by default.
They include `maskedMailboxEmail`. `email_read` may include the selected email
body because the caller supplies an exact source reference.

## Non-Negotiable Safety Rules

V1 is read-only.

Allowed:

- list mailboxes
- list unread messages
- list recent messages
- read one selected email
- summarize and classify locally
- save local Markdown and JSON reports

Forbidden in V1:

- mark messages as read
- move messages
- delete messages
- archive messages
- flag messages
- create mailbox drafts
- send email

Do not print, log, commit, or include in reports:

- `.env` contents
- passwords
- app passwords
- full credential-bearing config
- full mailbox email addresses unless a tool explicitly receives `includeEmail: true`

Reports must not include message bodies, recipients, mailbox emails, passwords,
host/port credential config, or TLS config.

## Mailbox Configuration

V1 reads all configured mailboxes from `MAILBOXES=...` and prefixed mailbox
variables:

```env
MAILBOXES=info,support,private

MAILBOX_INFO_LABEL=Infinisimo Info
MAILBOX_INFO_TYPE=company
MAILBOX_INFO_EMAIL=info@example.com
MAILBOX_INFO_PASSWORD=<password>
MAILBOX_INFO_IMAP_HOST=imap.example.com
MAILBOX_INFO_IMAP_PORT=993
MAILBOX_INFO_IMAP_SECURE=true
MAILBOX_INFO_FOLDER=INBOX
```

`MAIL_REPORTS_DIR` controls report output. Relative paths are resolved from this
MCP folder. The default is `../../reports`.

## Classification Rules

Keep classification behind:

```js
classifyEmail(email, options)
```

The V1 classifier is deterministic and heuristic, but callers must not depend on
that implementation. Future AI or hybrid classification should be able to use
the same boundary.

Use separate fields:

- `category`: email type
- `needsReply`: whether the user likely needs to answer
- `importance`: priority level
- `attentionScore`: numeric scan priority from 0 to 100
- `attentionReason`: short reason why the item is raised or buried

Do not use `urgent` as a category. Urgency is represented through `importance`,
`attentionScore`, and report sections.

Categories:

```js
const EMAIL_CATEGORIES = [
  "billing_invoice",
  "customer_support",
  "account_security",
  "business_opportunity",
  "legal_admin",
  "appointment_booking",
  "waiting_no_action",
  "newsletter_fyi",
  "automated_noise",
  "spam_suspicious",
  "private_personal",
  "unknown",
];
```

## Report Files

Each saved triage run writes:

```text
reports/email-triage-YYYY-MM-DD-HH-mm-ss.md
reports/email-triage-YYYY-MM-DD-HH-mm-ss.json
reports/latest.md
reports/latest.json
```

Markdown is for reading. JSON is for later search, filtering, and assistant context.

Markdown report table shape:

```text
Mailbox | Score | Reason | Category | From | Subject | Received | Importance | Needs Reply | Summary | Next Step | Source
```

The `Top Attention / Time-sensitive` section is a duplicate spotlight section.
It is derived from:

```text
attentionScore >= 70 OR importance is high/critical
```

It must not depend on an `urgent` category.

Every report item must preserve source metadata:

```text
mailboxId
mailboxLabel
folder
uid
messageId
from
subject
receivedAt
```

Source reference format:

```text
mailboxId=info folder=INBOX uid=12345 messageId=<abc@example.com>
```

## Module Boundaries

Prefer focused modules over growing `server.mjs`.

- `server.mjs`: MCP startup and tool registration
- `mailbox-config.mjs`: env parsing and mailbox resolution
- `imap-reader.mjs`: read-only IMAP access
- `email-normalizer.mjs`: parse raw messages into `EmailItem`
- `email-triage.mjs`: classifier boundary and fallback heuristics
- `report-writer.mjs`: Markdown/JSON rendering and persistence
- `mail-tools.mjs`: orchestration used by V1 MCP tools
- `test/*.test.mjs`: Node built-in test coverage

Known follow-up: legacy digest orchestration still exists in `server.mjs`.
Move or remove that only after V1 live verification is accepted.

## Acceptance Checklist

V1 is complete only when:

- `node --test` passes.
- `npm run check` passes.
- `email_list_mailboxes` returns all configured mailbox IDs without passwords.
- `email_list_unread_all` returns unread items or an empty array without failure.
- `email_list_recent` returns recent items or an empty array without failure.
- `email_read` returns one full normalized email by `mailboxId`, `folder`, and `uid`.
- `email_triage_report` saves Markdown and JSON reports.
- `reports/latest.md` and `reports/latest.json` are updated.
- Every report item has `mailboxId`, `folder`, `uid`, and `messageId`.
- JSON report items include `classifier`, `hasDeadline`, `deadline`, `isUnread`,
  `hasAttachments`, and `attachments`.
- Report tables include `Score`, `Reason`, `Category`, and `Needs Reply`.
- `needsReply` is independent from `category`.
- `urgent` is not used as a category.
- `maxTotalEmails` limits large runs.
- `MAIL_REPORTS_DIR` is honored when set.
- No V1 tool sends, drafts, moves, deletes, archives, flags, or marks mail as read.
- No credentials are printed by tests, docs, reports, or MCP output.

## Post-V1 Roadmap

Do these only after the read-only V1 is accepted:

1. Clean up or remove legacy server-side digest orchestration.
2. `email_search_context`: search saved JSON reports first, then optionally fetch live IMAP data.
3. AI structured classification: replace or augment heuristic classification.
4. `email_read_thread`: reconstruct thread context before drafting.
5. `email_draft_reply`: generate reply text only after full email or thread read.
6. `email_send_approved_reply`: send only after explicit user approval and exact recipient/body confirmation.
7. Optional local UI: add only after MCP tools and reports are reliable.
