import { describe, expect, test } from "vitest";
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

  test("SERVFAIL is an error, not an answer", async () => {
    const resolve = doh(async () => json({ Status: 2, AD: false }));
    await expect(resolve("broken.example", "MX")).rejects.toBeInstanceOf(
      DnsError,
    );
  });
});
