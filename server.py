#!/usr/bin/env python3
"""
idntory marketing site server.

Serves this folder as static files and handles POST /api/contact by
emailing the submission via the Resend HTTPS API (mail.idntory.com's SMTP
ports are unreachable — the domain is proxied through Cloudflare, which
only forwards HTTP/HTTPS).

Environment variables:
  PORT             (set automatically by Render)
  RESEND_API_KEY   from resend.com API Keys
  RESEND_FROM      verified sender, e.g. "idntory <onboarding@resend.dev>"
  CONTACT_TO       where submissions are delivered (defaults to info@idntory.com)
"""

import http.server
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:
    pass

PORT = int(os.environ.get("PORT", 5100))
ROOT = Path(__file__).parent

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM = os.environ.get("RESEND_FROM", "idntory <onboarding@resend.dev>")
CONTACT_TO = os.environ.get("CONTACT_TO", "info@idntory.com")

MAX_BODY_BYTES = 20_000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

REASON_LABELS = {
    "api": "Request API access",
    "sales": "Contact sales",
    "compliance": "Compliance / security question",
    "other": "Something else",
}


def send_contact_email(data: dict) -> None:
    reason_label = REASON_LABELS.get(data["reason"], data["reason"])
    text = (
        f'Name: {data["name"]}\n'
        f'Email: {data["email"]}\n'
        f'Company: {data.get("company") or "—"}\n'
        f'Reason: {reason_label}\n\n'
        f'Message:\n{data["message"]}\n'
    )
    payload = json.dumps({
        "from": RESEND_FROM,
        "to": [CONTACT_TO],
        "reply_to": data["email"],
        "subject": f'[idntory contact] {reason_label} — {data["name"]}',
        "text": text,
    }).encode()

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; idntory-contact-form/1.0)",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        if res.status >= 300:
            raise RuntimeError(f"Resend returned status {res.status}")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if self.path.endswith((".js", ".css", ".html")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        # Keep clean URLs (no ".html" in the address bar), mirroring the
        # rewrite/redirect rules in .htaccess for the cPanel deployment.
        path_only = self.path.split("?", 1)[0].split("#", 1)[0]
        suffix = self.path[len(path_only):]

        if path_only == "/index.html":
            self.send_response(301)
            self.send_header("Location", "/" + suffix)
            self.end_headers()
            return None
        if path_only.endswith(".html"):
            self.send_response(301)
            self.send_header("Location", path_only[:-len(".html")] + suffix)
            self.end_headers()
            return None

        fs_path = self.translate_path(path_only)
        if not os.path.isdir(fs_path) and not os.path.isfile(fs_path) and os.path.isfile(fs_path + ".html"):
            self.path = path_only + ".html" + suffix

        return super().send_head()

    def do_POST(self):
        if self.path == "/api/contact":
            self._handle_contact()
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_contact(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(400, {"ok": False, "error": "Invalid request body"})
            return

        try:
            data = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "Invalid JSON"})
            return

        name = (data.get("name") or "").strip()[:200]
        email = (data.get("email") or "").strip()[:200]
        company = (data.get("company") or "").strip()[:200]
        reason = (data.get("reason") or "other").strip()[:40]
        message = (data.get("message") or "").strip()[:5000]

        if not name or not message or not EMAIL_RE.match(email):
            self._json(400, {"ok": False, "error": "Name, a valid email, and a message are required"})
            return

        clean = {"name": name, "email": email, "company": company, "reason": reason, "message": message}

        if not RESEND_API_KEY:
            # Dev fallback: no API key configured — log instead of failing the form.
            print(f'  [CONTACT] (RESEND_API_KEY not configured, logging only) {clean}')
            self._json(200, {"ok": True, "status": "logged"})
            return

        try:
            send_contact_email(clean)
            self._json(200, {"ok": True, "status": "sent"})
        except urllib.error.HTTPError as exc:
            print(f"  [CONTACT ERR] Resend {exc.code}: {exc.read().decode(errors='replace')}")
            self._json(502, {"ok": False, "error": "Could not send email right now"})
        except Exception as exc:
            print(f"  [CONTACT ERR] {exc}")
            self._json(502, {"ok": False, "error": "Could not send email right now"})

    def log_message(self, fmt, *args):
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"  [{ts}] {self.client_address[0]} {fmt % args}")


if __name__ == "__main__":
    resend_status = "configured" if RESEND_API_KEY else "NOT configured (contact form will log only)"
    print()
    print("  +--------------------------------------------------+")
    print("  |  idntory marketing site                           |")
    print("  +--------------------------------------------------+")
    print(f"  |  Port   : {PORT}")
    print(f"  |  Resend : {resend_status}")
    print("  |  Ctrl+C to stop")
    print("  +--------------------------------------------------+")
    print()

    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
