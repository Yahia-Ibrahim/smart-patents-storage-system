import { useState } from 'react';
import { Alert, Button, FormField, Modal, Textarea } from '@/components/ui';

export type Decision = 'approve' | 'decline';

interface DecisionModalProps {
  decision: Decision | null;
  patentTitle: string;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (comments: string) => void;
}

/**
 * The approve/decline dialog.
 *
 * One component for both because they are the same act with different weight,
 * and splitting them would mean two copies of the same textarea drifting apart.
 * The asymmetry is real and mirrors the API: comments are optional on an
 * approval and required on a decline, because "declined, no reason given" is
 * the least useful thing this system could tell a submitter. The API enforces
 * it too — this is the courteous half of that rule, not the whole of it.
 */
export function DecisionModal({
  decision,
  patentTitle,
  submitting,
  error,
  onCancel,
  onConfirm,
}: DecisionModalProps) {
  const [comments, setComments] = useState('');

  const declining = decision === 'decline';
  const trimmed = comments.trim();
  const tooShort = declining && trimmed.length > 0 && trimmed.length < 5;
  const canConfirm = declining ? trimmed.length >= 5 : true;

  const close = () => {
    setComments('');
    onCancel();
  };

  return (
    <Modal
      open={decision !== null}
      onClose={close}
      title={declining ? 'Decline this filing' : 'Approve this filing'}
      description={patentTitle}
      dismissible={!submitting}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={declining ? 'danger' : 'primary'}
            loading={submitting}
            disabled={!canConfirm}
            onClick={() => onConfirm(trimmed)}
          >
            {declining ? 'Decline filing' : 'Approve filing'}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="decision__error">
          {error}
        </Alert>
      )}

      {!declining && (
        <Alert tone="info">
          Approving publishes this filing to every signed-in user and adds it to the prior-art
          corpus used by similarity search.
        </Alert>
      )}

      <FormField
        label={declining ? 'Reason for declining' : 'Examiner notes'}
        required={declining}
        optional={!declining}
        hint={
          declining
            ? 'The submitter reads this, and it is what tells them what to change before resubmitting.'
            : 'Recorded on the filing’s review trail. Visible to the submitter.'
        }
        error={tooShort ? 'Give at least 5 characters of reasoning.' : null}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            rows={5}
            maxLength={5000}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={
              declining
                ? 'e.g. The specification does not distinguish the claimed cooling chamber from PAT-000031.'
                : 'Optional notes for the record.'
            }
          />
        )}
      </FormField>
    </Modal>
  );
}
