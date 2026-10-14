"""Bounded Chromium API navigation, with enforcement before redirect follow-up.

Playwright routes do not intercept every redirect hop. CDP Fetch pauses both
request and response stages, retaining Chromium's own TLS/cookie handling.
Only counts and status codes leave this module; never URLs, headers or cookies.
"""

from datetime import datetime, timezone
import logging
import re
from urllib.parse import urljoin, urlsplit

REDIRECT_STATUSES = {301, 302, 303, 307, 308}


def _origin(url):
    parsed = urlsplit(url)
    if (parsed.scheme not in ('https', 'http') or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.fragment or any(c.isspace() or ord(c) < 32 for c in url)):
        raise ValueError('Invalid API navigation destination.')
    port = parsed.port if parsed.port is not None else (443 if parsed.scheme == 'https' else 80)
    return parsed.scheme, parsed.hostname, port


class NavigationGuard:
    def __init__(self, context, page, endpoint, label, *, redirect_limit=0,
                 allowed_redirects=()):
        if type(redirect_limit) is not int or not 0 <= redirect_limit <= 5:
            raise ValueError('Invalid API redirect limit.')
        self.origin = _origin(endpoint)
        self.allowed = {endpoint, *allowed_redirects}
        if any(_origin(url) != self.origin for url in self.allowed):
            raise ValueError('Redirect destinations must use the same origin.')
        self.page, self.endpoint, self.label = page, endpoint, label
        self.limit = redirect_limit
        self.expected = endpoint
        self.failure = None
        self.attempts = 0
        self.statuses = []
        self.blocked_redirects = self.blocked_requests = 0
        self.complete = False
        self.active = set()
        self.session = context.new_cdp_session(page)
        try:
            self.frame = self.session.send('Page.getFrameTree')['frameTree']['frame']['id']
            self.session.on('Fetch.requestPaused', self._paused)
            self.session.send('Network.enable')
            self.session.send('Network.setCacheDisabled', {'cacheDisabled': True})
            self.session.send('Network.setBypassServiceWorker', {'bypass': True})
            self.session.send('Fetch.enable', {'patterns': [
                {'urlPattern': '*', 'requestStage': 'Request'},
                {'urlPattern': '*', 'requestStage': 'Response'}]})
        except Exception:
            self.close()
            raise

    def _fail(self, request_id):
        self.session.send('Fetch.failRequest', {'requestId': request_id, 'errorReason': 'BlockedByClient'})

    def _paused(self, event):
        request_id = event['requestId']
        try:
            if 'responseStatusCode' not in event and 'responseErrorReason' not in event:
                request = event['request']
                if (self.failure or event.get('frameId') != self.frame
                        or event.get('resourceType') != 'Document'
                        or request.get('method') != 'GET' or request.get('url') != self.expected
                        or request.get('url') not in self.allowed):
                    self.blocked_requests += 1
                    self._fail(request_id)
                    return
                self.expected = None
                self.active.add(request_id)
                self.attempts += 1
                self.session.send('Fetch.continueRequest', {'requestId': request_id})
                return

            if request_id not in self.active:
                self.blocked_requests += 1
                self._fail(request_id)
                return
            self.active.remove(request_id)
            status = event.get('responseStatusCode')
            if type(status) is not int or not 100 <= status <= 599:
                self.failure = {'error': 'browser'}
                self._fail(request_id)
                return
            self.statuses.append(status)
            if status in REDIRECT_STATUSES:
                locations = [h['value'] for h in event.get('responseHeaders', [])
                             if h['name'].lower() == 'location']
                destination = None
                if len(locations) == 1 and locations[0]:
                    destination = urljoin(event['request']['url'], locations[0])
                try:
                    permitted = (destination in self.allowed and _origin(destination) == self.origin
                                 and not any(c.isspace() or ord(c) < 32 for c in locations[0]))
                except (ValueError, TypeError, IndexError):
                    permitted = False
                if not permitted or self.attempts > self.limit:
                    self.blocked_redirects += 1
                    self.failure = {'error': 'redirect', 'status': status}
                    self.complete = True
                    self._fail(request_id)
                    return
                self.expected = destination
            self.session.send('Fetch.continueResponse', {'requestId': request_id})
        except Exception:
            # Never let CDP exception text or an upstream Location enter logs.
            self.failure = {'error': 'browser'}
            self.complete = False
            try:
                self._fail(request_id)
            except Exception:
                pass

    def goto(self, timeout):
        try:
            response = self.page.goto(self.endpoint, wait_until='commit', timeout=timeout)
            self.complete = not self.active and bool(self.statuses)
            return response
        except Exception:
            if self.failure is None:
                self.failure = {'error': 'browser'}
                self.complete = False
            return None

    def accounting(self):
        return {'label': self.label, 'attempts': self.attempts,
                'statuses': list(self.statuses), 'redirects': max(0, self.attempts - 1),
                'blocked_redirects': self.blocked_redirects,
                'blocked_requests': self.blocked_requests, 'complete': self.complete}

    def close(self):
        # Caller closes the page FIRST, while interception still blocks traffic.
        # Disabling Fetch on a live page can release otherwise paused requests.
        try:
            self.session.remove_listener('Fetch.requestPaused', self._paused)
        finally:
            try:
                self.session.detach()
            except Exception:
                pass  # Closing the page normally detaches its CDP session.


def emit_accounting(reports):
    """Validate the worker pipe before emitting only safe, bounded metadata."""
    if not isinstance(reports, list) or not 1 <= len(reports) <= 2:
        reports = []
    messages = []
    for report in reports:
        if not isinstance(report, dict):
            continue
        label = report.get('label')
        if not isinstance(label, str) or not re.fullmatch(r'news_group_[16]|options_[A-Z]{1,5}', label):
            continue
        keys = ('attempts', 'redirects', 'blocked_redirects', 'blocked_requests')
        if any(type(report.get(k)) is not int or not 0 <= report[k] <= 10000 for k in keys):
            continue
        statuses = report.get('statuses')
        if (not isinstance(statuses, list) or len(statuses) > 6
                or any(type(s) is not int or not 100 <= s <= 599 for s in statuses)
                or type(report.get('complete')) is not bool):
            continue
        messages.append(f"{label}: API navigation attempts={report['attempts']}, "
                        f"responses={statuses}, redirects={report['redirects']}, "
                        f"blocked_redirects={report['blocked_redirects']}, "
                        f"blocked_requests={report['blocked_requests']}, complete={report['complete']}")
    if not messages:
        messages = ['API navigation accounting unavailable; no request count inferred.']
    logger = logging.getLogger('spyconverter-fallback')
    for message in messages:
        line = f'{datetime.now(timezone.utc).isoformat()} {message}'
        if logger.handlers:
            logger.info(line)
        else:
            print(line, flush=True)
