import assert from 'node:assert/strict'
import { WebCliSearchProvider } from '../../lib/provider.js'
import { WebError } from '@deepseek-ai/dsh-web'

const provider = new WebCliSearchProvider({
  command: 'web-cli',
  pathEnv: process.env.PATH,
  engine: 'bing',
  timeoutMs: 90_000,
})

const controller = new AbortController()
controller.abort() // pre-aborted

try {
  await provider.search({ query: 'anything' }, controller.signal)
  console.log('FAIL  expected search() to throw for a pre-aborted signal')
  process.exitCode = 1
} catch (e) {
  if (e instanceof WebError && e.code === 'WEB_ABORTED') {
    console.log('PASS  provider.search() surfaces WEB_ABORTED for a pre-aborted signal')
  } else {
    console.log('FAIL  unexpected error for pre-aborted signal:')
    console.log(e && e.stack ? e.stack : e)
    process.exitCode = 1
  }
}

// request.maxResults should be forwarded as --maxResults to web-cli
const result = await provider.search({ query: 'javascript array methods', maxResults: 2 })
assert.ok(result.sources.length <= 2, `expected <=2 sources, got ${result.sources.length}`)
console.log(`PASS  request.maxResults=2 forwarded to web-cli (got ${result.sources.length} sources)`)
