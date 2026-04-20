# AGENTS.md

## IONOS Inbox MCP

This folder contains a read-only MCP server for the configured business/private mail profiles.

## What Was Implemented

- Node-based MCP server in `server.mjs`
- IMAP access using `imapflow`
- email parsing using `mailparser`
- environment loading from local `.env`
- three MCP tools with optional `profile` input:
  - `email_list_unread(profile, limit)`
  - `email_digest_today(profile, limit)`
  - `email_digest_today_save(profile, limit)`

## Current Behavior

### `email_list_unread(profile, limit)`

Lists unread emails from the configured mailbox without changing mailbox state.

This implementation only fetches unread messages and does not scan the full mailbox.

Returned fields:

- `uid`
- `date`
- `from`
- `subject`
- `preview`
- `hasAttachments`
- `attachments`

### `email_digest_today(profile, limit)`

Builds a simple digest of unread emails dated today.

This implementation is built on the same unread-only fetch path and does not scan the full mailbox.

Returned output:

- total unread emails from today
- bullet list summary
- simple urgency hint: `high`, `medium`, or `normal`

### `email_digest_today_save(profile, limit)`

Builds the same same-day digest and saves it as a markdown report.

Behavior:

- writes reports into `reports/` at the repo root
- uses timestamped filenames to avoid overwriting previous runs
- falls back to a numeric suffix if two saves happen in the same second
- writes the active profile and mailbox address into the report header

## Safety Rules

- mailbox opens in read-only mode
- no message flags are changed
- no sending
- no drafts
- no moving or deleting mail
- no mark-as-read behavior

## Files In This Folder

- `server.mjs` - MCP server implementation
- `package.json` - project metadata and dependencies
- `package-lock.json` - installed dependency lockfile
- `.env.example` - example environment variables
- `.env` - local mailbox credentials and runtime config
- `README.md` - setup instructions
- `AGENTS.md` - implementation notes

## Environment Variables

Current example shape in `.env`:

```env
MAIL_DEFAULT_PROFILE=private
MAIL_MAILBOX=INBOX
MAIL_MAX_BODY_CHARS=4000

MAIL_EMAIL_BUSINESS=info@infinisimo.com
MAIL_PASSWORD_BUSINESS=...
MAIL_IMAP_HOST_BUSINESS=imap.ionos.de
MAIL_IMAP_PORT_BUSINESS=993
MAIL_IMAP_SECURE_BUSINESS=true

MAIL_EMAIL_PRIVATE=vkasyan@gmx.de
MAIL_PASSWORD_PRIVATE=...
MAIL_IMAP_HOST_PRIVATE=imap.gmx.net
MAIL_IMAP_PORT_PRIVATE=993
MAIL_IMAP_SECURE_PRIVATE=true
```

## Important Implementation Notes

- `.env` is loaded relative to `server.mjs`, not the process working directory
- this fix was necessary because Codex launches MCP servers from a different working directory
- German IONOS mailbox access is configured and documented with `imap.ionos.de`
- the checked-in `.env.example` now documents business/private mail profiles with `private` as the example default
- each tool call resolves the active mailbox profile once and passes it through the fetch/save helpers

## Verified Working

The MCP was tested successfully with:

- mailbox authentication
- read-only inbox open
- unread listing
- same-day digest generation

Observed mailbox state during testing:

- mailbox path: `INBOX`
- total messages: 81
- unread messages: 81

## Not Implemented Yet

- sender/category filtering
- excluding DMARC or spam summary reports
- reply drafting
- outbound email
- attachment content parsing
- issue/task creation from emails

## Recommended Next Improvements

1. Add filtering for automated senders such as:
   - `noreply@ionos.de`
   - `noreply-dmarc-support@google.com`
2. Add lightweight classification:
   - support
   - billing
   - bug
   - provider inquiry
   - spam/report
3. Add a digest mode that only includes likely human emails
4. Optionally add structured JSON output alongside text summaries
