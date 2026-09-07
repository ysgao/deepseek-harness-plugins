/**
 * Which OWL/RDF serialization an ontology file holds, and how its preview is
 * highlighted. Extension alone cannot answer this: `.owl` is used for RDF/XML,
 * OWL 2 Functional Syntax, Manchester Syntax, and Turtle interchangeably (the
 * OWL 2 spec names no canonical extension, and every serialization is plain
 * text), so {@link detectOntologySyntax} sniffs the file's own head first and
 * falls back to the extension only when the content says nothing.
 *
 * Two of the serializations are already covered by the app's one syntax
 * highlighter (`ReadBlock`'s shiki grammars): the XML ones (RDF/XML, OWL/XML)
 * highlight as `xml`, JSON-LD as `json`. Those are *delegated* —
 * `delegateLang` names the grammar and the preview renders a plain
 * `ReadBlock`, so an ontology file gets the same real XML/JSON tokenization
 * any other markup file gets, including shiki's own lazy grammar load and
 * viewport-bounded highlighting. The rest (Functional, Manchester, Turtle and
 * its N-Triples/N-Quads/N3/TriG relatives) have no shiki grammar at all, so
 * they carry a `dialect` for this package's own line tokenizer
 * (`./tokenize.ts`) instead. Exactly one of the two fields is ever set.
 */

/** An OWL/RDF serialization the preview recognizes. */
export type OntologySyntax =
  | 'owl-functional'
  | 'owl-manchester'
  | 'rdfxml'
  | 'owlxml'
  | 'turtle'
  | 'trig'
  | 'n3'
  | 'ntriples'
  | 'nquads'
  | 'jsonld'

/**
 * Token-shape family for the serializations this package tokenizes itself.
 * Three, not one per syntax: N-Triples, N-Quads, N3 and TriG all use the
 * Turtle token vocabulary (IRIs, prefixed names, blank nodes, literals with
 * `@lang`/`^^` suffixes, `#` comments) under different statement grammars, and
 * a line tokenizer sees only the vocabulary.
 */
export type OntologyDialect = 'functional' | 'manchester' | 'turtle'

/** How one detected serialization is displayed and highlighted. */
export interface OntologySyntaxProfile {
  /** The detected serialization. */
  readonly syntax: OntologySyntax
  /** Short id shown in the preview banner (the seat `ReadBlock` puts its own `lang` in). */
  readonly bannerId: string
  /** shiki grammar the app's own highlighter already covers this syntax with, or `undefined` when it has none. */
  readonly delegateLang: string | undefined
  /** Token family for `./tokenize.ts`, set exactly when `delegateLang` is not. */
  readonly dialect: OntologyDialect | undefined
}

/** Per-syntax display id, delegated grammar, and own-tokenizer dialect. */
const PROFILES: Readonly<Record<OntologySyntax, OntologySyntaxProfile>> = {
  'owl-functional': { syntax: 'owl-functional', bannerId: 'owl-functional', delegateLang: undefined, dialect: 'functional' },
  'owl-manchester': { syntax: 'owl-manchester', bannerId: 'owl-manchester', delegateLang: undefined, dialect: 'manchester' },
  rdfxml: { syntax: 'rdfxml', bannerId: 'rdf-xml', delegateLang: 'xml', dialect: undefined },
  owlxml: { syntax: 'owlxml', bannerId: 'owl-xml', delegateLang: 'xml', dialect: undefined },
  turtle: { syntax: 'turtle', bannerId: 'turtle', delegateLang: undefined, dialect: 'turtle' },
  trig: { syntax: 'trig', bannerId: 'trig', delegateLang: undefined, dialect: 'turtle' },
  n3: { syntax: 'n3', bannerId: 'n3', delegateLang: undefined, dialect: 'turtle' },
  ntriples: { syntax: 'ntriples', bannerId: 'n-triples', delegateLang: undefined, dialect: 'turtle' },
  nquads: { syntax: 'nquads', bannerId: 'n-quads', delegateLang: undefined, dialect: 'turtle' },
  jsonld: { syntax: 'jsonld', bannerId: 'json-ld', delegateLang: 'json', dialect: undefined },
}

/**
 * Serialization an extension names on its own. `.owl` is deliberately absent
 * here and appears only in {@link EXTENSION_FALLBACK}: it is the one extension
 * that names no serialization at all.
 */
const EXTENSION_SYNTAX: Readonly<Record<string, OntologySyntax>> = {
  rdf: 'rdfxml', rdfs: 'rdfxml', owx: 'owlxml',
  ofn: 'owl-functional', omn: 'owl-manchester',
  ttl: 'turtle', trig: 'trig', n3: 'n3', nt: 'ntriples', nq: 'nquads',
  jsonld: 'jsonld',
}

/**
 * Serialization assumed when the content sniff recognizes nothing. `.owl`
 * resolves to Functional Syntax rather than RDF/XML: an XML document is the
 * one thing the sniff never misses (its first non-space character is `<`), so
 * reaching this fallback has already ruled XML out.
 */
const EXTENSION_FALLBACK: Readonly<Record<string, OntologySyntax>> = { owl: 'owl-functional' }

/** Head of the file the content sniff reads — enough for a prologue, a prefix block, and the first few axioms. */
const SNIFF_LENGTH = 8 * 1024

/**
 * An XML document: the head opens a declaration/doctype/comment (`<?`, `<!`)
 * or a real element — an XML name, optionally prefix-qualified, followed by
 * whitespace or the tag's own end. The element arm is written that strictly on
 * purpose: a bare `<[A-Za-z_]` would also match an N-Triples line's opening
 * IRI (`<http://…>`), reading a triple dump as markup.
 */
