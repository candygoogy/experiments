// Builds services and files for the tests, with every field at its
// quietest (a pinned image, a restart policy, nothing open).
import type { ComposeFile, PortMapping, Service } from "../src/model";

export const svc = (s: Partial<Service> & { name: string }): Service => ({
  image: "app:1.0",
  build: false,
  ports: [],
  mounts: [],
  networks: [],
  networkMode: null,
  dependsOn: [],
  environment: [],
  envFiles: [],
  privileged: false,
  capAdd: [],
  devices: [],
  restart: "unless-stopped",
  healthcheck: false,
  user: null,
  pid: null,
  extends: false,
  profiles: [],
  ...s,
});

export const file = (...services: Service[]): ComposeFile => ({
  services,
  include: false,
  parts: [null],
});

export const port = (
  published: string | null,
  target: string,
  hostIp: string | null = null,
  protocol = "tcp",
): PortMapping => ({ hostIp, published, target, protocol });
