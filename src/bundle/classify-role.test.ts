import { describe, expect, it } from 'vitest';

// RED-PHASE acceptance test for Story 5.5 — Task 1 / AC3: the PURE, name-discarding role classifier.
//
// It imports the NOT-YET-AUTHORED `./classify-role` (classifyRole + the AbstractedRole union), so it
// ERRORS now (RED — module resolution fails). It turns GREEN when the dev (Task 1) authors
// src/bundle/classify-role.ts with:
//   - export type AbstractedRole = 'test' | 'schema' | 'migration' | 'config' | 'doc' | 'source';
//       (a string-literal union — NO numeric/native enum; the project convention)
//   - export function classifyRole(path: string | null): AbstractedRole — a PURE deterministic
//       function that maps a path PATTERN to a COARSE role token and returns ONLY the token; it NEVER
//       returns, echoes, logs, or embeds the path/name. `null` → the fallback role 'source'.
//
// AC3 (verbatim): "Given the abstracted role classifier, When it maps a path, Then it is a PURE
// deterministic function emitting only a coarse role token (test/schema/migration/config/doc/source)
// and NEVER echoes the path/name; classification happens at bake time and only the token ships."
//
// These run under NODE (no DOM) — the classifier is pure + SDK-free + phaser-free.
import { classifyRole, type AbstractedRole } from './classify-role';

// The six coarse role tokens AC3 enumerates — the ONLY values classifyRole may ever return.
const ROLE_TOKENS: readonly AbstractedRole[] = [
  'test',
  'schema',
  'migration',
  'config',
  'doc',
  'source',
] as const;