const XML_HEAD = /^\s*<(?:[?!]|[A-Za-z_][\w.-]*(?::[\w.-]+)?[\s/>])/

/** RDF/XML's own document element (its `rdf:RDF` wrapper), whatever prefix binding introduces it. */
const RDFXML_ROOT = /<(?:[A-Za-z_][\w.-]*:)?RDF\b/

/** OWL/XML's own document element, and the elements only it uses. */
const OWLXML_ROOT = /<(?:Ontology|Declaration|Prefix)\b/

/** A JSON-LD document: a JSON object or array whose head carries one of the keywords. */
const JSONLD_HEAD = /^\s*[[{]/
const JSONLD_KEYWORD = /"@(?:context|graph|id|type)"/

/** Functional Syntax: a top-level construct applied to its arguments, `Name(`. */
const FUNCTIONAL_HEAD =
  /^[ \t]*(?:Prefix|Ontology|Import|Declaration|Annotation|SubClassOf|EquivalentClasses|DisjointClasses|SubObjectPropertyOf|SubDataPropertyOf|AnnotationAssertion|ClassAssertion|ObjectPropertyAssertion|DataPropertyAssertion)\(/m

/** Manchester Syntax: a frame or frame-section keyword, always `Keyword:`. */
const MANCHESTER_HEAD =
  /^[ \t]*(?:Prefix|Ontology|Import|Class|ObjectProperty|DataProperty|AnnotationProperty|Individual|Datatype|EquivalentClasses|DisjointClasses|EquivalentTo|SubClassOf|Annotations):/m

/** Turtle-family prefix/base directives, in both the `@prefix` and SPARQL-style `PREFIX` spellings. */
const TURTLE_HEAD = /^[ \t]*(?:@prefix|@base|PREFIX[ \t]|BASE[ \t])/m

/** TriG's named-graph block, which plain Turtle has no form for. */
const TRIG_HEAD = /^[ \t]*(?:GRAPH[ \t]|(?:<[^>\s]*>|(?:[A-Za-z_][\w.-]*)?:[\w.-]*)[ \t]*\{)/m

/** N-Triples/N-Quads: every statement is absolute — subject and predicate written out in full, no prefixes. */
const NTRIPLES_HEAD = /^[ \t]*(?:<[^>\s]+>|_:\S+)[ \t]+<[^>\s]+>[ \t]+\S/m

/** A leading UTF-8 byte-order mark, which must not defeat the anchored head patterns. */
const LEADING_BOM = /^﻿/

/**
 * Lowercased extension of a path's base name, or `undefined` for a dotfile or
 * a name with no extension. Duplicated in miniature from the consuming
 * packages' own `classify.ts` (which owns the file-kind decision itself)
 * rather than imported: those are separate plugin packages, and cross-plugin
 * imports of another package's symbols are forbidden — see this repo's
 * `ARCHITECTURE.md`.
 * @param path - absolute or display path.
 * @returns the extension without its leading dot, lowercased.
 */
function extensionOf(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  return base.slice(dot + 1).toLowerCase()
}

/**
 * Serialization the file's own head declares, or `undefined` when it declares
 * nothing recognizable (an empty file, or a fragment carrying no prologue,
 * prefix block, or first axiom yet). Checked most-distinctive-first: XML and
 * JSON are settled by their opening character, and the remaining text syntaxes
 * are told apart by how they punctuate their own keywords — Functional applies
 * them (`Ontology(`), Manchester labels frames with them (`Class:`), Turtle
 * writes directives (`@prefix`).
 * @param head - the file's first {@link SNIFF_LENGTH} characters.
 * @returns the recognized serialization, or `undefined`.
 */
function sniffSyntax(head: string): OntologySyntax | undefined {
  if (XML_HEAD.test(head)) {
    if (RDFXML_ROOT.test(head)) return 'rdfxml'
    return OWLXML_ROOT.test(head) ? 'owlxml' : 'rdfxml'
  }
  if (JSONLD_HEAD.test(head) && JSONLD_KEYWORD.test(head)) return 'jsonld'
  if (FUNCTIONAL_HEAD.test(head)) return 'owl-functional'
  if (MANCHESTER_HEAD.test(head)) return 'owl-manchester'
  if (TURTLE_HEAD.test(head)) return TRIG_HEAD.test(head) ? 'trig' : 'turtle'
  if (NTRIPLES_HEAD.test(head)) return 'ntriples'
  return undefined
}

/**
 * Which serialization an ontology file holds, and how to highlight it.
 * Content wins over extension wherever the content is conclusive — a `.rdf`
 * holding Turtle highlights as Turtle — and the extension only decides when
 * the head recognizes nothing.
 * @param path - absolute or display path (read for the extension fallback only).
 * @param text - the file's decoded text; only its head is examined.
 * @returns the display/highlight profile for the detected serialization.
 */
export function detectOntologySyntax(path: string, text: string): OntologySyntaxProfile {
  const head = text.slice(0, SNIFF_LENGTH).replace(LEADING_BOM, '')
  const ext = extensionOf(path)
  const fromExtension = ext === undefined
    ? undefined
    : EXTENSION_SYNTAX[ext] ?? EXTENSION_FALLBACK[ext]
  // Neither the content nor the extension says anything (a `.owl` sibling
  // extension not in either table, holding a fragment with no prologue yet):
  // Functional Syntax is the least destructive assumption — its tokenizer only
  // colors what it recognizes and leaves everything else plain — and an
  // unrecognized head is by this point already known not to be XML or JSON.
  const syntax = sniffSyntax(head) ?? fromExtension ?? 'owl-functional'
  return PROFILES[syntax]
}
