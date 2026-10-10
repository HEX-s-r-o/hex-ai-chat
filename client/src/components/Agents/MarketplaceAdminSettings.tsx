import { ShieldEllipsis } from 'lucide-react';
import { Button, useToastContext, Switch } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { PermissionConfig } from '~/components/ui';
import { useUpdateMarketplacePermissionsMutation, useGetStartupConfig } from '~/data-provider';
import { AdminSettingsDialog } from '~/components/ui';
import { useLocalize } from '~/hooks';
import CategoriesManager from './CategoriesManager';
import { Label } from '@librechat/client';

const permissions: PermissionConfig[] = [
  { permission: Permissions.USE, labelKey: 'com_ui_marketplace_allow_use' },
];

const MarketplaceAdminSettings = () => {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const { data: startupConfig } = useGetStartupConfig();
  const allowUserCategories = startupConfig?.interface?.marketplace?.allowUserCategories !== false;

  const permissionsMutation = useUpdateMarketplacePermissionsMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_saved') });
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_ui_error_save_admin_settings') });
    },
  });

  /* `outline` matches the search field it sits beside — same border token, same
     radius — and `size-9` keeps the two controls the same height. */
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
    <div className="border-border-light border-t pt-4 mt-4">
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
    </div>
  );

  return (
    <AdminSettingsDialog
      permissionType={PermissionTypes.MARKETPLACE}
      sectionKey="com_ui_marketplace"
      permissions={permissions}
      menuId="marketplace-role-dropdown"
      mutation={permissionsMutation}
      trigger={trigger}
      showAdminWarning={false}
      extraContent={extraContent}
    />
  );
};

export default MarketplaceAdminSettings;