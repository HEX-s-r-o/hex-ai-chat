import { generateKeyPairSync } from 'crypto';
import type {
  DashboardCodeRecord,
  CreateDashboardCodeData,
  ConsumeDashboardCodeData,
} from '@librechat/data-schemas';
import type { KeyObject } from 'crypto';
import type { DashboardCodeStore } from './service';

/** Test-only helpers. Keys and secrets are generated per run; nothing here is a real credential. */
export function generateTestEd25519(): { privatePem: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey,
  };
}

export interface FakeClock {
  now: () => Date;
  advanceSeconds: (seconds: number) => void;
}

export function createFakeClock(start = new Date('2026-01-01T00:00:00.000Z')): FakeClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advanceSeconds: (seconds) => {
      current += seconds * 1000;
    },
  };
}

interface Stored extends DashboardCodeRecord {
  codeHash: string;
}

/** In-memory store with the same contract as the Mongo methods, for deterministic unit tests. */
export function createFakeStore(): DashboardCodeStore & { rows: Map<string, Stored> } {
  const rows = new Map<string, Stored>();
  const view = (row: Stored | undefined): DashboardCodeRecord | null => {
    if (!row) {
      return null;
    }
    const { codeHash: _omit, ...record } = row;
    return { ...record };
  };
  return {
    rows,
    async createDashboardCode(data: CreateDashboardCodeData) {
      if (rows.has(data.codeHash)) {
        throw new Error('duplicate');
      }
      rows.set(data.codeHash, {
        codeHash: data.codeHash,
        userId: data.userId,
        tenantId: data.tenantId,
        expiresAt: data.expiresAt,
      });
    },
    async consumeDashboardCode(data: ConsumeDashboardCodeData) {
      const row = rows.get(data.codeHash);
      if (!row || row.consumedAt != null || row.expiresAt <= data.now) {
        return null;
      }
      Object.assign(row, {
        consumedAt: data.now,
        sid: data.sid,
        handleHash: data.handleHash,
        handleExpiresAt: data.handleExpiresAt,
      });
      return view(row);
    },
    async findDashboardCode(codeHash: string) {
      return view(rows.get(codeHash));
    },
    async deletePendingDashboardCodes(userId: string, tenantId: string) {
      let deleted = 0;
      for (const [hash, row] of rows) {
        if (row.userId === userId && row.tenantId === tenantId && row.consumedAt == null) {
          rows.delete(hash);
          deleted += 1;
        }
      }
      return deleted;
    },
    async revokeDashboardHandle(handleHash: string, now: Date) {
      for (const row of rows.values()) {
        if (row.handleHash === handleHash && row.revokedAt == null) {
          row.revokedAt = now;
          return true;
        }
      }
      return false;
    },
    async revokeDashboardHandleByCode(codeHash: string, now: Date) {
      const row = rows.get(codeHash);
      if (!row || row.consumedAt == null || row.revokedAt != null) {
        return false;
      }
      row.revokedAt = now;
      return true;
    },
  };
}

export function decodeJwt(token: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
} {
  const [h, p, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(p, 'base64url').toString()),
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, 'base64url'),
  };
}
