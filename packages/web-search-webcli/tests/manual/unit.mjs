import assert from 'node:assert/strict'
import {
  resolveWebCliCommand,
  mapWebCliHit,
  mapWebCliResult,
  WebCliSearchProvider,
  WEBCLI_PROVIDER_ID,
} from '../../lib/provider.js'
import { WebError } from '@deepseek-ai/dsh-web'

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (e) {
    console.log(`FAIL  ${name}`)
    console.log(`      ${e && e.stack ? e.stack : e}`)
    process.exitCode = 1
  }
}

// --- resolveWebCliCommand ---
check('resolveWebCliCommand resolves a bare command on $PATH (node)', () => {
  const resolved = resolveWebCliCommand('node', process.env.PATH)
  assert.notEqual(resolved, undefined)
  assert.ok(resolved.endsWith('/node'))
})

check('resolveWebCliCommand returns undefined for an unknown bare command', () => {
  const resolved = resolveWebCliCommand('definitely-not-a-real-binary-xyz-123', process.env.PATH)
  assert.equal(resolved, undefined)
})

check('resolveWebCliCommand resolves an absolute path directly', () => {
  const resolved = resolveWebCliCommand('/Users/yoga/.npm-packages/bin/web-cli', process.env.PATH)
  assert.equal(resolved, '/Users/yoga/.npm-packages/bin/web-cli')
})

check('resolveWebCliCommand returns undefined for a nonexistent absolute path', () => {
  const resolved = resolveWebCliCommand('/no/such/path/web-cli', process.env.PATH)
  assert.equal(resolved, undefined)
})

check('resolveWebCliCommand finds the real web-cli on $PATH', () => {
  const resolved = resolveWebCliCommand('web-cli', process.env.PATH)
  assert.notEqual(resolved, undefined)
  assert.ok(resolved.endsWith('/web-cli'))
})

// --- mapWebCliHit ---
check('mapWebCliHit maps a complete hit', () => {
  const source = mapWebCliHit({ title: 'T', url: 'https://example.com', snippet: 'S' })
  assert.deepEqual(source, { url: 'https://example.com', title: 'T', snippet: 'S' })
})

check('mapWebCliHit omits a blank/whitespace-only snippet', () => {
  const source = mapWebCliHit({ title: 'T', url: 'https://example.com', snippet: '   ' })
  assert.deepEqual(source, { url: 'https://example.com', title: 'T' })
})

check('mapWebCliHit drops a hit missing url', () => {
  const source = mapWebCliHit({ title: 'T', url: '' })
  assert.equal(source, undefined)
})

check('mapWebCliHit drops a hit missing title', () => {
  const source = mapWebCliHit({ url: 'https://example.com' })
  assert.equal(source, undefined)
})

// --- mapWebCliResult ---
check('mapWebCliResult maps hits (bing/google shape), no content', () => {
  const result = mapWebCliResult({
    query: 'q',
    engine: 'bing',
    hits: [
      { title: 'A', url: 'https://a.example', snippet: 'snippet a' },
      { title: '', url: 'https://bad.example' }, // dropped: blank title
    ],
  })
  assert.equal(result.truncated, false)
  assert.equal(result.content, undefined)
  assert.deepEqual(result.sources, [{ url: 'https://a.example', title: 'A', snippet: 'snippet a' }])
})

check('mapWebCliResult maps a gemini answer to content, empty sources', () => {
  const result = mapWebCliResult({ query: 'q', engine: 'gemini', answer: 'The answer.' })
  assert.equal(result.content, 'The answer.')
  assert.deepEqual(result.sources, [])
  assert.equal(result.truncated, false)
})

check('mapWebCliResult prefixes a fallback note onto content when fallback[] is present', () => {
  const result = mapWebCliResult({
    query: 'q',
    engine: 'gemini',
    answer: 'Answer text.',
    fallback: [
      { from: 'google', reason: 'blocked' },
      { from: 'bing', reason: 'timeout' },
    ],
  })
  assert.ok(result.content.startsWith('[web-cli fell back from google (blocked) -> bing (timeout) to gemini]'))
  assert.ok(result.content.endsWith('Answer text.'))
})

check('mapWebCliResult with fallback but no answer (e.g. hits engine reached via fallback) still surfaces the note', () => {
  const result = mapWebCliResult({
    query: 'q',
    engine: 'bing',
    hits: [{ title: 'A', url: 'https://a.example' }],
    fallback: [{ from: 'google', reason: 'blocked' }],
  })
  assert.ok(result.content.startsWith('[web-cli fell back from google (blocked) to bing]'))
  assert.equal(result.sources.length, 1)
})

check('mapWebCliResult with neither hits nor answer nor fallback => no content, empty sources', () => {
  const result = mapWebCliResult({ query: 'q', engine: 'bing' })
  assert.equal(result.content, undefined)
  assert.deepEqual(result.sources, [])
})

// --- WebCliSearchProvider.available() ---
check('provider.available() is true when web-cli resolves', () => {
  const provider = new WebCliSearchProvider({
    command: 'web-cli',
    pathEnv: process.env.PATH,
    engine: 'bing',
    timeoutMs: 60_000,
  })
  assert.equal(provider.id, WEBCLI_PROVIDER_ID)
  assert.equal(provider.available(), true)
})

check('provider.available() is false when the command does not resolve', () => {
  const provider = new WebCliSearchProvider({
    command: 'definitely-not-a-real-binary-xyz-123',
    pathEnv: process.env.PATH,
    engine: 'bing',
    timeoutMs: 60_000,
  })
  assert.equal(provider.available(), false)
})

// --- WebCliSearchProvider.search() error path (no network) ---
await (async () => {
  const name = 'provider.search() throws WEB_PROVIDER_CONFIGURED_UNAVAILABLE for an unresolvable command'
  try {
    const provider = new WebCliSearchProvider({
      command: 'definitely-not-a-real-binary-xyz-123',
      pathEnv: process.env.PATH,
      engine: 'bing',
      timeoutMs: 5_000,
    })
    await provider.search({ query: 'test' })
    console.log(`FAIL  ${name} (did not throw)`)
    process.exitCode = 1
  } catch (e) {
    if (e instanceof WebError && e.code === 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE') {
      passed++
      console.log(`PASS  ${name}`)
    } else {
      console.log(`FAIL  ${name}`)
      console.log(`      unexpected error: ${e && e.stack ? e.stack : e}`)
      process.exitCode = 1
    }
  }
})()

console.log(`\n${passed} checks passed (unit-level)`)
