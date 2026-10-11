import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DocsToc } from "./docs-toc";

const ITEMS = [{ id: "h-a", label: "หัวข้อ A" }, { id: "h-b", label: "หัวข้อ B" }];

describe("DocsToc", () => {
  it("links every section, in the sidebar and in the phone disclosure", () => {
    const { container } = render(<DocsToc items={ITEMS} />);
    for (const nav of container.querySelectorAll("nav")) {
      expect([...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#h-a", "#h-b"]);
    }
    expect(container.querySelectorAll("nav")).toHaveLength(2);
  });

  it("closes the phone disclosure once a link is picked", async () => {
    const { container } = render(<DocsToc items={ITEMS} />);
    const details = container.querySelector("details")!;
    await userEvent.click(within(details).getByText("ในหน้านี้"));
    expect(details.open).toBe(true);
    await userEvent.click(within(details).getByRole("link", { name: "หัวข้อ B" }));
    expect(details.open).toBe(false);
    expect(screen.getAllByRole("link", { name: "หัวข้อ A" }).length).toBeGreaterThan(0);
  });
});
