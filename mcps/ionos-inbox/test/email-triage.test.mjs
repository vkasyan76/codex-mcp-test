import assert from "node:assert/strict";
import test from "node:test";

import {
  EMAIL_CATEGORIES,
  classifyEmail,
  groupTriageResults,
  summarizeBody,
} from "../email-triage.mjs";

const BASE_EMAIL = {
  mailboxId: "info",
  mailboxLabel: "Info",
  mailboxType: "company",
  mailboxEmail: "info@example.com",
  folder: "INBOX",
  uid: 1,
  messageId: "<m@example.com>",
  from: "Sender <sender@example.com>",
  to: ["info@example.com"],
  cc: [],
  subject: "Hello",
  receivedAt: "2026-05-31T10:00:00.000Z",
  isUnread: true,
  preview: "Hello",
  body: "Hello",
  hasAttachments: false,
  attachments: [],
};

function classify(overrides) {
  return classifyEmail({ ...BASE_EMAIL, ...overrides });
}

test("categories do not include urgent", () => {
  assert.equal(EMAIL_CATEGORIES.includes("urgent"), false);
});

test("classifies invoices as billing with medium attention", () => {
  const result = classify({
    subject: "Invoice for May",
    body: "Please find your invoice attached.",
  });

  assert.equal(result.category, "billing_invoice");
  assert.equal(result.importance, "medium");
  assert.equal(result.needsReply, false);
  assert.equal(result.classifier, "heuristic");
  assert.equal(result.confidence, "high");
  assert.equal(result.attentionScore >= 40, true);
  assert.equal(result.attentionScore <= 69, true);
  assert.match(result.attentionReason, /invoice|billing/i);
});

test("classifies security and login messages as account security", () => {
  const result = classify({
    subject: "Security alert: new login attempt",
    body: "A new login attempt was detected on your account.",
  });

  assert.equal(result.category, "account_security");
  assert.equal(result.importance, "high");
  assert.equal(result.attentionScore >= 90, true);
  assert.match(result.attentionReason, /security/i);
});

test("classifies real 2fa code messages as account security", () => {
  const result = classify({
    subject: "Your 2FA code",
    body: "Your 2FA code is 123456. Do not share this verification code.",
  });

  assert.equal(result.category, "account_security");
  assert.equal(result.importance, "high");
  assert.equal(result.attentionScore >= 90, true);
});

test("security alerts with tracking links remain account security", () => {
  const result = classify({
    subject: "Security alert: password reset requested",
    body: "A password reset was requested. Review this security alert. https://example.com/track?u=%252Fapi%252Fv1%2FA",
  });

  assert.equal(result.category, "account_security");
  assert.equal(result.importance, "high");
  assert.equal(result.attentionScore >= 90, true);
});

test("encoded newsletter links do not trigger account security", () => {
  const result = classify({
    from: "tennis.de <news@mail.tennis.de>",
    subject: "Das sind die neuen Deutschen Meister der Junior:innen",
    body: "tennis.de Newsletter. Lesen Sie die aktuellen Sportergebnisse. Tracking link https://public-eur.mkt.dynamics.com/api/v1.0/orgs/250d515e?u=%252Fapi%252Fv1%2FA%2FA. Unsubscribe here.",
  });

  assert.equal(result.category, "newsletter_fyi");
  assert.equal(result.importance, "low");
  assert.equal(result.needsReply, false);
  assert.equal(result.attentionScore <= 9, true);
  assert.notEqual(result.category, "account_security");
  assert.doesNotMatch(result.attentionReason, /security/i);
});

test("classifies newsletters as low-attention newsletter fyi", () => {
  const result = classify({
    from: "Newsletter <news@example.com>",
    subject: "Weekly newsletter",
    body: "This weekly digest has travel updates. Unsubscribe here.",
  });

  assert.equal(result.category, "newsletter_fyi");
  assert.equal(result.importance, "low");
  assert.equal(result.needsReply, false);
  assert.equal(result.confidence, "high");
  assert.equal(result.attentionScore >= 0, true);
  assert.equal(result.attentionScore <= 9, true);
});

