import { describe, expect, test, vi } from "vitest";
import { doh, DnsError } from "../src/dns";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/dns-json" },
  });

describe("DNS over HTTPS", () => {
  test("asks Cloudflare, in JSON, and reads the answer", async () => {
    const seen: { url: string; accept: string | null }[] = [];
    const resolve = doh(async (input, init) => {
      seen.push({
        url: String(input),
        accept: new Headers(init?.headers).get("accept"),
      });
      return json({
        Status: 0,
        AD: true,
        Answer: [
          {
            name: "example.net.",
            type: 15,
            TTL: 300,
            data: "10 mx.example.net.",
          },
        ],
      });
    });
    expect(await resolve("example.net", "MX")).toEqual({
      status: 0,
      ad: true,
      records: [{ type: 15, data: "10 mx.example.net." }],
    });
    expect(seen).toEqual([
      {
        url: "https://cloudflare-dns.com/dns-query?name=example.net&type=MX",
        accept: "application/dns-json",
      },
    ]);
  });

  test("no Answer is an empty answer; NXDOMAIN keeps its status", async () => {
    const resolve = doh(async () => json({ Status: 3, AD: false }));
    expect(await resolve("nope.example", "TXT")).toEqual({
      status: 3,
      ad: false,
      records: [],
    });
  });

  test("six questions at a time, at most", async () => {
    let open = 0;
    let most = 0;
    const resolve = doh(async () => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return json({ Status: 0, AD: false });
    });
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => resolve(`n${i}.example`, "TXT")),
    );
    expect(most).toBe(6);
  });

  test("one retry, then it gives up", async () => {
    let calls = 0;
    const flaky = doh(async () => {
      calls++;
      if (calls === 1) throw new TypeError("network");
      return json({ Status: 0, AD: false });
    });
    await expect(flaky("a.example", "TXT")).resolves.toMatchObject({
      status: 0,
    });
    expect(calls).toBe(2);

    calls = 0;
    const down = doh(async () => {
      calls++;
      return new Response("busy", { status: 503 });
    });
    await expect(down("a.example", "TXT")).rejects.toBeInstanceOf(DnsError);
    expect(calls).toBe(2);
  });

  test("the network failing (fetch's TypeError) is a DnsError", async () => {
    const offline = doh(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(offline("a.example", "TXT")).rejects.toBeInstanceOf(DnsError);
  });

  test("a question that hangs times out", async () => {
    const hang = doh(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError")),
          );
        }),
      { timeoutMs: 30 },
    );
    await expect(hang("slow.example", "MX")).rejects.toBeInstanceOf(DnsError);
  });

  // Answers only when its signal aborts, and then with the abort, as fetch
  // does.
  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      const off = () => reject(signal?.reason as Error);
      if (signal?.aborted) off();
      else signal?.addEventListener("abort", off);
    });

  test("calling questions off frees their places at once", async () => {
    const resolve = doh(
      (input, init) =>
        String(input).includes("old")
          ? hanging(input, init)
          : Promise.resolve(json({ Status: 0, AD: false })),
      { timeoutMs: 60_000 },
    );
    const old = new AbortController();
    const stale = Array.from({ length: 6 }, (_, i) =>
      resolve(`old${i}.example`, "TXT", old.signal),
    );
    const fresh = resolve("new.example", "TXT");
    old.abort();
    for (const s of stale) {
      await expect(s).rejects.toMatchObject({ name: "AbortError" });
    }
    // Long before any of the old questions' minute was up.
    await expect(fresh).resolves.toMatchObject({ status: 0 });
  });

  test("a question called off in the line is never sent", async () => {
    const sent: string[] = [];
    const resolve = doh(
      (input, init) => {
        sent.push(String(input));
        return hanging(input, init);
      },
      { limit: 1, timeoutMs: 60_000 },
    );
    const first = new AbortController();
    const waiting = new AbortController();
    const running = resolve("first.example", "TXT", first.signal);
    const queued = resolve("queued.example", "TXT", waiting.signal);
    waiting.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    first.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("first.example");
  });

  test("a question called off isn't tried again", async () => {
    let calls = 0;
    const resolve = doh(
      (input, init) => {
        calls++;
        return hanging(input, init);
      },
      { timeoutMs: 60_000 },
    );
    const controller = new AbortController();
    const asked = resolve("a.example", "TXT", controller.signal);
    // Called off once it's out, not while it waits for a place.
    await vi.waitFor(() => expect(calls).toBe(1));
    controller.abort();
    await expect(asked).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  test("SERVFAIL is an error, not an answer", async () => {
    const resolve = doh(async () => json({ Status: 2, AD: false }));
    await expect(resolve("broken.example", "MX")).rejects.toBeInstanceOf(
      DnsError,
    );
  });
});
