import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMaxTotalEmails,
  buildSinceDate,
  createMailTools,
  dedupeEmailsBySource,
  maskEmail,
  sanitizeEmailForToolOutput,
} from "../mail-tools.mjs";

const BASE_ENV = {
  MAIL_MAILBOX: "INBOX",
  MAIL_MAX_BODY_CHARS: "4000",
  MAIL_TLS_REJECT_UNAUTHORIZED: "true",
  MAIL_REPORTS_DIR: "../../reports",
  MAILBOXES: "info,support",
  MAILBOX_INFO_LABEL: "Info",
  MAILBOX_INFO_TYPE: "company",
  MAILBOX_INFO_EMAIL: "info@example.com",
  MAILBOX_INFO_PASSWORD: "info-password",
  MAILBOX_INFO_IMAP_HOST: "imap.example.com",
  MAILBOX_INFO_IMAP_PORT: "993",
  MAILBOX_INFO_IMAP_SECURE: "true",
  MAILBOX_INFO_FOLDER: "INBOX",
  MAILBOX_SUPPORT_LABEL: "Support",
  MAILBOX_SUPPORT_TYPE: "support",
  MAILBOX_SUPPORT_EMAIL: "support@example.com",
  MAILBOX_SUPPORT_PASSWORD: "support-password",
  MAILBOX_SUPPORT_IMAP_HOST: "imap.example.com",
  MAILBOX_SUPPORT_IMAP_PORT: "993",
  MAILBOX_SUPPORT_IMAP_SECURE: "true",
  MAILBOX_SUPPORT_FOLDER: "INBOX",
};

function email(overrides = {}) {
  return {
    mailboxId: "info",
    mailboxLabel: "Info",
    mailboxType: "company",
    mailboxEmail: "info@example.com",
    maskedMailboxEmail: "i***@example.com",
    folder: "INBOX",
    uid: 1,
    messageId: "<m1@example.com>",
    from: "Alice <alice@example.com>",
    to: ["secret-to@example.com"],
    cc: ["secret-cc@example.com"],
    subject: "Invoice",
    receivedAt: "2026-05-31T10:00:00.000Z",
    isUnread: true,
    preview: "Invoice preview",
    body: "Full selected body",
    hasAttachments: false,
    attachments: [],
    password: "password-secret",
    host: "imap.secret.example",
    port: 993,
    secure: true,
    tlsRejectUnauthorized: true,
    ...overrides,
  };
}

function raw(uid) {
  return { uid, source: Buffer.from(`Subject: Test ${uid}\n\nBody ${uid}`) };
}

