const nodemailer = require('nodemailer');

let transporter = null;
let warnedMissingConfig = false;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

// Fire-and-forget: notification email should never block or fail the RFI creation request.
async function sendRfiAssignedEmail({ to, toName, projectName, question, askedByName }) {
  const t = getTransporter();
  if (!t) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        'RFI email notifications are not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS). ' +
        'Skipping email — the RFI itself was still created normally.'
      );
    }
    return;
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const subject = `New RFI assigned to you: ${projectName}`;
  const text =
    `Hi ${toName},\n\n` +
    `${askedByName} has assigned you an RFI on "${projectName}":\n\n` +
    `"${question}"\n\n` +
    `Log in to the Civil PM app to answer it.\n`;

  try {
    await t.sendMail({ from, to, subject, text });
  } catch (err) {
    console.warn('Failed to send RFI assignment email:', err.message);
  }
}

module.exports = { sendRfiAssignedEmail };
