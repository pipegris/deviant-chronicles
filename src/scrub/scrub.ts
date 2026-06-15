import { createHash } from 'node:crypto';
import type { NormalizedEvent } from '../schema/normalized-event';
import { canonicalJSON } from '../interpret/freeze';
import {
  COMPILED_SCRUB_PATTERNS,
  type CompiledScrubPattern,
  type ScrubCategory,
} from './scrub-patterns';

// Story 5.1 / AC1 + AC3 — the PURE, config-driven secret/PII redactor over a NormalizedEvent[] Session,
// plus the manual-review report. This is the privacy guardrail's core: it walks every redaction-relevant
// string leaf, replaces each deny-pattern match with a category-carrying token (NEVER the matched text),
// flags suspicious-but-unmatched opaque tokens for human eyes, and content-addresses the scrubbed output
// so the publish gate (gate.ts) can detect a post-scrub mutation. [story Task 2; epics.md#Story-5.1 AC1]
//
// PURE/deterministic (R2-adjacent; Dev Notes "Purity & determinism"): same NormalizedEvent[] + same
// pattern set → byte-identical scrubbedEvents, report, and scrubHash. NO Date.now()/Math.random()/
// network/fs/global mutable state — the fs read/write is the thin scripts/scrub.ts glue ONLY. `node:
// crypto` (sha256) is deterministic and allowed (the freeze.ts precedent). canonicalJSON is REUSED from
// interpret/freeze.ts — the architecture mandates ONE canonical-JSON serializer (do NOT author a second).
// SDK-free + phaser-free (the r4-isolation.test.ts source-grep pins it). [architecture.md#R2/R4; #Format L264-266]

// The fixed redaction token. Carries the CATEGORY for auditability (a human auditing the scrubbed event
// sees WHAT class of secret was removed) but never the matched value — the load-bearing privacy choice.
function redactionToken(category: ScrubCategory): string {
  return `«REDACTED:${category}»`;
}

// A per-category aggregate count: the "what was redacted" summary half of AC1. NO value.
export interface ScrubRedactionCount {
  category: ScrubCategory;
  count: number;
}

// WHERE a redaction happened: an eventId + a jsonPath into the payload (or a top-level field name), so a
// human can audit the scrubbed event. NO value, NO surrounding context that could reveal the secret.
export interface ScrubLocation {
  eventId: string;
  jsonPath: string;
  category: ScrubCategory;
}

// A suspicious-but-UNMATCHED string leaf (the "what needs human eyes" half of AC1): a high-entropy/opaque
// token no deny pattern caught. NOT redacted — just the location + WHY it looked suspicious. NO value.
export interface ScrubCandidate {
  eventId: string;
  jsonPath: string;
  reason: string;
}

// The manual-review report. Counts + locations + reasons ONLY — a report that re-listed the secret values
// would defeat the whole privacy point (the load-bearing test invariant asserts no planted value appears
// anywhere in here). [story Dev Notes "Report shape — NO value leakage"]
export interface ScrubReport {
  $reportVersion: 1;
  redactions: ScrubRedactionCount[];
  locations: ScrubLocation[];
  candidates: ScrubCandidate[];
  patternSetVersion: string;
  scrubHash: string;
}

export interface ScrubResult {
  scrubbedEvents: NormalizedEvent[];
  report: ScrubReport;
  scrubHash: string;
}

// The suspicious-candidate heuristic (Dev Notes): a conservative high-entropy / long-opaque-token detector
// — a single run of >=20 non-whitespace, mixed alphanumeric chars that no deny pattern redacted. It is a
// HINT for the operator, not a second redactor (the matched token stays in scrubbedEvents). Kept simple.
const CANDIDATE_MIN_LEN = 20;
const OPAQUE_TOKEN = /[A-Za-z0-9][A-Za-z0-9._/+=-]{19,}/g;

function candidateReason(token: string): string {
  // The reason names the SHAPE (length) only — never the token value. [Dev Notes "NO value"]
  return `opaque-token-len-${token.length}`;
}

function isHighEntropyOpaque(token: string): boolean {
  if (token.length < CANDIDATE_MIN_LEN) return false;
  // "Mixed alnum": both a letter and a digit present (a plain English word or a pure-digit run is not a
  // secret-shaped opaque token). Conservative — this is a human-eyes hint, not a redaction trigger.
  return /[A-Za-z]/.test(token) && /[0-9]/.test(token);
}

// Apply every deny pattern (in config order) to one string leaf, replacing each match with its category
// token. Returns the scrubbed string + the per-pattern hit counts. A FRESH regex is used per leaf
// (lastIndex reset) so a /g regex never carries state across leaves — the determinism footgun guard.
function scrubLeaf(
  value: string,
  patterns: CompiledScrubPattern[],
): { scrubbed: string; hits: Array<{ category: ScrubCategory }> } {
  let scrubbed = value;
  const hits: Array<{ category: ScrubCategory }> = [];
  for (const pattern of patterns) {
    // Fresh per-leaf regex: never reuse a stateful /g lastIndex across String.replace calls.
    const regex = new RegExp(pattern.source, pattern.flags);
    scrubbed = scrubbed.replace(regex, () => {
      hits.push({ category: pattern.category });
      return redactionToken(pattern.category);
    });
  }
  return { scrubbed, hits };
}

