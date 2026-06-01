import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReportJson,
  buildReportMarkdown,
  saveReport,
  sourceReference,
} from "../report-writer.mjs";

const GENERATED_AT = new Date("2026-05-31T10:00:00.000Z");

const BASE_EMAIL = {
  mailboxId: "info",
  mailboxLabel: "Info",
  mailboxType: "company",
  mailboxEmail: "mailbox-secret@example.com",
  folder: "INBOX",
  uid: 123,
  messageId: "<abc@example.com>",
  from: "Alice <alice@example.com>",
  to: ["recipient-secret@example.com"],
  cc: ["copy-secret@example.com"],
  subject: "Invoice",
  receivedAt: "2026-05-31T10:00:00.000Z",
  isUnread: true,
  preview: "Preview",
  body: "full body secret should not appear",
  hasAttachments: true,
  attachments: ["invoice.pdf"],
  password: "password-secret",
  host: "imap.secret.example",
  port: 993,
  tlsRejectUnauthorized: false,
};

function item(overrides = {}) {
  const email = { ...BASE_EMAIL, ...(overrides.email || {}) };
  return {
    email,
    category: overrides.category || "billing_invoice",
    importance: overrides.importance || "medium",
    needsReply: overrides.needsReply ?? false,
    hasDeadline: overrides.hasDeadline ?? false,
    deadline: overrides.deadline ?? null,
    summary: overrides.summary || "Invoice received.",
    nextStep: overrides.nextStep || "Check amount.",
    confidence: overrides.confidence || "high",
    classifier: overrides.classifier || "heuristic",
    attentionScore: overrides.attentionScore ?? 55,
    attentionReason: overrides.attentionReason || "Invoice/billing keyword",
  };
}

function buildSampleResults() {
  return [
    item({
      category: "appointment_booking",
      importance: "medium",
      needsReply: true,
      attentionScore: 72,
      attentionReason: "Needs reply phrase",
      summary: "Appointment requires confirmation.",
      nextStep: "Confirm the appointment.",
      email: {
        uid: 201,
        subject: "Appointment confirmation",
        receivedAt: "2026-05-31T08:00:00.000Z",
      },
    }),
    item({
      category: "account_security",
      importance: "high",
      attentionScore: 94,
      attentionReason: "Security alert",
      summary: "Security alert received.",
      nextStep: "Verify account activity.",
      email: {
        uid: 202,
        subject: "Security alert",
        receivedAt: "2026-05-31T09:00:00.000Z",
        hasAttachments: false,
        attachments: [],
      },
    }),
    item({
      category: "newsletter_fyi",
      importance: "low",
      attentionScore: 7,
      attentionReason: "Newsletter/unsubscribe marker",
      summary: "Weekly newsletter.",
      nextStep: "No action required.",
      email: {
        uid: 203,
        subject: "Weekly newsletter",
        receivedAt: null,
        hasAttachments: false,
        attachments: [],
      },
    }),
    item({
      category: "spam_suspicious",
      importance: "high",
      attentionScore: 78,
      attentionReason: "Suspicious/phishing signal",
      summary: "Suspicious link blocked.",
      nextStep: "Do not click links.",
      email: {
        uid: 204,
        subject: "Suspicious link",
        receivedAt: "2026-05-31T07:00:00.000Z",
        hasAttachments: false,
        attachments: [],
      },
    }),
  ];
}

