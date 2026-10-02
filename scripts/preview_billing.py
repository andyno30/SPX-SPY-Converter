"""Local-only billing previews. No Stripe or Supabase requests or credentials.

Run: python3 scripts/preview_billing.py
Visit /__preview/active, /__preview/logged-out, /__preview/pending,
or /__preview/settings. Production files contain no preview bypass.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        requested = (ROOT / unquote(urlsplit(self.path).path).lstrip('/')).resolve()
        if not requested.is_relative_to(ROOT) or any(part.startswith('.') for part in requested.relative_to(ROOT).parts):
            self.send_error(404)
            return
        if self.path.startswith('/__preview/'):
            mode = self.path.split('/')[-1]
            self.send_response(302)
            self.send_header('Set-Cookie', f'preview={mode}; Path=/; SameSite=Strict')
            self.send_header('Location', '/docs/settings.html#billing-heading' if mode == 'settings' else '/docs/subscription-success.html')
            self.end_headers()
            return
        if self.path.split('?')[0] == '/analytics.js':
            self.send_response(204)
            self.end_headers()
            return
        if self.path.split('?')[0] == '/docs/auth.js':
            cookie = self.headers.get('Cookie', '')
            logged_out = 'preview=logged-out' in cookie or not cookie
            pending = 'preview=pending' in cookie
            body = ('''
export async function signOut() {}
const user = LOGGED_OUT ? null : { id: 'preview-user', email: 'trader@example.com' };
const profile = { is_subscribed: ACTIVE, stripe_customer_id: 'preview', nickname: 'Trader' };
const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: profile, error: null }; } };
export const supabase = {
  auth: { async getUser() { return { data: { user }, error: null }; }, async getSession() { return { data: { session: { access_token: 'local-preview' } } }; } },
  from() { return query; },
  functions: { async invoke() { return { error: { message: 'Preview only', context: { status: 503, async json() { return { message: 'Local preview only. The live button opens your secure Stripe billing portal.' }; } } } }; } }
};
'''.replace('LOGGED_OUT', json.dumps(logged_out)).replace('ACTIVE', json.dumps(not pending))).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        relative = requested.relative_to(ROOT)
        if relative.parts and (relative.parts[0] in {'docs', 'Images'} or relative.as_posix() in {'index.html', 'pro.html', 'aboutus.html', 'dashboard.html', 'styles.css', 'script.js'}):
            super().do_GET()
        else:
            self.send_error(404)


if __name__ == '__main__':
    print('Local billing preview: http://127.0.0.1:8765/__preview/active', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), Preview).serve_forever()
