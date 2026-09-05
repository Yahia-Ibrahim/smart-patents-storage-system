import { useState } from 'react';
import { Button, Input, Modal, FormField, Spinner } from '@/components/ui';
import { CloseIcon, PlusIcon, SearchIcon, UserIcon } from '@/components/icons';
import { useToast } from '@/context/ToastContext';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { ApiClientError } from '@/services/apiClient';
import { catalogService } from '@/services/catalogService';
import type { Inventor } from '@/types';

export interface SelectedInventor {
  inventorId: string;
  fullName: string;
  organization: string | null;
}

interface InventorPickerProps {
  selected: SelectedInventor[];
  onChange: (inventors: SelectedInventor[]) => void;
  disabled?: boolean;
}

/**
 * Named inventors, in order.
 *
 * Order is the whole reason this is a list and not another chip picker: on a
 * patent, first-named inventor is a real distinction, and the API enforces that
 * the orders form a contiguous 1..N. Rather than ask the user to type numbers,
 * position in this list *is* the order, and the index is what gets submitted —
 * so a gap is not expressible.
 *
 * An inventor is a separate record from a user account, because a named
 * inventor need not have signed up. Hence "create" here rather than "invite".
 */
export function InventorPicker({ selected, onChange, disabled }: InventorPickerProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const debounced = useDebounced(search, 300);
  const { data, loading, refetch } = useAsync(
    (signal) => catalogService.listInventors({ search: debounced.trim() || undefined, limit: 8 }, signal),
    [debounced],
  );

  const add = (inventor: Inventor) => {
    if (selected.some((entry) => entry.inventorId === inventor.id)) return;

    onChange([
      ...selected,
      {
        inventorId: inventor.id,
        fullName: inventor.fullName,
        organization: inventor.organization,
      },
    ]);
    setSearch('');
  };

  const remove = (inventorId: string) =>
    onChange(selected.filter((entry) => entry.inventorId !== inventorId));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= selected.length) return;

    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const results = (data?.inventors ?? []).filter(
    (inventor) => !selected.some((entry) => entry.inventorId === inventor.id),
  );

  return (
    <div className="picker">
      {selected.length > 0 && (
        <ol className="inventors">
          {selected.map((entry, index) => (
            <li key={entry.inventorId} className="inventors__row">
              <span className="inventors__order" aria-label={`Position ${index + 1}`}>
                {index + 1}
              </span>
              <span className="inventors__body">
                <span className="inventors__name">{entry.fullName}</span>
                {entry.organization && (
                  <span className="patents__muted">{entry.organization}</span>
                )}
              </span>
              <span className="inventors__controls">
                <button
                  type="button"
                  className="inventors__move"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${entry.fullName} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="inventors__move"
                  disabled={disabled || index === selected.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${entry.fullName} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="inventors__remove"
                  disabled={disabled}
                  onClick={() => remove(entry.inventorId)}
                  aria-label={`Remove ${entry.fullName}`}
                >
                  <CloseIcon size={16} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="picker__search">
        <Input
          type="search"
          value={search}
          disabled={disabled}
          leftIcon={<SearchIcon size={18} />}
          placeholder="Search inventors by name, email or organisation…"
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search inventors"
        />
        <Button
          type="button"
          variant="secondary"
          leftIcon={<PlusIcon size={16} />}
          disabled={disabled}
          onClick={() => setCreating(true)}
        >
          New
        </Button>
      </div>

      {loading ? (
        <Spinner label="Searching inventors" />
      ) : results.length > 0 ? (
        <ul className="picker__results">
          {results.map((inventor) => (
            <li key={inventor.id}>
              <button
                type="button"
                className="picker__result"
                disabled={disabled}
                onClick={() => add(inventor)}
              >
                <UserIcon size={16} />
                <span className="picker__result-name">{inventor.fullName}</span>
                {inventor.organization && (
                  <span className="patents__muted">{inventor.organization}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="patents__muted picker__none">
          {debounced.trim()
            ? 'No inventors match that search.'
            : 'Search for an inventor, or create one.'}
        </p>
      )}

      <NewInventorModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(inventor) => {
          add(inventor);
          setCreating(false);
          refetch();
          toast.success(`Added ${inventor.fullName}`);
        }}
      />
    </div>
  );
}

function NewInventorModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (inventor: Inventor) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [linkToMe, setLinkToMe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const reset = () => {
    setFullName('');
    setEmail('');
    setOrganization('');
    setLinkToMe(false);
    setFieldErrors({});
    setFormError(null);
  };

  const submit = async () => {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const inventor = await catalogService.createInventor({
        fullName: fullName.trim(),
        email: email.trim(),
        organization: organization.trim() || undefined,
        linkToMe,
      });
      reset();
      onCreated(inventor);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fieldErrors());
        // A 409 (this email is already an inventor) has no field attached, so
        // it would otherwise vanish entirely.
        if (Object.keys(err.fieldErrors()).length === 0) setFormError(err.message);
      } else {
        setFormError('Could not create that inventor.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New inventor"
      description="An inventor is a person named on a filing. They do not need an account here."
      size="sm"
      dismissible={!saving}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={fullName.trim().length < 2 || !email.trim()}
            onClick={submit}
          >
            Create inventor
          </Button>
        </>
      }
    >
      {formError && <p className="picker__error">{formError}</p>}

      <FormField label="Full name" required error={fieldErrors.fullName}>
        {({ id, invalid }) => (
          <Input
            id={id}
            value={fullName}
            invalid={invalid}
            autoFocus
            onChange={(e) => setFullName(e.target.value)}
          />
        )}
      </FormField>

      <FormField label="Email" required error={fieldErrors.email}>
        {({ id, invalid }) => (
          <Input
            id={id}
            type="email"
            value={email}
            invalid={invalid}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </FormField>

      <FormField label="Organisation" optional error={fieldErrors.organization}>
        {({ id, invalid }) => (
          <Input
            id={id}
            value={organization}
            invalid={invalid}
            onChange={(e) => setOrganization(e.target.value)}
          />
        )}
      </FormField>

      <label className="picker__link-me">
        <input
          type="checkbox"
          checked={linkToMe}
          onChange={(e) => setLinkToMe(e.target.checked)}
        />
        <span>This is me — link it to my account</span>
      </label>
    </Modal>
  );
}
