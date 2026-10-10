import React from 'react';
import { ShieldEllipsis } from 'lucide-react';
import { Button, useToastContext, Switch, Label } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { PermissionConfig } from '~/components/ui';
import { useUpdateMarketplacePermissionsMutation, useGetStartupConfig } from '~/data-provider';
import { AdminSettingsDialog } from '~/components/ui';
import { useLocalize } from '~/hooks';
import CategoriesManager from './CategoriesManager';

const permissions: PermissionConfig[] = [
  { permission: Permissions.USE, labelKey: 'com_ui_marketplace_allow_use' },
];

const MarketplaceAdminSettings = () => {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const { data: startupConfig } = useGetStartupConfig();
  const allowUserCategories = startupConfig?.interface?.marketplace?.allowUserCategories !== false;

  const mutation = useUpdateMarketplacePermissionsMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_saved') });
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_ui_error_save_admin_settings') });
    },
  });

  const trigger = (
    <Button
      size="icon-sm"
      variant="outline"
      className="size-9 shrink-0 transition-none"
      aria-label={localize('com_ui_admin_settings')}
    >
      <ShieldEllipsis className="size-4" aria-hidden="true" />
    </Button>
  );

  const extraContent = (
    <div className="space-y-4 pt-4 mt-4 border-t border-border-light">
      <div className="flex items-center justify-between p-3">
        <div className="flex flex-col gap-1">
          <Label className="text-sm font-medium text-text-primary">
            {localize('com_ui_marketplace_allow_user_categories')}
          </Label>
          <p className="text-xs text-text-secondary">
            {localize('com_ui_marketplace_allow_user_categories_help')}
          </p>
        </div>
        <Switch
          checked={allowUserCategories}
          onCheckedChange={() => {
            showToast({
              status: 'info',
              message: localize('com_ui_feature_coming_soon'),
            });
          }}
          disabled
          aria-label={localize('com_ui_marketplace_allow_user_categories')}
        />
      </div>
      <div className="border-border-light border-t pt-4">
        <CategoriesManager
          title={localize('com_agents_categories')}
          personalOnly={false}
          standalone={true}
        />
      </div>
    </div>
  );

  return (
    <AdminSettingsDialog
      permissionType={PermissionTypes.MARKETPLACE}
      sectionKey="com_ui_marketplace"
      permissions={permissions}
      menuId="marketplace-role-dropdown"
      mutation={mutation}
      trigger={trigger}
      showAdminWarning={false}
      extraContent={extraContent}
    />
  );
};

export default MarketplaceAdminSettings;
