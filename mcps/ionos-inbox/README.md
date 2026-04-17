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

## Codex config

Add a block like this to `~/.codex/config.toml`:

```toml
[mcp_servers.ionos_inbox]
command = "/home/vkasy/.nvm/versions/node/v22.22.2/bin/node"
args = ["/mnt/c/Users/vkasy/OneDrive/Documents/Webdesign/CODEX_AGENTS_MCP/Codex_MCP_test/mcps/ionos-inbox/server.mjs"]
enabled = true
startup_timeout_sec = 60
```

Update the `command` path if your Node installation differs.
