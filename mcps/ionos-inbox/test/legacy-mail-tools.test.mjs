import assert from "node:assert/strict";
import test from "node:test";

import { createLegacyMailTools } from "../legacy-mail-tools.mjs";

const BASE_CONFIG = {
  MAIL_DEFAULT_PROFILE: "business",
  MAIL_MAILBOX: "INBOX",
  MAIL_MAX_BODY_CHARS: 4000,
  MAIL_TLS_REJECT_UNAUTHORIZED: true,
  MAIL_REPORTS_DIR: "../../reports",
  MAIL_EMAIL_BUSINESS: "info@example.com",
  MAIL_PASSWORD_BUSINESS: "business-password",
  MAIL_IMAP_HOST_BUSINESS: "imap.example.com",
  MAIL_IMAP_PORT_BUSINESS: 993,
  MAIL_IMAP_SECURE_BUSINESS: true,
  MAIL_EMAIL_PRIVATE: "private@example.com",
  MAIL_PASSWORD_PRIVATE: "private-password",
  MAIL_IMAP_HOST_PRIVATE: "imap.private.example.com",
  MAIL_IMAP_PORT_PRIVATE: 993,
  MAIL_IMAP_SECURE_PRIVATE: true,
};

function legacyEmail(overrides = {}) {
  return {
    uid: 1,
    from: "Alice <alice@example.com>",
    subject: "Need help",
    date: "2026-06-02T08:00:00.000Z",
    preview: "Please help.",
    body: "Please help.",
    hasAttachments: false,
    attachments: [],
    category: "support",
    profile: "business",
    mailbox: "info@example.com",
    ...overrides,
  };
}

test("legacy unread helper resolves profile and delegates unread fetching", async () => {
  const calls = [];
  const tools = createLegacyMailTools({
    config: BASE_CONFIG,
    reportsDir: "reports",
    fetchUnreadMessages: async (limit, mailboxProfile) => {
      calls.push({ limit, mailboxProfile });
      return [legacyEmail({ uid: 10, profile: mailboxProfile.profile })];
    },
  });

  const emails = await tools.listUnread({ profile: "private", limit: 3 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 3);
  assert.equal(calls[0].mailboxProfile.profile, "private");
  assert.equal(calls[0].mailboxProfile.email, "private@example.com");
  assert.equal(emails[0].uid, 10);
  assert.equal(emails[0].profile, "private");
});

test("legacy digest helper returns null when no unread email is from today", async () => {
  const tools = createLegacyMailTools({
    config: BASE_CONFIG,
    reportsDir: "reports",
    now: () => new Date("2026-06-02T12:00:00.000Z"),
    fetchUnreadMessages: async () => [
      legacyEmail({ date: "2026-06-01T08:00:00.000Z" }),
    ],
  });

  assert.equal(await tools.digestToday({ limit: 5 }), null);
});

test("legacy save digest helper uses the provided reports directory", async () => {
  const calls = [];
  const tools = createLegacyMailTools({
    config: BASE_CONFIG,
    reportsDir: "custom-reports",
    now: () => new Date("2026-06-02T12:00:00.000Z"),
    fetchUnreadMessages: async () => [
      legacyEmail({ date: "2026-06-02T08:00:00.000Z" }),
    ],
    saveDigestReport: async (digestText, limit, mailboxProfile, reportsDir) => {
      calls.push({ digestText, limit, mailboxProfile, reportsDir });
      return "custom-reports/inbox-digest.md";
    },
  });

  const saved = await tools.saveDigestToday({ profile: "business", limit: 7 });

  assert.equal(saved.reportPath, "custom-reports/inbox-digest.md");
  assert.match(saved.digestText, /Unread emails today: 1/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 7);
  assert.equal(calls[0].mailboxProfile.profile, "business");
  assert.equal(calls[0].reportsDir, "custom-reports");
});
