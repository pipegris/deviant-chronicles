import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import {
  PLANTED_SECRET_EVENTS,
  PLANTED_SECRETS,
  PLANTED_CANDIDATE,
  PLANTED_CONN_STRING,
} from './__fixtures__/planted-secrets';

// RED-PHASE acceptance test for Story 5.1 — AC1 (scrub + report). It imports the not-yet-authored
// `./scrub` (scrubSession, ScrubResult, ScrubReport), so it ERRORS now (RED — module resolution fails);
// turns GREEN when the dev authors src/scrub/scrub.ts. [story Task 2; epics.md#Story-5.1 AC1]
//
// AC1 (verbatim): "every planted pattern is redacted from the emitted SCRUBBED Session copy, AND a
// manual-review report lists what was redacted BY CATEGORY + COUNT and what needs human eyes
// (suspicious-but-unmatched candidates) — with NO secret value ever appearing in the report or in any
// error message."
import { scrubSession, type ScrubResult } from './scrub';

// All planted secret values, as a flat list, for the load-bearing privacy assertion (no value may leak).
const ALL_PLANTED_VALUES: string[] = [...Object.values(PLANTED_SECRETS), PLANTED_CANDIDATE];

function run(): ScrubResult {
  return scrubSession(PLANTED_SECRET_EVENTS);
}

