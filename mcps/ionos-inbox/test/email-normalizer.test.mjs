import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAddressArray,
  formatAddressList,
  normalizeRawMessage,
  normalizeWhitespace,
  resolveMessageDate,
  resolveMessageFlags,
  resolveMessageFolder,
  stripHtml,
  trimToLength,
} from "../email-normalizer.mjs";

const BASE_MAILBOX = {
  id: "info",
  label: "Info",
  type: "company",
  email: "info@example.com",
  password: "password",
  host: "imap.example.com",
  port: 993,
  secure: true,
  folder: "INBOX",
  mailbox: "Legacy",
  maxBodyChars: 4000,
  tlsRejectUnauthorized: true,
};

function mime(lines) {
  return Buffer.from(lines.join("\r\n"));
}

test("normalizes whitespace", () => {
  assert.equal(normalizeWhitespace(" A\n\tB   C "), "A B C");
});

test("strips simple html and common entities", () => {
  assert.equal(
    stripHtml("<style>.x{}</style><script>x()</script><p>Hello&nbsp;<b>world</b> &amp; &#39;team&#39;</p>"),
    "Hello world & 'team'"
  );
});

test("trims text defensively", () => {
  assert.equal(trimToLength("abcdef", 5), "ab...");
  assert.equal(trimToLength("abcdef", 3), "...");
  assert.equal(trimToLength("abcdef", 0), "");
  assert.equal(trimToLength("abcdef", undefined), "");
});

test("formats sender address lists with fallback", () => {
  const value = {
    value: [
      { name: "Alice", address: "alice@example.com" },
      { address: "bob@example.com" },
    ],
  };

  assert.equal(formatAddressList(value), "Alice <alice@example.com>, bob@example.com");
  assert.equal(formatAddressList(undefined), "Unknown sender");
});

test("formats recipient arrays without sender fallback text", () => {
  const value = {
    value: [
      { name: "Alice", address: "alice@example.com" },
      { name: "Team" },
    ],
  };

  assert.deepEqual(formatAddressArray(value), ["alice@example.com", "Team"]);
  assert.deepEqual(formatAddressArray(undefined), []);
});

test("resolves message flags from arrays and sets", () => {
  assert.deepEqual(resolveMessageFlags({ flags: ["\\Seen"] }), ["\\Seen"]);
  assert.deepEqual(resolveMessageFlags({ flags: new Set(["\\Seen"]) }), ["\\Seen"]);
  assert.deepEqual(resolveMessageFlags({}), []);
});

test("resolves dates from parsed message first, then envelope", () => {
  const parsedDate = new Date("2026-05-31T10:00:00.000Z");
  const envelopeDate = new Date("2026-05-30T10:00:00.000Z");

  assert.equal(
    resolveMessageDate({ date: parsedDate }, { envelope: { date: envelopeDate } }),
    "2026-05-31T10:00:00.000Z"
  );
  assert.equal(
    resolveMessageDate({}, { envelope: { date: envelopeDate } }),
    "2026-05-30T10:00:00.000Z"
  );
  assert.equal(resolveMessageDate({}, {}), null);
});

test("resolves message folder from resolved folder before legacy mailbox", () => {
  assert.equal(resolveMessageFolder({ folder: "Resolved", mailbox: "Legacy" }), "Resolved");
  assert.equal(resolveMessageFolder({ mailbox: "Legacy" }), "Legacy");
  assert.equal(resolveMessageFolder({}), "INBOX");
});

test("normalizes plain text messages into stable email items", async () => {
  const rawMessage = {
    uid: 123,
    flags: new Set(),
    source: mime([
      "Message-ID: <abc@example.com>",
      "From: Alice <alice@example.com>",
      "To: Bob <bob@example.com>",
      "Cc: Carol <carol@example.com>",
      "Subject: Hello world",
      "Date: Sun, 31 May 2026 10:00:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello   team.",
      "Second line.",
    ]),
  };

  const normalized = await normalizeRawMessage(rawMessage, {
    ...BASE_MAILBOX,
    folder: "Resolved",
    maxBodyChars: 20,
  });

  assert.deepEqual(normalized, {
    mailboxId: "info",
    mailboxLabel: "Info",
    mailboxType: "company",
    mailboxEmail: "info@example.com",
    folder: "Resolved",
    uid: 123,
    messageId: "<abc@example.com>",
    from: "Alice <alice@example.com>",
    to: ["bob@example.com"],
    cc: ["carol@example.com"],
    subject: "Hello world",
    receivedAt: "2026-05-31T10:00:00.000Z",
    isUnread: true,
    preview: "Hello team. Secon...",
    body: "Hello team. Secon...",
    hasAttachments: false,
    attachments: [],
  });
});

