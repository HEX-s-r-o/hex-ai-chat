import { Schema } from 'mongoose';
import type { IDashboardCode } from '~/types';

const dashboardCodeSchema: Schema<IDashboardCode> = new Schema<IDashboardCode>({
  codeHash: { type: String, required: true },
  userId: { type: String, required: true },
  tenantId: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  purgeAt: { type: Date, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
  consumedAt: { type: Date },
  sid: { type: String },
  handleHash: { type: String },
  handleExpiresAt: { type: Date },
  revokedAt: { type: Date },
});

dashboardCodeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
dashboardCodeSchema.index({ codeHash: 1 }, { unique: true });
dashboardCodeSchema.index({ handleHash: 1 }, { sparse: true });
dashboardCodeSchema.index({ userId: 1, tenantId: 1 });

export default dashboardCodeSchema;