// Recursively walk a payload value, scrubbing string leaves in place (structurally) and recording
// locations/candidates. Object keys are walked in INPUT order (the redaction is surgical — it does not
// reorder structure; scrubHash stays stable because canonicalJSON re-sorts keys for the hash, and
// locations/candidates key on jsonPath+eventId so they are deterministic regardless of key order).
// Arrays keep order (order is meaningful). Numbers/booleans/null are structural — passed through. [R6]
function walkValue(
  value: unknown,
  jsonPath: string,
  eventId: string,
  patterns: CompiledScrubPattern[],
  acc: ScrubAccumulator,
): unknown {
  if (typeof value === 'string') {
    return scrubString(value, jsonPath, eventId, patterns, acc);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => walkValue(item, `${jsonPath}[${i}]`, eventId, patterns, acc));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      out[key] = walkValue(source[key], `${jsonPath}.${key}`, eventId, patterns, acc);
    }
    return out;
  }
  return value;
}

// Scrub one string leaf: redact deny-pattern matches (recording a location per hit) and, on the SCRUBBED
// remainder, flag any high-entropy opaque token that survived as a candidate (NOT redacted). NO value is
// ever written into acc.
function scrubString(
  value: string,
  jsonPath: string,
  eventId: string,
  patterns: CompiledScrubPattern[],
  acc: ScrubAccumulator,
): string {
  const { scrubbed, hits } = scrubLeaf(value, patterns);
  for (const hit of hits) {
    acc.locations.push({ eventId, jsonPath, category: hit.category });
    acc.counts.set(hit.category, (acc.counts.get(hit.category) ?? 0) + 1);
  }
  // Candidate detection runs on the SCRUBBED remainder so an already-redacted secret is not re-flagged
  // (its value is gone — replaced by the token). Surviving opaque tokens are the "needs human eyes" set.
  for (const match of scrubbed.matchAll(OPAQUE_TOKEN)) {
    const token = match[0];
    if (token.startsWith('«REDACTED:')) continue;
    if (isHighEntropyOpaque(token)) {
      acc.candidates.push({ eventId, jsonPath, reason: candidateReason(token) });
    }
  }
  return scrubbed;
}

interface ScrubAccumulator {
  counts: Map<ScrubCategory, number>;
  locations: ScrubLocation[];
  candidates: ScrubCandidate[];
}

// A deterministic identifier for the deny-pattern SET: the schema version plus a content hash of the
// (canonicalized) patterns. A pattern change changes this string, so it flows into scrubHash and the gate
// detects "the pattern set changed since approval". Pure (canonicalJSON + sha256). [story Task 2/3]
function patternSetVersionOf(patterns: CompiledScrubPattern[]): string {
  const canonical = canonicalJSON(
    patterns.map((p) => ({ id: p.id, category: p.category, source: p.source, flags: p.flags })),
  );
  return `1:${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
}

/**
 * Scrub a NormalizedEvent[] Session: redact every deny-pattern match from each redaction-relevant string
 * leaf (the payload record's string leaves, recursively, plus toolName/subtype), emit a manual-review
 * report (counts + locations + candidates, NO values), and content-address the scrubbed output.
 *
 * Structural fields (eventId/orderKey/timestamp/streamDepth/exitCode/isError/retryCount/eventType) are
 * NOT scrubbed — they carry no secrets and are load-bearing for ordering/mechanics. PURE/deterministic:
 * same input + same patterns → identical scrubbedEvents, report, scrubHash. Does NOT mutate `events`.
 *
 * @param patterns the deny set (defaults to the committed COMPILED_SCRUB_PATTERNS); a test may pass a
 *   different in-memory set (NFR-4 — the deny set is a config-only change).
 */
export function scrubSession(
  events: NormalizedEvent[],
  patterns: CompiledScrubPattern[] = COMPILED_SCRUB_PATTERNS,
): ScrubResult {
  const acc: ScrubAccumulator = { counts: new Map(), locations: [], candidates: [] };

  const scrubbedEvents: NormalizedEvent[] = events.map((event) => {
    // toolName / subtype are nullable strings that can carry redaction-relevant text (a tool name is
    // unlikely to, but subtype/free-form strings can) — scrub them as top-level string leaves.
    const toolName =
      event.toolName === null
        ? null
        : scrubString(event.toolName, 'toolName', event.eventId, patterns, acc);
    const subtype =
      event.subtype === null
        ? null
        : scrubString(event.subtype, 'subtype', event.eventId, patterns, acc);
    const payload =
      event.payload === null
        ? null
        : (walkValue(event.payload, 'payload', event.eventId, patterns, acc) as Record<
            string,
            unknown
          >);
    return { ...event, toolName, subtype, payload };
  });

  const patternSetVersion = patternSetVersionOf(patterns);
  const scrubHash = createHash('sha256')
    .update(canonicalJSON(scrubbedEvents) + patternSetVersion)
    .digest('hex');

  // redactions: per-category counts, only categories with hits. Sort is CODEPOINT (`<`/`>`), NOT
  // localeCompare: this array order is baked into reportHash via canonicalJSON (which preserves array
  // order), and localeCompare is locale/ICU-dependent — it could serialize the SAME report differently
  // across hosts and spuriously BLOCK a cross-host approval. Codepoint matches canonicalJSON's key sort. [R1]
  const redactions: ScrubRedactionCount[] = [...acc.counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const report: ScrubReport = {
    $reportVersion: 1,
    redactions,
    locations: acc.locations,
    candidates: acc.candidates,
    patternSetVersion,
    scrubHash,
  };

  return { scrubbedEvents, report, scrubHash };
}
