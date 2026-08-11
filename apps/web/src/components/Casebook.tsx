/**
 * The personal casebook: inventory and promises (Decision 011 §"Personal
 * casebook"). An empty section is one line of copy, verbatim — never a
 * decorative blank card.
 */

import type {
  ActivePromiseView,
  InventoryItemView,
} from "@the-town-remembers/http-contracts";

export interface CasebookProps {
  readonly inventory: readonly InventoryItemView[];
  readonly activePromises: readonly ActivePromiseView[];
}

export function Casebook({ inventory, activePromises }: CasebookProps) {
  return (
    <aside className="casebook" aria-label="Your casebook">
      <section aria-label="Inventory">
        <h2>Inventory</h2>
        {inventory.length === 0 ? (
          <p>You are carrying nothing.</p>
        ) : (
          <ul>
            {inventory.map((item) => (
              <li key={item.itemId}>
                <h3>{item.displayName}</h3>
                <p>{item.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Promises">
        <h2>Promises</h2>
        {activePromises.length === 0 ? (
          <p>You have made no active promises.</p>
        ) : (
          <ul>
            {activePromises.map((promise) => (
              <li key={promise.promiseId}>
                <span>{promise.npc.displayName}</span>
                <p>{promise.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
