import type { Document } from 'mongoose';

/**
 * A single-use dashboard redemption code (ADR-0006). The code itself is never stored: only a hash.
 * After redemption the same record carries the hashed session handle used for revocation.
 */
export interface IDashboardCode extends Document {
  codeHash: string;
  userId: string;
  tenantId: string;
  /** Absolute code expiry; enforced in every consuming query, not only by the TTL index. */
  expiresAt: Date;
  /** TTL anchor: the record outlives the code so replay is detected and the handle stays revocable. */
  purgeAt: Date;
  createdAt: Date;
  consumedAt?: Date;
  /** Opaque session id embedded in the issued JWT (`sid`). Not a secret. */
  sid?: string;
  handleHash?: string;
  handleExpiresAt?: Date;
  revokedAt?: Date;
}

/** Plain, storage-independent view of a record. */
export interface DashboardCodeRecord {
  userId: string;
  tenantId: string;
  expiresAt: Date;
  consumedAt?: Date;
  sid?: string;
  handleHash?: string;
  handleExpiresAt?: Date;
  revokedAt?: Date;
}

export interface CreateDashboardCodeData {
  codeHash: string;
  userId: string;
  tenantId: string;
  expiresAt: Date;
  purgeAt: Date;
}

export interface ConsumeDashboardCodeData {
  codeHash: string;
  now: Date;
  sid: string;
  handleHash: string;
  handleExpiresAt: Date;
  /** Keeps the record alive until the handle can no longer be used. */
  purgeAt: Date;
}
