/**
 * The global header (Decision 011 §"Header"). Never shows an always-on
 * network status — only a compact pending marker while an action is
 * in flight.
 */

import type { PlayerView } from "@the-town-remembers/http-contracts";

import { navigate } from "../routing/navigation.js";
import { buildWebPath } from "../routing/routes.js";

export interface HeaderProps {
  readonly view: PlayerView;
  readonly pending: boolean;
  readonly onLeave: () => void;
  readonly leaveDisabled: boolean;
}

const STATUS_LABEL: Partial<Record<PlayerView["town"]["status"], string>> = {
  awaiting_resolution: "Awaiting its final choice",
  resolved: "Story complete",
};

export function Header({ view, pending, onLeave, leaveDisabled }: HeaderProps) {
  const townId = view.town.id;
  const statusLabel = STATUS_LABEL[view.town.status];

  return (
    <header className="shell-header">
      <h1>{view.town.mysteryTitle}</h1>
      {statusLabel ? <span className="shell-header__status">{statusLabel}</span> : null}
      <button type="button" onClick={() => navigate(buildWebPath("board", { townId }))}>
        Case board ({view.caseBoard.length})
      </button>
      <span className="shell-header__player">{view.player.displayName}</span>
      {view.player.visit.status === "active" ? (
        <button type="button" onClick={onLeave} disabled={leaveDisabled}>
          Leave town
        </button>
      ) : null}
      {pending ? (
        <span className="shell-header__pending" role="status" aria-live="polite">
          Working…
        </span>
      ) : null}
    </header>
  );
}
