import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Casebook } from "./Casebook.js";

afterEach(cleanup);

describe("Casebook empty states", () => {
  it("renders the exact copy for an empty inventory", () => {
    render(<Casebook inventory={[]} activePromises={[]} />);
    expect(screen.getByText("You are carrying nothing.")).toBeTruthy();
  });

  it("renders the exact copy for no active promises", () => {
    render(<Casebook inventory={[]} activePromises={[]} />);
    expect(screen.getByText("You have made no active promises.")).toBeTruthy();
  });

  it("renders real inventory items instead of the empty-state copy", () => {
    render(
      <Casebook
        inventory={[
          {
            itemId: "item-1",
            displayName: "Storm lantern",
            description: "Cracked glass.",
          },
        ]}
        activePromises={[]}
      />,
    );
    expect(screen.queryByText("You are carrying nothing.")).toBeNull();
    expect(screen.getByText("Storm lantern")).toBeTruthy();
  });
});