function createTools(overrides = {}) {
  const calls = {
    unread: [],
    recent: [],
    read: [],
    classified: [],
    saved: [],
  };
  const rawToEmail = new Map();
  const readers = {
    listUnreadRawMessages: async (mailbox, options) => {
      calls.unread.push({ mailbox, options });
      return overrides.unreadRaw?.[mailbox.id] || [];
    },
    listRecentRawMessages: async (mailbox, options) => {
      calls.recent.push({ mailbox, options });
      return overrides.recentRaw?.[mailbox.id] || [];
    },
    readRawMessageByUid: async (mailbox, options) => {
      calls.read.push({ mailbox, options });
      return overrides.readRaw || null;
    },
  };
  const normalizeRawMessage = async (rawMessage, mailbox) => {
    if (rawToEmail.has(rawMessage.uid)) {
      return { ...rawToEmail.get(rawMessage.uid), mailboxId: mailbox.id, mailboxLabel: mailbox.label };
    }
    return email({
      mailboxId: mailbox.id,
      mailboxLabel: mailbox.label,
      mailboxType: mailbox.type,
      mailboxEmail: mailbox.email,
      folder: mailbox.folder,
      uid: rawMessage.uid,
      messageId: `<m${rawMessage.uid}@example.com>`,
      subject: `Message ${rawMessage.uid}`,
      receivedAt: `2026-05-31T10:0${rawMessage.uid}:00.000Z`,
      body: `Body ${rawMessage.uid}`,
    });
  };

  for (const value of overrides.normalizedEmails || []) {
    rawToEmail.set(value.uid, value);
  }

  const tools = createMailTools({
    env: overrides.env || BASE_ENV,
    now: () => new Date("2026-05-31T12:00:00.000Z"),
    mcpDir: "C:\\repo\\mcps\\ionos-inbox",
    readers,
    normalizeRawMessage,
    classifyEmail: (item) => {
      calls.classified.push(item);
      return {
        email: item,
        category: item.subject.includes("Security") ? "account_security" : "billing_invoice",
        importance: item.subject.includes("Security") ? "high" : "medium",
        needsReply: false,
        hasDeadline: false,
        deadline: null,
        summary: item.preview,
        nextStep: "Review.",
        confidence: "high",
        classifier: "heuristic",
        attentionScore: item.subject.includes("Security") ? 94 : 55,
        attentionReason: "Test classifier",
      };
    },
    saveReport: async (input) => {
      calls.saved.push(input);
      return {
        markdownPath: "report.md",
        jsonPath: "report.json",
        latestMarkdownPath: "latest.md",
        latestJsonPath: "latest.json",
        markdown: "# Saved report\n\nNo items.",
        json: { items: input.results },
      };
    },
    buildReportJson: ({ generatedAt, mailboxesChecked, results }) => ({
      generatedAt: generatedAt.toISOString(),
      mailboxesChecked,
      totals: { items: results.length },
      items: results.map((result) => ({
        category: result.category,
        source: {
          mailboxId: result.email.mailboxId,
          folder: result.email.folder,
          uid: result.email.uid,
        },
      })),
    }),
  });

  return { tools, calls };
}

test("builds since date from day count", () => {
  const since = buildSinceDate(3, new Date("2026-05-31T12:00:00.000Z"));
  assert.equal(since.toISOString(), "2026-05-28T12:00:00.000Z");
});

test("dedupes emails by mailbox folder and uid", () => {
  const emails = [
    { mailboxId: "info", folder: "INBOX", uid: 1 },
    { mailboxId: "info", folder: "INBOX", uid: 1 },
    { mailboxId: "support", folder: "INBOX", uid: 1 },
  ];

  assert.deepEqual(dedupeEmailsBySource(emails), [emails[0], emails[2]]);
});

