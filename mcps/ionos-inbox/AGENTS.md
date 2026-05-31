# AGENTS.md

## IONOS Inbox MCP

This folder contains a Node-based MCP server for read-only processing of multiple IMAP mailboxes used by Infinisimo and private email accounts.

The practical goal is to build an effective mail-processing assistant:

- summarize unread and recently received emails
- classify messages into useful action buckets
- highlight what needs attention or reply
- save readable and structured reports
- later draft replies only after full email/thread context is read
- send only after explicit user approval in a later phase

## Current State

Implemented or verified locally:

- `server.mjs` runs the MCP server over stdio.
- `imapflow` is used for IMAP access.
- `mailparser` is used for parsing messages.
- `.env` is loaded from this folder.
- `mailbox-config.mjs` contains TLS-aware config helpers.
- `test/mailbox-config.test.mjs` verifies TLS config behavior.
- All configured mailboxes have been verified to connect with strict TLS.
- Norton TLS interception was removed by uninstalling Norton; Windows Defender is active.

Current legacy tools may still exist until V1 migration is complete:

- `email_list_unread(profile, limit)`
- `email_digest_today(profile, limit)`
- `email_digest_today_save(profile, limit)`

## Non-Negotiable Safety Rules

V1 must be read-only.

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

## V1 Target

Build a safe read-only email intelligence layer.

V1 reads all configured mailboxes from the `MAILBOXES=...` format, fetches unread and recent mail, normalizes messages into a stable shape, classifies them, and saves a grouped triage report.

V1 MCP tools:

- `email_list_mailboxes`
- `email_list_unread_all`
- `email_list_recent`
- `email_read`
- `email_triage_report`

Post-V1 tools:

- `email_search_context`
- `email_read_thread`
- `email_draft_reply`
- `email_send_approved_reply`

## Important Design Corrections

### Classifier Strategy

The deterministic keyword classifier is only a V1 fallback and technical skeleton.

Do not couple keyword classification deeply into MCP tools or report rendering. Keep classification behind a small module/function boundary so an AI structured classifier can later replace or augment it.

Preferred boundary:

```js
classifyEmail(email, options)
```

The initial implementation may use heuristics, but callers should not care whether the result came from heuristics or AI.

### Category vs Reply State

Do not use `needs_reply` as the main classification concept.

Use separate fields:

- `category`: what kind of email this is
- `needsReply`: whether the user likely needs to answer
- `importance`: how important or urgent it is

An invoice, support request, legal email, or appointment email can all need a reply. This must remain filterable.

Do not use `urgent` as a category. Urgency is a priority/action state, not an email type. Represent urgency through `importance` and, if needed later, a derived `isUrgent` field or report section.

Recommended categories:

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

Use `needsReply: true` independently from category.

Classification should use sender, subject, and body or preview together. Do not classify solely from the subject when body text is available.

### Report Tables

Markdown report tables must show both category and reply state.

Use this column shape:

```text
Mailbox | Category | From | Subject | Received | Importance | Needs Reply | Summary | Next Step | Source
```

Grouping by section is still useful, but do not hide category or reply state inside the grouping.

The `Urgent / Time-sensitive` report section should be derived from `importance: "critical"` or `importance: "high"` plus the message content. It should not depend on an `urgent` category.

### Email Source References

Every report item must preserve enough data to find the original message:

```text
mailboxId
folder
uid
messageId
from
subject
receivedAt
```

IMAP UIDs are folder-specific. `email_read` must accept folder:

```json
{
  "mailboxId": "info",
  "folder": "INBOX",
  "uid": 12345
}
```

`folder` may default to the mailbox configured folder, but the tool input and internal read function must support it.

For V1 triage, normalized `body` may be trimmed by `MAIL_MAX_BODY_CHARS`. Post-V1 drafting must use full email or full thread content, not a triage-trimmed body.

### Report Directory

Make the report output directory configurable:

```env
MAIL_REPORTS_DIR=../../reports
```

