import { describe, expect, test } from "vitest";
import { findings, severity, type Finding } from "../src/findings";
import { file, port, svc } from "./make";

const rules = (...services: Parameters<typeof file>) =>
  findings(file(...services)).map((f) => f.rule);
const only = (rule: Finding["rule"], ...services: Parameters<typeof file>) =>
  findings(file(...services)).filter((f) => f.rule === rule);

test("a quiet file has nothing to say", () => {
  expect(
    rules(svc({ name: "web", ports: [port("8080", "80", "127.0.0.1")] })),
  ).toEqual([]);
});

describe("open ports", () => {
  test("published with no address, per service, every such port", () => {
    expect(
      only(
        "openPorts",
        svc({
          name: "media",
          ports: [
            port("8096", "8096"),
            port("8920", "8920", "0.0.0.0"),
            port("1900", "1900", "127.0.0.1", "udp"),
          ],
        }),
      ),
    ).toEqual([
      {
        rule: "openPorts",
        service: "media",
        ports: [port("8096", "8096"), port("8920", "8920", "0.0.0.0")],
      },
    ]);
  });

  test("an address chosen on purpose isn't flagged", () => {
    expect(
      rules(svc({ name: "a", ports: [port("80", "80", "192.168.1.5")] })),
    ).toEqual([]);
  });

  test("two services on the same host port clash", () => {
    expect(
      only(
        "portClash",
        svc({ name: "a", ports: [port("8080", "80", "127.0.0.1")] }),
        svc({ name: "b", ports: [port("8080", "8080", "127.0.0.1")] }),
      ),
    ).toEqual([
      { rule: "portClash", services: ["a", "b"], port: "8080", all: true },
    ]);
  });

  test("ranges clash where they overlap; protocols and addresses keep apart", () => {
    expect(
      only(
        "portClash",
        svc({
          name: "a",
          ports: [port("9000-9010", "9000-9010", "127.0.0.1")],
        }),
        svc({ name: "b", ports: [port("9005", "80", "127.0.0.1")] }),
      ),
    ).toEqual([
      { rule: "portClash", services: ["a", "b"], port: "9005", all: true },
    ]);
    expect(
      rules(
        svc({ name: "a", ports: [port("53", "53", "127.0.0.1")] }),
        svc({ name: "b", ports: [port("53", "53", "127.0.0.1", "udp")] }),
        svc({ name: "c", ports: [port("80", "80", "127.0.0.1")] }),
        svc({ name: "d", ports: [port("80", "80", "127.0.0.2")] }),
        svc({ name: "e", ports: [port("${P}", "80", "127.0.0.1")] }),
        svc({ name: "f", ports: [port("${P}", "80", "127.0.0.1")] }),
      ),
    ).toEqual([]);
  });

  test("one sentence per host port, every service on it, the protocol kept", () => {
    // a and b share 8080 and 53/udp; c keeps 8080 to the server, which
    // still clashes with a and b (every address).
    expect(
      only(
        "portClash",
        svc({
          name: "a",
          ports: [port("8080", "80"), port("53", "53", "0.0.0.0", "udp")],
        }),
        svc({
          name: "b",
          ports: [port("8080", "80"), port("53", "53", null, "udp")],
        }),
        svc({ name: "c", ports: [port("8080", "80", "127.0.0.1")] }),
      ),
    ).toEqual([
      { rule: "portClash", services: ["a", "b", "c"], port: "8080", all: true },
      { rule: "portClash", services: ["a", "b"], port: "53/udp", all: true },
    ]);
  });

  test("services that could run side by side make it can't all start", () => {
    // a and c each take one address; b takes every address.
    expect(
      only(
        "portClash",
        svc({ name: "a", ports: [port("80", "80", "127.0.0.1")] }),
        svc({ name: "b", ports: [port("80", "80")] }),
        svc({ name: "c", ports: [port("80", "80", "192.168.1.5")] }),
      ),
    ).toEqual([
      { rule: "portClash", services: ["a", "b", "c"], port: "80", all: false },
    ]);
  });

  test("overlapping ranges are named as the range they share", () => {
    expect(
      only(
        "portClash",
        svc({ name: "a", ports: [port("9000-9010", "9000-9010")] }),
        svc({ name: "b", ports: [port("9005-9020", "9005-9020")] }),
      ),
    ).toEqual([
      { rule: "portClash", services: ["a", "b"], port: "9005-9010", all: true },
    ]);
  });

  test("every address clashes with any one address", () => {
    expect(
      rules(
        svc({ name: "a", ports: [port("80", "80")] }),
        svc({ name: "b", ports: [port("80", "80", "127.0.0.1")] }),
      ),
    ).toContain("portClash");
  });
});

