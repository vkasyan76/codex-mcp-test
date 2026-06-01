# IONOS Inbox MCP

Read-only MCP server for the Infinisimo support inbox.

## Tools

- `email_list_unread(profile?, limit)`
- `email_digest_today(profile?, limit)`
- `email_digest_today_save(profile?, limit)`

## Safety

- Opens the mailbox in read-only mode
- Does not mark mail as read
- Does not send, move, delete, or modify messages

## Setup

1. Create `mcps/ionos-inbox/.env` manually.
2. Fill in local mailbox credentials. Do not commit `.env`.
3. Install dependencies with `npm install`.
4. Start the server with `npm start`.

The legacy MCP tools currently use `business` and `private` mailbox profiles, with `MAIL_DEFAULT_PROFILE` used when a tool call does not pass `profile`.

Use this sanitized shape for local setup:

```env
MAIL_DEFAULT_PROFILE=private
MAIL_MAILBOX=INBOX
MAIL_MAX_BODY_CHARS=4000
MAIL_TLS_REJECT_UNAUTHORIZED=true
MAIL_REPORTS_DIR=../../reports

MAIL_EMAIL_BUSINESS=info@example.com
MAIL_PASSWORD_BUSINESS=<business-password>
MAIL_IMAP_HOST_BUSINESS=imap.example.com
MAIL_IMAP_PORT_BUSINESS=993
MAIL_IMAP_SECURE_BUSINESS=true

MAIL_EMAIL_PRIVATE=private@example.com
MAIL_PASSWORD_PRIVATE=<private-password>
MAIL_IMAP_HOST_PRIVATE=imap.example.com
MAIL_IMAP_PORT_PRIVATE=993
MAIL_IMAP_SECURE_PRIVATE=true
```

The V1 multi-mailbox configuration also supports `MAILBOXES=...` plus prefixed keys such as `MAILBOX_INFO_EMAIL`, `MAILBOX_INFO_PASSWORD`, and `MAILBOX_INFO_IMAP_HOST`. These are used by the newer mailbox config helpers and will be connected to the V1 tools as the migration continues.

Saved digest reports are written to `MAIL_REPORTS_DIR`, resolved relative to this MCP folder when the value is relative. The default `../../reports` writes to `reports/` at the repository root with timestamped filenames, for example `reports/inbox-digest-2026-04-19-14-37-22.md`.

## Codex config

Add a block like this to `~/.codex/config.toml`:

```toml
[mcp_servers.ionos_inbox]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/mcps/ionos-inbox/server.mjs"]
enabled = true
startup_timeout_sec = 60
```

Update both the `command` and `args` paths to match your local Node installation and repository location.
