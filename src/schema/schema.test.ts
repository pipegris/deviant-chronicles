import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Smoke test: proves the pure-TS pipeline toolchain (Vitest + Zod) is wired up
// and that a versioned schema const + inferred type round-trips per the naming
// rule `XxxSchema` / `type Xxx = z.infer<typeof XxxSchema>` (architecture R-naming).
const SchemaVersionSchema = z.object({
  schemaVersion: z.literal(1),
});
type SchemaVersion = z.infer<typeof SchemaVersionSchema>;

describe('schema toolchain smoke', () => {
  it('parses a valid versioned object', () => {
    const value: SchemaVersion = SchemaVersionSchema.parse({ schemaVersion: 1 });
    expect(value.schemaVersion).toBe(1);
  });

  it('rejects an invalid object with a Zod error', () => {
    expect(() => SchemaVersionSchema.parse({ schemaVersion: 2 })).toThrow(z.ZodError);
  });
});
