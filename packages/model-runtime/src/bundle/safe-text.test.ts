import { describe, expect, it } from "vitest";

import { authoredTemplateText, playerSafeText } from "./safe-text.js";

describe("branded text helpers", () => {
  it("return the exact string unchanged", () => {
    expect(authoredTemplateText("The bell is missing.")).toBe("The bell is missing.");
    expect(playerSafeText("Mara Venn")).toBe("Mara Venn");
  });
});
