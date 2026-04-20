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

1. Copy `.env.example` to `.env`.
2. Fill in the mailbox credentials.
3. Install dependencies with `npm install`.
4. Start the server with `npm start`.

The MCP now supports `business` and `private` mailbox profiles through `.env`, with `MAIL_DEFAULT_PROFILE` used when a tool call does not pass `profile`.

Saved digest reports are written to `reports/` at the repository root with timestamped filenames, for example `reports/inbox-digest-2026-04-19-14-37-22.md`.

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
