/**
 * Human-readable label stored on the TrustedDevice row, so a user reviewing
 * their trusted devices sees "Chrome on Windows" rather than a bare UUID.
 * Best-effort and purely cosmetic — the security boundary is the opaque
 * deviceToken, not this string.
 */
export function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;

  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'Browser';

  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;

  return os ? `${browser} on ${os}` : browser;
}
