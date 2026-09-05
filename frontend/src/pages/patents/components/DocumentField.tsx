import { useRef, useState } from 'react';
import { Alert, Button, Spinner } from '@/components/ui';
import { CheckCircleIcon, FileIcon, UploadIcon } from '@/components/icons';
import { ApiClientError } from '@/services/apiClient';
import { patentService } from '@/services/patentService';
import { fileSize } from '@/utils/format';

interface DocumentFieldProps {
  /** The object key currently attached, if any. */
  value: string | null;
  onChange: (objectKey: string | null) => void;
  /** True when editing a filing that already has a document attached. */
  hasExisting: boolean;
  disabled?: boolean;
}

/**
 * The document upload.
 *
 * Bytes go straight from this browser to object storage using a presigned PUT;
 * they never pass through the API, which is what keeps a 40 MB specification
 * off the Node event loop. So this is a two-step flow — ask the API for a
 * target, then PUT to storage — and only the resulting object key is submitted
 * with the form.
 *
 * The upload therefore happens *before* the filing is saved. Uploading and then
 * abandoning the form leaves an orphaned object in storage; that is a known and
 * accepted cost (there is no sweeper yet), and the alternative — streaming the
 * file through the API on save — is the thing this design exists to avoid.
 */
export function DocumentField({ value, onChange, hasExisting, disabled }: DocumentFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ name: string; size: number } | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const objectKey = await patentService.uploadDocument(file);
      setUploaded({ name: file.name, size: file.size });
      onChange(objectKey);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'The upload failed. Please try again.',
      );
      // Leave any previously attached key in place: a failed replacement should
      // not silently detach the document the filing already had.
    } finally {
      setUploading(false);
      // Clear the input so re-picking the same file still fires onChange.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const state = uploaded ? 'uploaded' : value || hasExisting ? 'attached' : 'empty';

  return (
    <div className="docfield">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,text/plain,.pdf,.txt"
        className="docfield__input"
        disabled={disabled || uploading}
        onChange={(e) => pick(e.target.files?.[0])}
      />

      <div className={`docfield__box is-${state}`}>
        <span className="docfield__icon" aria-hidden="true">
          {uploading ? (
            <Spinner size={20} />
          ) : state === 'empty' ? (
            <UploadIcon size={22} />
          ) : (
            <FileIcon size={22} />
          )}
        </span>

        <div className="docfield__body">
          {uploading ? (
            <>
              <span className="docfield__title">Uploading…</span>
              <span className="docfield__hint">Sending the file directly to secure storage.</span>
            </>
          ) : uploaded ? (
            <>
              <span className="docfield__title">
                <CheckCircleIcon size={16} /> {uploaded.name}
              </span>
              <span className="docfield__hint">
                {fileSize(uploaded.size)} · attached, and saved with the filing.
              </span>
            </>
          ) : state === 'attached' ? (
            <>
              <span className="docfield__title">A document is attached</span>
              <span className="docfield__hint">
                Uploading a new one replaces it; the old file is deleted on save.
              </span>
            </>
          ) : (
            <>
              <span className="docfield__title">No document attached</span>
              <span className="docfield__hint">
                PDF or plain text. A filing cannot be submitted for review without one.
              </span>
            </>
          )}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {state === 'empty' ? 'Choose file' : 'Replace'}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
    </div>
  );
}
