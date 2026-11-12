import "server-only";
import { env } from "./env";

export type EmailResult =
  | { status: "accepted"; id: string | null }
  | { status: "failed"; error: string }
  | { status: "not_configured" };

export function isEmailConfigured(): boolean {
  return !!env.resendApiKey;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layout(heading: string, bodyHtml: string, button?: { label: string; url: string }): string {
  const cta = button
    ? `<p style="margin:28px 0"><a href="${esc(button.url)}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>
       <p style="color:#64748b;font-size:13px">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${esc(button.url)}</span></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
      <h1 style="font-size:20px;margin:0 0 16px">${esc(heading)}</h1>
      ${bodyHtml}
      ${cta}
    </div>
    <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:16px">Sent with SignFlow AI</p>
  </div></body></html>`;
}

/**
 * Sends through Resend's REST API. "accepted" means Resend took the message for delivery —
 * it is not proof the email reached the inbox, and the UI never claims that it did.
 */
async function send(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  const key = env.resendApiKey;
  if (!key) return { status: "not_configured" };
  const base = process.env.RESEND_BASE_URL?.replace(/\/+$/, "") || "https://api.resend.com";
  try {
    const res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.emailFrom, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      return { status: "failed", error: (body.message || `Email provider returned HTTP ${res.status}`).slice(0, 300) };
    }
    return { status: "accepted", id: body.id ?? null };
  } catch (err) {
    return { status: "failed", error: `Could not reach the email provider: ${err instanceof Error ? err.message : "unknown error"}`.slice(0, 300) };
  }
}

export function sendInvitationEmail(p: { to: string; signerName: string; workspaceName: string; agreementTitle: string; url: string; expiresAt: Date }) {
  const expires = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(p.expiresAt);
  const html = layout(
    `${p.workspaceName} sent you an agreement to sign`,
    `<p>Hello ${esc(p.signerName)},</p>
     <p><strong>${esc(p.workspaceName)}</strong> has asked you to review and sign <strong>${esc(p.agreementTitle)}</strong>.</p>
     <p>It takes about a minute and you do not need an account. This link is personal to you; please do not forward it. It expires on ${esc(expires)}.</p>`,
    { label: "Review and sign", url: p.url },
  );
  const text = `Hello ${p.signerName},\n\n${p.workspaceName} has asked you to review and sign "${p.agreementTitle}".\n\nOpen this link to sign (no account needed, expires ${expires}):\n${p.url}\n`;
  return send(p.to, `Please sign: ${p.agreementTitle}`, html, text);
}

export function sendSignedCopyEmail(p: { to: string; signerName: string; workspaceName: string; agreementTitle: string; url: string }) {
  const html = layout(
    "Your signed agreement",
    `<p>Hello ${esc(p.signerName)},</p><p>You signed <strong>${esc(p.agreementTitle)}</strong> for <strong>${esc(p.workspaceName)}</strong>. You can download your copy for the next 30 days.</p>`,
    { label: "Download signed copy", url: p.url },
  );
  return send(p.to, `Signed: ${p.agreementTitle}`, html, `You signed "${p.agreementTitle}". Download your copy: ${p.url}\n`);
}

export function sendAdminSignedEmail(p: { to: string; signerName: string; agreementTitle: string; caseReference: string; url: string }) {
  const html = layout(
    "Agreement signed",
    `<p><strong>${esc(p.signerName)}</strong> signed <strong>${esc(p.agreementTitle)}</strong> for file <strong>${esc(p.caseReference)}</strong>. The file is cleared to start.</p>`,
    { label: "Open agreement", url: p.url },
  );
  return send(p.to, `Signed: ${p.agreementTitle} (${p.caseReference})`, html, `${p.signerName} signed "${p.agreementTitle}" for file ${p.caseReference}. ${p.url}\n`);
}
