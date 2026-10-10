import { useState } from 'react';
import { Plus, Trash2, Edit2, X, Save, Loader2 } from 'lucide-react';
import { Button, useToastContext, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Input, Textarea, Label, Badge } from '@librechat/client';
import { useGetAgentCategoriesQuery, useCreateAgentCategoryMutation, useUpdateAgentCategoryMutation, useDeleteAgentCategoryMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const initialCategoryForm = {
  value: '',
  label: '',
  description: '',
  order: 0,
  isActive: true,
};

interface CategoriesManagerProps {
  /** If true, only show categories the current user created (for personal categories) */
  personalOnly?: boolean;
  /** Custom trigger element. If not provided, renders nothing (use as child of Dialog) */
  trigger?: React.ReactNode;
  /** Title override */
  title?: string;
  /** Whether to show the "Create Category" button */
  showCreateButton?: boolean;
  /** Called when categories change (for parent to refresh) */
  onCategoriesChange?: () => void;
}

export function CategoriesManager({
  personalOnly = false,
  trigger,
  title,
  showCreateButton = true,
  onCategoriesChange,
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

  const { data: categories, refetch: refetchCategories } = useGetAgentCategoriesQuery({
    staleTime: 0,
  });

  const createMutation = useCreateAgentCategoryMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_category_created') });
      setIsCreating(false);
      setEditingCategory(null);
      refetchCategories();
      onCategoriesChange?.();
    },
    onError: (error) => {
      showToast({ status: 'error', message: error?.response?.data?.error || localize('com_ui_error_create_category') });
    },
  });

  const updateMutation = useUpdateAgentCategoryMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_category_updated') });
      setEditingCategory(null);
      refetchCategories();
      onCategoriesChange?.();
    },
    onError: (error) => {
      showToast({ status: 'error', message: error?.response?.data?.error || localize('com_ui_error_update_category') });
    },
  });

  const deleteMutation = useDeleteAgentCategoryMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_category_deleted') });
      refetchCategories();
      onCategoriesChange?.();
    },
    onError: (error) => {
      showToast({ status: 'error', message: error?.response?.data?.error || localize('com_ui_error_delete_category') });
    },
  });

  const handleCreateCategory = () => {
    setEditingCategory({ ...initialCategoryForm });
    setIsCreating(true);
  };

  const handleEditCategory = (cat) => {
    setEditingCategory({
      value: cat.value,
      label: cat.label,
      description: cat.description || '',
      order: cat.order ?? 0,
      isActive: cat.isActive !== false,
    });
  };

  const handleDeleteCategory = (value) => {
    if (window.confirm(localize('com_ui_confirm_delete_category', { value }))) {
      deleteMutation.mutate(value);
    }
  };

  const handleSubmitCategory = (e) => {
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
        label: editingCategory.label,
        description: editingCategory.description,
        order: editingCategory.order,
        isActive: editingCategory.isActive,
      });
    }
  };

  const handleCancelCategory = () => {
    setEditingCategory(null);
    setIsCreating(false);
  };

  const sourceBadge = (source?: string) => {
    if (!source) return null;
    const variants = {
      user: 'bg-surface-submit text-white',
      yaml: 'bg-amber-500 text-white',
      default: 'bg-surface-tertiary text-text-secondary',
    };
    const labels = {
      user: localize('com_ui_category_source_user'),
      yaml: localize('com_ui_category_source_yaml'),
      default: localize('com_ui_category_source_default'),
    };
    return (
      <Badge variant="outline" className={cn(variants[source], 'text-xs')}>
        {labels[source]}
      </Badge>
    );
  };

  const filteredCategories = (categories || []).filter((cat) => {
    // Skip system categories
    if (cat.value === 'promoted' || cat.value === 'all') return false;
    // If personalOnly, only show user-created categories
    if (personalOnly && cat.source !== 'user') return false;
    return true;
  });

  const dialogContent = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DialogTitle className="text-lg">
          {title || localize('com_agents_categories')}
        </DialogTitle>
        {showCreateButton && !editingCategory && !isCreating && (
          <Button size="sm" variant="outline" onClick={handleCreateCategory}>
            <Plus className="size-4 mr-2" />
            {localize('com_ui_add_category')}
          </Button>
        )}
      </div>

      {editingCategory && (
        <form onSubmit={handleSubmitCategory} className="space-y-4 p-4 border-border-light border rounded-theme-surface bg-surface-secondary">
          <DialogTitle className="text-base">
            {isCreating ? localize('com_ui_create_category') : localize('com_ui_edit_category')}
          </DialogTitle>
          <div className="space-y-3">
            <div>
              <Label htmlFor="category-value">{localize('com_ui_category_value')}</Label>
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
              <Label htmlFor="category-label">{localize('com_ui_category_label')}</Label>
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
              <Label htmlFor="category-description">{localize('com_ui_category_description')}</Label>
              <Textarea
                id="category-description"
                value={editingCategory.description}
                onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                placeholder="EU/UK compliance agents"
                className="mt-1 min-h-[80px]"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="category-order">{localize('com_ui_category_order')}</Label>
                <Input
                  id="category-order"
                  type="number"
                  value={editingCategory.order}
                  onChange={(e) => setEditingCategory({ ...editingCategory, order: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                  min={0}
                />
              </div>
              <div className="flex items-end">
                <Label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingCategory.isActive}
                    onChange={(e) => setEditingCategory({ ...editingCategory, isActive: e.target.checked })}
                    className="size-4"
                  />
                  <span className="text-sm">{localize('com_ui_category_active')}</span>
                </Label>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button type="button" variant="outline" onClick={handleCancelCategory}>
              <X className="size-4 mr-2" />
              {localize('com_ui_cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {localize('com_ui_saving')}
                </>
              ) : (
                <>
                  <Save className="size-4 mr-2" />
                  {localize('com_ui_save')}
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {filteredCategories.length > 0 && (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {filteredCategories.map((cat) => (
            <div
              key={cat.value}
              className={cn(
                'flex items-center justify-between p-3 border-border-light border rounded-theme-surface bg-surface-secondary',
              )}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="font-medium truncate">{cat.label}</div>
                {cat.description && <span className="text-xs text-text-muted truncate">{cat.description}</span>}
                <span className="text-xs text-text-muted">({cat.value})</span>
                {sourceBadge(cat.source)}
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'px-2 py-0.5 text-xs rounded-full',
                  cat.isActive === false
                    ? 'bg-red-500/10 text-red-500'
                    : 'bg-green-500/10 text-green-500'
                )}>
                  {cat.isActive === false ? localize('com_ui_hidden') : localize('com_ui_active')}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-8 text-text-secondary hover:text-text-primary"
                  onClick={() => handleEditCategory(cat)}
                  aria-label={localize('com_ui_edit_category')}
                >
                  <Edit2 className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-8 text-text-secondary hover:text-red-500"
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
        <div className="text-center py-8 text-text-secondary">
          {personalOnly
            ? localize('com_ui_no_personal_categories')
            : localize('com_ui_no_categories')}
        </div>
      )}
    </div>
  );

  if (trigger) {
    return (
      <Dialog>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="w-11/12 max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title || localize('com_agents_categories')}</DialogTitle>
          </DialogHeader>
          {dialogContent}
        </DialogContent>
      </Dialog>
    );
  }

  return <>{dialogContent}</>;
}

export default CategoriesManager;