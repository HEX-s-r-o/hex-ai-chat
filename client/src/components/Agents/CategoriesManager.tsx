import { useState } from 'react';
import { Plus, Trash2, Edit2, X, Save, Loader2, FolderOpen } from 'lucide-react';
import { Button, useToastContext, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, Input, Textarea, Label, Badge } from '@librechat/client';
import { useGetAgentCategoriesQuery, useCreateAgentCategoryMutation, useUpdateAgentCategoryMutation, useDeleteAgentCategoryMutation } from '~/data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize, TranslationKeys } from '~/hooks';
import { cn } from '~/utils';
import type t from 'librechat-data-provider';

const initialCategoryForm = {
  value: '',
  label: '',
  description: '',
  order: 0,
  isActive: true,
};

interface CategoriesManagerProps {
  personalOnly?: boolean;
  title?: string;
  showCreateButton?: boolean;
  onCategoriesChange?: () => void;
  standalone?: boolean;
}

export function CategoriesManager({
  personalOnly = false,
  title,
  showCreateButton = true,
  onCategoriesChange,
  standalone = false,
}: CategoriesManagerProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [editingCategory, setEditingCategory] = useState<{
    value: string;
    label: string;
    description: string;
    order: number;
    isActive: boolean;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const { data: categories, refetch: refetchCategories } = useGetAgentCategoriesQuery(
    { includeInactive: true },
    { staleTime: 0 },
  );

  const { data: startupConfig } = useGetStartupConfig();
  const allowUserCategories = startupConfig?.interface?.marketplace?.allowUserCategories !== false;
  const isAdmin = false;

  const createMutation = useCreateAgentCategoryMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_category_created') });
      setIsCreating(false);
      setEditingCategory(null);
      refetchCategories();
      onCategoriesChange?.();
    },
    onError: (error: unknown) => {
      const axiosError = error as { response?: { data?: { error?: string } } };
      showToast({ status: 'error', message: axiosError.response?.data?.error || localize('com_ui_error_create_category') });
    },
  });

  const updateMutation = useUpdateAgentCategoryMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_category_updated') });
      setEditingCategory(null);
      refetchCategories();
      onCategoriesChange?.();
    },
    onError: (error: unknown) => {
      const axiosError = error as { response?: { data?: { error?: string } } };
      showToast({ status: 'error', message: axiosError.response?.data?.error || localize('com_ui_error_update_category') });
    },
  });

  const deleteMutation = useDeleteAgentCategoryMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_category_deleted') });
      refetchCategories();
      onCategoriesChange?.();
    },
    onError: (error: unknown) => {
      const axiosError = error as { response?: { data?: { error?: string } } };
      showToast({ status: 'error', message: axiosError.response?.data?.error || localize('com_ui_error_delete_category') });
    },
  });

  const handleCreateCategory = () => {
    if (!allowUserCategories && !isAdmin) {
      showToast({ status: 'error', message: localize('com_ui_category_user_creation_disabled') });
      return;
    }
    setEditingCategory({ ...initialCategoryForm });
    setIsCreating(true);
  };

  const handleEditCategory = (cat) => {
    if (!allowUserCategories && !isAdmin && cat.source !== 'yaml') {
      showToast({ status: 'error', message: localize('com_ui_category_user_edit_disabled') });
      return;
    }
    setEditingCategory({
      value: cat.value,
      label: cat.label,
      description: cat.description || '',
      order: cat.order ?? 0,
      isActive: cat.isActive !== false,
    });
  };

  const handleDeleteCategory = (value) => {
    if (!allowUserCategories && !isAdmin) {
      showToast({ status: 'error', message: localize('com_ui_category_user_delete_disabled') });
      return;
    }
    if (window.confirm(localize('com_ui_confirm_delete_category', { value }))) {
      deleteMutation.mutate(value);
    }
  };

  const handleSubmitCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;

    if (isCreating) {
      createMutation.mutate({
        value: editingCategory.value,
        label: editingCategory.label,
        description: editingCategory.description,
        order: editingCategory.order,
      });
    } else {
      updateMutation.mutate({
        value: editingCategory.value,
        data: {
          label: editingCategory.label,
          description: editingCategory.description,
          order: editingCategory.order,
          isActive: editingCategory.isActive,
        },
      });
    }
  };

  const handleCancelCategory = () => {
    setEditingCategory(null);
    setIsCreating(false);
  };

  const getCategoryDisplayName = (category: t.TMarketplaceCategory) => {
    if (category.value === 'promoted') return localize('com_agents_top_picks');
    if (category.value === 'all') return localize('com_agents_all_category');
    if (category.label && category.label.startsWith('com_')) {
      return localize(category.label as TranslationKeys);
    }
    return category.label || category.value.charAt(0).toUpperCase() + category.value.slice(1);
  };

  const sourceBadge = (source?: string) => {
    if (!source) return null;
    const variants = {
      user: 'bg-surface-submit text-white',
      yaml: 'bg-amber-500 text-white',
      default: 'bg-surface-tertiary text-text-secondary',
    };
    const labels = {
      user: localize('com_ui_category_source_user') || 'Custom',
      yaml: localize('com_ui_category_source_yaml') || 'Config',
      default: localize('com_ui_category_source_default') || 'Default',
    };
    return (
      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', variants[source])}>
        {labels[source]}
      </span>
    );
  };

  const filteredCategories = (categories || []).filter((cat) => {
    if (cat.value === 'promoted' || cat.value === 'all') return false;
    if (personalOnly && cat.source !== 'user') return false;
    return true;
  });

  const content = (
    <div className="flex flex-col gap-4 p-6 w-full max-w-2xl mx-auto">
      {!standalone && (
        <DialogHeader className="px-0 pt-0 pb-2">
          <DialogTitle className="text-xl font-semibold">{title || localize('com_agents_categories')}</DialogTitle>
          <DialogDescription className="text-sm text-text-secondary">{localize('com_agents_categories_description')}</DialogDescription>
        </DialogHeader>
      )}

      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        <div className="flex items-center justify-between pb-2">
          {showCreateButton && !editingCategory && !isCreating && (
            <Button size="sm" variant="submit" onClick={handleCreateCategory} className="gap-2">
              <Plus className="size-4" />
              {localize('com_ui_add_category')}
            </Button>
          )}
        </div>

        {editingCategory && (
          <form onSubmit={handleSubmitCategory} className="space-y-4 p-5 border border-border-medium rounded-2xl bg-surface-primary shadow-sm">
            <div className="text-base font-semibold text-text-primary">
              {isCreating ? localize('com_ui_create_category') : localize('com_ui_edit_category')}
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="category-value" className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{localize('com_ui_category_value')}</Label>
                <Input
                  id="category-value"
                  value={editingCategory.value}
                  onChange={(e) => setEditingCategory({ ...editingCategory, value: e.target.value })}
                  placeholder="regulatory"
                  disabled={!isCreating}
                  className="mt-1"
                  required
                />
                <p className="text-xs text-text-muted mt-1">{localize('com_ui_category_value_help')}</p>
              </div>
              <div>
                <Label htmlFor="category-label" className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{localize('com_ui_category_label')}</Label>
                <Input
                  id="category-label"
                  value={editingCategory.label}
                  onChange={(e) => setEditingCategory({ ...editingCategory, label: e.target.value })}
                  placeholder="Regulatory"
                  className="mt-1"
                  required
                />
              </div>
              <div>
                <Label htmlFor="category-description" className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{localize('com_ui_category_description')}</Label>
                <Textarea
                  id="category-description"
                  value={editingCategory.description}
                  onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                  placeholder="EU/UK compliance agents"
                  className="mt-1 min-h-[70px]"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div>
                  <Label htmlFor="category-order" className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{localize('com_ui_category_order')}</Label>
                  <Input
                    id="category-order"
                    type="number"
                    value={editingCategory.order}
                    onChange={(e) => setEditingCategory({ ...editingCategory, order: parseInt(e.target.value) || 0 })}
                    className="mt-1"
                    min={0}
                  />
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editingCategory.isActive}
                      onChange={(e) => setEditingCategory({ ...editingCategory, isActive: e.target.checked })}
                      className="size-4 rounded border-border-medium text-surface-submit focus:ring-surface-submit"
                    />
                    <span className="text-sm font-medium text-text-primary">{localize('com_ui_category_active')}</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
              <Button type="button" variant="outline" onClick={handleCancelCategory} size="sm">
                <X className="size-4 mr-1.5" />
                {localize('com_ui_cancel')}
              </Button>
              <Button type="submit" variant="submit" size="sm" disabled={createMutation.isLoading || updateMutation.isLoading}>
                {createMutation.isLoading || updateMutation.isLoading ? (
                  <>
                    <Loader2 className="size-4 mr-1.5 animate-spin" />
                    {localize('com_ui_saving')}
                  </>
                ) : (
                  <>
                    <Save className="size-4 mr-1.5" />
                    {localize('com_ui_save')}
                  </>
                )}
              </Button>
            </div>
          </form>
        )}

        {filteredCategories.length > 0 && (
          <div className="space-y-2.5">
            {filteredCategories.map((cat) => (
              <div
                key={cat.value}
                className="flex items-center justify-between p-3.5 border border-border-light rounded-2xl bg-surface-secondary shadow-2xs gap-3 transition-colors hover:border-border-medium"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="font-semibold text-text-primary truncate">{getCategoryDisplayName(cat)}</div>
                  {cat.description && <span className="text-xs text-text-muted truncate hidden md:inline">{cat.description}</span>}
                  <span className="text-xs text-text-muted shrink-0 font-mono">({cat.value})</span>
                  {sourceBadge(cat.source)}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className={cn(
                    'px-2.5 py-0.5 text-xs rounded-full font-medium',
                    cat.isActive === false
                      ? 'bg-red-500/10 text-red-500'
                      : 'bg-green-500/10 text-green-500'
                  )}>
                    {cat.isActive === false ? localize('com_ui_hidden') : localize('com_ui_active')}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="size-8 text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                    onClick={() => handleEditCategory(cat)}
                    aria-label={localize('com_ui_edit_category')}
                  >
                    <Edit2 className="size-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="size-8 text-text-secondary hover:text-red-500 hover:bg-red-500/10"
                    onClick={() => handleDeleteCategory(cat.value)}
                    aria-label={localize('com_ui_delete_category')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredCategories.length === 0 && (
          <div className="text-center py-12 text-text-secondary text-sm">
            {personalOnly
              ? localize('com_ui_no_personal_categories')
              : localize('com_ui_no_categories')}
          </div>
        )}
      </div>
    </div>
  );

  if (standalone) {
    return content;
  }

  return (
    <DialogContent className="w-11/12 max-w-2xl max-h-[85vh] overflow-hidden p-0">
      {content}
    </DialogContent>
  );
}

export default CategoriesManager;