// Transactional notifications are best-effort: email provider outages must not break audit intake or payment reconciliation.
export async function sendProofTTLEmail(env, options) {
  const apiKey = clean(env?.RESEND_API_KEY, 300);
  const from = clean(env?.PROOFTTL_EMAIL_FROM, 254);
  const to = clean(options?.to, 254);
  if (!apiKey || !from || !to || /[\r\n]/.test(from)) {
    console.warn(JSON.stringify({
      event: "proofttl_email_skipped",
      notification: clean(options?.event, 80) || "transactional",
      reason: !apiKey ? "resend_api_key_missing" : !from ? "sender_not_configured" : "recipient_missing"
    }));
    return { ok: false, skipped: true };
  }

  const payload = {
    from,
    to: [to],
    subject: clean(options?.subject, 180),
    text: String(options?.text || "").slice(0, 20000),
    html: String(options?.html || "").slice(0, 40000),
    tags: [
      { name: "project", value: "proofttl" },
      { name: "notification", value: clean(options?.event, 80) || "transactional" }
    ]
  };
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  };
  if (options?.idempotencyKey) headers["idempotency-key"] = String(options.idempotencyKey).slice(0, 256);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result?.id !== "string") {
      console.error(JSON.stringify({
        event: "proofttl_email_failed",
        notification: clean(options?.event, 80) || "transactional",
        status: response.status
      }));
      return { ok: false, status: response.status };
    }
    console.log(JSON.stringify({
      event: "proofttl_email_accepted",
      notification: clean(options?.event, 80) || "transactional",
      message_id: result.id
    }));
    return { ok: true, id: result.id };
  } catch (error) {
    console.error(JSON.stringify({
      event: "proofttl_email_failed",
      notification: clean(options?.event, 80) || "transactional",
      error: error?.name || "request_error"
    }));
    return { ok: false };
  }
}

export function escapeEmailHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
