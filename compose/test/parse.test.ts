import { describe, expect, test } from "vitest";
import type { Service } from "../src/model";
import { parseCompose, toModel } from "../src/parse";
import { port } from "./make";

// The one service of a file with only `body` under it.
const one = (body: Record<string, unknown>): Service => {
  const result = toModel({ services: { web: body } });
  if (!("file" in result)) throw new Error("no file");
  const s = result.file.services[0];
  if (!s) throw new Error("no service");
  return s;
};

describe("reading the YAML", () => {
  test("a file with services", () => {
    const r = parseCompose("services:\n  web:\n    image: nginx:1.27\n");
    expect("file" in r && r.file.services.map((s) => s.name)).toEqual(["web"]);
  });

  test("bad indentation names its line, counted from 1", () => {
    const r = parseCompose(
      "services:\n  web:\n    image: nginx\n   ports:\n      - 8080:80\n",
    );
    expect(r).toEqual({ error: "yaml", line: 4 });
  });

  test("documents in one file are read as one, as Docker Compose reads them", () => {
    const r = parseCompose(
      "services:\n  a:\n    image: a:1\n---\nservices:\n  a:\n    restart: always\n",
    );
    if (!("file" in r)) throw new Error("no file");
    expect(r.file.services[0]).toMatchObject({
      image: "a:1",
      restart: "always",
    });
    expect(r.file.parts).toEqual([null, null]);
    expect(parseCompose("services: {}\n---\nservices: {}\n")).toEqual({
      error: "empty",
    });
  });

  test("no services, or not a mapping at all", () => {
    expect(parseCompose("")).toEqual({ error: "empty" });
    expect(parseCompose("just words")).toEqual({ error: "empty" });
    expect(parseCompose("- a\n- b\n")).toEqual({ error: "empty" });
    expect(parseCompose("services: {}\n")).toEqual({ error: "empty" });
    expect(parseCompose("services: [a, b]\n")).toEqual({ error: "empty" });
    expect(parseCompose("version: '3'\n")).toEqual({ error: "empty" });
  });

  test("merge keys, as in shared x- blocks", () => {
    const r = parseCompose(
      "x-base: &base\n  restart: always\n  image: app:2\nservices:\n  web:\n    <<: *base\n    image: web:1\n",
    );
    const s = "file" in r ? r.file.services[0] : undefined;
    expect(s?.restart).toBe("always");
    expect(s?.image).toBe("web:1");
  });

  test("YAML 1.2: 22:22 stays a string, not a base-60 number", () => {
    const r = parseCompose("services:\n  ssh:\n    ports:\n      - 22:22\n");
    expect("file" in r && r.file.services[0]?.ports).toEqual([
      port("22", "22"),
    ]);
  });

  test("a service with nothing under it", () => {
    const r = parseCompose("services:\n  idle:\n");
    expect("file" in r && r.file.services[0]?.name).toBe("idle");
  });
});

