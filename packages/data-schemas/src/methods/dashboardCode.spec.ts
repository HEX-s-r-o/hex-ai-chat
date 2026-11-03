import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { DashboardCodeMethods } from './dashboardCode';
import { createDashboardCodeModel } from '~/models/dashboardCode';
import { createDashboardCodeMethods } from './dashboardCode';

let mongoServer: MongoMemoryServer;
let methods: DashboardCodeMethods;

const NOW = new Date('2026-01-01T00:00:00.000Z');
const plus = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

function codeData(
  overrides: Partial<Parameters<DashboardCodeMethods['createDashboardCode']>[0]> = {},
) {
  return {
    codeHash: 'hash-a',
    userId: 'user-1',
    tenantId: 'tenant-1',
    expiresAt: plus(60),
    purgeAt: plus(360),
    ...overrides,
  };
}

function consumeData(
  overrides: Partial<Parameters<DashboardCodeMethods['consumeDashboardCode']>[0]> = {},
) {
  return {
    codeHash: 'hash-a',
    now: NOW,
    sid: 'sid-1',
    handleHash: 'handle-hash-1',
    handleExpiresAt: plus(300),
    purgeAt: plus(360),
    ...overrides,
  };
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createDashboardCodeModel(mongoose);
  methods = createDashboardCodeMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await mongoose.models.DashboardCode.deleteMany({});
});

describe('dashboard code methods', () => {
  it('consumes an unexpired code once and returns the bound principal', async () => {
    await methods.createDashboardCode(codeData());
    const first = await methods.consumeDashboardCode(consumeData());
    expect(first).toMatchObject({ userId: 'user-1', tenantId: 'tenant-1', sid: 'sid-1' });
    expect(await methods.consumeDashboardCode(consumeData())).toBeNull();
  });

  it('lets exactly one of many concurrent redemptions win', async () => {
    await methods.createDashboardCode(codeData());
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        methods.consumeDashboardCode(consumeData({ sid: `sid-${i}`, handleHash: `h-${i}` })),
      ),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('refuses an expired code even before the TTL index removes it', async () => {
    await methods.createDashboardCode(codeData({ expiresAt: plus(60) }));
    expect(await methods.consumeDashboardCode(consumeData({ now: plus(60) }))).toBeNull();
    expect(await methods.consumeDashboardCode(consumeData({ now: plus(61) }))).toBeNull();
    expect(await methods.consumeDashboardCode(consumeData({ now: plus(59) }))).not.toBeNull();
  });

  it('returns null for an unknown code and exposes consumed state for replay detection', async () => {
    expect(await methods.consumeDashboardCode(consumeData({ codeHash: 'missing' }))).toBeNull();
    await methods.createDashboardCode(codeData());
    await methods.consumeDashboardCode(consumeData());
    const record = await methods.findDashboardCode('hash-a');
    expect(record?.consumedAt).toEqual(NOW);
  });

  it('stores only the hashes it is given', async () => {
    await methods.createDashboardCode(codeData());
    await methods.consumeDashboardCode(consumeData());
    const raw = await mongoose.models.DashboardCode.findOne({}).lean();
    expect(Object.keys(raw ?? {}).sort()).toEqual(
      [
        '__v',
        '_id',
        'codeHash',
        'consumedAt',
        'createdAt',
        'expiresAt',
        'handleExpiresAt',
        'handleHash',
        'purgeAt',
        'sid',
        'tenantId',
        'userId',
      ].sort(),
    );
  });

  it('revokes a handle once, directly or via its originating code', async () => {
    await methods.createDashboardCode(codeData());
    await methods.consumeDashboardCode(consumeData());
    expect(await methods.revokeDashboardHandle('handle-hash-1', plus(5))).toBe(true);
    expect(await methods.revokeDashboardHandle('handle-hash-1', plus(6))).toBe(false);
    expect(await methods.revokeDashboardHandle('unknown', plus(6))).toBe(false);
    expect((await methods.findDashboardHandle('handle-hash-1'))?.revokedAt).toEqual(plus(5));

    await methods.createDashboardCode(codeData({ codeHash: 'hash-b', userId: 'user-2' }));
    await methods.consumeDashboardCode(
      consumeData({ codeHash: 'hash-b', handleHash: 'handle-hash-2' }),
    );
    expect(await methods.revokeDashboardHandleByCode('hash-b', plus(7))).toBe(true);
    expect(await methods.revokeDashboardHandleByCode('hash-b', plus(8))).toBe(false);
  });

  it('does not revoke an unconsumed code through the code path', async () => {
    await methods.createDashboardCode(codeData());
    expect(await methods.revokeDashboardHandleByCode('hash-a', plus(1))).toBe(false);
  });

  it('supersedes only pending codes for the same user and tenant', async () => {
    await methods.createDashboardCode(codeData({ codeHash: 'p1' }));
    await methods.createDashboardCode(codeData({ codeHash: 'p2', tenantId: 'tenant-2' }));
    await methods.createDashboardCode(codeData({ codeHash: 'p3', userId: 'user-2' }));
    await methods.createDashboardCode(codeData({ codeHash: 'used' }));
    await methods.consumeDashboardCode(consumeData({ codeHash: 'used', handleHash: 'hh' }));

    expect(await methods.deletePendingDashboardCodes('user-1', 'tenant-1')).toBe(1);
    expect(await methods.findDashboardCode('p1')).toBeNull();
    expect(await methods.findDashboardCode('p2')).not.toBeNull();
    expect(await methods.findDashboardCode('p3')).not.toBeNull();
    expect(await methods.findDashboardCode('used')).not.toBeNull();
  });

  it('rejects a duplicate code hash instead of overwriting', async () => {
    await methods.createDashboardCode(codeData());
    await expect(methods.createDashboardCode(codeData())).rejects.toBeDefined();
  });
});
