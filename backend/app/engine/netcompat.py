"""Network compatibility checks for yt-dlp's browser impersonation.

Some sites (Dailymotion, Vimeo, others) only answer requests that look like a real browser,
so yt-dlp retries them with curl_cffi "impersonation". The newest browser profiles send a
large TLS ClientHello (post-quantum key share), and some routers, ISPs and antivirus
middleboxes silently drop it: every impersonated request then times out, while normal
requests work. The site appears broken even though it isn't.

At startup we probe the profiles yt-dlp would pick. If a profile can't connect while a plain
request can, we move it to the end of yt-dlp's preference list, so "chrome" resolves to the
newest Chrome profile that works on this network. On healthy networks nothing changes.
"""
from __future__ import annotations

import logging
import threading

log = logging.getLogger("haul.netcompat")

PROBE_URL = "https://www.google.com/generate_204"
CONNECT_TIMEOUT = 6
_lock = threading.Lock()
_result: dict[str, list[str]] = {"blocked": [], "kept": []}


def _probe(curl_requests, name: str | None) -> bool:
    try:
        curl_requests.get(PROBE_URL, impersonate=name, timeout=CONNECT_TIMEOUT, allow_redirects=False)
        return True
    except Exception:
        return False


def tune_impersonation() -> dict[str, list[str]]:
    """Demote impersonation targets this network can't use. Safe to call more than once."""
    with _lock:
        try:
            from curl_cffi import requests as curl_requests
            from yt_dlp.networking import _curlcffi
        except Exception:  # curl_cffi not installed: nothing to tune
            return _result
        handler = _curlcffi.CurlCFFIRH
        targets = dict(handler._SUPPORTED_IMPERSONATE_TARGET_MAP)
        if not targets or not _probe(curl_requests, None):
            return _result  # offline or curl_cffi broken entirely: don't judge profiles

        from concurrent.futures import ThreadPoolExecutor

        candidates = [t for t in targets if t.client in ("chrome", "edge", "safari", "firefox")
                      and t.os not in ("ios", "android")]
        with ThreadPoolExecutor(max_workers=12) as pool:
            ok = dict(zip(candidates, pool.map(lambda t: _probe(curl_requests, targets[t]), candidates)))
        # Only demote within a family that has at least one working profile:
        # demoting a whole family would change nothing.
        blocked = []
        for client in ("chrome", "edge", "safari", "firefox"):
            family = [t for t in candidates if t.client == client]
            if any(ok[t] for t in family):
                blocked.extend(t for t in family if not ok[t])

        if blocked:
            reordered = {t: n for t, n in targets.items() if t not in blocked}
            reordered.update({t: targets[t] for t in blocked})
            handler._SUPPORTED_IMPERSONATE_TARGET_MAP = reordered
            log.warning("This network drops some browser TLS profiles; avoiding: %s",
                        ", ".join(str(targets[t]) for t in blocked))
        _result["blocked"] = [str(targets[t]) for t in blocked]
        _result["kept"] = [str(n) for t, n in handler._SUPPORTED_IMPERSONATE_TARGET_MAP.items()][:5]
        return _result


_started = False


def tune_in_background() -> None:
    """Run the probe once per process, off the request path (it takes a few seconds)."""
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=tune_impersonation, name="netcompat", daemon=True).start()
