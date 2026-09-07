/**
 * Line tokenizer for the OWL/RDF serializations the app's own syntax
 * highlighter has no grammar for: OWL 2 Functional Syntax, Manchester Syntax,
 * and the Turtle family (Turtle, TriG, N3, N-Triples, N-Quads). The XML and
 * JSON serializations never reach here — `./syntax.ts` delegates those to
 * shiki's real `xml`/`json` grammars.
 *
 * One line at a time, and no state carried between lines. All three families
 * comment to end-of-line (`#`) and write every construct within one line in
 * practice, so a line's tokens depend only on that line's own text — which is
 * what lets `../OntologyPreview.tsx` tokenize just the rows it actually
 * renders instead of the whole file, however large the file is. The one
 * consequence is Turtle's multi-line long literal (`"""…"""` spanning lines):
 * its opening line's quotes and its continuation lines tokenize as ordinary
 * content rather than as one string run. That is a display-only imperfection
 * in a rarely-used form, deliberately traded for the bounded cost.
 *
 * Token colors are not decided here — every token carries a kind, and
 * `../OntologyPreview.module.css` maps each kind to the `--shiki-token-*`
 * custom property the app's own highlighted surfaces already use, so this
 * preview's palette follows the theme (light and dark) with no colors in TS.
 */

import type { OntologyDialect } from './syntax.ts'

/**
 * What one run of a tokenized line is. `plain` covers everything no pattern
 * claimed — entity names in Functional/Manchester syntax, whitespace, and any
 * text the tokenizer does not recognize.
 */
export type OntologyTokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'iri'
  | 'keyword'
  | 'blank'
  | 'datatype'
  | 'langtag'
  | 'number'
  | 'prefixed'
  | 'punctuation'

/** One run of a tokenized line: its text and what it is. */
export interface OntologyToken {
  readonly text: string
  readonly kind: OntologyTokenKind
}

/**
 * Longest line the tokenizer scans; anything longer renders as one plain run.
 * A machine-generated serialization can emit a whole graph on one line, and
 * the string patterns below cost O(n²) on a line of unterminated quotes — the
 * cap keeps a pathological line cheap rather than correct-but-slow, since a
 * line that long is unreadable either way.
 */
const MAX_TOKENIZED_LINE_LENGTH = 2000

/** End-of-line comment, the one comment form all three families share. */
const COMMENT = '(?<comment>#[^\\n]*)'

/**
 * A quoted literal: Turtle's long (triple-quoted) forms first, so a `"""…"""`
 * is one run rather than an empty `""` followed by content. Each inner
 * alternative starts with a different character class, so the scan is linear
 * in the line for a literal that closes.
 */
const STRING = '(?<string>'
  + '"""(?:[^"\\\\]|\\\\[\\s\\S]|"(?!""))*"""'
  + '|\'\'\'(?:[^\'\\\\]|\\\\[\\s\\S]|\'(?!\'\'))*\'\'\''
  + '|"(?:[^"\\\\]|\\\\.)*"'
  + '|\'(?:[^\'\\\\]|\\\\.)*\''
  + ')'

/** A full IRI in angle brackets, excluding the characters IRIREF itself forbids. */
const IRI = '(?<iri><[^<>"{}|^`\\\\\\s]*>)'

/** A blank-node label (`_:b0`). */
const BLANK = '(?<blank>_:[A-Za-z0-9_][\\w.\\-]*)'

/** The literal datatype marker, `^^`, whose datatype itself tokenizes as an IRI or prefixed name. */
const DATATYPE = '(?<datatype>\\^\\^)'

/** A literal language tag (`@en`, `@en-GB`). */
const LANGTAG = '(?<langtag>@[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)'

/** A numeric literal, in all three of Turtle's integer/decimal/double spellings. */
const NUMBER = '(?<number>[+-]?(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[eE][+-]?\\d+)?)'

/** An abbreviated IRI (`owl:Thing`, `:Foo`, `sct:73211009`), prefix label optional. */
const PREFIXED = '(?<prefixed>(?:[A-Za-z_][\\w.\\-]*)?:[\\w.\\-%~]*)'

/** Structural punctuation — argument parens, collection brackets, statement separators. */
const PUNCTUATION = '(?<punctuation>[(){}\\[\\].,;=])'

