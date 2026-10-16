import { describe, expect, test } from "vitest";
import { plain, say, verdict } from "../src/copy";
import type { Finding } from "../src/findings";
import { port } from "./make";

const text = (f: Finding) => plain(say(f));

describe("each finding is one sentence that names its service", () => {
  test("names are marked, for the page to set in weight", () => {
    const parts = say({ rule: "latest", services: ["jellyfin", "watchtower"] });
    expect(parts.filter((p) => typeof p !== "string")).toEqual([
      { name: "jellyfin" },
      { name: "watchtower" },
    ]);
  });

  test("one open port, with the line that keeps it local", () => {
    expect(
      text({
        rule: "openPorts",
        service: "jellyfin",
        ports: [port("8096", "8096")],
      }),
    ).toBe(
      "jellyfin is open to every device on your network on port 8096, and to the internet if your router forwards it. If only the server itself needs it (another container, or a reverse proxy on the same host), write 127.0.0.1:8096:8096.",
    );
  });

  test("several, and UDP, and a port Docker picks", () => {
    expect(
      text({
        rule: "openPorts",
        service: "caddy",
        ports: [
          port("80", "80"),
          port("443", "443"),
          port("443", "443", null, "udp"),
          port(null, "9000"),
        ],
      }),
    ).toBe(
      "caddy is open to every device on your network on ports 80, 443, 443/udp and one Docker picks for 9000, and to the internet if your router forwards them. If only the server itself needs them (another container, or a reverse proxy on the same host), write 127.0.0.1:80:80, and the same for each.",
    );
  });

  test("open ports an earlier file wrote: in the override, replace the list", () => {
    expect(
      text({
        rule: "openPorts",
        service: "caddy",
        ports: [port("80", "80"), port("443", "443")],
        earlier: { file: null, ports: [port("80", "80"), port("443", "443")] },
      }),
    ).toBe(
      "caddy is open to every device on your network on ports 80 and 443, and to the internet if your router forwards them. If only the server itself needs them (another container, or a reverse proxy on the same host), write 127.0.0.1:80:80, and the same for each. In an override file, that would add ports, not replace them: 80:80 and 443:443 stay open. There, write ports: !override, then the whole list.",
    );
  });

  test("secrets show their names and never a value", () => {
    expect(
      text({ rule: "secrets", service: "db", keys: ["POSTGRES_PASSWORD"] }),
    ).toBe(
      "db has POSTGRES_PASSWORD=•••• written in the file, so anyone who can read the file can read it. An env_file or a Docker secret keeps it out.",
    );
    expect(
      text({ rule: "secrets", service: "app", keys: ["A_KEY", "B_TOKEN"] }),
    ).toContain("A_KEY=•••• and B_TOKEN=•••• written in the file");
  });

  test("a port clash names every service on the port, with its protocol", () => {
    expect(
      text({
        rule: "portClash",
        services: ["a", "b"],
        port: "8080",
        all: true,
      }),
    ).toBe("a and b both publish port 8080, so only one of them can start.");
    expect(
      text({
        rule: "portClash",
        services: ["a", "b", "c"],
        port: "53/udp",
        all: true,
      }),
    ).toBe(
      "a, b and c all publish port 53/udp, so only one of them can start.",
    );
    expect(
      text({
        rule: "portClash",
        services: ["a", "b", "c"],
        port: "80",
        all: false,
      }),
    ).toBe("a, b and c all publish port 80, so they can’t all start.");
    expect(
      text({
        rule: "portClash",
        services: ["a", "b"],
        port: "9005-9010",
        all: true,
      }),
    ).toBe(
      "a and b both publish ports 9005-9010, so only one of them can start.",
    );
  });

  test("pid: host", () => {
    expect(text({ rule: "hostPid", services: ["monitor"] })).toBe(
      "monitor shares the host’s process list (pid: host), so it can see, and with the right powers stop, every process on the host.",
    );
  });

  test("every rule has words", () => {
    const all: Finding[] = [
      { rule: "socket", service: "w", path: "/var/run/docker.sock" },
      { rule: "privileged", services: ["a"] },
      { rule: "rootMount", service: "a", paths: ["/etc"] },
      { rule: "caps", service: "a", caps: ["NET_ADMIN", "SYS_ADMIN", "ALL"] },
      { rule: "hostNetwork", services: ["a", "b"] },
      { rule: "portClash", services: ["a", "b"], port: "8080", all: true },
      { rule: "hostPid", services: ["monitor"] },
      { rule: "waitsForHealth", service: "app", on: "db" },
      { rule: "noRestart", services: ["a"] },
    ];
    for (const f of all) {
      const t = text(f);
      expect(t).toMatch(/^\S.*\.$/);
      expect(t).not.toMatch(/undefined|null|\[object/);
    }
  });
});

describe("the verdict, first", () => {
  const sock: Finding = {
    rule: "socket",
    service: "w",
    path: "/var/run/docker.sock",
  };
  const priv: Finding = { rule: "privileged", services: ["p", "q"] };
  const open: Finding = {
    rule: "openPorts",
    service: "j",
    ports: [port("80", "80")],
  };
  const latest: Finding = { rule: "latest", services: ["j"] };

  test("nothing", () => {
    expect(verdict([])).toBe("Nothing here stands out.");
  });

  test("power over the host leads, counting services", () => {
    expect(verdict([sock])).toBe("One service can take over the whole host.");
    expect(verdict([sock, open, latest])).toBe(
      "One service can take over the whole host, and two more things are worth a look.",
    );
    expect(verdict([sock, priv, open])).toBe(
      "Three services can take over the whole host, and one more thing is worth a look.",
    );
  });

  test("then exposure", () => {
    expect(verdict([open])).toBe(
      "Nothing can take over the host, but one thing is worth a look.",
    );
    expect(verdict([open, latest])).toBe(
      "Nothing can take over the host, but two things are worth a look.",
    );
  });

  test("then tidying", () => {
    expect(verdict([latest])).toBe(
      "Nothing serious, just one small thing to tidy.",
    );
  });
});
