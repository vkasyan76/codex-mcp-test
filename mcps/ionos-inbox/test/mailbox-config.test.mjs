import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImapClientOptions,
  loadConfigFromEnv,
  resolveConfiguredMailbox,
  resolveConfiguredMailboxes,
  resolveMailboxProfile,
  toSafeMailboxMetadata,
} from "../mailbox-config.mjs";

const BASE_ENV = {
  MAIL_DEFAULT_PROFILE: "business",
  MAIL_MAILBOX: "INBOX",
  MAIL_MAX_BODY_CHARS: "4000",
  MAIL_EMAIL_BUSINESS: "info@example.com",
  MAIL_PASSWORD_BUSINESS: "business-password",
  MAIL_IMAP_HOST_BUSINESS: "imap.example.com",
  MAIL_IMAP_PORT_BUSINESS: "993",
  MAIL_IMAP_SECURE_BUSINESS: "true",
  MAIL_EMAIL_PRIVATE: "private@example.com",
  MAIL_PASSWORD_PRIVATE: "private-password",
  MAIL_IMAP_HOST_PRIVATE: "imap.private.example.com",
  MAIL_IMAP_PORT_PRIVATE: "993",
  MAIL_IMAP_SECURE_PRIVATE: "true",
};

const MULTI_MAILBOX_ENV = {
  ...BASE_ENV,
  MAILBOXES: "info,support",
  MAILBOX_INFO_LABEL: "Infinisimo Info",
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
  MAILBOX_SUPPORT_FOLDER: "Support",
};

test("mailbox profiles default to strict TLS certificate verification", () => {
  const config = loadConfigFromEnv(BASE_ENV);
  const mailboxProfile = resolveMailboxProfile(config, "business");
  const options = buildImapClientOptions(mailboxProfile);

  assert.equal(mailboxProfile.tlsRejectUnauthorized, true);
  assert.deepEqual(options.tls, { rejectUnauthorized: true });
});

test("mailbox profiles can disable TLS certificate verification explicitly", () => {
  const config = loadConfigFromEnv({
    ...BASE_ENV,
    MAIL_TLS_REJECT_UNAUTHORIZED: "false",
  });
  const mailboxProfile = resolveMailboxProfile(config, "business");
  const options = buildImapClientOptions(mailboxProfile);

  assert.equal(mailboxProfile.tlsRejectUnauthorized, false);
  assert.deepEqual(options.tls, { rejectUnauthorized: false });
});

test("loads configured mailboxes from an explicit env object", () => {
  const env = { ...MULTI_MAILBOX_ENV };
  const config = loadConfigFromEnv(env);
  const mailboxes = resolveConfiguredMailboxes(config, env);

  assert.equal(mailboxes.length, 2);
  assert.deepEqual(
    mailboxes.map((mailbox) => [
      mailbox.id,
      mailbox.label,
      mailbox.email,
      mailbox.type,
      mailbox.folder,
    ]),
    [
      ["info", "Infinisimo Info", "info@example.com", "company", "INBOX"],
      ["support", "Support", "support@example.com", "support", "Support"],
    ]
  );
});

test("loads one configured mailbox by id", () => {
  const env = { ...MULTI_MAILBOX_ENV, MAILBOXES: "info" };
  const config = loadConfigFromEnv(env);
  const mailbox = resolveConfiguredMailbox(config, "info", env);

  assert.equal(mailbox.id, "info");
  assert.equal(mailbox.profile, "info");
  assert.equal(mailbox.email, "info@example.com");
  assert.equal(mailbox.host, "imap.example.com");
  assert.equal(mailbox.port, 993);
  assert.equal(mailbox.secure, true);
  assert.equal(mailbox.tlsRejectUnauthorized, true);
});

test("configured mailboxes use the default folder when no folder is configured", () => {
  const env = { ...MULTI_MAILBOX_ENV, MAILBOXES: "info" };
  delete env.MAILBOX_INFO_FOLDER;
  const config = loadConfigFromEnv(env);
  const mailbox = resolveConfiguredMailbox(config, "info", env);

  assert.equal(mailbox.folder, "INBOX");
  assert.equal(mailbox.mailbox, "INBOX");
});

test("configured mailboxes default to other type", () => {
  const env = { ...MULTI_MAILBOX_ENV, MAILBOXES: "info" };
  delete env.MAILBOX_INFO_TYPE;
  const config = loadConfigFromEnv(env);
  const mailbox = resolveConfiguredMailbox(config, "info", env);

  assert.equal(mailbox.type, "other");
});

test("configured mailboxes inherit TLS reject unauthorized behavior", () => {
  const env = {
    ...MULTI_MAILBOX_ENV,
    MAILBOXES: "info",
    MAIL_TLS_REJECT_UNAUTHORIZED: "false",
  };
  const config = loadConfigFromEnv(env);
  const mailbox = resolveConfiguredMailbox(config, "info", env);
  const options = buildImapClientOptions(mailbox);

  assert.equal(mailbox.tlsRejectUnauthorized, false);
  assert.deepEqual(options.tls, { rejectUnauthorized: false });
});

test("mail report directory defaults and can be overridden", () => {
  assert.equal(loadConfigFromEnv(BASE_ENV).MAIL_REPORTS_DIR, "../../reports");
  assert.equal(
    loadConfigFromEnv({
      ...BASE_ENV,
      MAIL_REPORTS_DIR: "../custom-reports",
    }).MAIL_REPORTS_DIR,
    "../custom-reports"
  );
});

test("configured mailbox missing required fields throws a clear error", () => {
  const env = { ...MULTI_MAILBOX_ENV, MAILBOXES: "info" };
  delete env.MAILBOX_INFO_PASSWORD;
  const config = loadConfigFromEnv(env);

  assert.throws(
    () => resolveConfiguredMailbox(config, "info", env),
    /Mailbox info is missing EMAIL, PASSWORD, or IMAP_HOST/
  );
});

test("configured mailbox tests do not depend on real process env", () => {
  const previousMailboxes = process.env.MAILBOXES;
  process.env.MAILBOXES = "real-local-mailbox";

  try {
    const env = { ...MULTI_MAILBOX_ENV, MAILBOXES: "info" };
    const config = loadConfigFromEnv(env);
    const mailboxes = resolveConfiguredMailboxes(config, env);

    assert.deepEqual(mailboxes.map((mailbox) => mailbox.id), ["info"]);
  } finally {
    if (previousMailboxes === undefined) {
      delete process.env.MAILBOXES;
    } else {
      process.env.MAILBOXES = previousMailboxes;
    }
  }
});

test("safe mailbox metadata does not expose credentials by default", () => {
  const env = { ...MULTI_MAILBOX_ENV, MAILBOXES: "info" };
  const config = loadConfigFromEnv(env);
  const mailbox = resolveConfiguredMailbox(config, "info", env);
  const metadata = toSafeMailboxMetadata(mailbox);

  assert.equal("password" in metadata, false);
  assert.equal("email" in metadata, false);
  assert.equal(metadata.maskedEmail, "i***@example.com");
});

test("safe mailbox metadata can include email only when explicitly requested", () => {
  const env = { ...MULTI_MAILBOX_ENV, MAILBOXES: "info" };
  const config = loadConfigFromEnv(env);
  const mailbox = resolveConfiguredMailbox(config, "info", env);
  const metadata = toSafeMailboxMetadata(mailbox, { includeEmail: true });

  assert.equal(metadata.email, "info@example.com");
  assert.equal("password" in metadata, false);
});