/**
 * OWL 2 Functional Syntax constructs: the ontology/axiom/expression keywords
 * of the spec's own grammar, plus its SWRL rule vocabulary. Every alternative
 * is bounded by `\b` on both sides, so a longer construct is never shadowed by
 * a shorter one that prefixes it (`Object` cannot match inside
 * `ObjectUnionOf`) and the list needs no length ordering.
 */
const FUNCTIONAL_KEYWORDS = [
  'Ontology', 'Prefix', 'Import', 'Declaration', 'Annotation',
  'Class', 'Datatype', 'ObjectProperty', 'DataProperty', 'AnnotationProperty',
  'NamedIndividual', 'AnonymousIndividual', 'Literal', 'Variable',
  'SubClassOf', 'EquivalentClasses', 'DisjointClasses', 'DisjointUnion', 'HasKey',
  'ObjectIntersectionOf', 'ObjectUnionOf', 'ObjectComplementOf', 'ObjectOneOf',
  'ObjectSomeValuesFrom', 'ObjectAllValuesFrom', 'ObjectHasValue', 'ObjectHasSelf',
  'ObjectMinCardinality', 'ObjectMaxCardinality', 'ObjectExactCardinality',
  'DataIntersectionOf', 'DataUnionOf', 'DataComplementOf', 'DataOneOf',
  'DatatypeRestriction', 'DatatypeDefinition',
  'DataSomeValuesFrom', 'DataAllValuesFrom', 'DataHasValue',
  'DataMinCardinality', 'DataMaxCardinality', 'DataExactCardinality',
  'ObjectInverseOf', 'ObjectPropertyChain',
  'SubObjectPropertyOf', 'EquivalentObjectProperties', 'DisjointObjectProperties',
  'InverseObjectProperties', 'ObjectPropertyDomain', 'ObjectPropertyRange',
  'FunctionalObjectProperty', 'InverseFunctionalObjectProperty',
  'ReflexiveObjectProperty', 'IrreflexiveObjectProperty',
  'SymmetricObjectProperty', 'AsymmetricObjectProperty', 'TransitiveObjectProperty',
  'SubDataPropertyOf', 'EquivalentDataProperties', 'DisjointDataProperties',
  'DataPropertyDomain', 'DataPropertyRange', 'FunctionalDataProperty',
  'SubAnnotationPropertyOf', 'AnnotationPropertyDomain', 'AnnotationPropertyRange',
  'SameIndividual', 'DifferentIndividuals', 'ClassAssertion',
  'ObjectPropertyAssertion', 'NegativeObjectPropertyAssertion',
  'DataPropertyAssertion', 'NegativeDataPropertyAssertion', 'AnnotationAssertion',
  'DLSafeRule', 'Body', 'Head', 'ClassAtom', 'DataRangeAtom',
  'ObjectPropertyAtom', 'DataPropertyAtom', 'BuiltInAtom',
  'SameIndividualAtom', 'DifferentIndividualsAtom',
]

/**
 * Manchester Syntax frame and frame-section keywords. Always written with a
 * trailing colon, which is what keeps them out of {@link PREFIXED}'s reach —
 * `Class:` matches here first, at the same start position.
 */
const MANCHESTER_FRAME_KEYWORDS = [
  'Prefix', 'Ontology', 'Import', 'Annotations',
  'Class', 'ObjectProperty', 'DataProperty', 'AnnotationProperty', 'Individual', 'Datatype',
  'EquivalentClasses', 'DisjointClasses', 'EquivalentProperties', 'DisjointProperties',
  'SameIndividual', 'DifferentIndividuals', 'Rule',
  'SubClassOf', 'EquivalentTo', 'DisjointWith', 'DisjointUnionOf', 'HasKey',
  'SubPropertyOf', 'SubPropertyChain', 'InverseOf', 'Domain', 'Range', 'Characteristics',
  'Types', 'Facts', 'SameAs', 'DifferentFrom',
]

/** Manchester Syntax class-expression operators, property characteristics, and facet names. */
const MANCHESTER_EXPRESSION_KEYWORDS = [
  'and', 'or', 'not', 'some', 'only', 'value', 'min', 'max', 'exactly', 'that',
  'self', 'Self', 'inverse', 'length', 'minLength', 'maxLength', 'pattern', 'langRange',
  'Functional', 'InverseFunctional', 'Reflexive', 'Irreflexive',
  'Symmetric', 'Asymmetric', 'Transitive',
]

