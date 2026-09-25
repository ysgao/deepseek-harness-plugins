/**
 * The File tab's controls over the open file: View/Edit/Diff, Save, and the
 * conflict notice that Save can raise.
 *
 * One component, two mount points — see `./mode-store.ts` for why. While the
 * relocated preview engine is drawing (View mode) these render inside its
 * own header toolbar, through the `sidebar.right.tab.document.actions` slot
 * upstream declares for exactly this ("contributions acting on the previewed
 * file"). While it is not — Edit and Diff replace the engine's body, and a
 * composition without `dsh-plugins-client-ui-document-host` has no engine at
 * all — the tab's own header draws them instead. Either way this is the same
 * component reading the same store, so the controls do not move, change, or
 * disagree between modes.
 *
 * It owns no state. Everything drawn comes from the snapshot `FileView`
 * publishes, and every action goes back through that store's handlers.
 * @module dsh-plugins-client-ui-conversation-files/FileActions
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileModeStore } from './mode-store.ts'
import css from './FileActions.module.css'

/** What the controls need: the tab's published state, and this package's copy. */
export interface FileActionsProps {
  /** The session's shared toolbar state, published by `FileView`. */
  store: FileModeStore
  /**
   * Which of the two mount points this is. The `engine` mount claims the
   * controls for as long as it is on screen, which is what tells `FileView`
   * to stop drawing them in its own header; the `tab` mount is the fallback
   * that draws them when nothing claimed them.
   */
  owner: 'engine' | 'tab'
  /** Bound `conversation-files` locale translate function. */
  t: TranslateNS<'conversation-files'>
}

/**
 * Draw the open file's controls.
 * @param props - see {@link FileActionsProps}.
 * @returns the controls, or nothing while the tab is resting or the file
 * offers neither editing nor a diff.
 */
export function FileActions({ store, owner, t }: FileActionsProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  // Claimed for the whole mount, not just while the controls are visible:
  // the claim answers "is the engine's toolbar on screen", and the early
  // return below can hide the controls for a file that offers neither Edit
  // nor Diff without that ceasing to be true.
  useEffect(() => {
    if (owner !== 'engine') return
    store.setHosted(true)
    return () => { store.setHosted(false) }
  }, [owner, store])
  // Read on each event rather than at render: the handlers close over
  // `FileView`'s latest render and are deliberately outside the subscribed
  // snapshot (see `FileModeStore.getHandlers`).
  const run = <T extends 'setMode' | 'save' | 'discardAndReload'>(name: T) => store.getHandlers()[name]

  // Nothing open, or a file that is neither editable nor changed (an image,
  // a PDF): the engine's own toolbar controls are the whole story, and an
  // empty group would just add a divider to it.
  if (state.path === null || (!state.canEdit && !state.canDiff)) return null

  return (
    <div className={css.actions}>
      {state.mode === 'edit' && (
        <>
          {state.save === 'conflict' && (
            <span className={css.conflict} role="alert">
              {t('files.edit.conflict')}
              {' '}
              <button type="button" className={css.conflictReload} onClick={() => { run('discardAndReload')() }}>
                {t('files.edit.reload')}
              </button>
            </span>
          )}
          {state.save === 'error' && <span className={css.conflict} role="alert">{t('files.edit.saveError')}</span>}
          <Button
            variant="primary"
            disabled={!state.dirty || state.save === 'saving'}
            onClick={() => { run('save')() }}
          >
            {state.save === 'saving' ? t('files.edit.saving') : t('files.edit.save')}
          </Button>
        </>
      )}
      {/* The unsaved marker the tab's own header carries beside the path —
          drawn here only for the engine mount, which replaces that header.
          The `tab` mount sits *inside* it, where the path already carries
          its own marker, and drawing a second one there reads as "path • … •".
          Outside Edit only: in Edit the Save button beside it already says
          there is something to save. */}
      {owner === 'engine' && state.dirty && state.mode !== 'edit' && (
        <span className={css.unsaved} aria-label={t('files.edit.unsaved')}> •</span>
      )}
      <div className={css.modeToggle}>
        <Button variant={state.mode === 'view' ? 'primary' : 'ghost'} onClick={() => { run('setMode')('view') }}>
          {t('files.diff.view')}
        </Button>
        {state.canEdit && (
          <Button variant={state.mode === 'edit' ? 'primary' : 'ghost'} onClick={() => { run('setMode')('edit') }}>
            {t('files.edit.edit')}
          </Button>
        )}
        {state.canDiff && (
          <Button variant={state.mode === 'diff' ? 'primary' : 'ghost'} onClick={() => { run('setMode')('diff') }}>
            {t('files.diff.diff')}
          </Button>
        )}
      </div>
    </div>
  )
}