// ---------------------------------------------------------------------------------------------------
// AC3 — the classifier maps a path PATTERN to a coarse role (the documented ordered rules; FIRST
// match wins). The precedence is load-bearing: a path can match multiple patterns.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC3 — classifyRole maps a path pattern to a coarse role token (table-driven)', () => {
  // [input path, expected role] — one row per role plus the precedence cases (Dev Notes §3 order).
  const cases: ReadonlyArray<readonly [string, AbstractedRole]> = [
    // test
    ['src/schema/normalized-event.test.ts', 'test'],
    ['src/render/arena.spec.ts', 'test'],
    ['src/__tests__/helpers.ts', 'test'],
    // schema
    ['src/schema/normalized-event.ts', 'schema'],
    ['src/foo.schema.ts', 'schema'],
    // migration
    ['db/migrations/001_init.sql', 'migration'],
    ['src/foo.migration.ts', 'migration'],
    // config
    ['package.json', 'config'],
    ['tsconfig.json', 'config'],
    ['vite.config.ts', 'config'],
    ['eslint.config.ts', 'config'],
    ['config/app.yaml', 'config'],
    ['_bmad/custom/skill.toml', 'config'],
    // doc
    ['README.md', 'doc'],
    ['docs/guide.mdx', 'doc'],
    ['notes.txt', 'doc'],
    // source (the fallback)
    ['src/render/arena.ts', 'source'],
    ['src/ingest/parse-transcript.ts', 'source'],
  ];

  for (const [path, expected] of cases) {
    it(`classifies "${path}" as "${expected}"`, () => {
      expect(classifyRole(path)).toBe(expected);
    });
  }

  it('PRECEDENCE — a test file inside a schema dir is "test" (test wins over schema)', () => {
    // src/schema/foo.test.ts matches BOTH `*.test.*` AND a `schema/` segment; the documented FIRST-match
    // order (test before schema) makes it 'test'. This pins the ordered-rule semantics (Dev Notes §3).
    expect(classifyRole('src/schema/foo.test.ts')).toBe('test');
  });

  // test-review (Story 5.5): the FIRST-match precedence is load-bearing logic, not data — a reorder or a
  // de-anchored regex would silently MIS-classify (e.g. ship 'config' where the AC's coarse role is
  // 'schema'), and the adversarial CODE review hunts source defects, not test adequacy. The single
  // test>schema case above under-pins it: a path can match SEVERAL rules at OTHER tiers too. These cases
  // pin the full documented order + each rule's anchoring against the ground-truth classifier behavior so
  // a rule-table regression fails RED here. [SKILL: missing AC-branch / pass-for-the-wrong-reason gaps]
  it('PRECEDENCE/ANCHORING — pins the full first-match order + each rule`s segment/ext anchoring', () => {
    // .schema. wins over the *.json config rule (rule order: schema before config) — NOT 'config'.
    expect(classifyRole('src/foo.schema.json')).toBe('schema');
    // a migrations/ segment wins over a config/ segment (migration tier before config) — NOT 'config'.
    expect(classifyRole('config/migrations/x.ts')).toBe('migration');
    // a *.config.* file living UNDER migrations/ is still 'migration' (the segment rule precedes config).
    expect(classifyRole('src/migrations/v.config.json')).toBe('migration');
    // the plural `schema(s)?` segment matches a `schemas/` dir too.
    expect(classifyRole('src/db/schemas/user.ts')).toBe('schema');
    // ANCHORING (the load-bearing no-mis-fire claim in the source): `schematic/` is NOT a `schema/`
    // segment — a de-anchored /schema/ regex would WRONGLY return 'schema' here. It must fall through.
    expect(classifyRole('src/schematic/foo.ts')).toBe('source');
    // a known config basename (tsconfig*) classifies even with an infix segment.
    expect(classifyRole('tsconfig.build.json')).toBe('config');
    // a bare extension-less, non-config-basename path is the 'source' fallback (NOT config/doc).
    expect(classifyRole('Dockerfile')).toBe('source');
    expect(classifyRole('README')).toBe('source');
  });

  // Review F1 regression: the dotted-config-basename rule must NOT over-match SOURCE files whose basename
  // merely STARTS with a config prefix. The earlier `(tsconfig|eslint|vite|package)[^/]*$` form mislabeled
  // these 'config' (a name-free but WRONG coarse role the portal renders to the viewer — AC4 accuracy).
  // The fix requires a DOT after the dotted prefix and matches `package.json` EXACTLY; these must be
  // 'source'. The legitimate dotted-config basenames (still 'config') are pinned in the table above.
  it('F1/ANCHORING — config-prefixed SOURCE files fall through to "source" (no basename over-match)', () => {
    expect(classifyRole('src/components/PackageList.tsx')).toBe('source'); // package* prefix, but .tsx source
    expect(classifyRole('vite-plugin-custom.ts')).toBe('source'); // vite* prefix, but hyphenated source
    expect(classifyRole('eslint-runner.ts')).toBe('source'); // eslint* prefix, but source
    expect(classifyRole('packageResolver.ts')).toBe('source'); // package* prefix, but source
    expect(classifyRole('tsconfigLoader.ts')).toBe('source'); // tsconfig* prefix, no dot → source
    // `package.json` is matched EXACTLY (not as a prefix) — a `packages.json` is NOT the package manifest,
    // but it still classifies 'config' via the generic *.json rule (rule order: .json precedes this rule).
    expect(classifyRole('package.json')).toBe('config');
    // a dotted-config basename WITH the required dot stays 'config' (the fix keeps real configs matching).
    expect(classifyRole('jest.config.js')).toBe('config');
  });

  it('NORMALIZATION — backslash paths + uppercase extensions classify the same as their normal form', () => {
    // The classifier normalizes a LOCAL copy (backslashes → /, lower-case) before matching; pin it so a
    // dropped .replace/.toLowerCase (which would leave Windows paths / SHOUTING extensions unclassified
    // → a silent 'source' leak of structure) fails RED. The normalized copy is still DISCARDED (no echo).
    expect(classifyRole('src\\win\\path.test.ts')).toBe('test'); // backslash → forward-slash
    expect(classifyRole('a/b/c.YAML')).toBe('config'); // .YAML → .yaml
    expect(classifyRole('DOCS/Guide.MD')).toBe('doc'); // .MD → .md
  });

  it('maps null (no target — a prompt/text/tool_result event with no file) to the fallback "source"', () => {
    expect(classifyRole(null)).toBe('source');
  });
});