function section(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}`);
  assert.notEqual(start, -1);
  const next = markdown.indexOf("\n## ", start + 1);
  return next === -1 ? markdown.slice(start) : markdown.slice(start, next);
}

test("builds source references", () => {
  assert.equal(
    sourceReference(BASE_EMAIL),
    "mailboxId=info folder=INBOX uid=123 messageId=<abc@example.com>"
  );
});

test("builds markdown title summary and attention columns", () => {
  const markdown = buildReportMarkdown({
    generatedAt: GENERATED_AT,
    mailboxesChecked: 2,
    results: buildSampleResults(),
  });

  assert.match(markdown, /# Email Triage Report - 2026-05-31T10:00:00.000Z/);
  assert.match(markdown, /- Mailboxes checked: 2/);
  assert.match(markdown, /- Emails checked: 4/);
  assert.match(markdown, /- Top attention: 3/);
  assert.match(markdown, /- Needs reply: 1/);
  assert.match(markdown, /- High\/Critical: 2/);
  assert.match(markdown, /- Billing\/Invoices: 0/);
  assert.match(markdown, /- Security\/Account: 1/);
  assert.match(markdown, /- Newsletter\/Noise: 1/);
  assert.match(markdown, /- Suspicious\/Fraud: 1/);
  assert.match(markdown, /\| Mailbox \| Score \| Reason \| Category \| From \| Subject \| Received \| Importance \| Needs Reply \| Summary \| Next Step \| Source \|/);
});

test("derives top attention section from attention score and importance", () => {
  const markdown = buildReportMarkdown({
    generatedAt: GENERATED_AT,
    mailboxesChecked: 1,
    results: buildSampleResults(),
  });
  const top = section(markdown, "Top Attention / Time-sensitive");

  assert.match(top, /Appointment requires confirmation/);
  assert.match(top, /Security alert received/);
  assert.match(top, /Suspicious link blocked/);
  assert.doesNotMatch(top, /Weekly newsletter/);
});

test("sorts sections by attention score then received date with missing dates last", () => {
  const results = [
    item({
      attentionScore: 40,
      summary: "Lower score newer date.",
      email: { uid: 301, subject: "Invoice lower", receivedAt: "2026-05-31T12:00:00.000Z" },
    }),
    item({
      attentionScore: 80,
      summary: "Higher score older date.",
      email: { uid: 302, subject: "Invoice higher", receivedAt: "2026-05-30T12:00:00.000Z" },
    }),
    item({
      attentionScore: 80,
      summary: "Higher score missing date.",
      email: { uid: 303, subject: "Invoice missing date", receivedAt: null },
    }),
    item({
      attentionScore: 80,
      summary: "Higher score newer date.",
      email: { uid: 304, subject: "Invoice newer", receivedAt: "2026-05-31T13:00:00.000Z" },
    }),
  ];
  const markdown = buildReportMarkdown({ generatedAt: GENERATED_AT, mailboxesChecked: 1, results });
  const billing = section(markdown, "Billing / Invoices");

  assert.equal(
    billing.indexOf("Higher score newer date.") < billing.indexOf("Higher score older date."),
    true
  );
  assert.equal(
    billing.indexOf("Higher score older date.") < billing.indexOf("Higher score missing date."),
    true
  );
  assert.equal(
    billing.indexOf("Higher score missing date.") < billing.indexOf("Lower score newer date."),
    true
  );
});

test("builds json preserving report-safe source and triage metadata", () => {
  const report = buildReportJson({
    generatedAt: GENERATED_AT,
    mailboxesChecked: 1,
    results: [item({ hasDeadline: true, deadline: "2026-06-01" })],
  });

  assert.equal(report.generatedAt, "2026-05-31T10:00:00.000Z");
  assert.equal(report.mailboxesChecked, 1);
  assert.equal(report.totals.items, 1);
  assert.equal(report.items[0].category, "billing_invoice");
  assert.equal(report.items[0].classifier, "heuristic");
  assert.equal(report.items[0].hasDeadline, true);
  assert.equal(report.items[0].deadline, "2026-06-01");
  assert.equal(report.items[0].isUnread, true);
  assert.equal(report.items[0].hasAttachments, true);
  assert.deepEqual(report.items[0].attachments, ["invoice.pdf"]);
  assert.deepEqual(report.items[0].source, {
    mailboxId: "info",
    mailboxLabel: "Info",
    folder: "INBOX",
    uid: 123,
    messageId: "<abc@example.com>",
    from: "Alice <alice@example.com>",
    subject: "Invoice",
    receivedAt: "2026-05-31T10:00:00.000Z",
  });
});

test("escapes markdown pipes and newlines in table cells", () => {
  const markdown = buildReportMarkdown({
    generatedAt: GENERATED_AT,
    mailboxesChecked: 1,
    results: [
      item({
        summary: "Line one\nLine two",
        nextStep: "Check A | B",
        email: {
          mailboxLabel: "Info | Sales",
          subject: "Invoice | May\nFollow-up",
        },
      }),
    ],
  });

  assert.match(markdown, /Info \\| Sales/);
  assert.match(markdown, /Invoice \\| May Follow-up/);
  assert.match(markdown, /Line one Line two/);
  assert.match(markdown, /Check A \\| B/);
});

test("reports exclude mailbox body and credential-bearing config fields", () => {
  const results = [item()];
  const markdown = buildReportMarkdown({ generatedAt: GENERATED_AT, mailboxesChecked: 1, results });
  const jsonText = JSON.stringify(buildReportJson({ generatedAt: GENERATED_AT, mailboxesChecked: 1, results }));
  const combined = `${markdown}\n${jsonText}`;

  for (const forbidden of [
    "mailbox-secret@example.com",
    "full body secret should not appear",
    "recipient-secret@example.com",
    "copy-secret@example.com",
    "password-secret",
    "imap.secret.example",
    "tlsRejectUnauthorized",
  ]) {
    assert.equal(combined.includes(forbidden), false);
  }
});

test("saves timestamped markdown and json reports plus latest files", async () => {
  const reportsDir = await fs.mkdtemp(path.join(os.tmpdir(), "email-triage-report-"));
  const saved = await saveReport({
    reportsDir,
    generatedAt: GENERATED_AT,
    mailboxesChecked: 1,
    results: [item()],
  });

  assert.equal(path.basename(saved.markdownPath), "email-triage-2026-05-31-10-00-00.md");
  assert.equal(path.basename(saved.jsonPath), "email-triage-2026-05-31-10-00-00.json");
  assert.equal(path.basename(saved.latestMarkdownPath), "latest.md");
  assert.equal(path.basename(saved.latestJsonPath), "latest.json");

  await fs.stat(saved.markdownPath);
  await fs.stat(saved.jsonPath);
  await fs.stat(saved.latestMarkdownPath);
  await fs.stat(saved.latestJsonPath);

  assert.equal(await fs.readFile(saved.latestMarkdownPath, "utf8"), saved.markdown);
  assert.deepEqual(JSON.parse(await fs.readFile(saved.latestJsonPath, "utf8")), saved.json);
});