test("classifies no-reply automated messages as automated noise with low cap", () => {
  const result = classify({
    from: "noreply@example.com",
    subject: "Delivery status notification",
    body: "This is an automated message from a no-reply mailbox.",
  });

  assert.equal(result.category, "automated_noise");
  assert.equal(result.importance, "low");
  assert.equal(result.attentionScore <= 15, true);
});

test("classifies dmarc no-reply support reports as automated noise", () => {
  const result = classify({
    from: "noreply-dmarc-support@google.com",
    subject: "DMARC report for example.com",
    body: "This is an automated DMARC aggregate report about mail authentication results.",
  });

  assert.equal(result.category, "automated_noise");
  assert.equal(result.importance, "low");
  assert.equal(result.attentionScore <= 15, true);
  assert.notEqual(result.category, "customer_support");
  assert.match(result.attentionReason, /dmarc|delivery|technical/i);
});

test("classifies phishing and fraud messages as suspicious", () => {
  const result = classify({
    subject: "Suspicious phishing link blocked",
    body: "A fraud attempt with malware was blocked.",
  });

  assert.equal(result.category, "spam_suspicious");
  assert.equal(result.importance, "high");
  assert.equal(result.attentionScore >= 70, true);
});

test("classifies support problem emails as customer support", () => {
  const result = classify({
    subject: "Booking problem",
    body: "The customer has a problem with the reservation and can you help?",
  });

  assert.equal(result.category, "customer_support");
  assert.equal(result.needsReply, true);
  assert.equal(result.attentionScore >= 40, true);
});

test("classifies appointment and Termin emails as appointment booking", () => {
  const result = classify({
    subject: "Termin bestätigen",
    body: "Bitte bestätigen Sie den Termin für morgen.",
  });

  assert.equal(result.category, "appointment_booking");
  assert.equal(result.needsReply, true);
});

test("classifies legal tax and notary emails as legal admin", () => {
  const result = classify({
    subject: "Tax and notary documents",
    body: "Please review the legal contract and tax registration.",
  });

  assert.equal(result.category, "legal_admin");
  assert.equal(result.importance, "medium");
});

test("classifies private unknown emails as private personal with low cap", () => {
  const result = classify({
    mailboxType: "private",
    subject: "Hello",
    body: "Just checking in.",
  });

  assert.equal(result.category, "private_personal");
  assert.equal(result.attentionScore <= 39, true);
});

test("keeps weak unknown emails unknown with low cap", () => {
  const result = classify({
    subject: "Hello",
    body: "Just a short note.",
  });

  assert.equal(result.category, "unknown");
  assert.equal(result.confidence, "low");
  assert.equal(result.attentionScore <= 39, true);
});

test("classifies waiting no action emails with low cap", () => {
  const result = classify({
    subject: "FYI status update",
    body: "For your information only. No action required.",
  });

  assert.equal(result.category, "waiting_no_action");
  assert.equal(result.needsReply, false);
  assert.equal(result.attentionScore <= 25, true);
});

test("needsReply is independent from category", () => {
  const result = classify({
    subject: "Invoice for May",
    body: "Please confirm that you received this invoice.",
  });

  assert.equal(result.category, "billing_invoice");
  assert.equal(result.needsReply, true);
});

test("needsReply lifts actionable categories to high attention", () => {
  const cases = [
    [
      "billing_invoice",
      classify({
        subject: "Invoice for May",
        body: "Please confirm that you received this invoice.",
      }),
    ],
    [
      "appointment_booking",
      classify({
        subject: "Meeting appointment",
        body: "Please confirm tomorrow's appointment.",
      }),
    ],
    [
      "legal_admin",
      classify({
        subject: "Tax contract",
        body: "Please reply about the legal contract.",
      }),
    ],
    [
      "business_opportunity",
      classify({
        subject: "Partnership opportunity",
        body: "Can you respond about this collaboration?",
      }),
    ],
  ];

  for (const [category, result] of cases) {
    assert.equal(result.category, category);
    assert.equal(result.needsReply, true);
    assert.equal(result.attentionScore >= 70, true);
  }
});

