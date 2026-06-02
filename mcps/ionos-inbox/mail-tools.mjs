import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyEmail as defaultClassifyEmail } from "./email-triage.mjs";
import { normalizeRawMessage as defaultNormalizeRawMessage } from "./email-normalizer.mjs";
import {
  listRecentRawMessages,
  listUnreadRawMessages,
  readRawMessageByUid,
} from "./imap-reader.mjs";
import {
  loadConfigFromEnv,
  maskEmail as maskConfiguredEmail,
  resolveConfiguredMailboxes,
  resolveReportsDir,
  toSafeMailboxMetadata,
} from "./mailbox-config.mjs";
import {
  buildReportJson as defaultBuildReportJson,
  saveReport as defaultSaveReport,
} from "./report-writer.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_READERS = {
  listUnreadRawMessages,
  listRecentRawMessages,
  readRawMessageByUid,
};

export function buildSinceDate(days, now = new Date()) {
  const since = new Date(now);
  since.setDate(since.getDate() - days);
  return since;
}

export function dedupeEmailsBySource(emails) {
  const seen = new Set();
  return emails.filter((email) => {
    const key = `${email.mailboxId}:${email.folder}:${email.uid}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function applyMaxTotalEmails(emails, maxTotalEmails) {
  if (!Number.isInteger(maxTotalEmails) || maxTotalEmails <= 0) {
    return [...emails];
  }
  return emails.slice(0, maxTotalEmails);
}

export function maskEmail(email) {
  return maskConfiguredEmail(email);
}

function receivedTime(email) {
  const parsed = Date.parse(email.receivedAt || "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function sortEmailsNewestFirst(emails) {
  return [...emails].sort((a, b) => receivedTime(b) - receivedTime(a));
}

function assertPositiveUid(uid) {
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("readEmail requires a positive integer uid");
  }
}

export function sanitizeEmailForToolOutput(
  email,
  { includeEmail = false, includeBody = false } = {}
) {
  const sanitized = {
    mailboxId: email.mailboxId,
    mailboxLabel: email.mailboxLabel,
    mailboxType: email.mailboxType,
    maskedMailboxEmail: email.maskedMailboxEmail || maskEmail(email.mailboxEmail),
    folder: email.folder,
    uid: email.uid,
    messageId: email.messageId,
    from: email.from,
    subject: email.subject,
    receivedAt: email.receivedAt,
    isUnread: Boolean(email.isUnread),
    preview: email.preview,
    hasAttachments: Boolean(email.hasAttachments),
    attachments: Array.isArray(email.attachments) ? email.attachments : [],
  };

  if (includeBody) {
    sanitized.body = email.body || "";
  }

  if (includeEmail) {
    sanitized.mailboxEmail = email.mailboxEmail;
  }

  return sanitized;
}

function loadMailContext(env) {
  const config = loadConfigFromEnv(env);
  const mailboxes = resolveConfiguredMailboxes(config, env);
  return { config, mailboxes };
}

function mailboxMapById(mailboxes) {
  return new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
}

function selectMailboxes(mailboxes, mailboxIds) {
  if (!mailboxIds?.length) {
    return mailboxes;
  }

  const byId = mailboxMapById(mailboxes);
  return mailboxIds.map((id) => {
    const mailbox = byId.get(id);
    if (!mailbox) {
      throw new Error(`Unknown mailbox id: ${id}`);
    }
    return mailbox;
  });
}

async function normalizeMessages(rawMessages, mailbox, normalizeRawMessage) {
  const normalized = [];
  for (const rawMessage of rawMessages) {
    normalized.push(await normalizeRawMessage(rawMessage, mailbox));
  }
  return normalized;
}

export function createMailTools({
  env = process.env,
  now = () => new Date(),
  mcpDir = __dirname,
  readers = DEFAULT_READERS,
  normalizeRawMessage = defaultNormalizeRawMessage,
  classifyEmail = defaultClassifyEmail,
  saveReport = defaultSaveReport,
  buildReportJson = defaultBuildReportJson,
} = {}) {
  async function listMailboxes({ includeEmail = false } = {}) {
    const { config, mailboxes } = loadMailContext(env);
    return mailboxes.map((mailbox) =>
      toSafeMailboxMetadata(mailbox, { includeEmail, config })
    );
  }

  async function listUnreadAll({
    limitPerMailbox = 25,
    maxTotalEmails = 250,
    includeEmail = false,
  } = {}) {
    const { mailboxes } = loadMailContext(env);
    const emails = [];

    for (const mailbox of mailboxes) {
      const rawMessages = await readers.listUnreadRawMessages(mailbox, {
        folder: mailbox.folder,
        limit: limitPerMailbox,
      });
      emails.push(...(await normalizeMessages(rawMessages, mailbox, normalizeRawMessage)));
    }

    return applyMaxTotalEmails(sortEmailsNewestFirst(emails), maxTotalEmails).map((email) =>
      sanitizeEmailForToolOutput(email, { includeEmail, includeBody: false })
    );
  }

  async function listRecent({
    mailboxIds,
    days = 3,
    limitPerMailbox = 50,
    maxTotalEmails = 250,
    unreadOnly = false,
    includeEmail = false,
  } = {}) {
    const { mailboxes } = loadMailContext(env);
    const selectedMailboxes = selectMailboxes(mailboxes, mailboxIds);
    const since = buildSinceDate(days, now());
    const emails = [];

    for (const mailbox of selectedMailboxes) {
      const rawMessages = await readers.listRecentRawMessages(mailbox, {
        folder: mailbox.folder,
        since,
        limit: limitPerMailbox,
        unreadOnly,
      });
      emails.push(...(await normalizeMessages(rawMessages, mailbox, normalizeRawMessage)));
    }

    return applyMaxTotalEmails(sortEmailsNewestFirst(emails), maxTotalEmails).map((email) =>
      sanitizeEmailForToolOutput(email, { includeEmail, includeBody: false })
    );
  }

  async function readEmail({ mailboxId, folder, uid, includeEmail = false } = {}) {
    assertPositiveUid(uid);
    const { mailboxes } = loadMailContext(env);
    const [mailbox] = selectMailboxes(mailboxes, [mailboxId]);
    const rawMessage = await readers.readRawMessageByUid(mailbox, { folder, uid });

    if (!rawMessage) {
      return null;
    }

    const normalized = await normalizeRawMessage(rawMessage, {
      ...mailbox,
      folder: folder || mailbox.folder,
    });
    return sanitizeEmailForToolOutput(normalized, { includeEmail, includeBody: true });
  }

  async function triageReport({
    days = 3,
    limitPerMailbox = 50,
    maxTotalEmails = 250,
    save = true,
  } = {}) {
    const { config, mailboxes } = loadMailContext(env);
    const since = buildSinceDate(days, now());
    const unread = [];
    const recent = [];

    for (const mailbox of mailboxes) {
      const unreadRaw = await readers.listUnreadRawMessages(mailbox, {
        folder: mailbox.folder,
        limit: limitPerMailbox,
      });
      unread.push(...(await normalizeMessages(unreadRaw, mailbox, normalizeRawMessage)));

      const recentRaw = await readers.listRecentRawMessages(mailbox, {
        folder: mailbox.folder,
        since,
        limit: limitPerMailbox,
        unreadOnly: false,
      });
      recent.push(...(await normalizeMessages(recentRaw, mailbox, normalizeRawMessage)));
    }

    const emails = applyMaxTotalEmails(
      sortEmailsNewestFirst(dedupeEmailsBySource([...unread, ...recent])),
      maxTotalEmails
    );
    const results = emails.map((email) => classifyEmail(email, {}));

    if (!save) {
      return {
        saved: null,
        resultCount: results.length,
        json: buildReportJson({
          generatedAt: now(),
          mailboxesChecked: mailboxes.length,
          results,
        }),
      };
    }

    const saved = await saveReport({
      reportsDir: resolveReportsDir(config, mcpDir),
      generatedAt: now(),
      mailboxesChecked: mailboxes.length,
      results,
    });

    return {
      saved,
      resultCount: results.length,
      markdown: saved.markdown,
      json: saved.json,
    };
  }

  return {
    listMailboxes,
    listUnreadAll,
    listRecent,
    readEmail,
    triageReport,
  };
}

export function createRuntimeMailTools({ mcpDir = __dirname } = {}) {
  return createMailTools({ mcpDir });
}