/**
 * Turtle-family keywords: both spellings of the prefix/base directives,
 * TriG's graph keyword, and the three bare-word terms (`a` for `rdf:type`,
 * plus the boolean literals).
 */
const TURTLE_KEYWORDS = '(?<keyword>@(?:prefix|base)\\b|\\b(?:PREFIX|BASE|GRAPH|a|true|false)\\b)'

/** `\b`-bounded keyword alternation from a word list. */
function wordKeywords(words: readonly string[]): string {
  return `(?<keyword>\\b(?:${words.join('|')})\\b)`
}

/** Manchester's two keyword shapes: colon-terminated frame keywords, then bare operators. */
function manchesterKeywords(): string {
  const frames = MANCHESTER_FRAME_KEYWORDS.join('|')
  const expressions = MANCHESTER_EXPRESSION_KEYWORDS.join('|')
  return `(?<keyword>\\b(?:${frames}):|\\b(?:${expressions})\\b)`
}

/**
 * Build one dialect's scanner. Alternation order is the precedence rule: a
 * comment or a literal claims a `#` or a quote before any inner pattern can,
 * an IRI claims a `<…>` before the punctuation class sees its brackets, and a
 * keyword claims `Class:`/`@prefix` before the prefixed-name and language-tag
 * patterns would take them for something else. Within one start position the
 * first matching alternative wins, so the order below is exactly the intent.
 */
function buildPattern(dialect: OntologyDialect): RegExp {
  const keywords = dialect === 'functional'
    ? wordKeywords(FUNCTIONAL_KEYWORDS)
    : dialect === 'manchester'
      ? manchesterKeywords()
      : TURTLE_KEYWORDS
  return new RegExp(
    [COMMENT, STRING, IRI, keywords, BLANK, DATATYPE, LANGTAG, NUMBER, PREFIXED, PUNCTUATION].join('|'),
    'g',
  )
}

/** One scanner per dialect, built on first use — each is a `g`-flagged regex whose `lastIndex` the tokenizer resets. */
const PATTERNS = new Map<OntologyDialect, RegExp>()

/** The dialect's scanner, cached across lines (a file's every line reuses it). */
function patternFor(dialect: OntologyDialect): RegExp {
  const cached = PATTERNS.get(dialect)
  if (cached !== undefined) return cached
  const built = buildPattern(dialect)
  PATTERNS.set(dialect, built)
  return built
}

/**
 * Which alternative matched: the one named group that participated. Every
 * alternative in {@link buildPattern} is a named group whose name is its token
 * kind, so the first defined entry names the kind directly.
 */
function kindOf(groups: Record<string, string | undefined>): OntologyTokenKind {
  for (const [name, value] of Object.entries(groups)) {
    if (value !== undefined) return name as OntologyTokenKind
  }
  /* v8 ignore next -- unreachable: a match participated in exactly one named alternative. */
  return 'plain'
}

/**
 * Tokenize one line of an ontology serialization.
 * @param line - the line's text, with no line terminator.
 * @param dialect - the token family, from `detectOntologySyntax`'s profile.
 * @returns the line's runs in order, concatenating back to `line` exactly;
 * empty for an empty line.
 */
export function tokenizeOntologyLine(line: string, dialect: OntologyDialect): readonly OntologyToken[] {
  if (line === '') return []
  if (line.length > MAX_TOKENIZED_LINE_LENGTH) return [{ text: line, kind: 'plain' }]
  const pattern = patternFor(dialect)
  pattern.lastIndex = 0
  const tokens: OntologyToken[] = []
  let cursor = 0
  // No alternative can match the empty string (each requires at least one
  // literal character), so `exec` always advances and this terminates.
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
    if (match.index > cursor) tokens.push({ text: line.slice(cursor, match.index), kind: 'plain' })
    /* v8 ignore next -- `groups` is always present: every alternative is a named group. */
    tokens.push({ text: match[0], kind: kindOf(match.groups ?? {}) })
    cursor = match.index + match[0].length
  }
  if (cursor < line.length) tokens.push({ text: line.slice(cursor), kind: 'plain' })
  return tokens
}
