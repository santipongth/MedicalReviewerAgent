import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/lib/glossary";
import { Term } from "./term";

describe("Term", () => {
  it("a wrapped term reads left-aligned, like the text around it (Plan 20 Task 7 fix round 1)", () => {
    render(<Term k="relevance" />);
    expect(screen.getByRole("button", { name: GLOSSARY.relevance.label.th })).toHaveClass("text-left");
  });

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

  it("Esc is not propagated to other listeners while the panel is open", async () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    render(<Term k="ci95" />);
    await userEvent.keyboard("{Escape}");
    expect(outer).toHaveBeenCalledTimes(1); // closed term: Esc passes through
    await userEvent.click(screen.getByRole("button"));
    outer.mockClear();
    await userEvent.keyboard("{Escape}");
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole("note")).toBeNull();
    document.removeEventListener("keydown", outer);
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
