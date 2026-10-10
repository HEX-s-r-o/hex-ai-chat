import React from 'react';
import { ShieldEllipsis, FolderCog } from 'lucide-react';
import { Button, useToastContext, Switch, Label } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { PermissionConfig } from '~/components/ui';
import { useUpdateMarketplacePermissionsMutation, useGetStartupConfig } from '~/data-provider';
import { AdminSettingsDialog } from '~/components/ui';
import { useLocalize } from '~/hooks';

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
    <div className="space-y-4 pt-5 mt-5 border-t border-border-light">
      <div className="flex items-center justify-between p-4 rounded-2xl bg-surface-secondary border border-border-light shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="border-border-light bg-surface-primary text-text-primary flex size-9 shrink-0 items-center justify-center rounded-xl border">
            <FolderCog className="size-4" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <Label className="text-sm font-semibold text-text-primary truncate">
              {localize('com_ui_marketplace_allow_user_categories')}
            </Label>
            <p className="text-xs text-text-secondary truncate">
              {localize('com_ui_marketplace_allow_user_categories_help')}
            </p>
          </div>
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