Fallback may remain `../../reports`, resolved relative to this MCP folder. Avoid unclear saves under the wrong `reports/` directory.

### Global Triage Cap

Use both per-mailbox and global limits.

Recommended defaults:

```text
limitPerMailbox: 50
maxTotalEmails: 250
```

This prevents a daily triage run from processing hundreds of messages across many mailboxes.

### Test Isolation

Mailbox config tests must not accidentally read the real local `.env` or `process.env`.

Pass explicit env objects in tests:

```js
const env = { ...BASE_ENV, MAILBOXES: "info,support" };
const config = loadConfigFromEnv(env);
const mailboxes = resolveConfiguredMailboxes(config, env);
```

Do not rely on `process.env` in tests unless the test is explicitly checking runtime loading.

## Internal Data Shapes

Use plain JavaScript modules with JSDoc and `zod` where runtime validation matters.

```js
/**
 * @typedef {"company" | "private" | "support" | "accounting" | "system" | "other"} MailboxType
 *
 * @typedef {Object} MailboxConfig
 * @property {string} id
 * @property {string} label
 * @property {MailboxType} type
 * @property {string} email
 * @property {string} password
 * @property {string} host
 * @property {number} port
 * @property {boolean} secure
 * @property {string} folder
 * @property {number} maxBodyChars
 * @property {boolean} tlsRejectUnauthorized
 */
```

```js
/**
 * @typedef {Object} EmailItem
 * @property {string} mailboxId
 * @property {string} mailboxLabel
 * @property {string} mailboxType
 * @property {string} mailboxEmail
 * @property {string} folder
 * @property {number} uid
 * @property {string | null} messageId
 * @property {string} from
 * @property {string[]} to
 * @property {string[]} cc
 * @property {string} subject
 * @property {string | null} receivedAt
 * @property {boolean} isUnread
 * @property {string} preview
 * @property {string} body
 * @property {boolean} hasAttachments
 * @property {string[]} attachments
 */
```

```js
/**
 * @typedef {Object} EmailTriageResult
 * @property {EmailItem} email
 * @property {string} category
 * @property {"critical" | "high" | "medium" | "low"} importance
 * @property {boolean} needsReply
 * @property {boolean} hasDeadline
 * @property {string | null} deadline
 * @property {string} summary
 * @property {string} nextStep
 * @property {"high" | "medium" | "low"} confidence
 * @property {"heuristic" | "ai" | "hybrid"} classifier
 */
```

## Report Files

Each triage run should save:

```text
reports/email-triage-YYYY-MM-DD-HH-mm-ss.md
reports/email-triage-YYYY-MM-DD-HH-mm-ss.json
reports/latest.md
reports/latest.json
```

Markdown is for reading. JSON is for later search, filtering, and assistant context.

JSON report items must preserve classification and message metadata useful for future search:

```text
category
importance
needsReply
hasDeadline
deadline
summary
nextStep
confidence
classifier
isUnread
hasAttachments
attachments
source.mailboxId
source.folder
source.uid
source.messageId
source.from
source.subject
source.receivedAt
```

## Recommended Module Split

Prefer focused modules over growing `server.mjs`.

- `server.mjs`: MCP startup and tool registration only
- `mailbox-config.mjs`: env parsing and mailbox resolution
- `imap-reader.mjs`: read-only IMAP access
- `email-normalizer.mjs`: parse raw messages into `EmailItem`
- `email-triage.mjs`: classifier boundary and fallback heuristics
- `report-writer.mjs`: Markdown/JSON rendering and persistence
- `mail-tools.mjs`: orchestration used by MCP tools
- `test/*.test.mjs`: Node built-in test coverage

## Implementation Tasks

Implement task-by-task with tests first.

1. Expand mailbox config for `MAILBOXES=...`.
   - Add explicit env-object tests.
   - Preserve legacy `business/private` helpers only as compatibility support.
   - Include `MAIL_REPORTS_DIR`.

2. Add safe read-only IMAP layer.
   - Always open mailbox read-only.
   - Support unread, recent, and single-message read.
   - Support `folder` for single-message read.

