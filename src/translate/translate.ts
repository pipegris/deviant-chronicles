import type { NormalizedEvent } from '../schema/normalized-event';
import type { TranslatedAction } from './translated-action';
import {
  RULES,
  type TranslationRule,
  type TranslationRules,
} from './translation-rules';

// The pure, ordered-walk Translate engine (Layer 0): NormalizedEvent[] in, TranslatedAction[]
// out, driven ENTIRELY by src/config/translation-rules.json. The engine is GENERIC — it
// interprets rule fields (toolName array, commandPattern regex, isError, subtypeIn,
// isMirageCandidate) and contains NO literal like `if (toolName === 'Edit')`. The metaphor
// lives in the JSON (NFR-4); this is the load-bearing constraint Task 7 proves.
//
// PURE (R2): no Date.now / Math.random / performance.now / network / fs / module-level
// mutable state. Every output derives from the input events + the rules. The scout/spell
// accumulators below are FUNCTION-LOCAL (allocated fresh per call, reset implicitly by being
// const inside translate) — local working memory, NOT global mutable state. Input events and
// the input array are never mutated; fresh objects are returned, so a second run is
// byte-identical.

// payload.input shape for tool_use events (open record at the schema boundary). We read only
// the few keys the metaphor needs.
interface ToolInput {
  file_path?: unknown;
  path?: unknown;
  command?: unknown;
}

function getToolInput(event: NormalizedEvent): ToolInput {
  const payload = event.payload;
  if (payload === null || typeof payload !== 'object') return {};
  const input = (payload as { input?: unknown }).input;
  if (input === null || typeof input === 'undefined' || typeof input !== 'object') return {};
  return input as ToolInput;
}

// Target precedence (documented): input.file_path ?? input.path ?? null. The fixture uses
// absolute paths; we compare the resolved string exactly (trimmed). file_path covers
// Edit/Write/Read; path covers a Grep/Glob sweep.
function resolveTarget(event: NormalizedEvent): string | null {
  const input = getToolInput(event);
  const raw =
    typeof input.file_path === 'string'
      ? input.file_path
      : typeof input.path === 'string'
        ? input.path
        : null;
  if (raw === null) return null;
  const trimmed = raw.trim();
  // An empty/whitespace-only path is "no target", NOT an empty-string target — otherwise an
  // empty-path Read would record '' and a later null-target strike querying '' could collide
  // with it. Collapse both to null so "no target" and "empty-string target" never alias.
  return trimmed === '' ? null : trimmed;
}

function getCommand(event: NormalizedEvent): string | null {
  const command = getToolInput(event).command;
  return typeof command === 'string' ? command : null;
}

// The stringified payload.content of a tool_result, for contentPattern matching. content may
// be a string OR an array of normalized blocks (see ingest/normalize); we JSON-stringify the
// array so a hazard token in any block's text is matchable. Returns null when absent.
function getResultContent(event: NormalizedEvent): string | null {
  const payload = event.payload;
  if (payload === null || typeof payload !== 'object') return null;
  const content = (payload as { content?: unknown }).content;
  if (content === null || content === undefined) return null;
  return typeof content === 'string' ? content : JSON.stringify(content);
}

// Compile a static config pattern to RegExp ONCE per pattern (memoized in the per-call cache).
// Supports a leading (?i) flag (case-insensitive) since JS RegExp has no inline-flag syntax —
// hazard error text varies in case across providers. Building a RegExp from a static string is
// a pure constructor (no clock/IO).
function compilePattern(pattern: string, regexCache: Map<string, RegExp>): RegExp {
  let regex = regexCache.get(pattern);
  if (regex === undefined) {
    const ci = pattern.startsWith('(?i)');
    regex = new RegExp(ci ? pattern.slice(4) : pattern, ci ? 'i' : undefined);
    regexCache.set(pattern, regex);
  }
  return regex;
}

// Does a rule's match clause fully hold for this event? Absent fields are wildcards; ALL
// present fields must hold (AND). commandPattern/contentPattern compile to RegExp via the
// per-call cache. resolvesStrike consults the live open-strike set for the event's stream.
function matches(
  rule: TranslationRule,
  event: NormalizedEvent,
  regexCache: Map<string, RegExp>,
  pendingStrikeByStream: Set<string>,
): boolean {
  const { match } = rule;

  if (match.eventType !== undefined && match.eventType !== event.eventType) return false;

  if (match.toolName !== undefined) {
    if (event.toolName === null || !match.toolName.includes(event.toolName)) return false;
  }

  if (match.isError !== undefined && match.isError !== event.isError) return false;

  if (match.subtypeIn !== undefined) {
    if (event.subtype === null || !match.subtypeIn.includes(event.subtype)) return false;
  }

  if (match.commandPattern !== undefined) {
    const command = getCommand(event);
    if (command === null) return false;
    if (!compilePattern(match.commandPattern, regexCache).test(command)) return false;
  }

  if (match.contentPattern !== undefined) {
    const content = getResultContent(event);
    if (content === null) return false;
    if (!compilePattern(match.contentPattern, regexCache).test(content)) return false;
  }

  if (match.resolvesStrike === true && !pendingStrikeByStream.has(event.orderKey.streamId)) {
    return false;
  }

  return true;
}

