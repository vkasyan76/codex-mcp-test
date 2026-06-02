# IONOS Inbox MCP

Read-only MCP server for triaging multiple IMAP mailboxes.

## V1 Triage Tools

- `email_list_mailboxes(includeEmail?)`
- `email_list_unread_all(limitPerMailbox, maxTotalEmails, includeEmail?)`
- `email_list_recent(mailboxIds?, days, limitPerMailbox, maxTotalEmails, unreadOnly, includeEmail?)`
- `email_read(mailboxId, folder?, uid, includeEmail?)`
- `email_triage_report(days, limitPerMailbox, maxTotalEmails, save)`

All V1 tools are read-only. They do not mark messages as read, move, delete,
archive, flag, draft, or send email.

List tools return compact sanitized email items. They omit the full message body
and mask the mailbox address by default. `email_read` may return the selected
message body because the caller supplies an exact `mailboxId`, `folder`, and
`uid`.

## Tool Inputs

### `email_list_mailboxes`

```json
{
  "includeEmail": false
}
```

Returns configured mailbox metadata without passwords. Full mailbox email
addresses are omitted by default and returned only when `includeEmail` is true.

### `email_list_unread_all`

```json
{
  "limitPerMailbox": 25,
  "maxTotalEmails": 250,
  "includeEmail": false
}
```

Returns sanitized unread email summaries across all configured mailboxes.

### `email_list_recent`

```json
{
  "mailboxIds": ["info", "support"],
  "days": 3,
  "limitPerMailbox": 50,
  "maxTotalEmails": 250,
  "unreadOnly": false,
  "includeEmail": false
}
```

When `mailboxIds` is omitted, all configured mailboxes are checked. Unknown
mailbox IDs fail with a clear error.

### `email_read`

```json
{
  "mailboxId": "info",
  "folder": "INBOX",
  "uid": 12345,
  "includeEmail": false
}
```

Reads one normalized email without changing read state. `folder` is optional and
defaults to the configured mailbox folder.

### `email_triage_report`

```json
{
  "days": 3,
  "limitPerMailbox": 50,
  "maxTotalEmails": 250,
  "save": true
}
```

Fetches unread and recent emails, dedupes by `mailboxId + folder + uid`,
classifies each item, and returns a grouped triage report. When `save` is true,
the tool saves Markdown and JSON reports and returns Markdown. When `save` is
false, it returns report-safe JSON.

## Report Files

Triage reports are saved under `MAIL_REPORTS_DIR`, resolved relative to this MCP
folder when the value is relative. The default is `../../reports`, which writes
to the repository-level `reports/` directory.

Each saved run writes:

```text
reports/email-triage-YYYY-MM-DD-HH-mm-ss.md
reports/email-triage-YYYY-MM-DD-HH-mm-ss.json
reports/latest.md
reports/latest.json
```

Reports exclude full message bodies, full mailbox email addresses, passwords,
host/port credential config, and TLS config. Markdown tables include:

```text
Mailbox | Score | Reason | Category | From | Subject | Received | Importance | Needs Reply | Summary | Next Step | Source
```

## Legacy Tools

These legacy tools remain available temporarily as fallback while V1 is verified:

- `email_list_unread(profile?, limit)`
- `email_digest_today(profile?, limit)`
- `email_digest_today_save(profile?, limit)`

They use the legacy `business` / `private` profile config.

## Setup

1. Create `mcps/ionos-inbox/.env` manually.
2. Fill in local mailbox credentials. Do not commit `.env`.
3. Install dependencies with `npm install`.
4. Start the server with `npm start`.

Use this sanitized V1 multi-mailbox shape:

```env
MAILBOXES=info,support,private
MAIL_MAILBOX=INBOX
MAIL_MAX_BODY_CHARS=4000
MAIL_TLS_REJECT_UNAUTHORIZED=true
MAIL_REPORTS_DIR=../../reports

MAILBOX_INFO_LABEL=Infinisimo Info
MAILBOX_INFO_TYPE=company
MAILBOX_INFO_EMAIL=info@example.com
MAILBOX_INFO_PASSWORD=<info-password>
MAILBOX_INFO_IMAP_HOST=imap.example.com
MAILBOX_INFO_IMAP_PORT=993
MAILBOX_INFO_IMAP_SECURE=true
MAILBOX_INFO_FOLDER=INBOX
```

Legacy profile variables may remain for fallback tools:

```env
MAIL_DEFAULT_PROFILE=private
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

## Safety

- Opens mailboxes in read-only mode.
- Does not mark mail as read.
- Does not send, draft, move, delete, archive, or flag messages.
- Does not expose passwords or app passwords in tool output.
- Masks mailbox email addresses by default.
- Does not implement reply drafting or sending in V1.

## Codex Config

Add a block like this to `~/.codex/config.toml`:

```toml
[mcp_servers.ionos_inbox]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/mcps/ionos-inbox/server.mjs"]
enabled = true
startup_timeout_sec = 60
```

Update both the `command` and `args` paths to match your local Node installation
and repository location. Restart or reload the MCP server after code changes so
new tool registrations are picked up.
