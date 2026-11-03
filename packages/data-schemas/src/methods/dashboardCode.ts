import type { Model } from 'mongoose';
import type {
  IDashboardCode,
  DashboardCodeRecord,
  CreateDashboardCodeData,
  ConsumeDashboardCodeData,
} from '~/types';
import { createIndexesWithRetry } from '~/utils/retry';

function toRecord(doc: IDashboardCode): DashboardCodeRecord {
  return {
    userId: doc.userId,
    tenantId: doc.tenantId,
    expiresAt: doc.expiresAt,
    ...(doc.consumedAt != null && { consumedAt: doc.consumedAt }),
    ...(doc.sid != null && { sid: doc.sid }),
    ...(doc.handleHash != null && { handleHash: doc.handleHash }),
    ...(doc.handleExpiresAt != null && { handleExpiresAt: doc.handleExpiresAt }),
    ...(doc.revokedAt != null && { revokedAt: doc.revokedAt }),
  };
}

/**
 * Storage for dashboard redemption codes. Failures propagate: an outage must never read as
 * "code not found". Methods are keyed by hashes only; raw codes and handles never reach this layer.
 */
export function createDashboardCodeMethods(mongoose: typeof import('mongoose')): {
  createDashboardCode: (data: CreateDashboardCodeData) => Promise<void>;
  consumeDashboardCode: (data: ConsumeDashboardCodeData) => Promise<DashboardCodeRecord | null>;
  findDashboardCode: (codeHash: string) => Promise<DashboardCodeRecord | null>;
  deletePendingDashboardCodes: (userId: string, tenantId: string) => Promise<number>;
  revokeDashboardHandle: (handleHash: string, now: Date) => Promise<boolean>;
  revokeDashboardHandleByCode: (codeHash: string, now: Date) => Promise<boolean>;
  findDashboardHandle: (handleHash: string) => Promise<DashboardCodeRecord | null>;
} {
  let indexesPromise: Promise<void> | null = null;
  const getModel = () => mongoose.models.DashboardCode as Model<IDashboardCode>;

  /** The unique `codeHash` index and the TTL index are load-bearing; build them before writing. */
  function ensureIndexes(): Promise<void> {
    if (!indexesPromise) {
      indexesPromise = createIndexesWithRetry(getModel()).catch((error) => {
        indexesPromise = null;
        throw error;
      });
    }
    return indexesPromise;
  }

  async function createDashboardCode(data: CreateDashboardCodeData): Promise<void> {
    await ensureIndexes();
    await getModel().create({ ...data, createdAt: new Date() });
  }

  /**
   * Atomically claims an unexpired, unconsumed code. Exactly one concurrent caller receives the
   * record; everyone else gets `null`, and the caller classifies the miss with `findDashboardCode`.
   */
  async function consumeDashboardCode(
    data: ConsumeDashboardCodeData,
  ): Promise<DashboardCodeRecord | null> {
    await ensureIndexes();
    const doc = await getModel()
      .findOneAndUpdate(
        {
          codeHash: data.codeHash,
          consumedAt: { $exists: false },
          expiresAt: { $gt: data.now },
        },
        {
          $set: {
            consumedAt: data.now,
            sid: data.sid,
            handleHash: data.handleHash,
            handleExpiresAt: data.handleExpiresAt,
            purgeAt: data.purgeAt,
          },
        },
        { new: true },
      )
      .lean<IDashboardCode>();
    return doc ? toRecord(doc) : null;
  }

  async function findDashboardCode(codeHash: string): Promise<DashboardCodeRecord | null> {
    const doc = await getModel().findOne({ codeHash }).lean<IDashboardCode>();
    return doc ? toRecord(doc) : null;
  }

  async function findDashboardHandle(handleHash: string): Promise<DashboardCodeRecord | null> {
    const doc = await getModel().findOne({ handleHash }).lean<IDashboardCode>();
    return doc ? toRecord(doc) : null;
  }

  /** A fresh code supersedes any earlier unredeemed one, bounding outstanding codes per user. */
  async function deletePendingDashboardCodes(userId: string, tenantId: string): Promise<number> {
    await ensureIndexes();
    const result = await getModel().deleteMany({
      userId,
      tenantId,
      consumedAt: { $exists: false },
    });
    return result.deletedCount ?? 0;
  }

  async function revokeDashboardHandle(handleHash: string, now: Date): Promise<boolean> {
    const result = await getModel().updateOne(
      { handleHash, revokedAt: { $exists: false } },
      { $set: { revokedAt: now } },
    );
    return result.modifiedCount > 0;
  }

  async function revokeDashboardHandleByCode(codeHash: string, now: Date): Promise<boolean> {
    const result = await getModel().updateOne(
      { codeHash, consumedAt: { $exists: true }, revokedAt: { $exists: false } },
      { $set: { revokedAt: now } },
    );
    return result.modifiedCount > 0;
  }

  return {
    createDashboardCode,
    consumeDashboardCode,
    findDashboardCode,
    deletePendingDashboardCodes,
    revokeDashboardHandle,
    revokeDashboardHandleByCode,
    findDashboardHandle,
  };
}

export type DashboardCodeMethods = ReturnType<typeof createDashboardCodeMethods>;