describe("a service", () => {
  test("image, or build", () => {
    expect(one({ image: "nginx:1.27" }).image).toBe("nginx:1.27");
    expect(one({ build: "." })).toMatchObject({ image: null, build: true });
    expect(one({ build: { context: "." }, image: "me/app" })).toMatchObject({
      image: "me/app",
      build: true,
    });
  });

  test("ports, skipping the ones it can't read", () => {
    expect(
      one({ ports: ["80:80", { target: 443 }, "nonsense"] }).ports,
    ).toEqual([port("80", "80"), port(null, "443")]);
  });

  test("volumes, short syntax", () => {
    expect(
      one({
        volumes: [
          "data:/data",
          "./config:/config",
          "/srv/media:/media:ro",
          "/cache",
          "~/notes:/notes:rw",
          "C:\\games:/games",
          "../up:/up:z",
        ],
      }).mounts,
    ).toEqual([
      { kind: "volume", source: "data", target: "/data", readOnly: false },
      { kind: "bind", source: "./config", target: "/config", readOnly: false },
      { kind: "bind", source: "/srv/media", target: "/media", readOnly: true },
      { kind: "anonymous", source: null, target: "/cache", readOnly: false },
      { kind: "bind", source: "~/notes", target: "/notes", readOnly: false },
      { kind: "bind", source: "C:\\games", target: "/games", readOnly: false },
      { kind: "bind", source: "../up", target: "/up", readOnly: false },
    ]);
  });

  test("volumes, long syntax", () => {
    expect(
      one({
        volumes: [
          {
            type: "bind",
            source: "/var/run/docker.sock",
            target: "/var/run/docker.sock",
            read_only: true,
          },
          { type: "volume", source: "db", target: "/var/lib/db" },
          { type: "tmpfs", target: "/tmp" },
          { type: "volume", target: "/anon" },
        ],
      }).mounts,
    ).toEqual([
      {
        kind: "bind",
        source: "/var/run/docker.sock",
        target: "/var/run/docker.sock",
        readOnly: true,
      },
      { kind: "volume", source: "db", target: "/var/lib/db", readOnly: false },
      { kind: "tmpfs", source: null, target: "/tmp", readOnly: false },
      { kind: "anonymous", source: null, target: "/anon", readOnly: false },
    ]);
  });

  test("networks, as a list or a mapping, and network_mode", () => {
    expect(one({ networks: ["front", "back"] }).networks).toEqual([
      "front",
      "back",
    ]);
    expect(
      one({ networks: { front: null, back: { aliases: ["db"] } } }).networks,
    ).toEqual(["front", "back"]);
    expect(one({ network_mode: "host" }).networkMode).toBe("host");
  });

  test("depends_on, as a list or with conditions", () => {
    expect(one({ depends_on: ["db", "cache"] }).dependsOn).toEqual([
      { service: "db", condition: "started" },
      { service: "cache", condition: "started" },
    ]);
    expect(
      one({
        depends_on: {
          db: { condition: "service_healthy" },
          init: { condition: "service_completed_successfully" },
          cache: { condition: "service_started" },
          other: null,
        },
      }).dependsOn,
    ).toEqual([
      { service: "db", condition: "healthy" },
      { service: "init", condition: "completed" },
      { service: "cache", condition: "started" },
      { service: "other", condition: "started" },
    ]);
  });

  test("environment: which values are written out, never the values", () => {
    const fromList = one({
      environment: ["A=1", "B", "C=${X}", "D=", "E=x${Y}", "F=a=b"],
    });
    const fromMap = one({
      environment: { A: 1, B: null, C: "${X}", D: "", E: false, F: "a=b" },
    });
    for (const s of [fromList, fromMap]) {
      expect(s.environment).toEqual([
        { key: "A", literal: true, fileRef: false },
        { key: "B", literal: false, fileRef: false },
        { key: "C", literal: false, fileRef: false },
        { key: "D", literal: false, fileRef: false },
        { key: "E", literal: s === fromMap, fileRef: false },
        { key: "F", literal: true, fileRef: false },
      ]);
    }
  });

  test("a secret's value never reaches the model", () => {
    const secret = "correct-horse-battery-staple";
    const r = parseCompose(
      `services:\n  db:\n    environment:\n      - DB_PASSWORD=${secret}\n`,
    );
    expect(JSON.stringify(r)).not.toContain(secret);
    const r2 = parseCompose(
      `services:\n  db:\n    environment:\n      DB_PASSWORD: ${secret}\n`,
    );
    expect(JSON.stringify(r2)).not.toContain(secret);
  });

  test("env_file in each form", () => {
    expect(one({ env_file: ".env" }).envFiles).toEqual([".env"]);
    expect(
      one({ env_file: ["a.env", { path: "b.env", required: false }] }).envFiles,
    ).toEqual(["a.env", "b.env"]);
  });

  test("the rest", () => {
    expect(
      one({
        privileged: true,
        cap_add: ["NET_ADMIN", "CAP_SYS_ADMIN"],
        devices: ["/dev/dri:/dev/dri"],
        restart: "always",
        user: "1000:1000",
        healthcheck: { test: ["CMD", "true"] },
        extends: { service: "base" },
      }),
    ).toMatchObject({
      privileged: true,
      capAdd: ["NET_ADMIN", "CAP_SYS_ADMIN"],
      devices: ["/dev/dri:/dev/dri"],
      restart: "always",
      user: "1000:1000",
      healthcheck: true,
      extends: true,
    });
    expect(one({ user: 1000 }).user).toBe("1000");
  });

  test("a healthcheck that's switched off isn't one", () => {
    expect(one({ healthcheck: { disable: true } }).healthcheck).toBe(false);
    expect(one({ healthcheck: { test: ["NONE"] } }).healthcheck).toBe(false);
    expect(one({}).healthcheck).toBe(false);
  });

  test("include is noted, not followed", () => {
    const r = toModel({ include: ["other.yml"], services: { a: {} } });
    expect("file" in r && r.file.include).toBe(true);
  });
});
