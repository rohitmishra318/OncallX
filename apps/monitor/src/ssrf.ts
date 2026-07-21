/**
 * Local copy of the SSRF utility for apps/monitor.
 * apps/monitor cannot import from @oncallx/shared (it would bring in Prisma/Redis),
 * so we vendor this file. The canonical implementation lives in packages/shared/src/ssrf.ts
 * — keep them in sync if you update the IP-range logic.
 */
import dns from 'dns/promises';
import net from 'net';

export async function isUrlSafeToFetch(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname;

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    return false;
  }

  if (addresses.length === 0) return false;

  for (const addr of addresses) {
    if (!isPublicIp(addr)) return false;
  }

  return true;
}

function isPublicIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === '::1') return false;
    if (norm.startsWith('fe80:')) return false;
    if (norm.startsWith('::ffff:')) return isPublicIp(norm.slice(7));
    return true;
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;

  if (a === 0) return false;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;

  return true;
}
