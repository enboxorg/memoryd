// memoryd CLI — flag parsing helpers (hand-rolled, no external library).

export function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) { return undefined; }
  return args[idx + 1];
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function parsePort(value: string | undefined, fallback: number): number {
  if (!value) { return fallback; }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`Invalid port: ${value}`);
    process.exit(1);
  }
  return n;
}
