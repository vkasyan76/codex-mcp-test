# IONOS Inbox MCP

Read-only MCP server for the Infinisimo support inbox.

## Tools

- `email_list_unread(limit)`
- `email_digest_today(limit)`

## Safety

- Opens the mailbox in read-only mode
- Does not mark mail as read
- Does not send, move, delete, or modify messages

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in the mailbox credentials.
3. Install dependencies with `npm install`.
4. Start the server with `npm start`.

Use `imap.ionos.de` as the IMAP host for this mailbox setup.

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
