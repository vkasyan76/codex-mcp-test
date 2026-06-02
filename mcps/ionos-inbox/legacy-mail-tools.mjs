import fs from "node:fs/promises";
import path from "node:path";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import {
  buildImapClientOptions,
  resolveMailboxProfile,
} from "./mailbox-config.mjs";

// Legacy helpers for the pre-V1 unread and same-day digest tools.
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
  const haystack = `${email.subject || ""} ${email.body || ""}`.toLowerCase();

  if (/\b(urgent|asap|immediately|refund|chargeback|failed|error|broken|cannot|can't)\b/.test(haystack)) {
    return "high";
  }
  if (/\b(help|issue|problem|question|billing|invoice)\b/.test(haystack)) {
    return "medium";
  }
  return "normal";
}

function classifyEmail(email) {
  const from = (email.from || "").toLowerCase();
  const haystack = `${email.subject || ""} ${email.body || ""}`.toLowerCase();

  if (
    from.includes("noreply@ionos.de") ||
    from.includes("noreply-dmarc-support@google.com") ||
    /\b(dmarc|spam report|spambericht|report-id)\b/.test(haystack)
  ) {
    return "spam_report";
  }

  if (/\b(invoice|billing|payment|charge|refund|subscription)\b/.test(haystack)) {
    return "billing";
  }

  if (/\b(error|bug|broken|failed|exception|not working)\b/.test(haystack)) {
    return "bug";
  }

  if (/\b(provider|partnership|listing|onboarding|vendor)\b/.test(haystack)) {
    return "provider_inquiry";
  }

  if (/\b(help|support|booking|reservation|cancel)\b/.test(haystack)) {
    return "support";
  }

  return "general";
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

function formatTimestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

export function buildTodayDigest(emails, now = new Date()) {
  const todaysEmails = emails.filter((email) => isSameLocalDay(email.date, now));

  if (!todaysEmails.length) {
    return null;
  }

  const lines = [];
  lines.push(`Unread emails today: ${todaysEmails.length}`);
  lines.push("");

  for (const email of todaysEmails) {
    const summary = summarizeBody(email.body);
    const urgency = urgencyHint(email);
    lines.push(
      `- [${urgency}] [${email.category}] ${email.from} | ${email.subject} | ${summary}`
    );
  }

  return lines.join("\n");
}

async function getUniqueReportPath(baseDir, baseName) {
  let attempt = 0;

  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = path.join(baseDir, `${baseName}${suffix}.md`);

    try {
      await fs.access(candidate);
      attempt += 1;
    } catch {
      return candidate;
    }
  }
}

export async function saveDigestReport(digestText, limit, mailboxProfile, reportsDir) {
  const generatedAt = new Date();
  const timestamp = formatTimestampForFile(generatedAt);

  await fs.mkdir(reportsDir, { recursive: true });

  const reportPath = await getUniqueReportPath(reportsDir, `inbox-digest-${timestamp}`);
  const reportBody = [
    "# IONOS Inbox Digest",
    "",
    `- Generated at: ${generatedAt.toISOString()}`,
    `- Profile: ${mailboxProfile.profile}`,
    `- Mailbox: ${mailboxProfile.email}`,
    "- Tool: email_digest_today_save",
    `- Limit: ${limit}`,
    "",
    digestText,
    "",
  ].join("\n");

  await fs.writeFile(reportPath, reportBody, "utf8");
  return reportPath;
}

export async function withMailbox(
  mailboxProfile,
  callback,
  { ImapFlowClass = ImapFlow } = {}
) {
  const client = new ImapFlowClass(buildImapClientOptions(mailboxProfile));

  try {
    await client.connect();
    await client.mailboxOpen(mailboxProfile.mailbox, { readOnly: true });
    return await callback(client, mailboxProfile);
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function fetchUnreadMessages(
  limit,
  mailboxProfile,
  { ImapFlowClass = ImapFlow } = {}
) {
  return withMailbox(
    mailboxProfile,
    async (client, activeMailbox) => {
      const unreadUids = (await client.search({ seen: false }, { uid: true }))
        .sort((a, b) => a - b);
      const selectedUids = unreadUids.slice(-limit).reverse();
      const emails = [];

      if (!selectedUids.length) {
        return emails;
      }

      for await (const message of client.fetch(selectedUids, {
        envelope: true,
        source: true,
      }, { uid: true })) {
        const parsed = await parseMessage(message.source, activeMailbox.maxBodyChars);
        const category = classifyEmail(parsed);
        emails.push({
          uid: message.uid,
          from: parsed.from,
          subject: parsed.subject,
          date: parsed.date || message.envelope?.date?.toISOString() || null,
          preview: parsed.preview,
          body: parsed.body,
          hasAttachments: parsed.hasAttachments,
          attachments: parsed.attachments,
          category,
          profile: activeMailbox.profile,
          mailbox: activeMailbox.email,
        });
      }

      emails.sort((a, b) => {
        const aDate = a.date ? Date.parse(a.date) : 0;
        const bDate = b.date ? Date.parse(b.date) : 0;
        return bDate - aDate;
      });

      return emails;
    },
    { ImapFlowClass }
  );
}

export function createLegacyMailTools({
  config,
  reportsDir,
  now = () => new Date(),
  fetchUnreadMessages: fetchUnread = fetchUnreadMessages,
  saveDigestReport: saveDigest = saveDigestReport,
} = {}) {
  function resolveProfile(profile) {
    return resolveMailboxProfile(config, profile);
  }

  async function listUnread({ profile, limit } = {}) {
    return fetchUnread(limit, resolveProfile(profile));
  }

  async function digestToday({ profile, limit } = {}) {
    const emails = await listUnread({ profile, limit });
    return buildTodayDigest(emails, now());
  }

  async function saveDigestToday({ profile, limit } = {}) {
    const mailboxProfile = resolveProfile(profile);
    const emails = await fetchUnread(limit, mailboxProfile);
    const digestText = buildTodayDigest(emails, now());

    if (!digestText) {
      return { digestText: null, reportPath: null };
    }

    const reportPath = await saveDigest(digestText, limit, mailboxProfile, reportsDir);
    return { digestText, reportPath };
  }

  return {
    listUnread,
    digestToday,
    saveDigestToday,
  };
}