describe('Story 5.1 / AC1 — every planted pattern is redacted from the scrubbed Session copy', () => {
  it('returns a ScrubResult with scrubbedEvents, a report, and a scrubHash', () => {
    const result = run();
    expect(Array.isArray(result.scrubbedEvents)).toBe(true);
    expect(result.scrubbedEvents).toHaveLength(PLANTED_SECRET_EVENTS.length);
    expect(result.report).toBeDefined();
    expect(typeof result.scrubHash).toBe('string');
    expect(result.scrubHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('replaces each matched secret with a category-carrying token «REDACTED:{category}» (not the value)', () => {
    const serialized = JSON.stringify(run().scrubbedEvents);
    // The token must carry the CATEGORY (auditability) and never the matched text.
    expect(serialized).toContain('«REDACTED:');
    // AC1 verbatim: "EVERY planted pattern is redacted from the emitted SCRUBBED Session copy". A bare
    // `.toContain('«REDACTED:')` passes even if only ONE category ever fired — so assert the SCRUBBED
    // OUTPUT itself carries each planted category's token (not just that the report counted it). This
    // catches a regression that drops a category suffix or redacts into the report but not the events.
    for (const category of ['token', 'credential', 'pii-email', 'home-path', 'db-role'] as const) {
      expect(serialized).toContain(`«REDACTED:${category}»`);
    }
  });

  it('preserves STRUCTURAL fields (eventId/orderKey/timestamp) untouched — only string leaves scrub', () => {
    const result = run();
    result.scrubbedEvents.forEach((scrubbed, i) => {
      const original = PLANTED_SECRET_EVENTS[i];
      expect(scrubbed.eventId).toBe(original.eventId);
      expect(scrubbed.orderKey).toEqual(original.orderKey);
      expect(scrubbed.timestamp).toBe(original.timestamp);
      expect(scrubbed.isError).toBe(original.isError);
    });
  });
});

describe('Story 5.1 / AC1 — the report lists what was redacted BY CATEGORY + COUNT', () => {
  it('report carries a version, redactions (category+count), locations, and candidates', () => {
    const { report } = run();
    expect(report.$reportVersion).toBe(1);
    expect(Array.isArray(report.redactions)).toBe(true);
    expect(Array.isArray(report.locations)).toBe(true);
    expect(Array.isArray(report.candidates)).toBe(true);
  });

  it('redactions aggregate the EXACT count per category for every planted category', () => {
    const { report } = run();
    const byCategory = new Map(report.redactions.map((r) => [r.category, r.count]));
    // AC1 says "by category + COUNT" — the fixture is deterministic, so the counts are FIXED and pinned
    // here (a `> 0` check would let a double-count / under-count regression pass silently). Derived from
    // the planted fixture: token = sk- key (evt-token.apiKey) + Bearer (evt-token.command) = 2;
    // credential = password=… inside the connection string = 1; pii-email = 1; home-path = 1;
    // db-role = `postgres` + `app_rw` in the connectionString + `app_rw` in env.role = 3.
    const expected: Record<string, number> = {
      token: 2,
      credential: 1,
      'pii-email': 1,
      'home-path': 1,
      'db-role': 3,
    };
    for (const [category, count] of Object.entries(expected)) {
      expect(byCategory.get(category as never) ?? 0).toBe(count);
    }
    // No category fires that the fixture did not plant (e.g. `secret` is not exercised by this fixture).
    expect(report.redactions.map((r) => r.category).sort()).toEqual(
      ['credential', 'db-role', 'home-path', 'pii-email', 'token'],
    );
  });

  it('locations point at the right eventId + a jsonPath into the payload (so a human can audit)', () => {
    const { report } = run();
    expect(report.locations.length).toBeGreaterThan(0);
    for (const loc of report.locations) {
      expect(typeof loc.eventId).toBe('string');
      expect(typeof loc.jsonPath).toBe('string');
      expect(loc.jsonPath.length).toBeGreaterThan(0);
      expect(typeof loc.category).toBe('string');
    }
    // The token/bearer secrets live on evt-token; assert at least one redaction was located there.
    expect(report.locations.some((l) => l.eventId === 'evt-token')).toBe(true);
  });
});

describe('Story 5.1 / AC1 — the `secret` deny pattern (generic high-entropy assignment) redacts', () => {
  // The shared planted fixture exercises token/credential/pii-email/home-path/db-role but NOT the
  // config's `generic-high-entropy-secret` pattern (category `secret`) — leaving one of the six
  // SCRUB_CATEGORIES with zero redaction coverage. Drive a dedicated event so the `secret` branch is
  // proven (a regression that dropped that config entry would otherwise go unnoticed). [AC1 + AC3 config]
  const SECRET_VALUE = 'secret = abcdef0123456789ABCDEF'; // matches `(?:secret|…)["'\s:=]+[A-Za-z0-9._-]{16,}`
  const HIGH_ENTROPY = 'abcdef0123456789ABCDEF';

  function secretEvent(): NormalizedEvent {
    return { ...PLANTED_SECRET_EVENTS[0], eventId: 'evt-secret', payload: { config: SECRET_VALUE } };
  }

  it('redacts a generic `secret = <high-entropy>` assignment as category `secret`', () => {
    const result = scrubSession([secretEvent()]);
    const byCategory = new Map(result.report.redactions.map((r) => [r.category, r.count]));
    expect(byCategory.get('secret') ?? 0).toBeGreaterThan(0);
    const serialized = JSON.stringify(result.scrubbedEvents);
    expect(serialized).toContain('«REDACTED:secret»');
    // The high-entropy value itself must be gone from the scrubbed output (no leak).
    expect(serialized).not.toContain(HIGH_ENTROPY);
  });
});

describe('Story 5.1 / AC1 — the `connection-string-credential` deny pattern redacts (R3 coverage)', () => {
  // The shared fixture's connection string carries a `password=` literal, so the broad
  // password-assignment pattern pre-empts the narrower `connection-string-credential` pattern — leaving
  // that pattern (scrub-patterns.json line 31) with zero coverage. Drive a password-literal-free
  // `://user:pass@` conn string so the conn-str pattern is the one that fires. [review R3]
  function connEvent(): NormalizedEvent {
    return { ...PLANTED_SECRET_EVENTS[0], eventId: 'evt-conn', payload: { dsn: PLANTED_CONN_STRING } };
  }

  it('redacts the `://user:pass@` credential segment via the connection-string-credential pattern', () => {
    const result = scrubSession([connEvent()]);
    const byCategory = new Map(result.report.redactions.map((r) => [r.category, r.count]));
    // The ONLY pattern that can fire on this leaf is connection-string-credential (no password= / sk- /
    // Bearer / db-role token present), so a credential hit here PROVES line 31 is exercised.
    expect(byCategory.get('credential') ?? 0).toBe(1);
    const serialized = JSON.stringify(result.scrubbedEvents);
    expect(serialized).toContain('«REDACTED:credential»');
    // Both the embedded user AND password are gone — the conn-str credential segment is removed.
    expect(serialized).not.toContain('svcuser');
    expect(serialized).not.toContain('s3cr3tFAKEpw');
    expect(serialized).not.toContain(PLANTED_CONN_STRING);
  });
});

describe('Story 5.1 / AC1 — home-path patterns consume the path TAIL (incl. filename) (R5)', () => {
  // The home-path patterns redact the whole absolute path through the filename (not just the
  // /home/<user> prefix), so .ssh/id_rsa-style residual signal is also removed — the fail-safe privacy
  // direction. [review R5]
  it('redacts the full /home/<user>/… path including the tail, leaving no residual segment', () => {
    const event: NormalizedEvent = {
      ...PLANTED_SECRET_EVENTS[0],
      eventId: 'evt-home-tail',
      payload: { filePath: '/home/fakeuser/.ssh/id_rsa' },
    };
    const result = scrubSession([event]);
    const filePath = (result.scrubbedEvents[0].payload as Record<string, unknown>).filePath;
    // The ENTIRE path collapses to the token — no `/.ssh/id_rsa` tail survives (the R5 fix).
    expect(filePath).toBe('«REDACTED:home-path»');
    const serialized = JSON.stringify(result.scrubbedEvents);
    expect(serialized).not.toContain('.ssh');
    expect(serialized).not.toContain('id_rsa');
    expect(serialized).not.toContain('fakeuser');
  });
});

describe('Story 5.1 / AC1 — suspicious-but-UNMATCHED tokens surface as candidates (human eyes)', () => {
  it('flags the planted opaque high-entropy token as a candidate (NOT redacted, just hinted)', () => {
    const { report, scrubbedEvents } = run();
    // It is a CANDIDATE for evt-candidate, with a reason — but its VALUE never appears.
    expect(report.candidates.some((c) => c.eventId === 'evt-candidate')).toBe(true);
    for (const c of report.candidates) {
      expect(typeof c.jsonPath).toBe('string');
      expect(typeof c.reason).toBe('string');
      expect(c.reason.length).toBeGreaterThan(0);
    }
    // A candidate is a HINT, not a redaction: the opaque token is still present in scrubbedEvents
    // (it matched no deny pattern). This distinguishes "flagged for review" from "redacted".
    expect(JSON.stringify(scrubbedEvents)).toContain(PLANTED_CANDIDATE);
  });
});

describe('Story 5.1 / AC1 — LOAD-BEARING privacy invariant: NO secret value leaks anywhere', () => {
  it('no planted matched secret value appears in the scrubbed events string leaves', () => {
    const serialized = JSON.stringify(run().scrubbedEvents);
    // Every MATCHED category value must be gone (the candidate is the deliberate exception, tested above).
    for (const value of Object.values(PLANTED_SECRETS)) {
      expect(serialized).not.toContain(value);
    }
  });

  it('no planted secret value (incl. the candidate) appears anywhere in the serialized report', () => {
    const serializedReport = JSON.stringify(run().report);
    // The report lists counts + locations + reasons ONLY — never a value (a value-listing report would
    // defeat the whole privacy point). The candidate too: its location/reason, never its text.
    for (const value of ALL_PLANTED_VALUES) {
      expect(serializedReport).not.toContain(value);
    }
  });

  it('no thrown error message leaks a secret value (errors reference ids/paths only)', () => {
    // Drive a payload whose only string leaf is a planted secret; if any internal validation throws,
    // assert the message carries no value. If it does NOT throw, the assertion is vacuously satisfied.
    try {
      scrubSession([
        { ...PLANTED_SECRET_EVENTS[0], payload: { apiKey: PLANTED_SECRETS.token } },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const value of ALL_PLANTED_VALUES) {
        expect(message).not.toContain(value);
      }
    }
  });
});

describe('Story 5.1 / AC3 — the scrub is PURE/deterministic (same input → same output + report)', () => {
  it('two runs over the same input produce deeply-equal scrubbedEvents, report, and scrubHash', () => {
    const a = run();
    const b = run();
    expect(b.scrubbedEvents).toEqual(a.scrubbedEvents);
    expect(b.report).toEqual(a.report);
    expect(b.scrubHash).toBe(a.scrubHash);
  });

  it('does not mutate the input events (a pure function leaves its argument intact)', () => {
    const snapshot = JSON.stringify(PLANTED_SECRET_EVENTS);
    run();
    expect(JSON.stringify(PLANTED_SECRET_EVENTS)).toBe(snapshot);
  });

  // GOLDEN snapshot — the load-bearing determinism pin. `run() === run()` (above) only proves the
  // function is a pure function of its input; it does NOT prove the output is CORRECT or stable across
  // code changes. This golden pins the exact report (counts + locations + candidates) AND the scrubbed
  // payloads so a behavioral drift that stays internally deterministic — a changed token format, a
  // changed jsonPath shape, a re-ordered locations array, an off-by-one count — FAILS loudly. This is
  // the snapshot the task brief mandates for a determinism-bearing story. NO secret value appears in it
  // (verified by the no-leak tests above + visible here). Update only on an INTENTIONAL behavior change.
  it('pins the report + scrubbed payloads as a golden snapshot (determinism / no-drift)', () => {
    const { report, scrubbedEvents } = run();
    expect({
      redactions: report.redactions,
      locations: report.locations,
      candidates: report.candidates,
      $reportVersion: report.$reportVersion,
      payloads: scrubbedEvents.map((e) => e.payload),
    }).toMatchInlineSnapshot(`
      {
        "$reportVersion": 1,
        "candidates": [
          {
            "eventId": "evt-candidate",
            "jsonPath": "payload.note",
            "reason": "opaque-token-len-40",
          },
        ],
        "locations": [
          {
            "category": "token",
            "eventId": "evt-token",
            "jsonPath": "payload.command",
          },
          {
            "category": "token",
            "eventId": "evt-token",
            "jsonPath": "payload.apiKey",
          },
          {
            "category": "credential",
            "eventId": "evt-credential",
            "jsonPath": "payload.env.connectionString",
          },
          {
            "category": "db-role",
            "eventId": "evt-credential",
            "jsonPath": "payload.env.connectionString",
          },
          {
            "category": "db-role",
            "eventId": "evt-credential",
            "jsonPath": "payload.env.connectionString",
          },
          {
            "category": "db-role",
            "eventId": "evt-credential",
            "jsonPath": "payload.env.role",
          },
          {
            "category": "home-path",
            "eventId": "evt-pii-home",
            "jsonPath": "payload.filePath",
          },
          {
            "category": "pii-email",
            "eventId": "evt-pii-home",
            "jsonPath": "payload.contactEmail",
          },
        ],
        "payloads": [
          {
            "apiKey": "«REDACTED:token»",
            "command": "curl -H "Authorization: «REDACTED:token»" https://api.example.invalid",
          },
          {
            "env": {
              "connectionString": "«REDACTED:db-role»://«REDACTED:db-role»:«REDACTED:credential»",
              "role": "«REDACTED:db-role»",
            },
          },
          {
            "contactEmail": "«REDACTED:pii-email»",
            "filePath": "«REDACTED:home-path»",
          },
          {
            "note": "generated reference id FAKEa1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8 for later",
          },
        ],
        "redactions": [
          {
            "category": "credential",
            "count": 1,
          },
          {
            "category": "db-role",
            "count": 3,
          },
          {
            "category": "home-path",
            "count": 1,
          },
          {
            "category": "pii-email",
            "count": 1,
          },
          {
            "category": "token",
            "count": 2,
          },
        ],
      }
    `);
  });
});
