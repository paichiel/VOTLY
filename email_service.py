import os
import smtplib
import json
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

class EmailService:
    @staticmethod
    def get_config():
        return {
            "resend_key": os.environ.get("RESEND_API_KEY", "").strip(),
            "resend_from": os.environ.get("RESEND_FROM", "Votly Vault <notifications@votly.vault>").strip(),
            "smtp_host": os.environ.get("SMTP_HOST", "").strip(),
            "smtp_port": int(os.environ.get("SMTP_PORT", 587)),
            "smtp_user": os.environ.get("SMTP_USER", "").strip(),
            "smtp_pass": os.environ.get("SMTP_PASS", "").strip(),
            "smtp_from": os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "vault@votly.com")).strip(),
            "vault_url": os.environ.get("VAULT_URL", "http://localhost:5000").strip()
        }

    @staticmethod
    def render_expiration_template(user_name, doc_title, doc_number, category, expires_date, days_remaining, milestone_label, vault_url):
        # Determine urgency accent colors
        if days_remaining <= 1:
            badge_color = "#DC2626"
            badge_bg = "#FEF2F2"
            urgency_text = "EXPIRES IN 24 HOURS"
        elif days_remaining <= 7:
            badge_color = "#EA580C"
            badge_bg = "#FFF7ED"
            urgency_text = f"EXPIRES IN {days_remaining} DAYS"
        elif days_remaining <= 14:
            badge_color = "#D97706"
            badge_bg = "#FFFBEB"
            urgency_text = f"EXPIRES IN {days_remaining} DAYS"
        else:
            badge_color = "#2563EB"
            badge_bg = "#EFF6FF"
            urgency_text = f"EXPIRES IN {days_remaining} DAYS (1 MONTH NOTICE)"

        doc_num_display = doc_number if doc_number else "Not specified"

        html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Expiration Alert - Votly</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0F172A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F8FAFC; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #FFFFFF; border-radius: 20px; border: 1px solid #E2E8F0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.03); overflow: hidden;">
          
          <!-- Top Accent Bar -->
          <tr>
            <td style="background: linear-gradient(90deg, #1E3A8A 0%, #2563EB 50%, #3B82F6 100%); height: 6px;"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding: 32px 36px 20px; text-align: left;">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <div style="display: inline-block; width: 40px; height: 40px; background: linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%); border-radius: 12px; text-align: center; line-height: 40px; color: #FFFFFF; font-weight: 800; font-size: 20px;">V</div>
                    <span style="font-size: 22px; font-weight: 800; color: #0F172A; margin-left: 10px; letter-spacing: -0.5px; vertical-align: middle;">VOTLY</span>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; padding: 6px 12px; background-color: {badge_bg}; color: {badge_color}; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; border: 1px solid {badge_color}30;">
                      {urgency_text}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 0 36px 30px;">
              <h1 style="font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 12px; letter-spacing: -0.3px;">
                Your document is expiring soon
              </h1>
              <p style="font-size: 15px; line-height: 24px; color: #475569; margin: 0 0 24px;">
                Hello <strong>{user_name}</strong>, your digital document <strong>"{doc_title}"</strong> stored in your secure vault is set to expire on <strong>{expires_date}</strong> ({days_remaining} days remaining).
              </p>

              <!-- Document Metadata Box -->
              <table role="presentation" width="100%" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 18px 20px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #64748B; width: 40%;">Document Title</td>
                  <td style="padding: 6px 0; font-size: 14px; font-weight: 600; color: #0F172A;">{doc_title}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #64748B;">Category</td>
                  <td style="padding: 6px 0; font-size: 14px; font-weight: 600; color: #2563EB;">{category}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #64748B;">Document Number</td>
                  <td style="padding: 6px 0; font-size: 14px; font-weight: 600; color: #0F172A; font-family: monospace;">{doc_num_display}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #64748B;">Expiration Date</td>
                  <td style="padding: 6px 0; font-size: 14px; font-weight: 700; color: {badge_color};">{expires_date}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #64748B;">Notice Milestone</td>
                  <td style="padding: 6px 0; font-size: 13px; font-weight: 600; color: #334155;">{milestone_label}</td>
                </tr>
              </table>

              <!-- Action Recommendation -->
              <p style="font-size: 14px; line-height: 22px; color: #64748B; margin: 0 0 28px;">
                We recommend reviewing this document now to prepare renewal applications, book appointments, or request a replacement before it becomes invalid.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%">
                <tr>
                  <td align="center">
                    <a href="{vault_url}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%); color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);">
                      Open Secure Vault &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 24px 36px; text-align: center;">
              <p style="font-size: 12px; line-height: 18px; color: #94A3B8; margin: 0 0 6px;">
                This automated reminder was sent by <strong>VOTLY Vault</strong> based on your scheduled document notice preferences.
              </p>
              <p style="font-size: 12px; color: #94A3B8; margin: 0;">
                AES-256 Zero-Knowledge Encrypted Security Platform &bull; {datetime.now().year} Votly Inc.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
        return html

    @classmethod
    def send_notification(cls, to_email, user_name, doc_title, doc_number, category, expires_date, days_remaining, milestone_label):
        """
        Sends an expiration notification email using configured provider:
        - Resend API (if RESEND_API_KEY is present)
        - SMTP (if SMTP_HOST is present)
        - Simulation (logs to console/activity log with full HTML preview)
        """
        config = cls.get_config()
        subject = f"[Notice] Expiration Alert: '{doc_title}' expires in {days_remaining} day{'s' if days_remaining != 1 else ''}"
        html_content = cls.render_expiration_template(
            user_name=user_name,
            doc_title=doc_title,
            doc_number=doc_number,
            category=category,
            expires_date=expires_date,
            days_remaining=days_remaining,
            milestone_label=milestone_label,
            vault_url=config["vault_url"]
        )

        # 1. Resend API
        if config["resend_key"]:
            try:
                payload = {
                    "from": config["resend_from"],
                    "to": [to_email],
                    "subject": subject,
                    "html": html_content
                }
                req = urllib.request.Request(
                    "https://api.resend.com/emails",
                    data=json.dumps(payload).encode("utf-8"),
                    headers={
                        "Authorization": f"Bearer {config['resend_key']}",
                        "Content-Type": "application/json",
                        "User-Agent": "VotlyVault/1.0"
                    }
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                    print(f"[EmailService] Resend email dispatched to {to_email}: {result}")
                    return {"success": True, "provider": "resend", "id": result.get("id")}
            except Exception as e:
                print(f"[EmailService] Resend failed: {e}. Falling back to simulation.")

        # 2. SMTP Transport
        elif config["smtp_host"] and config["smtp_user"]:
            try:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = config["smtp_from"]
                msg["To"] = to_email
                msg.attach(MIMEText(html_content, "html"))

                if config["smtp_port"] == 465:
                    server = smtplib.SMTP_SSL(config["smtp_host"], config["smtp_port"], timeout=10)
                else:
                    server = smtplib.SMTP(config["smtp_host"], config["smtp_port"], timeout=10)
                    server.starttls()
                server.login(config["smtp_user"], config["smtp_pass"])
                server.sendmail(config["smtp_from"], [to_email], msg.as_string())
                server.quit()
                print(f"[EmailService] SMTP email sent to {to_email} via {config['smtp_host']}")
                return {"success": True, "provider": "smtp"}
            except Exception as e:
                print(f"[EmailService] SMTP failed: {e}. Falling back to simulation.")

        # 3. Default: Simulation Mode
        print(f"[EmailService-SIMULATION] Simulated automated email to <{to_email}>: '{subject}' ({milestone_label})")
        return {
            "success": True,
            "provider": "simulation",
            "to": to_email,
            "subject": subject,
            "milestone": milestone_label
        }
