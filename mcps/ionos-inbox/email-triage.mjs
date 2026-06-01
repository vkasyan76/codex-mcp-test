import { trimToLength } from "./email-normalizer.mjs";

export const EMAIL_CATEGORIES = [
  "billing_invoice",
  "customer_support",
  "account_security",
  "business_opportunity",
  "legal_admin",
  "appointment_booking",
  "waiting_no_action",
  "newsletter_fyi",
  "automated_noise",
  "spam_suspicious",
  "private_personal",
  "unknown",
];

export const EMAIL_IMPORTANCE = ["critical", "high", "medium", "low"];
export const TRIAGE_CONFIDENCE = ["high", "medium", "low"];

const ACTIONABLE_NEEDS_REPLY_CATEGORIES = new Set([
  "billing_invoice",
  "customer_support",
  "account_security",
  "business_opportunity",
  "legal_admin",
  "appointment_booking",
]);

export function summarizeBody(body) {
  if (!body) {
    return "No readable body text.";
  }

  const sentences = String(body)
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return trimToLength((sentences[0] || body).trim(), 220);
}

function includesPattern(value, pattern) {
  return pattern.test(value);
}

function buildHaystack(email) {
  return [
    email.from,
    email.subject,
    email.body || email.preview,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasNeedsReplySignal(haystack) {
  return includesPattern(
    haystack,
    /\b(please reply|please respond|can you|could you|please confirm|let me know|antworten|bitte bestätigen|rückmeldung)\b/i
  );
}

function hasDeadlineSignal(haystack) {
  return includesPattern(
    haystack,
    /\b(action required|requires action|deadline|due date|frist|mahnung)\b/i
  );
}

function hasWaitingNoActionSignal(haystack) {
  return /\b(no action required|fyi|for your information)\b/i.test(haystack);
}

function hasTechnicalReportSignal(haystack) {
  return /\b(delivery status notification|dmarc|spam report)\b/i.test(haystack);
}

function hasAutomatedNoiseSignal(haystack, from) {
  return (
    hasTechnicalReportSignal(haystack) ||
    /\b(automated message|no action required)\b/i.test(haystack) ||
    from.includes("noreply") ||
    from.includes("no-reply")
  );
}

function clampScoreForCategory(category, score) {
  if (category === "newsletter_fyi") {
    return Math.min(score, 9);
  }
  if (category === "automated_noise") {
    return Math.min(score, 15);
  }
  if (category === "waiting_no_action") {
    return Math.min(score, 25);
  }
  if (category === "unknown" || category === "private_personal") {
    return Math.min(score, 39);
  }
  return score;
}

function applyNeedsReplyFloor(category, score, needsReply) {
  if (needsReply && ACTIONABLE_NEEDS_REPLY_CATEGORIES.has(category)) {
    return Math.max(score, 70);
  }
  return score;
}

function result(email, values) {
  const category = values.category || "unknown";
  const needsReply = Boolean(values.needsReply);
  const rawAttentionScore = applyNeedsReplyFloor(category, values.attentionScore ?? 20, needsReply);
  const attentionScore = clampScoreForCategory(category, rawAttentionScore);

  return {
    email,
    category,
    importance: values.importance || "low",
    needsReply,
    hasDeadline: Boolean(values.hasDeadline),
    deadline: values.deadline || null,
    summary: values.summary,
    nextStep: values.nextStep || "Review manually.",
    confidence: values.confidence || "medium",
    classifier: "heuristic",
    attentionScore,
    attentionReason: values.attentionReason || "Weak or unknown signal",
  };
}

export function classifyEmail(email, options = {}) {
  const haystack = buildHaystack(email);
  const from = String(email.from || "").toLowerCase();
  const summary = summarizeBody(email.body || email.preview || email.subject);
  const needsReply = hasNeedsReplySignal(haystack);
  const hasDeadline = hasDeadlineSignal(haystack);
  const base = { summary, needsReply, hasDeadline, deadline: null };

  if (/\b(phishing|fraud|malware|suspicious|blocked link|scam)\b/i.test(haystack)) {
    return result(email, {
      ...base,
      category: "spam_suspicious",
      importance: "high",
      confidence: "high",
      attentionScore: 78,
      attentionReason: "Suspicious/phishing signal",
      nextStep: "Do not click links; inspect sender and account activity.",
    });
  }

  if (/\b(security alert|login attempt|new login|password reset|2fa|two factor|verification code|passkey)\b/i.test(haystack)) {
    return result(email, {
      ...base,
      category: "account_security",
      importance: "high",
      confidence: "high",
      attentionScore: 94,
      attentionReason: "Security alert",
      nextStep: "Verify whether the account activity is expected.",
    });
  }

  if (/\b(payment failed|invoice|billing|payment|receipt|charge|refund|subscription|rechnung|beleg)\b/i.test(haystack)) {
    const failedPayment = /\b(payment failed|action required|requires action|mahnung)\b/i.test(haystack);
    return result(email, {
      ...base,
      category: "billing_invoice",
      importance: failedPayment ? "high" : "medium",
      confidence: "high",
      attentionScore: failedPayment ? 84 : 55,
      attentionReason: failedPayment ? "Payment failed / action required" : "Invoice/billing keyword",
      nextStep: failedPayment ? "Review billing issue and act." : "Check amount and file for accounting.",
    });
  }

  if (/\b(legal|lawyer|contract|tax|steuer|finanzamt|notary|registration|frist)\b/i.test(haystack)) {
    const deadline = /\b(deadline|frist|due date|mahnung)\b/i.test(haystack);
    return result(email, {
      ...base,
      category: "legal_admin",
      importance: deadline ? "high" : "medium",
      confidence: "medium",
      attentionScore: deadline ? 88 : 58,
      attentionReason: "Legal/admin keyword",
      nextStep: "Review and file with admin/legal material.",
    });
  }

  if (hasAutomatedNoiseSignal(haystack, from)) {
    const waitingNoAction = hasWaitingNoActionSignal(haystack);
    const technicalReport = hasTechnicalReportSignal(haystack);
    return result(email, {
      ...base,
      category: waitingNoAction ? "waiting_no_action" : "automated_noise",
      importance: "low",
      needsReply: false,
      hasDeadline: false,
      confidence: "high",
      attentionScore: waitingNoAction ? 20 : 10,
      attentionReason: waitingNoAction
        ? "Waiting/no-action marker"
        : technicalReport
          ? "DMARC/delivery technical report"
          : "Automated no-reply message",
      nextStep: technicalReport
        ? "Review only if it reports authentication failures or deliverability problems."
        : "No action required unless it indicates an account problem.",
    });
  }

  if (/\b(support|help|issue|problem|bug|not working|booking problem|reservation|cancel)\b/i.test(haystack)) {
    return result(email, {
      ...base,
      category: "customer_support",
      importance: hasDeadline || needsReply ? "high" : "medium",
      confidence: "medium",
      attentionScore: hasDeadline || needsReply ? 76 : 58,
      attentionReason: needsReply ? "Needs reply phrase" : "Customer/support keyword",
      nextStep: "Read full message and prepare a support response if needed.",
    });
  }

  if (/\b(appointment|meeting|calendar|termin|reservation)\b/i.test(haystack)) {
    return result(email, {
      ...base,
      category: "appointment_booking",
      importance: "medium",
      confidence: "medium",
      attentionScore: needsReply ? 66 : 52,
      attentionReason: needsReply ? "Appointment needs confirmation" : "Appointment/booking keyword",
      nextStep: needsReply ? "Confirm or propose a time." : "Check calendar relevance.",
    });
  }

  if (/\b(partnership|provider|vendor|collaboration|opportunity|angebot)\b/i.test(haystack)) {
    return result(email, {
      ...base,
      category: "business_opportunity",
      importance: "medium",
      confidence: "medium",
      attentionScore: 50,
      attentionReason: "Business opportunity keyword",
      nextStep: "Review for business relevance.",
    });
  }

  if (/\b(newsletter|unsubscribe|digest|weekly update|promotion|limited offer|sale ends today|today only|last chance)\b/i.test(haystack)) {
    return result(email, {
      ...base,
      category: "newsletter_fyi",
      importance: "low",
      needsReply: false,
      hasDeadline: false,
      confidence: "high",
      attentionScore: 7,
      attentionReason: "Newsletter/unsubscribe marker",
      nextStep: "No action required unless topic is relevant.",
    });
  }

  if (email.mailboxType === "private") {
    return result(email, {
      ...base,
      category: "private_personal",
      importance: "low",
      confidence: "low",
      attentionScore: 30,
      attentionReason: "Private mailbox weak signal",
      nextStep: "Review when processing private mail.",
    });
  }

  return result(email, {
    ...base,
    category: "unknown",
    importance: "low",
    confidence: "low",
    attentionScore: 25,
    attentionReason: "Weak or unknown signal",
    nextStep: "Review manually.",
  });
}

export function groupTriageResults(results) {
  return Object.fromEntries(
    EMAIL_CATEGORIES.map((category) => [
      category,
      results.filter((item) => item.category === category),
    ])
  );
}
