import assert from 'node:assert/strict'
import { WebCliSearchProvider } from '../../lib/provider.js'

const provider = new WebCliSearchProvider({
  command: 'web-cli',
  pathEnv: process.env.PATH,
  engine: 'bing', // fast, no CAPTCHA/consent window, no API key needed
  timeoutMs: 90_000,
  maxResults: 3,
})

console.log('available():', provider.available())
assert.equal(provider.available(), true)

console.log('\ncalling provider.search({ query: "TypeScript 5.7 release notes" }) via real web-cli websearch --engine bing ...')
const start = Date.now()
const result = await provider.search({ query: 'TypeScript 5.7 release notes' })
const elapsedMs = Date.now() - start

console.log(`\ndone in ${elapsedMs}ms`)
console.log(JSON.stringify(result, null, 2))

assert.ok(Array.isArray(result.sources))
assert.ok(result.sources.length > 0, 'expected at least one source')
assert.equal(result.truncated, false)
for (const source of result.sources) {
  assert.ok(typeof source.url === 'string' && source.url.length > 0)
  assert.ok(typeof source.title === 'string' && source.title.length > 0)
  assert.ok(source.url.startsWith('http'), `source url should be absolute: ${source.url}`)
}

console.log('\nPASS  integration: provider.search() returns real, well-formed WebSearchResult via web-cli')
