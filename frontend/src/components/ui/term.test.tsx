import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GLOSSARY } from "@/lib/glossary";
import { Term } from "./term";

describe("Term", () => {
  it("opens and closes on click, toggling aria-expanded", async () => {
    render(<Term k="relevance" />);
    const btn = screen.getByRole("button", { name: GLOSSARY.relevance.label.th });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(GLOSSARY.relevance.body.th);
    expect(btn).toHaveAttribute("aria-controls", note.id);
    await userEvent.click(btn);
    expect(screen.queryByRole("note")).toBeNull();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc closes and returns focus to the trigger", async () => {
    render(<><Term k="uncertain" /><button type="button">other</button></>);
    const btn = screen.getByRole("button", { name: GLOSSARY.uncertain.label.th });
    await userEvent.click(btn);
    screen.getByRole("button", { name: "other" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("note")).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("clicking outside closes it", async () => {
    render(<><Term k="ci95" /><p>elsewhere</p></>);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("renders th and en text, and children override the label", async () => {
    const { rerender } = render(<Term k="ci95" />);
    expect(screen.getByRole("button")).toHaveTextContent(GLOSSARY.ci95.label.th);
    rerender(<Term k="ci95" lang="en" />);
    expect(screen.getByRole("button")).toHaveTextContent(GLOSSARY.ci95.label.en);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("note")).toHaveTextContent(GLOSSARY.ci95.body.en);
    rerender(<Term k="ci95" lang="en">CI</Term>);
    expect(screen.getByRole("button")).toHaveTextContent("CI");
  });
});
