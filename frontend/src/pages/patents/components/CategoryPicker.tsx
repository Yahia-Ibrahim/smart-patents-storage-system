import { useState } from 'react';
import { Button, Input, Spinner } from '@/components/ui';
import { CheckIcon, PlusIcon } from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { ApiClientError } from '@/services/apiClient';
import { catalogService } from '@/services/catalogService';

interface CategoryPickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select over the shared taxonomy.
 *
 * Toggle chips rather than a `<select multiple>`: the list is short, the
 * selection is the thing worth showing, and ctrl-clicking a native multi-select
 * is a control almost nobody discovers.
 *
 * The API rejects a repeated id rather than deduplicating it — a repeat means
 * the client built the request wrong — so selection is modelled as a set here
 * and a duplicate is not representable.
 */
export function CategoryPicker({ selected, onChange, disabled }: CategoryPickerProps) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useAsync(
    (signal) => catalogService.listCategories(undefined, signal),
    [],
  );

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const create = async () => {
    const name = newName.trim();
    if (name.length < 2) return;

    setSaving(true);
    try {
      const category = await catalogService.createCategory(name);
      onChange([...selected, category.id]);
      setNewName('');
      setCreating(false);
      refetch();
      toast.success(`Added “${category.name}”`);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not create that category.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner label="Loading categories" />;

  if (error) {
    return (
      <p className="picker__error">
        Categories could not be loaded.{' '}
        <button type="button" className="linkish" onClick={refetch}>
          Retry
        </button>
      </p>
    );
  }

  const categories = data?.categories ?? [];

  return (
    <div className="picker">
      {categories.length === 0 ? (
        <p className="patents__muted">
          No categories exist yet.
          {!isAdmin && ' An administrator can add them.'}
        </p>
      ) : (
        <div className="picker__chips">
          {categories.map((category) => {
            const on = selected.includes(category.id);
            return (
              <button
                key={category.id}
                type="button"
                disabled={disabled}
                className={`picker__chip ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggle(category.id)}
              >
                {on && <CheckIcon size={14} />}
                {category.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Only admins may extend the taxonomy: it is shared across every filing,
          so letting any submitter add to it is how you get forty spellings of
          the same field. */}
      {isAdmin &&
        (creating ? (
          <div className="picker__create">
            <Input
              value={newName}
              autoFocus
              placeholder="New category name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  create();
                }
                if (e.key === 'Escape') setCreating(false);
              }}
            />
            <Button type="button" size="sm" loading={saving} onClick={create}>
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="linkish picker__add"
            onClick={() => setCreating(true)}
            disabled={disabled}
          >
            <PlusIcon size={14} /> New category
          </button>
        ))}
    </div>
  );
}
