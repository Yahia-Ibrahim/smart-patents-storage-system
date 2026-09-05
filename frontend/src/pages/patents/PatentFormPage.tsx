import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { ArrowLeftIcon } from '@/components/icons';
import { useToast } from '@/context/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { ApiClientError } from '@/services/apiClient';
import { isEditable, patentService } from '@/services/patentService';
import type { PatentInput } from '@/services/patentService';
import { CategoryPicker } from './components/CategoryPicker';
import { DocumentField } from './components/DocumentField';
import { InventorPicker } from './components/InventorPicker';
import type { SelectedInventor } from './components/InventorPicker';
import './Patents.css';

/** Mirrors the API's own bounds so a length mistake is caught before a round trip. */
const LIMITS = {
  title: { min: 3, max: 500 },
  abstract: { min: 20, max: 10000 },
  specification: { min: 20, max: 200000 },
};

interface FormState {
  title: string;
  abstract: string;
  specification: string;
  publicationNumber: string;
  jurisdiction: string;
  documentKey: string | null;
  categoryIds: string[];
  inventors: SelectedInventor[];
}

const EMPTY: FormState = {
  title: '',
  abstract: '',
  specification: '',
  publicationNumber: '',
  jurisdiction: '',
  documentKey: null,
  categoryIds: [],
  inventors: [],
};

