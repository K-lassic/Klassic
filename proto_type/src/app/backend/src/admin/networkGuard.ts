// 관리자 화면 내부망 전용 (tasks T092, FR-051, G5): ADMIN_ALLOWED_CIDRS 밖이면 ADMIN_NETWORK_DENIED
import type { Request, Response, NextFunction } from 'express';
import { isIP } from 'node:net';
import { env } from '../config/env.js';
import { ApiError, sendError } from '../web/errors.js';
import { recordGate } from '../services/gateEvents.js';
import { hashAddr } from '../lib/ids.js';

function toBigInt(ip: string): { v: bigint; bits: number } | null {
  const plain = ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
  if (isIP(plain) === 4) return { v: plain.split('.').reduce((a, o) => (a << 8n) + BigInt(Number(o)), 0n), bits: 32 };
  if (isIP(plain) === 6) {
    const [head, tail = ''] = plain.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const parts = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    return { v: parts.reduce((a, p) => (a << 16n) + BigInt(parseInt(p || '0', 16)), 0n), bits: 128 };
  }
  return null;
}

export function ipAllowed(ip: string | undefined, cidrs = env.ADMIN_ALLOWED_CIDRS): boolean {
  if (!ip) return false;
  const addr = toBigInt(ip);
  if (!addr) return false;
  return cidrs.split(',').map((c) => c.trim()).filter(Boolean).some((cidr) => {
    const [base, lenStr] = cidr.split('/');
    const net = toBigInt(base);
    if (!net || net.bits !== addr.bits) return false;
    const len = lenStr === undefined ? net.bits : Number(lenStr);
    const shift = BigInt(net.bits - len);
    return (addr.v >> shift) === (net.v >> shift);
  });
}

export function networkGuard(req: Request, res: Response, next: NextFunction): void {
  if (ipAllowed(req.ip ?? req.socket.remoteAddress)) return next();
  void recordGate('G5', 'admin', 'client', hashAddr(req.ip), 'ADMIN_NETWORK_DENIED');
  sendError(res, new ApiError('ADMIN_NETWORK_DENIED'));
}