test("normalizes html fallback when text body is missing", async () => {
  const normalized = await normalizeRawMessage(
    {
      uid: 5,
      flags: [],
      source: mime([
        "Message-ID: <html@example.com>",
        "From: Web <web@example.com>",
        "Subject: HTML",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>Hello&nbsp;<strong>HTML</strong></p>",
      ]),
    },
    BASE_MAILBOX
  );

  assert.equal(normalized.body, "Hello HTML");
  assert.equal(normalized.preview, "Hello HTML");
});

test("detects read messages from seen flags", async () => {
  const normalized = await normalizeRawMessage(
    {
      uid: 7,
      flags: ["\\Seen"],
      source: mime([
        "From: Sender <sender@example.com>",
        "Subject: Read",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Read message.",
      ]),
    },
    BASE_MAILBOX
  );

  assert.equal(normalized.isUnread, false);
});

test("extracts attachment filenames only", async () => {
  const normalized = await normalizeRawMessage(
    {
      uid: 9,
      flags: [],
      source: mime([
        "From: Billing <billing@example.com>",
        "Subject: Invoice",
        "MIME-Version: 1.0",
        "Content-Type: multipart/mixed; boundary=\"boundary1\"",
        "",
        "--boundary1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Attached invoice.",
        "--boundary1",
        "Content-Type: application/pdf; name=\"invoice.pdf\"",
        "Content-Disposition: attachment; filename=\"invoice.pdf\"",
        "Content-Transfer-Encoding: base64",
        "",
        "SGVsbG8=",
        "--boundary1--",
        "",
      ]),
    },
    BASE_MAILBOX
  );

  assert.equal(normalized.hasAttachments, true);
  assert.deepEqual(normalized.attachments, ["invoice.pdf"]);
});

test("uses missing subject and envelope date fallbacks", async () => {
  const normalized = await normalizeRawMessage(
    {
      uid: 10,
      flags: [],
      envelope: { date: new Date("2026-05-30T08:00:00.000Z") },
      source: mime([
        "Message-ID: <fallback@example.com>",
        "From: Sender <sender@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Fallback message.",
      ]),
    },
    BASE_MAILBOX
  );

  assert.equal(normalized.subject, "(no subject)");
  assert.equal(normalized.receivedAt, "2026-05-30T08:00:00.000Z");
});

test("rejects raw messages without source", async () => {
  await assert.rejects(
    () => normalizeRawMessage({ uid: 1 }, BASE_MAILBOX),
    /requires rawMessage\.source/
  );
});

test("rejects raw messages without a positive integer uid", async () => {
  await assert.rejects(
    () =>
      normalizeRawMessage(
        {
          source: mime([
            "From: Sender <sender@example.com>",
            "Content-Type: text/plain; charset=utf-8",
            "",
            "Missing uid.",
          ]),
        },
        BASE_MAILBOX
      ),
    /requires a positive integer rawMessage\.uid/
  );

  await assert.rejects(
    () =>
      normalizeRawMessage(
        {
          uid: 0,
          source: mime([
            "From: Sender <sender@example.com>",
            "Content-Type: text/plain; charset=utf-8",
            "",
            "Invalid uid.",
          ]),
        },
        BASE_MAILBOX
      ),
    /requires a positive integer rawMessage\.uid/
  );
});

test("normalization defaults max body chars when mailbox config omits it", async () => {
  const normalized = await normalizeRawMessage(
    {
      uid: 11,
      flags: [],
      source: mime([
        "From: Sender <sender@example.com>",
        "Subject: Default body limit",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Body text.",
      ]),
    },
    {
      ...BASE_MAILBOX,
      maxBodyChars: undefined,
    }
  );

  assert.equal(normalized.body, "Body text.");
});

test("normalized output preserves source fields and excludes internal config", async () => {
  const normalized = await normalizeRawMessage(
    {
      uid: 12,
      flags: [],
      source: mime([
        "Message-ID: <source@example.com>",
        "From: Source <source@example.com>",
        "Subject: Source fields",
        "Date: Sun, 31 May 2026 10:00:00 +0000",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Source message.",
      ]),
    },
    BASE_MAILBOX
  );

  for (const key of ["mailboxId", "folder", "uid", "messageId", "from", "subject", "receivedAt"]) {
    assert.equal(key in normalized, true);
  }

  assert.equal("password" in normalized, false);
  assert.equal("host" in normalized, false);
  assert.equal("port" in normalized, false);
  assert.equal("secure" in normalized, false);
  assert.equal("tlsRejectUnauthorized" in normalized, false);
});