test("applies max total email cap", () => {
  assert.deepEqual(applyMaxTotalEmails([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(applyMaxTotalEmails([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(applyMaxTotalEmails([1, 2, 3], 0), [1, 2, 3]);
});

test("masks email addresses", () => {
  assert.equal(maskEmail("info@example.com"), "i***@example.com");
  assert.equal(maskEmail(""), "");
  assert.equal(maskEmail("not-an-email"), "");
});

test("sanitized list output excludes full mailbox email and body by default", () => {
  const sanitized = sanitizeEmailForToolOutput(email(), { includeBody: false });

  assert.equal(sanitized.maskedMailboxEmail, "i***@example.com");
  assert.equal("mailboxEmail" in sanitized, false);
  assert.equal("body" in sanitized, false);
  assert.equal("to" in sanitized, false);
  assert.equal("cc" in sanitized, false);
  assert.equal("password" in sanitized, false);
  assert.equal("host" in sanitized, false);
  assert.equal("tlsRejectUnauthorized" in sanitized, false);
});

test("sanitized output includes mailbox email only when explicitly requested", () => {
  const sanitized = sanitizeEmailForToolOutput(email(), { includeEmail: true, includeBody: true });

  assert.equal(sanitized.mailboxEmail, "info@example.com");
  assert.equal(sanitized.body, "Full selected body");
});

test("lists configured mailboxes with masked email by default", async () => {
  const { tools } = createTools();
  const mailboxes = await tools.listMailboxes({});

  assert.deepEqual(
    mailboxes.map((mailbox) => ({
      id: mailbox.id,
      maskedEmail: mailbox.maskedEmail,
      hasEmail: "email" in mailbox,
    })),
    [
      { id: "info", maskedEmail: "i***@example.com", hasEmail: false },
      { id: "support", maskedEmail: "s***@example.com", hasEmail: false },
    ]
  );
});

test("list unread sanitizes output and respects per-mailbox and global limits", async () => {
  const { tools, calls } = createTools({
    unreadRaw: {
      info: [raw(1), raw(2)],
      support: [raw(3), raw(4)],
    },
  });

  const emails = await tools.listUnreadAll({ limitPerMailbox: 2, maxTotalEmails: 3 });

  assert.equal(calls.unread.length, 2);
  assert.equal(calls.unread[0].options.limit, 2);
  assert.equal(emails.length, 3);
  assert.equal("body" in emails[0], false);
  assert.equal("mailboxEmail" in emails[0], false);
  assert.equal(emails[0].maskedMailboxEmail.endsWith("@example.com"), true);
});

test("list recent supports selected mailbox ids and rejects unknown ids", async () => {
  const { tools, calls } = createTools({
    recentRaw: {
      support: [raw(5)],
    },
  });

  const emails = await tools.listRecent({
    mailboxIds: ["support"],
    days: 3,
    limitPerMailbox: 1,
    maxTotalEmails: 10,
    unreadOnly: true,
  });

  assert.equal(emails.length, 1);
  assert.equal(calls.recent.length, 1);
  assert.equal(calls.recent[0].mailbox.id, "support");
  assert.equal(calls.recent[0].options.unreadOnly, true);
  assert.equal(calls.recent[0].options.since.toISOString(), "2026-05-28T12:00:00.000Z");
  await assert.rejects(
    () => tools.listRecent({ mailboxIds: ["missing"] }),
    /Unknown mailbox id: missing/
  );
});

test("readEmail validates uid early and returns body for selected email", async () => {
  const { tools, calls } = createTools({ readRaw: raw(9) });

  await assert.rejects(
    () => tools.readEmail({ mailboxId: "info" }),
    /readEmail requires a positive integer uid/
  );
  await assert.rejects(
    () => tools.readEmail({ mailboxId: "info", uid: 0 }),
    /readEmail requires a positive integer uid/
  );

  const selected = await tools.readEmail({ mailboxId: "info", folder: "Archive", uid: 9 });

  assert.equal(calls.read.length, 1);
  assert.deepEqual(calls.read[0].options, { folder: "Archive", uid: 9 });
  assert.equal(selected.body, "Body 9");
  assert.equal("mailboxEmail" in selected, false);
});

test("triage combines unread and recent, dedupes before cap, then classifies", async () => {
  const { tools, calls } = createTools({
    unreadRaw: { info: [raw(1), raw(2)] },
    recentRaw: { info: [raw(2), raw(3)] },
    normalizedEmails: [
      email({ uid: 1, subject: "Invoice old", receivedAt: "2026-05-31T08:00:00.000Z" }),
      email({ uid: 2, subject: "Security newer", receivedAt: "2026-05-31T11:00:00.000Z" }),
      email({ uid: 3, subject: "Invoice newest", receivedAt: "2026-05-31T12:00:00.000Z" }),
    ],
  });

  const report = await tools.triageReport({
    days: 3,
    limitPerMailbox: 2,
    maxTotalEmails: 2,
    save: true,
  });

  assert.equal(calls.classified.length, 2);
  assert.deepEqual(calls.classified.map((item) => item.uid), [3, 2]);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].results.length, 2);
  assert.match(report.markdown, /Saved report/);
  assert.equal(report.resultCount, 2);
  assert.equal("results" in report, false);
});

test("triage returns report-safe json when save is false", async () => {
  const { tools } = createTools({
    unreadRaw: { info: [raw(1)] },
  });

  const report = await tools.triageReport({ save: false });

  assert.equal(report.saved, null);
  assert.equal(report.json.totals.items, 1);
  assert.equal("email" in report.json.items[0], false);
  assert.equal(report.resultCount, 1);
  assert.equal("results" in report, false);
});

test("triage handles empty unread and recent results", async () => {
  const { tools, calls } = createTools();
  const report = await tools.triageReport({ save: true });

  assert.equal(report.resultCount, 0);
  assert.equal("results" in report, false);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].results.length, 0);
  assert.match(report.markdown, /No items/);
});