3. Add email normalization.
   - Normalize sender, recipients, subject, body, attachments, flags, source references.
   - Keep body trimming configurable through `MAIL_MAX_BODY_CHARS`.

4. Add classifier boundary.
   - Implement deterministic fallback classifier.
   - Keep it replaceable by future AI structured classification.
   - Keep `needsReply` independent from `category`.

5. Add report writer.
   - Use grouped Markdown.
   - Include `Category` and `Needs Reply` columns.
   - Save Markdown and JSON.
   - Update `latest.md` and `latest.json`.

6. Register V1 MCP tools.
   - `email_list_mailboxes`
   - `email_list_unread_all`
   - `email_list_recent`
   - `email_read`
   - `email_triage_report`
   - Include `limitPerMailbox` and `maxTotalEmails` where relevant.

7. Verify against local mailboxes.
   - Run automated tests.
   - Run syntax check.
   - Smoke test all configured mailboxes.
   - Generate a small report.
   - Confirm no secrets appear in output.

## MCP Tool Contracts

### `email_list_mailboxes`

Lists configured mailboxes without passwords.

Full email addresses should not be exposed by default. Return masked mailbox addresses unless the caller explicitly passes `includeEmail: true`.

Input:

```json
{
  "includeEmail": false
}
```

Output fields:

```text
id
label
type
maskedEmail
email, only when includeEmail=true
host
folder
status, when connection checking is implemented
```

### `email_list_unread_all`

Input:

```json
{
  "limitPerMailbox": 25,
  "maxTotalEmails": 250
}
```

Returns normalized unread email items from all configured mailboxes.

### `email_list_recent`

Input:

```json
{
  "mailboxIds": ["info", "support"],
  "days": 3,
  "limitPerMailbox": 50,
  "maxTotalEmails": 250,
  "unreadOnly": false
}
```

Returns normalized recent email items.

### `email_read`

Input:

```json
{
  "mailboxId": "info",
  "folder": "INBOX",
  "uid": 12345
}
```

Returns one normalized full email without changing read state.

### `email_triage_report`

Input:

```json
{
  "days": 3,
  "limitPerMailbox": 50,
  "maxTotalEmails": 250,
  "save": true
}
```

Returns or saves a grouped triage report. The report must include category, importance, needs-reply state, summary, next step, confidence, and source reference.

## Acceptance Checklist

V1 is complete only when:

- `node --test` passes.
- `npm run check` passes.
- `email_list_mailboxes` returns all configured mailbox ids without passwords.
- `email_list_unread_all` returns unread items across multiple mailboxes.
- `email_list_recent` returns recent items from the requested time window.
- `email_read` returns one full normalized email by `mailboxId`, `folder`, and `uid`.
- `email_triage_report` saves Markdown and JSON reports.
- `reports/latest.md` and `reports/latest.json` are updated.
- Every report item has `mailboxId`, `folder`, `uid`, and `messageId`.
- JSON report items include `classifier`, `hasDeadline`, `deadline`, `isUnread`, `hasAttachments`, and `attachments`.
- Report tables include `Category` and `Needs Reply`.
- `needsReply` is independent from `category`.
- `urgent` is not used as a category; urgency is represented through `importance` or derived report sections.
- `maxTotalEmails` limits large runs.
- `MAIL_REPORTS_DIR` is honored when set.
- No V1 tool sends, drafts, moves, deletes, archives, flags, or marks mail as read.
- No credentials are printed by tests, docs, reports, or MCP output.

## Post-V1 Roadmap

Do these only after the read-only V1 is accepted:

1. `email_search_context`: search saved JSON reports first, then optionally fetch live IMAP data.
2. AI structured classification: replace or augment heuristic classifier through the classifier boundary.
3. `email_read_thread`: reconstruct thread context before drafting.
4. `email_draft_reply`: generate reply text only after full email or thread read.
5. `email_send_approved_reply`: send only after explicit user approval and exact recipient/body confirmation.
6. Optional local UI: add only after MCP tools and reports are reliable.