/**
 * Translate an orderKey-sorted NormalizedEvent[] into one TranslatedAction per event.
 *
 * Assumes input is already orderKey-sorted (the merged output of ingest/); does NOT re-sort.
 * For each event: first matching rule wins (array order = priority); if none match, the
 * fail-closed `default` idle action is emitted. NEVER throws on an unmapped event (AC4).
 *
 * Local accumulators (pure — fresh per call):
 *  - scoutedTargets: paths previously Read (scout-BEFORE-strike, AC2). A later Read does not
 *    retroactively solidify, and Grep/Glob (broad sweeps, no single targeted file_path) do
 *    NOT mark a specific path solid.
 *  - pendingStrikeByStream: streamId -> an OPEN strike awaits its outcome. A tool_use whose
 *    rule emits opensStrike (a melee or a Bash spell) opens one; the NEXT tool_result on the
 *    SAME orderKey.streamId resolves it. A passing result lands (Boss damage) ONLY via the
 *    resolvesStrike-gated rule, so a scout's own result never damages the Boss; a failing
 *    result backfires (counter / Resolve drain). The same-stream key stops a sub-agent result
 *    resolving the main stream's strike. This is what makes the spell channel LOAD-BEARING.
 */
export function translate(
  events: NormalizedEvent[],
  rules: TranslationRules = RULES,
): TranslatedAction[] {
  const scoutedTargets = new Set<string>();
  const pendingStrikeByStream = new Set<string>();
  const regexCache = new Map<string, RegExp>();
  const out: TranslatedAction[] = [];

  for (const event of events) {
    const target = resolveTarget(event);
    const streamId = event.orderKey.streamId;

    // A scout reveals ground truth: only a targeted Read (file_path present) makes a later
    // strike on the SAME path solid. Recorded BEFORE this event's own strike resolution so a
    // Read never solidifies itself.
    if (event.eventType === 'tool_use' && event.toolName === 'Read' && target !== null) {
      scoutedTargets.add(target);
    }

    // Match (reads pendingStrikeByStream for any resolvesStrike rule) BEFORE we mutate the set
    // below, so a passing result resolves the strike that was open WHEN it arrived.
    const rule = rules.rules.find((r) => matches(r, event, regexCache, pendingStrikeByStream)) ?? null;

    if (rule === null) {
      out.push(buildDefault(rules, event));
      // A tool_result with no matching rule still closes any open strike on its stream (the
      // outcome arrived, even if it mapped to nothing), so a later result can't resolve a
      // stale strike.
      if (event.eventType === 'tool_result') pendingStrikeByStream.delete(streamId);
      continue;
    }

    const emit = rule.emit;
    const isStrike = emit.isMirageCandidate === true;

    out.push({
      actionType: emit.actionType,
      sourceEventId: event.eventId,
      orderKey: {
        logicalClock: event.orderKey.logicalClock,
        streamId: event.orderKey.streamId,
        seqWithinStream: event.orderKey.seqWithinStream,
      },
      target,
      // null target = no file to scout, so a strike on it is always a Mirage; otherwise solid
      // iff that exact path was Read earlier. Treating null explicitly avoids aliasing "no
      // target" with an empty-string scout key.
      isMirage: isStrike ? (target === null ? true : !scoutedTargets.has(target)) : null,
      resolveDelta: emit.resolveDelta ?? 0,
      problemIntegrityDelta: emit.problemIntegrityDelta ?? 0,
      isAetherStorm: emit.isAetherStorm ?? false,
    });

    // Open/close the stream's strike AFTER matching: a tool_result resolves (closes) whatever
    // strike was open; a tool_use that opensStrike (melee/spell) opens one for the next result.
    if (event.eventType === 'tool_result') {
      pendingStrikeByStream.delete(streamId);
    } else if (emit.opensStrike === true) {
      pendingStrikeByStream.add(streamId);
    }
  }

  return out;
}

// The fail-closed-to-default neutral action (AC4). Its zero-deltas come from DATA.
function buildDefault(rules: TranslationRules, event: NormalizedEvent): TranslatedAction {
  return {
    actionType: rules.default.actionType,
    sourceEventId: event.eventId,
    orderKey: {
      logicalClock: event.orderKey.logicalClock,
      streamId: event.orderKey.streamId,
      seqWithinStream: event.orderKey.seqWithinStream,
    },
    target: null,
    isMirage: null,
    resolveDelta: rules.default.resolveDelta,
    problemIntegrityDelta: rules.default.problemIntegrityDelta,
    isAetherStorm: false,
  };
}
