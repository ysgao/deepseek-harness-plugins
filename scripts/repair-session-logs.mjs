#!/usr/bin/env node
// Retrofit `ignorable: true` onto session-log records this repo's own plugins
// wrote with an event type no harness build can know.
//
// WHY THIS EXISTS
//
// `KNOWN_SESSION_EVENT_TYPES` in `@deepseek-ai/dsh-session` is GENERATED from
// the harness repository's own `SessionEventMap`. A plugin living outside
// that repository — everything in this one — can declaration-merge a new
// event type and `Session.append()` it, and the compiler is perfectly happy;
// the type is simply absent from that generated set at every reader. On
// reload, `validateStoredEvents` then refuses the ENTIRE log:
//
//   session "session-…" contains event type "workspace-git/file-sentence-request"
//   (seq 95) unknown to this harness and not marked ignorable; refusing to
//   interpret the log — it was likely written by a newer harness
//
// The refusal is deliberate and correct: an unrecognised REQUIRED event may
// change how the rest of the log is interpreted, so skipping it could rebuild
// a wrong conversation. The envelope's `ignorable: true` marker is the
// documented escape — "a reader that does not know this type may safely skip
// it" — but `Session.append()` exposes no parameter that sets it, so the
// writer could not have marked it at the time.
//
// Hence a repair rather than a fallback: the records are already on disk, and
// the only thing wrong with them is a missing marker. The session title still
// renders because it is read from the header line; everything after it is
// what fails, which is why the symptom is "the conversation is listed but its
// history will not load".
//
// WHAT IT WILL AND WILL NOT TOUCH
//
// Only the event types in REPAIRABLE below — types this repo wrote and knows
// to be purely informational (nothing reads them; dropping them cannot change
// the reconstructed conversation). Any OTHER unknown type is reported and
// left alone: this script cannot know whether skipping someone else's event
// is safe, and guessing is exactly the failure mode the harness refuses in
// the first place.
//
// Every other byte is preserved: no record is deleted, no `seq` is renumbered
// (the log is index-addressed by seq, and cross-references such as
// `sourceEventSeqs` point into it), no other row is re-serialised.
//
// Usage:
//   node scripts/repair-session-logs.mjs               # report only
//   node scripts/repair-session-logs.mjs --apply       # rewrite, keeping .bak
//   node scripts/repair-session-logs.mjs --root <dir>  # default ~/.dsh/sessions
//
// Close the app first. `--apply` rewrites logs a running harness may hold
// open for append, and this script deliberately does not take the lease.
//
// Exit 0 = nothing to repair, or the repair succeeded and verified;
// exit 1 = something was found that this script will not repair, or a
// rewrite failed verification (in which case the .bak is still there).
import { closeSync, copyFileSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Event types this repo shipped into logs, and may therefore mark ignorable. */
const REPAIRABLE = new Set([
  // dsh-plugins-api-file-sentence-controller @ 0.0.0 logged one of these per
  // File-editor ghost-text dispatch. The plugin no longer writes any event;
  // see that package's README.
  'workspace-git/file-sentence-request',
])

const ZSTD_MAGIC = 0xFD2FB528
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const LOG_FILENAME = /^session\.v\d+\.jsonl(\.zstd)?$/

function fail(message) {
  console.error(`repair-session-logs: ${message}`)
  process.exit(1)
}

/**
 * The vocabulary the CURRENTLY PINNED vendor knows, read from its generated
 * source rather than copied here, so a pin bump that adds event types does
 * not leave this script reporting them as unknown.
 */
function knownEventTypes() {
  const path = join(REPO, 'packages/_vendor/deepseek-harness/packages/core/session/src/known-event-types.ts')
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch {
    fail(`cannot read the vendor event vocabulary at ${path} — is the submodule checked out?`)
  }
  const start = source.indexOf('export const KNOWN_SESSION_EVENT_TYPES')
  const end = source.indexOf('])', start)
  if (start === -1 || end === -1) {
    fail('the vendor event vocabulary no longer looks like a generated Set literal; update this script')
  }
  const types = [...source.slice(start, end).matchAll(/'([^']+)'/g)].map(m => m[1])
  if (types.length === 0) fail('parsed an empty event vocabulary from the vendor source')
  return new Set(types)
}

/**
 * Locate complete Zstandard frames without decompressing them. A session log
 * is a CONCATENATION of independently decodable frames (one per append
 * batch), which is why `zstd.decompress()` on the whole file yields only the
 * first one. Mirrors `scanZstdFrames` in the vendor's persistence backend.
 */
function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      return { frames, tornStart: start }
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (offset > buffer.length) return { frames, tornStart: start }
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const payloadBytes = blockType === 0x01 ? 1 : blockHeader >>> 3
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** Whole-log plaintext, or `undefined` for a log whose tail is torn. */
function readLogText(path) {
  const bytes = readFileSync(path)
  if (!path.endsWith('.zstd')) return { text: bytes.toString('utf8') }
  const { frames, tornStart } = scanFrames(bytes)
  if (frames.length === 0) return { text: '', torn: true }
  const parts = frames.map(f => zstdDecompressSync(bytes.subarray(f.start, f.end)))
  return { text: Buffer.concat(parts).toString('utf8'), torn: tornStart !== undefined }
}

/**
 * Re-encode as exactly two frames: the header line alone, then every event
 * row. The reader requires the first frame to be "exactly one header line"
 * (`assertIndependentHeaderFrame`) and every complete frame to end on a
 * record boundary; batching the rest into one frame satisfies both and the
 * harness appends further frames after it as usual.
 */
function encodeLog(path, lines) {
  const header = `${lines[0]}\n`
  const body = lines.length > 1 ? `${lines.slice(1).join('\n')}\n` : ''
  if (!path.endsWith('.zstd')) return Buffer.from(header + body, 'utf8')
  const frames = [zstdCompressSync(Buffer.from(header, 'utf8'), CHECKSUM)]
  if (body.length > 0) frames.push(zstdCompressSync(Buffer.from(body, 'utf8'), CHECKSUM))
  return Buffer.concat(frames)
}

/**
 * Prove nobody is writing this session right now, by asking the same kernel
 * the harness asks. `SessionWriteLease` holds a non-blocking exclusive
 * `flock(2)` on `session.lock` for the entire life of a write handle, so a
 * lock we can take ourselves is a session no process has open for append.
 *
 * Rewriting a log under a live writer is the one way this script could
 * destroy data rather than repair it: the writer keeps appending frames to
 * the old inode that `renameSync` just replaced, and those events are gone.
 * A guard that only warned would be useless here, so an indeterminate answer
 * (no addon, an unexpected errno, Windows) counts as "held" and skips the
 * file — a session left unrepaired is recoverable, a torn one is not.
 */
async function isIdle(logPath) {
  const lockPath = join(dirname(logPath), 'session.lock')
  let tryLockExclusive
  try {
    const require = createRequire(join(REPO, 'packages/_vendor/deepseek-harness/package.json'))
    const entry = require.resolve('@deepseek-ai/node-addon-system/flock', {
      paths: [join(REPO, 'packages/_vendor/deepseek-harness/packages/session/session-persistence-jsonl')],
    });
    ({ tryLockExclusive } = await import(pathToFileURL(entry).href))
  } catch {
    return false
  }
  let handle
  try {
    handle = openSync(lockPath, 'r+')
  } catch {
    // No lock file: the session directory predates the lease, or the session
    // was never write-opened. Either way no descriptor can be holding one.
    return true
  }
  try {
    await tryLockExclusive(handle)
    return true
  } catch {
    return false
  } finally {
    closeSync(handle) // releases the lock we just took, if we took it
  }
}

function* logPaths(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* logPaths(path)
    else if (LOG_FILENAME.test(entry.name)) yield path
  }
}

