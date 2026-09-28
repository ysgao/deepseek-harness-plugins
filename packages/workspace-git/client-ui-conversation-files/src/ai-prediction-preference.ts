/**
 * The "model-backed ghost text" on/off preference: one boolean, shared by
 * every File tab in this browser (not per-session, not per-file) —
 * persisted so a reader who turns it off does not have to turn it off again
 * for the next file, tab, or conversation. Deliberately a plain
 * `localStorage` read/write, not the heavier declarative store engine
 * (`@deepseek-ai/dsh-client-store`) this app's `ui-slots`-registered
 * terminals use elsewhere: there is exactly one boolean here, read once per
 * `FileView` mount and written on toggle, with no slot, selector hook, or
 * cross-tab sync need to justify that machinery.
 *
 * A `localStorage` access can throw (private browsing in some browsers,
 * storage disabled by policy) — every read/write is guarded, and a failure
 * simply keeps the in-memory default/current value rather than crashing the
 * tab. Multiple File tabs open at once (two different conversations) each
 * read this key independently at their own mount; toggling in one does not
 * live-update an already-open other tab, only the next one opened or the
 * same tab reloaded.
 * @module dsh-plugins-client-ui-conversation-files/ai-prediction-preference
 */

/** `localStorage` key for the preference. */
const STORAGE_KEY = 'dsh-plugins-client-ui-conversation-files.aiSentencePrediction'

/**
 * Default when nothing is stored yet: on. The model called is the exact one
 * the conversation itself already uses (see `dsh-plugins-api-file-sentence-
 * controller`'s own README) — not a separate, independently-trusted
 * integration — so there is no new data-sharing decision to opt into beyond
 * the one already made by having this conversation at all.
 */
const DEFAULT_ENABLED = true

/**
 * Read the current preference.
 * @returns the stored value, or {@link DEFAULT_ENABLED} when unset or unreadable.
 */
export function readAiPredictionPreference(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_ENABLED
    return raw === '1'
  } catch {
    return DEFAULT_ENABLED
  }
}

/**
 * Persist the preference. Silently a no-op on failure — the toggle still
 * takes effect for the rest of this tab's own lifetime through the caller's
 * own in-memory state, it simply will not survive a reload.
 * @param enabled - the new value.
 */
export function writeAiPredictionPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Storage unavailable (private browsing, policy-disabled, quota) — the
    // in-memory value the caller already updated is the best available.
  }
}
