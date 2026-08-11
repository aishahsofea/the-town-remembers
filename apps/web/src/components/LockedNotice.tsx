/**
 * A locked location's server-provided message (Decision 011 §"3. Town
 * map"). Never enumerates the unlock route — the message itself already
 * guarantees that; this component only ever renders exactly what the
 * server sent.
 */

export interface LockedNoticeProps {
  readonly message: string;
}

export function LockedNotice({ message }: LockedNoticeProps) {
  return (
    <p className="locked-notice" role="note">
      {message}
    </p>
  );
}
