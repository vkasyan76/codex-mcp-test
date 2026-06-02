# Infinisimo IONOS Inbox MCP

Goal: build a read-only MCP server for `info@infinisimo.com` that can list unread emails and generate a same-day digest.

## V1 Tool Scope

- `email_list_unread(limit)`
- `email_digest_today(limit)`

## Safety Rules

- Open the mailbox in read-only mode.
- Never mutate flags.
- Never send, delete, move, or mark messages as read.
- Keep secrets in `.env`, not in source control.

## Runtime Notes

- IMAP host: `imap.ionos.de`
- Port: `993`
- TLS: enabled
