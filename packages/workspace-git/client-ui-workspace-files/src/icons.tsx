/**
 * Git action and file/folder glyphs the Files tree needs that
 * `@deepseek-ai/dsh-client-ui-primitives` does not (yet) ship — ported
 * verbatim from `yga/deepseek-harness`'s own direct addition of these icons
 * to that package. Kept local to this package instead of depending on an
 * upstream `dsh-client-ui-primitives` change: none of these glyphs are used
 * outside the Files tree today.
 */
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Placeholder generic-file glyph (plain page outline with a folded corner):
 * not a figma extract like its neighbors in the design system — no file
 * icon exists there yet. Stands in for the Workspace Files tree's file rows
 * until a real design asset replaces it.
 */
export const IconFilePlaceholder16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none">
    <path
      d="M4 1.5H9.5L12.5 4.5V13.5C12.5 13.9142 12.1642 14.25 11.75 14.25H4C3.58579 14.25 3.25 13.9142 3.25 13.5V2.25C3.25 1.83579 3.58579 1.5 4 1.5Z"
      stroke="currentColor"
      strokeWidth="1.1"
      fill="none"
      strokeLinejoin="round"
    />
    <path d="M9.25 1.5V4.5H12.25" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
  </svg>
)

/**
 * "Add file": {@link IconFilePlaceholder16}'s glyph, shrunk and shifted
 * up-left, with a small filled-circle plus badge riding its bottom-right
 * corner (the background paint uses the page's own currentColor with 12%
 * opacity, so the badge reads correctly on both themes without a
 * theme-token prop this icon set otherwise has no room for).
 */
export const IconNewFile16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none">
    <path
      d="M3.5 1H8L10.5 3.5V10.5C10.5 10.7761 10.2761 11 10 11H3.5C3.22386 11 3 10.7761 3 10.5V1.5C3 1.22386 3.22386 1 3.5 1Z"
      stroke="currentColor"
      strokeWidth="1"
      fill="none"
      strokeLinejoin="round"
    />
    <path d="M7.75 1V3.5H10.25" stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round" />
    <circle cx="11.5" cy="11.5" r="4" fill="currentColor" opacity="0.12" />
    <path d="M11.5 9.5V13.5M9.5 11.5H13.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
)

/**
 * "Add folder": the design system's own folder-close glyph, shrunk and
 * shifted up-left, with the same plus badge {@link IconNewFile16} uses.
 */
export const IconNewFolder16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none">
    <path
      d="M1 2.5C1 1.94772 1.44772 1.5 2 1.5H4.5L5.5 3H9.5C10.0523 3 10.5 3.44772 10.5 4V9C10.5 9.55228 10.0523 10 9.5 10H2C1.44772 10 1 9.55228 1 9V2.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
    />
    <circle cx="11.5" cy="11.5" r="4" fill="currentColor" opacity="0.12" />
    <path d="M11.5 9.5V13.5M9.5 11.5H13.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
)

/** ic_ds_arrow_up_outline_14 (hand-drawn, stroke-based, no figma source): upload/commit glyph — an up arrow into a base line. */
export const IconArrowUpOutline14 = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M7 10V3M3 7L7 3L11 7M4 12H10"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** ic_ds_undo_outline_14 (hand-drawn, stroke-based, no figma source): revert/discard glyph — a shaft hooking back on itself. */
export const IconUndoOutline14 = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M6 4L2 7L6 10M2 7H8A3.5 3.5 0 0 1 8 14H6"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * ic_ds_arrow_down_outline_14 (hand-drawn, stroke-based, no figma source):
 * download/pull glyph — a down arrow descending from a base line, the
 * vertical mirror of {@link IconArrowUpOutline14}.
 */
export const IconArrowDownOutline14 = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M7 4V11M3 7L7 11L11 7M4 2H10"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * ic_ds_chevron_duo_up_outline_14 (hand-drawn, stroke-based, no figma
 * source): push glyph — two stacked ascending chevrons, kept visually
 * distinct from {@link IconArrowUpOutline14}'s single arrow-into-base
 * commit glyph.
 */
export const IconChevronDuoUpOutline14 = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M3.5 12L7 8.5L10.5 12M3.5 8L7 4.5L10.5 8"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
