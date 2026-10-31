import { Model } from 'mongoose';
import type * as t from '~/types';
import dashboardCodeSchema from '~/schema/dashboardCode';

/**
 * Codes are redeemed by the dashboard backend, which has no user context, so automatic tenant
 * isolation would be the wrong boundary. Methods and callers compare tenants explicitly.
 */
export function createDashboardCodeModel(
  mongoose: typeof import('mongoose'),
): Model<t.IDashboardCode> {
  return (
    mongoose.models.DashboardCode ||
    mongoose.model<t.IDashboardCode>('DashboardCode', dashboardCodeSchema)
  );
}
