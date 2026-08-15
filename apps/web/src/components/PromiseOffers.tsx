/**
 * Promise offers produced by the last completed exchange (`P4-20`). An offer
 * is accepted by its opaque `offerId` alone — the offer's own subject/terms
 * are trusted verbatim from the response that produced it, never
 * reconstructed client-side. A stale offer's denial renders through the same
 * `ResultCard` denied path the parent already owns; this component only
 * disables the button it is waiting on.
 */

import { useEffect, useRef, useState } from "react";

import type {
  CompletedActionResponse,
  PromiseOfferView,
} from "@the-town-remembers/http-contracts";

import type { UseActionSubmissionResult } from "../api/actionSubmission.js";

export interface PromiseOffersProps {
  readonly offers: readonly PromiseOfferView[];
  readonly action: UseActionSubmissionResult;
  readonly onAccepted: (result: CompletedActionResponse) => void;
}

export function PromiseOffers({ offers, action, onAccepted }: PromiseOffersProps) {
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | undefined>(
    undefined,
  );
  const awaitingRef = useRef(false);

  useEffect(() => {
    if (!awaitingRef.current || action.pending) return;
    const result = action.lastResult;
    if (!result || result.kind !== "accept_promise") return;
    awaitingRef.current = false;
    setAcceptingOfferId(undefined);
    onAccepted(result);
  }, [action.pending, action.lastResult, onAccepted]);

  if (offers.length === 0) return null;

  const disabled = action.pending || action.readOnlyPending;

  function accept(offerId: string) {
    setAcceptingOfferId(offerId);
    awaitingRef.current = true;
    void action.submit({ kind: "accept_promise", offerId });
  }

  return (
    <section aria-label="Offers">
      {offers.map((offer) => (
        <article key={offer.offerId} aria-label={`Offer: ${offer.summary}`}>
          <p>{offer.summary}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => accept(offer.offerId)}
          >
            {acceptingOfferId === offer.offerId ? "Accepting…" : "Accept"}
          </button>
        </article>
      ))}
    </section>
  );
}
