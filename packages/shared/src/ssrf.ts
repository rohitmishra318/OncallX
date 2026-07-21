import dns from 'dns/promises';
import net from 'net';

/**
 * §17.4 — SSRF protection.
 *
 * Checks both at target-creation time AND immediately before every HTTP request
 * the monitor makes (to defend against DNS rebinding).
 *
 * Returns true if the URL is safe to fetch, false otherwise.
 * Throws never — callers should treat any exception as "unsafe".
 */
export async function isUrlSafeToFetch(rawUrl: string): Promise<boolean> {
  // Rule 1: scheme must be https
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname;

  // Rule 2 + 3: resolve hostname and check every returned IP
  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    // DNS failure → unsafe (can't confirm the destination)
    return false;
  }

  if (addresses.length === 0) return false;

  for (const addr of addresses) {
    if (!isPublicIp(addr)) return false;
  }

  return true;
}

/**
 * Returns false if the IP address falls into any private/reserved/loopback range.
 * Covers both IPv4 and IPv6.
 */
function isPublicIp(ip: string): boolean {
  // Reject anything that isn't a recognisable IP
  if (!net.isIP(ip)) return false;

  // ── IPv6 ──────────────────────────────────────────────────────────────────
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    // loopback ::1
    if (norm === '::1') return false;
    // link-local fe80::/10
    if (norm.startsWith('fe80:')) return false;
    // IPv4-mapped ::ffff:x.x.x.x — extract the embedded IPv4 and re-check
    if (norm.startsWith('::ffff:')) {
      const embedded = norm.slice(7);
      return isPublicIp(embedded);
    }
    return true;
  }

  // ── IPv4 ──────────────────────────────────────────────────────────────────
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;

  if (a === 0) return false;                        // 0.0.0.0/8
  if (a === 10) return false;                       // 10.0.0.0/8
  if (a === 127) return false;                      // 127.0.0.0/8  loopback
  if (a === 169 && b === 254) return false;         // 169.254.0.0/16  link-local / AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
  if (a === 192 && b === 168) return false;         // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10  RFC 6598 shared
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15  benchmarking

  return true;
}
