# AGENTS.md

## IONOS Inbox MCP

This folder contains a read-only MCP server for the IONOS mailbox `info@infinisimo.com`.

## What Was Implemented

- Node-based MCP server in `server.mjs`
- IMAP access using `imapflow`
- email parsing using `mailparser`
- environment loading from local `.env`
- two MCP tools:
  - `email_list_unread(limit)`
  - `email_digest_today(limit)`

## Current Behavior

### `email_list_unread(limit)`

Lists unread emails from the configured mailbox without changing mailbox state.

Returned fields:

- `uid`
- `date`
- `from`
- `subject`
- `preview`
- `hasAttachments`
- `attachments`

### `email_digest_today(limit)`

Builds a simple digest of unread emails dated today.

Returned output:

- total unread emails from today
- bullet list summary
- simple urgency hint: `high`, `medium`, or `normal`

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

Expected in `.env`:

```env
IONOS_EMAIL=info@infinisimo.com
IONOS_PASSWORD=...
IONOS_IMAP_HOST=imap.ionos.de
IONOS_IMAP_PORT=993
IONOS_IMAP_SECURE=true
IONOS_MAILBOX=INBOX
IONOS_MAX_BODY_CHARS=4000
```

## Important Implementation Notes

- `.env` is loaded relative to `server.mjs`, not the process working directory
- this fix was necessary because Codex launches MCP servers from a different working directory
- German IONOS mailbox access worked with `imap.ionos.de`
- `imap.ionos.com` failed authentication in this setup

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
