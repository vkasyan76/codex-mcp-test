import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const LimitSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
});

const ENV_SCHEMA = z.object({
  IONOS_EMAIL: z.string().min(1),
  IONOS_PASSWORD: z.string().min(1),
  IONOS_IMAP_HOST: z.string().min(1).default("imap.ionos.com"),
  IONOS_IMAP_PORT: z.coerce.number().int().positive().default(993),
  IONOS_IMAP_SECURE: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  IONOS_MAILBOX: z.string().min(1).default("INBOX"),
  IONOS_MAX_BODY_CHARS: z.coerce.number().int().positive().default(4000),
});

function loadConfig() {
  return ENV_SCHEMA.parse(process.env);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(html) {
  return normalizeWhitespace(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
  );
}

function trimToLength(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatAddressList(addressList) {
  if (!addressList?.value?.length) {
    return "Unknown sender";
  }

  return addressList.value
    .map((entry) => {
      if (entry.name && entry.address) {
        return `${entry.name} <${entry.address}>`;
      }
      return entry.address || entry.name || "Unknown sender";
    })
    .join(", ");
}

async function parseMessage(raw, maxBodyChars) {
  const parsed = await simpleParser(raw);
  const textSource = parsed.text || stripHtml(parsed.html || "");
  const text = trimToLength(normalizeWhitespace(textSource || ""), maxBodyChars);

  return {
    from: formatAddressList(parsed.from),
    subject: normalizeWhitespace(parsed.subject || "(no subject)"),
    date: parsed.date ? parsed.date.toISOString() : null,
    preview: trimToLength(text, 240),
    body: text,
    hasAttachments: Boolean(parsed.attachments?.length),
    attachments:
      parsed.attachments?.map((attachment) => attachment.filename).filter(Boolean) || [],
  };
}

function summarizeBody(body) {
  if (!body) {
    return "No readable body text.";
  }

  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return trimToLength((sentences[0] || body).trim(), 220);
}

function urgencyHint(email) {
  const haystack = `${email.subject} ${email.body}`.toLowerCase();

  if (/\b(urgent|asap|immediately|refund|chargeback|failed|error|broken|cannot|can't)\b/.test(haystack)) {
    return "high";
  }
  if (/\b(help|issue|problem|question|billing|invoice)\b/.test(haystack)) {
    return "medium";
  }
  return "normal";
}

function isSameLocalDay(dateValue, now = new Date()) {
  if (!dateValue) {
    return false;
  }

  const date = new Date(dateValue);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

async function withMailbox(callback) {
  const config = loadConfig();
  const client = new ImapFlow({
    host: config.IONOS_IMAP_HOST,
    port: config.IONOS_IMAP_PORT,
    secure: config.IONOS_IMAP_SECURE,
    auth: {
      user: config.IONOS_EMAIL,
      pass: config.IONOS_PASSWORD,
    },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen(config.IONOS_MAILBOX, { readOnly: true });
    return await callback(client, config);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function fetchUnreadMessages(limit) {
  return withMailbox(async (client, config) => {
    const sequenceNumbers = [];

    for await (const message of client.fetch("1:*", { uid: true, flags: true })) {
      if (!message.flags?.has("\\Seen")) {
        sequenceNumbers.push(message.uid);
      }
    }

    const selectedUids = sequenceNumbers.slice(-limit).reverse();
    const emails = [];

    if (!selectedUids.length) {
      return emails;
    }

    for await (const message of client.fetch(selectedUids, {
      uid: true,
      envelope: true,
      source: true,
    })) {
      const parsed = await parseMessage(message.source, config.IONOS_MAX_BODY_CHARS);
      emails.push({
        uid: message.uid,
        from: parsed.from,
        subject: parsed.subject,
        date: parsed.date || message.envelope?.date?.toISOString() || null,
        preview: parsed.preview,
        body: parsed.body,
        hasAttachments: parsed.hasAttachments,
        attachments: parsed.attachments,
      });
    }

    emails.sort((a, b) => {
      const aDate = a.date ? Date.parse(a.date) : 0;
      const bDate = b.date ? Date.parse(b.date) : 0;
      return bDate - aDate;
    });

    return emails;
  });
}

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: value,
      },
    ],
  };
}

const server = new McpServer({
  name: "ionos-inbox",
  version: "0.1.0",
});

server.tool(
  "email_list_unread",
  "List unread emails from the configured IONOS inbox without modifying mailbox state.",
  {
    limit: z.number().int().min(1).max(50).default(10),
  },
  async (input) => {
    const { limit } = LimitSchema.parse(input);
    const emails = await fetchUnreadMessages(limit);

    if (!emails.length) {
      return textResult("No unread emails found.");
    }

    const payload = emails.map((email) => ({
      uid: email.uid,
      date: email.date,
      from: email.from,
      subject: email.subject,
      preview: email.preview,
      hasAttachments: email.hasAttachments,
      attachments: email.attachments,
    }));

    return textResult(JSON.stringify(payload, null, 2));
  }
);

server.tool(
  "email_digest_today",
  "Summarize unread emails from today in the configured IONOS inbox.",
  {
    limit: z.number().int().min(1).max(50).default(20),
  },
  async (input) => {
    const { limit } = LimitSchema.extend({
      limit: z.number().int().min(1).max(50).default(20),
    }).parse(input);
    const emails = await fetchUnreadMessages(limit);
    const todaysEmails = emails.filter((email) => isSameLocalDay(email.date));

    if (!todaysEmails.length) {
      return textResult("No unread emails from today.");
    }

    const lines = [];
    lines.push(`Unread emails today: ${todaysEmails.length}`);
    lines.push("");

    for (const email of todaysEmails) {
      const summary = summarizeBody(email.body);
      const urgency = urgencyHint(email);
      lines.push(
        `- [${urgency}] ${email.from} | ${email.subject} | ${summary}`
      );
    }

    return textResult(lines.join("\n"));
  }
);

const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error) {
  console.error("IONOS inbox MCP failed to start.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
