import { BlockList, isIP } from 'node:net';

/** IP / CIDR allowlist built on Node's BlockList (IPv4 + IPv6, IPv4-mapped IPv6 normalised). */
export class IpAllowlist {
  private readonly list = new BlockList();
  readonly enabled: boolean;

  constructor(entries: string[]) {
    this.enabled = entries.length > 0;
    for (const raw of entries) {
      const [addr, prefix] = raw.split('/');
      const family = isIP(addr);
      if (family === 0) throw new Error(`invalid IP in allowlist: ${raw}`);
      const type = family === 4 ? 'ipv4' : 'ipv6';
      if (prefix === undefined) this.list.addAddress(addr, type);
      else this.list.addSubnet(addr, Number(prefix), type);
    }
  }

  allows(ip: string | undefined): boolean {
    if (!this.enabled) return true;
    if (!ip) return false;
    const norm = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
    const family = isIP(norm);
    if (family === 0) return false;
    return this.list.check(norm, family === 4 ? 'ipv4' : 'ipv6');
  }
}
