import type { NormalizedEvent } from '../../schema/normalized-event';

// Story 5.1 — planted-secret test fixture (Task 5). A small, Zod-VALID `NormalizedEvent[]` whose
// payload string leaves carry one OBVIOUSLY-FAKE planted value per scrub category, PLUS one
// suspicious-but-unmatched opaque token to exercise the `candidate` path (AC1's "what needs human
// eyes" half).
//
// Every value here is clearly synthetic ("FAKE" / `.invalid`) so the fixture itself ships NO real
// secret — exactly the committed-fixture posture (Dev Notes "Data-source reality"). The REAL scrub
// over the git-ignored `.sources/story-10-1/*` session is the deferred operator step.
//
// This fixture is the shared input for scrub.test.ts (AC1) and gate.test.ts (AC2). It is intentionally
// authored as inline NormalizedEvent objects (post-ingest, validated shape) rather than raw JSONL: the
// scrub runs over the validated `NormalizedEvent[]`, not the untrusted format (R3 — only ingest/ parses
// raw JSONL). The shape mirrors src/schema/normalized-event.unit.test.ts's `validEvent`.

// Exported so the load-bearing privacy assertion can iterate them and assert each is `.not.toContain`'d
// anywhere in the scrubbed output + report (a report that re-listed values would FAIL that gate).
export const PLANTED_SECRETS = {
  token: 'sk-FAKE0000000000000000000000', // API key / token shape (sk-…)
  bearer: 'Bearer FAKEtokenABCDEF0123456789abcdef', // Bearer auth header
  credential: 'password=FAKEpw123!', // credential (password=…)
  piiEmail: 'dev.person@example.invalid', // PII email (RFC-lite)
  homePath: '/home/fakeuser/secret/private.key', // absolute home path /home/<user>/…
  dbRole: 'app_rw', // DB role name (configurable allowlist)
} as const;

// A suspicious-but-UNMATCHED opaque token: long, mixed-alnum, no whitespace, but NOT shaped like any
// deny pattern above (no `sk-`/`Bearer`/`password=`/`@`/`/home/`). It must be FLAGGED as a `candidate`
// (high-entropy hint for human eyes), NOT redacted. Clearly synthetic via the FAKE prefix.
export const PLANTED_CANDIDATE = 'FAKEa1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

// A connection string whose credentials are the `://user:pass@` form WITHOUT a `password=` literal, so
// the broad password-assignment pattern does NOT pre-empt it — this exercises the otherwise-untested
// `connection-string-credential` deny pattern (scrub-patterns.json line 31). [R3 coverage]
export const PLANTED_CONN_STRING = 'mysql://svcuser:s3cr3tFAKEpw@db.internal.invalid:5432/appdb';

function orderKey(seq: number): NormalizedEvent['orderKey'] {
  return { logicalClock: seq, streamId: 'main', seqWithinStream: seq };
}

// Each event plants its secret(s) in payload string leaves (including a NESTED record, to exercise the
// recursive-walk requirement of scrubSession) and/or in `toolName`/`subtype`. Structural fields
// (eventId/orderKey/timestamp/numeric/boolean) carry NO secrets — they must NOT be scrubbed.
export const PLANTED_SECRET_EVENTS: NormalizedEvent[] = [
  {
    orderKey: orderKey(0),
    eventId: 'evt-token',
    eventType: 'tool_use',
    toolName: 'Bash',
    subtype: null,
    timestamp: '2026-06-14T15:00:00.000Z',
    streamDepth: 0,
    exitCode: 0,
    isError: false,
    retryCount: 0,
    payload: {
      command: `curl -H "Authorization: ${PLANTED_SECRETS.bearer}" https://api.example.invalid`,
      apiKey: PLANTED_SECRETS.token,
    },
  },
  {
    orderKey: orderKey(1),
    eventId: 'evt-credential',
    eventType: 'tool_use',
    toolName: 'Bash',
    subtype: null,
    timestamp: '2026-06-14T15:00:01.000Z',
    streamDepth: 0,
    exitCode: 0,
    isError: false,
    retryCount: 0,
    payload: {
      // Nested record — exercises scrubSession's RECURSIVE string-leaf walk.
      env: {
        connectionString: `postgres://${PLANTED_SECRETS.dbRole}:${PLANTED_SECRETS.credential}@db.example.invalid:5432/app`,
        role: PLANTED_SECRETS.dbRole,
      },
    },
  },
  {
    orderKey: orderKey(2),
    eventId: 'evt-pii-home',
    eventType: 'tool_use',
    toolName: 'Read',
    subtype: null,
    timestamp: '2026-06-14T15:00:02.000Z',
    streamDepth: 0,
    exitCode: 0,
    isError: false,
    retryCount: 0,
    payload: {
      filePath: PLANTED_SECRETS.homePath,
      contactEmail: PLANTED_SECRETS.piiEmail,
    },
  },
  {
    orderKey: orderKey(3),
    eventId: 'evt-candidate',
    eventType: 'assistant',
    toolName: null,
    subtype: 'text',
    timestamp: '2026-06-14T15:00:03.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: {
      // A high-entropy opaque token no deny pattern catches → must surface as a `candidate`.
      note: `generated reference id ${PLANTED_CANDIDATE} for later`,
    },
  },
];