// ---------------------------------------------------------------------------------------------------
// AC3 — the classifier emits ONLY one of the six coarse tokens, for ANY input.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC3 — classifyRole emits ONLY one of the six coarse role tokens', () => {
  it('every output is a member of the six-token union (for a spread of inputs)', () => {
    const inputs: ReadonlyArray<string | null> = [
      null,
      '',
      '   ',
      'src/render/arena.ts',
      'README.md',
      'package.json',
      'db/migrations/001.sql',
      'src/schema/x.ts',
      'src/a.test.ts',
      '/work/project/src/ingest/parse-transcript.ts',
      'weird/path/with.no.known.extension',
    ];
    for (const input of inputs) {
      expect(ROLE_TOKENS).toContain(classifyRole(input));
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC3 — PURE + deterministic: calling twice on the same input yields the same token; no global state.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC3 — classifyRole is PURE + deterministic (R2)', () => {
  it('calling twice on the same path yields the same token (determinism)', () => {
    const paths = ['src/schema/foo.ts', 'README.md', 'src/a.test.ts', null];
    for (const p of paths) {
      expect(classifyRole(p)).toBe(classifyRole(p));
    }
  });

  it('does not mutate a String input wrapper or rely on call order (independent calls)', () => {
    // Two interleaved sequences over distinct inputs return the same tokens regardless of order —
    // proving there is no module-level mutable state carrying between calls.
    const a1 = classifyRole('src/schema/foo.ts');
    const b1 = classifyRole('README.md');
    const b2 = classifyRole('README.md');
    const a2 = classifyRole('src/schema/foo.ts');
    expect(a1).toBe(a2);
    expect(b1).toBe(b2);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC3 — THE NO-ECHO INVARIANT (the operator's hard line): classifyRole reads the path ONLY to test
// patterns; it returns one of the six literals and NOTHING derived from the path text. A property
// assertion: for paths carrying DISTINCTIVE name substrings, the returned token contains NO substring
// of the input path. This is the load-bearing privacy proof — the path is read, then DISCARDED.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC3 — classifyRole NEVER echoes the path/name (the no-echo property)', () => {
  it('the returned token contains none of the distinctive substrings of the input path', () => {
    // Each path embeds a distinctive, secret-looking name segment. The returned token is one of the six
    // fixed literals and must NOT contain any of these distinctive substrings (no path text leaks out).
    const distinctive: ReadonlyArray<readonly [string, readonly string[]]> = [
      [
        '/work/project/src/schema/SuperSecretInternalName.ts',
        // dev-story fix (documented): dropped 'schema' from this row's forbidden list. This path lives in
        // a `schema/` dir, so its CORRECT coarse role IS the token 'schema' — that is the classifier
        // working, not a name leak. The no-echo property is about the path's DISTINCTIVE/secret segments
        // (the file name, the private dir names) never appearing in the token; a generic role word that
        // happens to equal a path segment is by-design. The genuinely-distinctive substrings below still
        // prove no path text leaks. [instruction: "fix the test WITH a documented justification"]
        ['SuperSecretInternalName', 'work', 'project'],
      ],
      [
        '/home/realuser/private/CustomerData.migration.sql',
        ['realuser', 'CustomerData', 'private', 'home'],
      ],
      [
        'src/internal/UnreleasedFeatureFlag.config.json',
        ['UnreleasedFeatureFlag', 'internal'],
      ],
      ['ProprietaryArchitecture.md', ['ProprietaryArchitecture']],
    ];
    for (const [path, substrings] of distinctive) {
      const token = classifyRole(path);
      expect(ROLE_TOKENS).toContain(token);
      for (const sub of substrings) {
        expect(token).not.toContain(sub);
      }
      // And the token is short (a single coarse word), never a path-shaped string.
      expect(token.length).toBeLessThanOrEqual('migration'.length);
      expect(token).not.toContain('/');
      expect(token).not.toContain('.');
    }
  });
});
