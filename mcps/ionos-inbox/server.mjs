import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  loadConfigFromEnv,
  PROFILE_SCHEMA,
  resolveReportsDir,
} from "./mailbox-config.mjs";
import { createLegacyMailTools } from "./legacy-mail-tools.mjs";
import { createRuntimeMailTools } from "./mail-tools.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load mailbox credentials and runtime options from the local MCP folder.
dotenv.config({ path: path.join(__dirname, ".env") });

function loadConfig() {
  return loadConfigFromEnv(process.env);
}

// MCP responses are returned as plain text payloads for now.
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
const mailTools = createRuntimeMailTools({ mcpDir: __dirname });

function createLegacyTools() {
  const config = loadConfig();
  return createLegacyMailTools({
    config,
    reportsDir: resolveReportsDir(config, __dirname),
  });
}

// Tool: unread email listing with previews and lightweight classification.
server.tool(
  "email_list_unread",
  "List unread emails from the configured IONOS inbox without modifying mailbox state.",
  {
    profile: PROFILE_SCHEMA.optional(),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async (input) => {
    const emails = await createLegacyTools().listUnread(input);

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
      category: email.category,
    }));

    return textResult(JSON.stringify(payload, null, 2));
  }
);

// Tool: same-day digest built from unread emails only.
server.tool(
  "email_digest_today",
  "Summarize unread emails from today in the configured IONOS inbox.",
  {
    profile: PROFILE_SCHEMA.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  },
  async (input) => {
    const digestText = await createLegacyTools().digestToday(input);

    if (!digestText) {
      return textResult("No unread emails from today.");
    }

    return textResult(digestText);
  }
);

// Tool: same-day digest plus a timestamped markdown report saved under reports/.
server.tool(
  "email_digest_today_save",
  "Summarize unread emails from today and save the digest to a timestamped markdown report.",
  {
    profile: PROFILE_SCHEMA.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  },
  async (input) => {
    const { digestText, reportPath } = await createLegacyTools().saveDigestToday(input);

    if (!digestText) {
      return textResult("No unread emails from today.");
    }

    return textResult(`Saved digest to ${reportPath}\n\n${digestText}`);
  }
);

server.tool(
  "email_list_mailboxes",
  "List configured mailboxes without exposing passwords or full email addresses by default.",
  {
    includeEmail: z.boolean().default(false),
  },
  async (input) => {
    const mailboxes = await mailTools.listMailboxes(input);
    return textResult(JSON.stringify(mailboxes, null, 2));
  }
);

server.tool(
  "email_list_unread_all",
  "List unread emails from all configured mailboxes without modifying mailbox state.",
  {
    limitPerMailbox: z.number().int().min(1).max(100).default(25),
    maxTotalEmails: z.number().int().min(1).max(500).default(250),
    includeEmail: z.boolean().default(false),
  },
  async (input) => {
    const emails = await mailTools.listUnreadAll(input);
    return textResult(JSON.stringify(emails, null, 2));
  }
);

server.tool(
  "email_list_recent",
  "List recent emails by mailbox and date range without modifying mailbox state.",
  {
    mailboxIds: z.array(z.string()).optional(),
    days: z.number().int().min(1).max(30).default(3),
    limitPerMailbox: z.number().int().min(1).max(100).default(50),
    maxTotalEmails: z.number().int().min(1).max(500).default(250),
    unreadOnly: z.boolean().default(false),
    includeEmail: z.boolean().default(false),
  },
  async (input) => {
    const emails = await mailTools.listRecent(input);
    return textResult(JSON.stringify(emails, null, 2));
  }
);

server.tool(
  "email_read",
  "Read one full normalized email by mailbox id, folder, and uid without modifying mailbox state.",
  {
    mailboxId: z.string().min(1),
    folder: z.string().min(1).optional(),
    uid: z.number().int().positive(),
    includeEmail: z.boolean().default(false),
  },
  async (input) => {
    const email = await mailTools.readEmail(input);
    return textResult(email ? JSON.stringify(email, null, 2) : "Email not found.");
  }
);

server.tool(
  "email_triage_report",
  "Create a grouped read-only triage report for unread and recent emails.",
  {
    days: z.number().int().min(1).max(30).default(3),
    limitPerMailbox: z.number().int().min(1).max(100).default(50),
    maxTotalEmails: z.number().int().min(1).max(500).default(250),
    save: z.boolean().default(true),
  },
  async (input) => {
    const report = await mailTools.triageReport(input);
    return textResult(report.saved ? report.markdown : JSON.stringify(report.json, null, 2));
  }
);

const transport = new StdioServerTransport();

// Start the MCP server on stdio so Codex can connect to it as a local tool.
try {
  await server.connect(transport);
} catch (error) {
  console.error("IONOS inbox MCP failed to start.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
