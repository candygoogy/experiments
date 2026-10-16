// What the map is drawn from: the parts of a compose file it reads, as
// plain data. Environment values never get this far: only whether each one
// is written out literally.

export interface PortMapping {
  // The host address it's published on; null means every address.
  hostIp: string | null;
  // The host port (or range); null means Docker picks one.
  published: string | null;
  target: string;
  protocol: string;
}

export interface Mount {
  // A named volume, a host folder or file, an anonymous volume, memory, or
  // whichever a variable is set to (${VOL_NAME}:/data).
  kind: "volume" | "bind" | "anonymous" | "tmpfs" | "variable";
  source: string | null;
  target: string;
  readOnly: boolean;
}

export interface Dependency {
  service: string;
  condition: "started" | "healthy" | "completed";
}

export interface Setting {
  // A valid variable name, never anything after an "=".
  key: string;
  // Written out in the file: not empty, not drawn from a variable, or a
  // variable's default (${VAR:-x}) written out.
  literal: boolean;
  // It names a file that holds the secret (a *_FILE variable, or a path
  // under /run/secrets): the recommended way, not a secret itself.
  fileRef: boolean;
}

export interface Service {
  name: string;
  image: string | null;
  build: boolean;
  ports: PortMapping[];
  mounts: Mount[];
  networks: string[];
  networkMode: string | null;
  dependsOn: Dependency[];
  environment: Setting[];
  envFiles: string[];
  privileged: boolean;
  capAdd: string[];
  devices: string[];
  restart: string | null;
  healthcheck: boolean;
  user: string | null;
  // pid: "host" shares the host's process list.
  pid: string | null;
  // It extends another service, which the map doesn't follow.
  extends: boolean;
  // The profiles it belongs to: with any, `docker compose up` starts it
  // only when one of them is turned on.
  profiles: string[];
  // Ports an earlier file of a merged set wrote, when a later file (the
  // one at `part`) also sets this service: a ports list written there is
  // added to these, not put in their place.
  earlier?: { part: number; ports: PortMapping[] };
}

export interface ComposeFile {
  services: Service[];
  // It includes other files, which the map doesn't follow.
  include: boolean;
  // The documents read as one, in order: each one's file name when a line
  // "# name.yml" opens it, else null. One entry for a single file.
  parts: (string | null)[];
}