export function PatentFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const existing = useAsync(
    (signal) => (id ? patentService.get(id, signal) : Promise.resolve(null)),
    [id],
  );

  // Seed the form once the record arrives. Keyed on the record's identity rather
  // than on `existing.data` alone so a background refetch cannot stomp on edits
  // the user has already typed.
  const loadedId = existing.data?.id;

  useEffect(() => {
    const record = existing.data;
    if (!record) return;

    setForm({
      title: record.title,
      abstract: record.abstract,
      specification: record.specification,
      publicationNumber: record.publicationNumber ?? '',
      jurisdiction: record.jurisdiction ?? '',
      documentKey: null,
      categoryIds: record.categories.map((category) => category.id),
      inventors: record.inventors.map((inventor) => ({
        inventorId: inventor.id,
        fullName: inventor.fullName,
        organization: inventor.organization,
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const localErrors = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    const title = form.title.trim();
    const abstract = form.abstract.trim();
    const specification = form.specification.trim();

    if (title.length < LIMITS.title.min) errors.title = 'Give the filing a title of at least 3 characters.';
    if (abstract.length < LIMITS.abstract.min)
      errors.abstract = 'The abstract must be at least 20 characters.';
    if (specification.length < LIMITS.specification.min)
      errors.specification = 'The specification must be at least 20 characters.';
    if (!editing && !form.documentKey)
      errors.documentKey = 'Attach the filing document before saving.';

    return errors;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const errors = localErrors();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);

    // `order` is the position in the list, 1-based. The API requires a
    // contiguous 1..N and rejects gaps, so deriving it from the index rather
    // than storing it makes a gap unrepresentable.
    const payload: PatentInput = {
      title: form.title.trim(),
      abstract: form.abstract.trim(),
      specification: form.specification.trim(),
      publicationNumber: form.publicationNumber.trim() || null,
      jurisdiction: form.jurisdiction.trim().toUpperCase() || null,
      categoryIds: form.categoryIds,
      inventors: form.inventors.map((inventor, index) => ({
        inventorId: inventor.inventorId,
        order: index + 1,
      })),
    };

    // Only sent when a new file was uploaded in this session. Re-sending the
    // existing key would be accepted but pointless; sending nothing leaves the
    // attached document alone.
    if (form.documentKey) payload.documentKey = form.documentKey;

    try {
      const saved = editing
        ? await patentService.update(id!, payload)
        : await patentService.create(payload);

      toast.success(editing ? 'Filing updated' : 'Draft created', {
        description: editing ? undefined : 'Submit it for review when you are ready.',
      });
      navigate(`/patents/${saved.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError) {
        const byField = error.fieldErrors();
        setFieldErrors(byField);
        if (Object.keys(byField).length === 0) setFormError(error.message);
      } else {
        setFormError('Could not save the filing.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (editing && existing.error) {
    return (
      <>
        <Back id={id} />
        <Card padding="none">
          <ErrorState
            title={existing.error.status === 404 ? 'Filing not found' : 'Could not load this filing'}
            message={existing.error.message}
            onRetry={existing.error.status === 404 ? undefined : existing.refetch}
          />
        </Card>
      </>
    );
  }

  if (editing && existing.loading) {
    return (
      <>
        <Back id={id} />
        <Card>
          <Skeleton width="40%" height={24} />
        </Card>
      </>
    );
  }

  // The API would refuse the write anyway, in the transaction where it matters.
  // Saying so here saves the user filling in a form that cannot be saved.
  if (editing && existing.data && !isEditable(existing.data)) {
    return (
      <>
        <Back id={id} />
        <Card>
          <Alert tone="warning" title="This filing can no longer be edited">
            A filing is editable while it is a draft, or after it has been declined. This one is{' '}
            {existing.data.status.replace('_', ' ')}.
          </Alert>
          <Button onClick={() => navigate(`/patents/${id}`)}>Back to the filing</Button>
        </Card>
      </>
    );
  }

  return (
    <>
      <Back id={id} />

      <PageHeader
        eyebrow={editing ? 'Amendment' : 'New filing'}
        title={editing ? 'Edit filing' : 'File a patent'}
        description={
          editing
            ? 'Changes to the title, abstract, specification or document raise the version. Category and inventor edits do not.'
            : 'Saved as a draft, visible only to you until you submit it for review.'
        }
      />

      <form className="patent-form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Card>
          <CardHeader title="The invention" />

          <FormField label="Title" required error={fieldErrors.title}>
            {({ id: fieldId, invalid }) => (
              <Input
                id={fieldId}
                value={form.title}
                invalid={invalid}
                maxLength={LIMITS.title.max}
                placeholder="A short, descriptive name for the invention"
                onChange={(e) => set('title', e.target.value)}
              />
            )}
          </FormField>

          <FormField
            label="Abstract"
            required
            hint="A summary of the invention. This is what prior-art similarity is explained against."
            error={fieldErrors.abstract}
          >
            {({ id: fieldId, invalid }) => (
              <Textarea
                id={fieldId}
                rows={5}
                value={form.abstract}
                invalid={invalid}
                maxLength={LIMITS.abstract.max}
                onChange={(e) => set('abstract', e.target.value)}
              />
            )}
          </FormField>

          <FormField
            label="Specification"
            required
            hint="The full disclosure: what the invention is, how it is built, and what is claimed."
            error={fieldErrors.specification}
          >
            {({ id: fieldId, invalid }) => (
              <Textarea
                id={fieldId}
                rows={12}
                value={form.specification}
                invalid={invalid}
                maxLength={LIMITS.specification.max}
                onChange={(e) => set('specification', e.target.value)}
              />
            )}
          </FormField>
        </Card>

        <Card>
          <CardHeader
            title="Document"
            description="The filing document itself. Uploaded straight to secure storage — it never passes through the API."
          />
          <FormField error={fieldErrors.documentKey}>
            {() => (
              <DocumentField
                value={form.documentKey}
                hasExisting={Boolean(existing.data?.hasDocument)}
                disabled={saving}
                onChange={(key) => set('documentKey', key)}
              />
            )}
          </FormField>
        </Card>

        <Card>
          <CardHeader title="Registry details" description="Optional, and usually assigned later." />
          <div className="patent-form__row">
            <FormField label="Publication number" optional error={fieldErrors.publicationNumber}>
              {({ id: fieldId, invalid }) => (
                <Input
                  id={fieldId}
                  value={form.publicationNumber}
                  invalid={invalid}
                  placeholder="e.g. EP3456789A1"
                  onChange={(e) => set('publicationNumber', e.target.value)}
                />
              )}
            </FormField>
            <FormField
              label="Jurisdiction"
              optional
              hint="A two to eight character code, e.g. EP, US, WO."
              error={fieldErrors.jurisdiction}
            >
              {({ id: fieldId, invalid }) => (
                <Input
                  id={fieldId}
                  value={form.jurisdiction}
                  invalid={invalid}
                  maxLength={8}
                  placeholder="EP"
                  onChange={(e) => set('jurisdiction', e.target.value.toUpperCase())}
                />
              )}
            </FormField>
          </div>
        </Card>

        <Card>
          <CardHeader title="Inventors" description="In order. The first named is the lead." />
          <InventorPicker
            selected={form.inventors}
            disabled={saving}
            onChange={(inventors) => set('inventors', inventors)}
          />
        </Card>

        <Card>
          <CardHeader title="Categories" description="How this filing is classified." />
          <CategoryPicker
            selected={form.categoryIds}
            disabled={saving}
            onChange={(ids) => set('categoryIds', ids)}
          />
        </Card>

        <div className="patent-form__actions">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(id ? `/patents/${id}` : '/patents')}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {editing ? 'Save changes' : 'Create draft'}
          </Button>
        </div>
      </form>
    </>
  );
}

function Back({ id }: { id?: string }) {
  return (
    <Link to={id ? `/patents/${id}` : '/patents'} className="detail__back">
      <ArrowLeftIcon size={18} />
      {id ? 'Back to the filing' : 'All patents'}
    </Link>
  );
}