describe("images", () => {
  test("no tag, or latest", () => {
    expect(
      only(
        "latest",
        svc({ name: "a", image: "nginx" }),
        svc({ name: "b", image: "ghcr.io/me/app:latest" }),
        svc({ name: "c", image: "registry.local:5000/app" }),
        svc({ name: "d", image: "nginx:1.27" }),
        svc({ name: "e", image: "registry.local:5000/app:2" }),
        svc({ name: "f", image: "nginx@sha256:0123abcd" }),
        svc({ name: "g", image: "app:${TAG}" }),
        svc({ name: "h", image: null, build: true }),
      ),
    ).toEqual([{ rule: "latest", services: ["a", "b", "c"] }]);
  });
});

describe("power over the host", () => {
  test("privileged", () => {
    expect(
      only(
        "privileged",
        svc({ name: "a", privileged: true }),
        svc({ name: "b" }),
      ),
    ).toEqual([{ rule: "privileged", services: ["a"] }]);
  });

  test("the host's network", () => {
    expect(
      only(
        "hostNetwork",
        svc({ name: "a", networkMode: "host" }),
        svc({ name: "b", networkMode: "service:a" }),
      ),
    ).toEqual([{ rule: "hostNetwork", services: ["a"] }]);
  });

  test("the powerful capabilities, not the small ones", () => {
    expect(
      only(
        "caps",
        svc({ name: "a", capAdd: ["NET_ADMIN", "CHOWN", "cap_sys_admin"] }),
        svc({ name: "b", capAdd: ["ALL"] }),
        svc({ name: "c", capAdd: ["NET_BIND_SERVICE"] }),
      ),
    ).toEqual([
      { rule: "caps", service: "a", caps: ["NET_ADMIN", "SYS_ADMIN"] },
      { rule: "caps", service: "b", caps: ["ALL"] },
    ]);
  });

  test("Docker's socket", () => {
    const sock = (source: string) =>
      svc({
        name: "w",
        mounts: [
          {
            kind: "bind",
            source,
            target: "/var/run/docker.sock",
            readOnly: true,
          },
        ],
      });
    expect(only("socket", sock("/var/run/docker.sock"))).toEqual([
      { rule: "socket", service: "w", path: "/var/run/docker.sock" },
    ]);
    expect(rules(sock("/run/docker.sock"))).toContain("socket");
    expect(rules(sock("//var/run/docker.sock"))).toContain("socket");
    expect(
      rules(
        svc({
          name: "x",
          mounts: [
            {
              kind: "volume",
              source: "docker.sock",
              target: "/x",
              readOnly: false,
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("the host's root, /etc and /root", () => {
    const bind = (source: string) => ({
      kind: "bind" as const,
      source,
      target: "/host",
      readOnly: true,
    });
    expect(
      only(
        "rootMount",
        svc({
          name: "a",
          mounts: [
            bind("/"),
            bind("/etc/"),
            bind("/root"),
            bind("/etc/localtime"),
            bind("/srv"),
          ],
        }),
      ),
    ).toEqual([
      { rule: "rootMount", service: "a", paths: ["/", "/etc", "/root"] },
    ]);
  });
});

describe("secrets", () => {
  test("keys that look secret, with a value written out", () => {
    expect(
      only(
        "secrets",
        svc({
          name: "db",
          environment: [
            { key: "POSTGRES_PASSWORD", literal: true, fileRef: false },
            { key: "API_TOKEN", literal: false, fileRef: false },
            { key: "secret_key_base", literal: true, fileRef: false },
            { key: "TZ", literal: true, fileRef: false },
            { key: "MYSQL_ROOT_PWD", literal: true, fileRef: false },
            { key: "ACCESS_KEY", literal: true, fileRef: false },
          ],
        }),
      ),
    ).toEqual([
      {
        rule: "secrets",
        service: "db",
        keys: [
          "POSTGRES_PASSWORD",
          "secret_key_base",
          "MYSQL_ROOT_PWD",
          "ACCESS_KEY",
        ],
      },
    ]);
  });
});

describe("secret names, by word", () => {
  const flagged = (...keys: string[]) =>
    only(
      "secrets",
      svc({
        name: "a",
        environment: keys.map((key) => ({
          key,
          literal: true,
          fileRef: false,
        })),
      }),
    ).flatMap((f) => (f.rule === "secrets" ? f.keys : []));

  test("words that only contain KEY or PASS aren't secrets", () => {
    expect(
      flagged(
        "MONKEY",
        "KEYBOARD_LAYOUT",
        "KEYCLOAK_HOSTNAME",
        "PASSTHROUGH",
        "BYPASS_PROXY",
        "PASSWORD_MIN_LENGTH",
        "TOKEN_EXPIRY",
        "SSH_KEY_PATH",
        "OAUTH_TOKEN_URL",
        "AWS_ACCESS_KEY_ID",
        "TURNKEY",
        "COMPASS_URL",
      ),
    ).toEqual([]);
  });

  test("names that hold a secret, however they're written", () => {
    const keys = [
      "DB_PASSWORD",
      "PGPASSWORD",
      "MYSQL_ROOT_PWD",
      "SECRET_KEY_BASE",
      "APP_KEY",
      "API_KEY",
      "apiKey",
      "dbPassword",
      "spring.datasource.password",
      "DB-PASSWORD",
      "JWT_SECRET",
      "GITHUB_TOKEN",
      "AUTHTOKEN",
      "CLIENTSECRET",
      "SMTP_PASSWD",
      "AWS_SECRET_ACCESS_KEY",
      "PASSPHRASE",
    ];
    expect(flagged(...keys)).toEqual(keys);
  });
});

describe("the host's process list", () => {
  test("pid: host is flagged, other pid modes aren't", () => {
    expect(
      only(
        "hostPid",
        svc({ name: "monitor", pid: "host" }),
        svc({ name: "sidecar", pid: "service:monitor" }),
        svc({ name: "web" }),
      ),
    ).toEqual([{ rule: "hostPid", services: ["monitor"] }]);
  });

  test("it's exposed, not a takeover", () => {
    expect(severity({ rule: "hostPid", services: ["a"] })).toBe(2);
  });
});

describe("staying up", () => {
  test("no restart policy, or no", () => {
    expect(
      only(
        "noRestart",
        svc({ name: "a", restart: null }),
        svc({ name: "b", restart: "no" }),
        svc({ name: "c", restart: "always" }),
      ),
    ).toEqual([{ rule: "noRestart", services: ["a", "b"] }]);
  });

  test("waiting for a healthy service that has no healthcheck", () => {
    expect(
      only(
        "waitsForHealth",
        svc({
          name: "app",
          dependsOn: [
            { service: "db", condition: "healthy" },
            { service: "cache", condition: "healthy" },
            { service: "gone", condition: "healthy" },
          ],
        }),
        svc({ name: "db" }),
        svc({ name: "cache", healthcheck: true }),
      ),
    ).toEqual([{ rule: "waitsForHealth", service: "app", on: "db" }]);
  });

  test("waiting only for a start needs no healthcheck", () => {
    expect(
      rules(
        svc({
          name: "app",
          dependsOn: [{ service: "db", condition: "started" }],
        }),
        svc({ name: "db" }),
      ),
    ).toEqual([]);
  });
});

describe("order", () => {
  test("the worst first, then the file's order", () => {
    const all = findings(
      file(
        svc({
          name: "a",
          image: "nginx",
          restart: null,
          ports: [port("80", "80")],
        }),
        svc({ name: "b", privileged: true }),
        svc({
          name: "c",
          mounts: [
            {
              kind: "bind",
              source: "/var/run/docker.sock",
              target: "/s",
              readOnly: false,
            },
          ],
        }),
      ),
    );
    expect(all.map((f) => f.rule)).toEqual([
      "socket",
      "privileged",
      "openPorts",
      "latest",
      "noRestart",
    ]);
    expect(all.map(severity)).toEqual([3, 3, 2, 1, 1]);
  });

  test("NET_ADMIN alone is serious, not severe", () => {
    expect(severity({ rule: "caps", service: "a", caps: ["NET_ADMIN"] })).toBe(
      2,
    );
    expect(severity({ rule: "caps", service: "a", caps: ["SYS_ADMIN"] })).toBe(
      3,
    );
  });
});
