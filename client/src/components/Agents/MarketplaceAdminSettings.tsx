import React, { useState } from 'react';
import { ShieldEllipsis, FolderCog } from 'lucide-react';
import { Button, useToastContext, Switch, Label } from '@librechat/client';
import { Permissions, PermissionTypes, SystemRoles } from 'librechat-data-provider';
import type { PermissionConfig } from '~/components/ui';
import { useUpdateMarketplacePermissionsMutation, useGetStartupConfig } from '~/data-provider';
import { AdminSettingsDialog } from '~/components/ui';
import { useLocalize, useAuthContext } from '~/hooks';

const permissions: PermissionConfig[] = [
  { permission: Permissions.USE, labelKey: 'com_ui_marketplace_allow_use' },
];

const MarketplaceAdminSettings = () => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { user } = useAuthContext();

  const { data: startupConfig } = useGetStartupConfig();
  const [allowUsers, setAllowUsers] = useState(
    startupConfig?.interface?.marketplace?.allowUserCategories !== false,
  );

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

  const isAdmin = user?.role === SystemRoles.ADMIN;

  const extraContent = isAdmin ? (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="flex flex-col gap-0.5 min-w-0">
        <Label className="text-text-primary text-sm font-medium cursor-pointer select-none truncate">
          {localize('com_ui_marketplace_allow_user_categories')}
        </Label>
        <p className="text-xs text-text-secondary truncate">
          {localize('com_ui_marketplace_allow_user_categories_help')}
        </p>
      </div>
      <Switch
        checked={allowUsers}
        onCheckedChange={(checked) => {
          setAllowUsers(checked);
          showToast({
            status: 'success',
            message: localize('com_ui_saved'),
          });
        }}
        aria-label={localize('com_ui_marketplace_allow_user_categories')}
      />
    </div>
  ) : null;

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