test("needsReply wording does not lift noise categories", () => {
  const newsletter = classify({
    subject: "Weekly newsletter",
    body: "Please reply to marketing preferences. Unsubscribe here.",
  });
  const automated = classify({
    from: "noreply@example.com",
    subject: "Delivery status notification",
    body: "Automated message. Please reply is footer text only.",
  });

  assert.equal(newsletter.category, "newsletter_fyi");
  assert.equal(newsletter.needsReply, false);
  assert.equal(newsletter.attentionScore <= 9, true);
  assert.equal(automated.category, "automated_noise");
  assert.equal(automated.needsReply, false);
  assert.equal(automated.attentionScore <= 15, true);
});

test("high importance is derived without urgent category", () => {
  const result = classify({
    subject: "Action required",
    body: "Payment failed. Please update billing today.",
  });

  assert.equal(result.category, "billing_invoice");
  assert.equal(result.importance, "high");
  assert.notEqual(result.category, "urgent");
});

test("urgency event signals do not set deadline metadata without deadline language", () => {
  const security = classify({
    subject: "Security alert",
    body: "New login attempt detected.",
  });
  const failedPayment = classify({
    subject: "Payment failed",
    body: "Payment failed for your account.",
  });

  assert.equal(security.category, "account_security");
  assert.equal(security.importance, "high");
  assert.equal(security.hasDeadline, false);
  assert.equal(security.deadline, null);
  assert.equal(failedPayment.category, "billing_invoice");
  assert.equal(failedPayment.importance, "high");
  assert.equal(failedPayment.hasDeadline, false);
  assert.equal(failedPayment.deadline, null);
});

test("promotional urgency does not become high importance", () => {
  const result = classify({
    subject: "Today only sale",
    body: "Limited offer. Sale ends today. Unsubscribe here.",
  });

  assert.equal(result.category, "newsletter_fyi");
  assert.equal(result.importance, "low");
  assert.equal(result.attentionScore <= 9, true);
});

test("payment failure overrides unsubscribe footer noise", () => {
  const result = classify({
    from: "Stripe <no-reply@stripe.com>",
    subject: "Payment failed",
    body: "Action required: payment failed for your account. Manage preferences or unsubscribe.",
  });

  assert.equal(result.category, "billing_invoice");
  assert.equal(result.importance, "high");
  assert.equal(result.attentionScore >= 80, true);
});

test("security alert overrides manage-preferences footer noise", () => {
  const result = classify({
    from: "Security <security@example.com>",
    subject: "Security alert",
    body: "Security alert: password reset requested. Manage preferences in your account footer.",
  });

  assert.equal(result.category, "account_security");
  assert.equal(result.importance, "high");
  assert.equal(result.attentionScore >= 90, true);
});

test("important transactional emails score higher than promotional noise", () => {
  const important = classify({
    subject: "Payment failed",
    body: "Action required: payment failed. Unsubscribe from account notices.",
  });
  const noise = classify({
    subject: "Today only sale",
    body: "Marketing digest. Limited offer. Unsubscribe here.",
  });

  assert.equal(important.attentionScore > noise.attentionScore, true);
});

test("includes classifier confidence and attention metadata", () => {
  const result = classify({
    subject: "Security alert",
    body: "New login attempt detected.",
  });

  assert.equal(result.classifier, "heuristic");
  assert.equal(typeof result.confidence, "string");
  assert.equal(typeof result.attentionScore, "number");
  assert.equal(typeof result.attentionReason, "string");
});

test("summarizes first sentence", () => {
  assert.equal(summarizeBody("First sentence. Second sentence."), "First sentence.");
});

test("groups triage results by category", () => {
  const grouped = groupTriageResults([
    classify({ subject: "Invoice", body: "Invoice attached." }),
    classify({ subject: "Security alert", body: "New login attempt detected." }),
  ]);

  assert.equal(grouped.billing_invoice.length, 1);
  assert.equal(grouped.account_security.length, 1);
});
