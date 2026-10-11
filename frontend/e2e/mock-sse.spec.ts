import { expect, test, type Page } from "@playwright/test";
import { API, mockApi, RID, sseGatesOpen, streamSse } from "./mock-api";

// Task 9 fix round 1: the `after:` gate of the mock event stream opens on an attribute change too, and a gate that never
// opens fails with a message naming its selector.

/** Starts reading the event stream in the page; resolves the events' names as they arrive into window.__got. */
async function read(page: Page) {
  await page.evaluate(async ([api, rid]) => {
    const w = window as unknown as { __got: string[] };
    w.__got = [];
    const res = await fetch(`${api}/api/v1/reviews/${rid}/events`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        for (const m of dec.decode(value).matchAll(/event: (\w+)/g)) w.__got.push(m[1]);
      }
    })();
  }, [API, RID] as const);
}

test("a gated frame is sent once its selector matches through an attribute change", async ({ page }) => {
  await streamSse(page, [{ delayMs: 0, events: [["queued", {}]] }, { delayMs: 0, after: "body[data-ready='yes']", events: [["started", {}]] }]);
  await mockApi(page);
  await page.goto("/developers");
  await read(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["queued"]);
  await page.evaluate(() => document.body.setAttribute("data-ready", "yes"));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["queued", "started"]);
  await sseGatesOpen(page, 1000);
});

test("a gate that never opens fails naming its selector", async ({ page }) => {
  await streamSse(page, [{ delayMs: 0, events: [["queued", {}]] }, { delayMs: 0, after: "#never-there", events: [["started", {}]] }]);
  await mockApi(page);
  await page.goto("/developers");
  await read(page);
  await expect(sseGatesOpen(page, 500)).rejects.toThrow('the frame gated on "#never-there" was never sent');
});
