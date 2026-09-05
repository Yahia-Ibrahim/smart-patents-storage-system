import { useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Modal,
  PageHeader,
  PasswordInput,
  Textarea,
  RoleBadge,
  Skeleton,
  Spinner,
  StatusBadge,
} from '@/components/ui';
import type { Column } from '@/components/ui';
import { InboxIcon, MailIcon, SealIcon } from '@/components/icons';
import { useToast } from '@/context/ToastContext';
import './DesignSystem.css';

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="ds-section" id={id}>
      <div className="ds-section__head">
        <h2 className="ds-section__title">{title}</h2>
        {note && <p className="ds-section__note">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const SWATCHES = [
  { name: 'Blueprint 600', var: '--brand-600', role: 'Primary action' },
  { name: 'Legal Navy 950', var: '--brand-950', role: 'Brand surface' },
  { name: 'Brass 500', var: '--accent-500', role: 'Seal accent' },
  { name: 'Success', var: '--color-success', role: 'Approved' },
  { name: 'Warning', var: '--color-warning', role: 'Pending' },
  { name: 'Danger', var: '--color-danger', role: 'Declined' },
];

const TYPE = [
  { face: 'IBM Plex Serif', role: 'Display · headings', sample: 'Registry of Record', cls: 'ds-type--serif' },
  { face: 'IBM Plex Sans', role: 'Body · interface', sample: 'Clear, legible interface copy', cls: 'ds-type--sans' },
  { face: 'IBM Plex Mono', role: 'Data · references', sample: 'USR-000042 · FIG. 01', cls: 'ds-type--mono' },
];

interface DemoRow {
  id: string;
  name: string;
  ref: string;
  status: string;
}
const DEMO_ROWS: DemoRow[] = [
  { id: '1', name: 'Ada Lovelace', ref: 'PAT-004192', status: 'approved' },
  { id: '2', name: 'Grace Hopper', ref: 'PAT-004193', status: 'pending_admin' },
  { id: '3', name: 'Alan Turing', ref: 'PAT-004194', status: 'declined' },
];

export function DesignSystemPage() {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [demoInvalid, setDemoInvalid] = useState('');

  const cols: Column<DemoRow>[] = [
    { key: 'name', header: 'Applicant', render: (r) => <strong>{r.name}</strong> },
    { key: 'ref', header: 'Filing', render: (r) => <span className="ref">{r.ref}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Foundation"
        title="Design System"
        description="The shared visual language every module in Smart Patents is built from — tokens, type, and components in one place."
      />

      <Section id="color" title="Color" note="A cool, document-neutral palette. Brass is the certification accent, used sparingly.">
        <div className="ds-swatches">
          {SWATCHES.map((s) => (
            <div key={s.name} className="ds-swatch">
              <span className="ds-swatch__chip" style={{ background: `var(${s.var})` }} />
              <div className="ds-swatch__meta">
                <span className="ds-swatch__name">{s.name}</span>
                <span className="ds-swatch__role">{s.role}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="type" title="Typography" note="The IBM Plex superfamily — an engineering-documentation heritage that fits patent work.">
        <Card>
          <div className="ds-type-list">
            {TYPE.map((t) => (
              <div key={t.face} className="ds-type-row">
                <div className="ds-type-meta">
                  <span className="ds-type-face">{t.face}</span>
                  <span className="ds-type-role">{t.role}</span>
                </div>
                <span className={`ds-type-sample ${t.cls}`}>{t.sample}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <Section id="buttons" title="Buttons" note="Five variants across three sizes, each with hover, focus, disabled, and loading states.">
        <Card>
          <div className="ds-row">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="accent" leftIcon={<SealIcon size={16} />}>
              Certify
            </Button>
            <Button variant="danger">Delete</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div className="ds-row ds-row--spaced">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Card>
      </Section>

      <Section id="badges" title="Badges" note="Soft badges for quiet labels; stamp badges read as an ink certification mark.">
        <Card>
          <div className="ds-row">
            <RoleBadge role="admin" />
            <RoleBadge role="user" />
            <StatusBadge status="approved" />
            <StatusBadge status="pending_admin" />
            <StatusBadge status="pending_ai" />
            <StatusBadge status="declined" />
            <StatusBadge status="draft" />
          </div>
          <div className="ds-row ds-row--spaced">
            <Badge tone="brand">Brand</Badge>
            <Badge tone="success" dot>
              Success
            </Badge>
            <Badge tone="warning" dot>
              Warning
            </Badge>
            <Badge tone="danger" dot>
              Danger
            </Badge>
            <Badge tone="neutral">Neutral</Badge>
          </div>
        </Card>
      </Section>

      <Section id="forms" title="Form controls" note="Inputs carry clear default, focus, error, and success states, with accessible messaging.">
        <Card>
          <div className="ds-form-grid">
            <FormField label="Email" hint="We never share your address.">
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} placeholder="you@firm.com" leftIcon={<MailIcon size={18} />} />
              )}
            </FormField>
            <FormField label="Password">
              {({ id }) => <PasswordInput id={id} showStrength value="Passw0rd" onChange={() => {}} />}
            </FormField>
            <FormField label="With an error" error={demoInvalid ? undefined : 'This field is required'}>
              {({ id }) => (
                <Input
                  id={id}
                  invalid={!demoInvalid}
                  value={demoInvalid}
                  onChange={(e) => setDemoInvalid(e.target.value)}
                  placeholder="Type to clear the error"
                />
              )}
            </FormField>
            <FormField label="Valid" success="Looks good">
              {({ id }) => <Input id={id} success defaultValue="ada@example.com" />}
            </FormField>
            <FormField
              label="Long-form text"
              hint="Abstracts, specifications, and examiner reasoning."
            >
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={4}
                  defaultValue="An apparatus for cooling a beverage container using an endothermic reaction chamber."
                />
              )}
            </FormField>
          </div>
        </Card>
      </Section>

      <Section id="feedback" title="Feedback" note="Inline alerts for context; toasts for transient confirmation.">
        <div className="ds-stack">
          <Alert tone="info" title="Heads up">Access tokens expire every 15 minutes and refresh automatically.</Alert>
          <Alert tone="success" title="Saved">Your profile changes were recorded.</Alert>
          <Alert tone="warning" title="Check your input">One field needs your attention.</Alert>
          <Alert tone="danger" title="Couldn’t sign in">Invalid email or password.</Alert>
        </div>
        <div className="ds-row ds-row--spaced">
          <Button variant="secondary" onClick={() => toast.success('Profile updated')}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast.error('Something went wrong', { description: 'Please try again.' })}>
            Error toast
          </Button>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
        </div>
      </Section>

      <Section id="data" title="Tables & data" note="Dense, scannable tables with sticky headers and reference numbers in mono.">
        <DataTable columns={cols} rows={DEMO_ROWS} rowKey={(r) => r.id} caption="Sample filings" />
      </Section>

      <Section id="states" title="Loading, empty & error states" note="Every async surface has a considered state — never a blank screen.">
        <div className="ds-states">
          <Card>
            <span className="eyebrow">Loading</span>
            <div className="ds-skeletons">
              <div className="ds-skeleton-row">
                <Skeleton width={36} height={36} radius="var(--radius-full)" />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="60%" />
                  <Skeleton width="40%" />
                </div>
              </div>
              <div className="ds-row" style={{ marginTop: 'var(--space-4)' }}>
                <Spinner size={20} />
                <span className="ds-muted">Loading…</span>
              </div>
            </div>
          </Card>
          <Card padding="none">
            <EmptyState compact icon={<InboxIcon size={26} />} title="Nothing here yet" description="Records will appear once created." />
          </Card>
          <Card padding="none">
            <ErrorState compact title="Couldn’t load" message="The request failed." onRetry={() => toast.info('Retrying…')} />
          </Card>
        </div>
      </Section>

      <Section id="avatars" title="Avatars" note="Deterministic swatches from a name; admins carry the brass seal ring.">
        <Card>
          <div className="ds-row">
            <Avatar name="Ada Lovelace" size="sm" />
            <Avatar name="Grace Hopper" size="md" />
            <Avatar name="Alan Turing" size="lg" />
            <Avatar name="Root Admin" size="lg" accent />
            <Avatar name="Katherine Johnson" size="xl" />
          </div>
        </Card>
      </Section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Certify this record?"
        description="This marks the filing as reviewed and records your name against the action."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              leftIcon={<SealIcon size={16} />}
              onClick={() => {
                setModalOpen(false);
                toast.success('Record certified');
              }}
            >
              Certify
            </Button>
          </>
        }
      >
        <p className="ds-muted">
          Modals trap focus, close on Escape or overlay click, and restore focus to where you left
          off.
        </p>
      </Modal>
    </>
  );
}
