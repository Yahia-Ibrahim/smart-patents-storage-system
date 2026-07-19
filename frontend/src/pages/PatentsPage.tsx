import { Card, EmptyState, PageHeader } from '@/components/ui';
import { FileIcon } from '@/components/icons';

/** Placeholder for the forthcoming Patents module. The backend exposes these
 *  endpoints as stubs today; this page reserves the navigation and proves the
 *  design language is ready to receive them. */
export function PatentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Registry"
        title="Patents"
        description="Submission, AI pre-screening, and examiner review will live here."
      />
      <Card padding="none">
        <EmptyState
          icon={<FileIcon size={26} />}
          title="The Patents module is on the way"
          description="This workspace is built and ready. Filing management will slot in using the same components you see across the app — no redesign required."
        />
      </Card>
    </>
  );
}
