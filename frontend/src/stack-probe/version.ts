// Trivial typed module: proves TypeScript compiles + type-checks in the build.
export interface ProbeInfo {
  readonly name: string;
  readonly version: readonly [number, number, number];
}

const INFO: ProbeInfo = { name: 'chess-tactics core', version: [0, 1, 0] };

export function probeVersion(): string {
  return `${INFO.name} v${INFO.version.join('.')}`;
}
