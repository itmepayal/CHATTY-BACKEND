import { Resend } from "resend";
import { clientUrl } from "../constants/constants.js";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "Chatty <onboarding@resend.dev>";

export async function sendPasswordResetEmail(toEmail, resetUrl) {
  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: "Reset your Chatty password",
    html: passwordResetHtml(resetUrl),
    text: passwordResetText(resetUrl),
  });

  if (error) {
    throw new Error(
      `Email delivery failed: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

function passwordResetHtml(resetUrl) {
  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your Chatty password</title>
</head>
<body style="margin:0;padding:0;background:#0b0914;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0b0914;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#1a1625;border:1px solid #2d2441;border-radius:16px;overflow:hidden;" cellpadding="0" cellspacing="0" role="presentation">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed,#a855f7,#ec4899);padding:28px 32px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">Chatty</p>
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.75);">Baat karo, bina ruke</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 28px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#f1f5f9;">Reset your password</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#94a3b8;">
                We received a request to reset the password for your Chatty account. Click the button below within the next <strong style="color:#e2e8f0;">30 minutes</strong> — after that the link expires.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 28px;">
                <tr>
                  <td style="border-radius:12px;background:linear-gradient(135deg,#7c3aed,#a855f7);">
                    <a href="${resetUrl}"
                       target="_blank"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;letter-spacing:0.2px;">
                      Reset my password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback URL -->
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;">If the button above doesn't work, copy and paste this link into your browser:</p>
              <p style="margin:0 0 28px;word-break:break-all;font-size:12px;color:#7c3aed;">${resetUrl}</p>

              <!-- Security note -->
              <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#0f0c1a;border:1px solid #2d2441;border-radius:10px;">
                <tr>
                  <td style="padding:16px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#a78bfa;">&#128274; Didn't request this?</p>
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;">If you didn't ask for a password reset, you can safely ignore this email. Your account remains secure.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 28px;text-align:center;border-top:1px solid #2d2441;">
              <p style="margin:0;font-size:12px;color:#475569;">
                This link expires in 30 minutes &bull; Chatty &copy; ${new Date().getFullYear()}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function passwordResetText(resetUrl) {
  return `
Chatty — Reset your password
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

We received a request to reset your Chatty account password.

Open the link below to set a new password (valid for 30 minutes):

${resetUrl}

If you didn't request this, you can safely ignore this email.
Your account remains secure.

— The Chatty team
`.trim();
}

export async function sendLoginAlertEmail(toEmail, info) {
  const sessionsUrl = `${clientUrl}/profile?tab=security`;
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: "New sign-in to your Chatty account",
      html: loginAlertHtml(info, sessionsUrl),
      text: loginAlertText(info, sessionsUrl),
    });
    if (error) {
      console.error("[email] login alert failed:", error.message ?? error);
    }
  } catch (err) {
    console.error("[email] login alert exception:", err?.message || err);
  }
}

function loginAlertHtml({ deviceLabel, location, time }, sessionsUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>New sign-in to Chatty</title></head>
<body style="margin:0;padding:0;background:#0b0914;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#1a1625;border:1px solid #2d2441;border-radius:16px;overflow:hidden;" cellpadding="0" cellspacing="0">
        <tr><td style="background:linear-gradient(135deg,#7c3aed,#a855f7,#ec4899);padding:28px 32px;text-align:center;">
          <p style="margin:0;font-size:28px;font-weight:900;color:#fff;">Chatty</p>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.75);">Security alert</p>
        </td></tr>
        <tr><td style="padding:36px 32px 28px;">
          <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#f1f5f9;">New sign-in detected</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#94a3b8;">We noticed a sign-in to your Chatty account. Here are the details:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#241e35;border:1px solid #3d3158;border-radius:12px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:5px 0;font-size:13px;color:#64748b;width:90px;">Device</td><td style="font-size:14px;color:#e2e8f0;font-weight:600;">${deviceLabel}</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Location</td><td style="font-size:14px;color:#e2e8f0;font-weight:600;">${location}</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Time</td><td style="font-size:14px;color:#e2e8f0;font-weight:600;">${time}</td></tr>
              </table>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#94a3b8;"><strong style="color:#fbbf24;">If this was you</strong>, no action needed. <strong style="color:#f87171;">If this wasn't you</strong>, review your sessions immediately.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;"><tr>
            <td style="border-radius:12px;background:linear-gradient(135deg,#7c3aed,#a855f7);">
              <a href="${sessionsUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:12px;">Review active sessions</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #2d2441;text-align:center;">
          <p style="margin:0;font-size:12px;color:#475569;">You received this because login alerts are enabled on your account.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();
}

function loginAlertText({ deviceLabel, location, time }, sessionsUrl) {
  return `New Chatty sign-in detected\n\nDevice:   ${deviceLabel}\nLocation: ${location}\nTime:     ${time}\n\nIf this was you, no action is needed.\nIf this wasn't you, review your active sessions:\n${sessionsUrl}\n\n— The Chatty team`.trim();
}