/** Classify one log: which rows need the marker, which are beyond this script. */
function inspect(path, known) {
  const { text, torn } = readLogText(path)
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const repairable = []
  const foreign = new Set()
  for (const [index, line] of lines.entries()) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      return { path, unreadable: `row ${index} is not JSON` }
    }
    if (index === 0) continue // the header line carries no event type
    if (typeof row.type !== 'string' || known.has(row.type) || row.ignorable === true) continue
    if (REPAIRABLE.has(row.type)) repairable.push({ index, row })
    else foreign.add(row.type)
  }
  return { path, lines, repairable, foreign: [...foreign], torn }
}

const apply = process.argv.includes('--apply')
const rootFlag = process.argv.indexOf('--root')
const root = rootFlag === -1 ? join(homedir(), '.dsh', 'sessions') : process.argv[rootFlag + 1]
if (root === undefined) fail('--root needs a directory')

const known = knownEventTypes()
const reports = [...logPaths(root)].map(path => inspect(path, known))
const damaged = reports.filter(r => r.repairable?.length > 0)
const blocked = reports.filter(r => r.unreadable !== undefined || r.foreign?.length > 0)

console.log(`repair-session-logs: scanned ${reports.length} session log(s) under ${root}`)
for (const report of blocked) {
  console.error(report.unreadable === undefined
    ? `  UNREPAIRABLE ${report.path}\n    unknown event type(s) this script does not own: ${report.foreign.join(', ')}`
    : `  UNREADABLE   ${report.path}\n    ${report.unreadable}`)
}
if (damaged.length === 0) {
  console.log('  nothing to repair')
  process.exit(blocked.length === 0 ? 0 : 1)
}

let skippedLive = 0
for (const report of damaged) {
  const types = [...new Set(report.repairable.map(r => r.row.type))].join(', ')
  const idle = await isIdle(report.path)
  const verb = !idle ? 'IN USE' : apply ? 'REPAIRING' : 'WOULD REPAIR'
  console.log(`  ${verb} ${report.path}`)
  console.log(`    ${report.repairable.length} record(s): ${types}`)
  if (report.torn) console.log('    note: torn final frame (a crashed append) — its bytes are dropped by the rewrite')
  if (!idle) {
    console.log('    a process holds this session\'s write lock — close the app and re-run; skipped')
    skippedLive += 1
    continue
  }
  if (!apply) continue

  for (const { index, row } of report.repairable) {
    // Re-serialise only the rows being marked. `ignorable` is placed last so
    // the diff against the original row is a pure suffix.
    report.lines[index] = JSON.stringify({ ...row, ignorable: true })
  }

  const backup = `${report.path}.bak`
  const staged = `${report.path}.repair-tmp`
  copyFileSync(report.path, backup)
  writeFileSync(staged, encodeLog(report.path, report.lines))
  renameSync(staged, report.path)

  const after = inspect(report.path, known)
  const rows = after.lines?.length
  if (after.unreadable !== undefined || rows !== report.lines.length || after.repairable.length > 0) {
    copyFileSync(backup, report.path)
    fail(`verification failed for ${report.path} (restored from ${backup})`)
  }
  console.log(`    verified: ${rows} row(s) readable, marker present; backup at ${backup}`)
}

if (!apply) {
  console.log('\nRe-run with --apply to rewrite these logs (a .bak is kept next to each).')
}
if (skippedLive > 0) {
  console.log(`\n${skippedLive} log(s) skipped because a running harness owns them. Quit the app, then re-run.`)
}
process.exit(blocked.length === 0 && skippedLive === 0 ? 0 : 1)
