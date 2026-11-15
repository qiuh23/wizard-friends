import type { ReactNode } from 'react';

/** Shared existing Wizard dialog shell; callers retain their own controls. */
export function ModalFrame({titleId, children}: {titleId: string; children: ReactNode}) {
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</section></div>;
}
