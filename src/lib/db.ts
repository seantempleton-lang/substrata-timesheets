import postgres from "postgres";

let client: postgres.Sql | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb() {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!client) {
    client = postgres(process.env.DATABASE_URL!, {
      max: 5,
      ssl: "prefer",
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  return client;
}

export function quoteIdentifierPath(value: string): string {
  const segments = value.split(".");

  if (
    segments.length === 0 ||
    segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))
  ) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }

  return segments.map((segment) => `"${segment}"`).join(".");
}
