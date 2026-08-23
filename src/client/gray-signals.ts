/**
 * Versioned gray-test fingerprint table.
 *
 * Community-attested dirty tokens and opener fingerprints live here as data,
 * so a new community report (a new dirty token, a new opener) is a one-line
 * table edit — no probe-logic change. Bump GRAYTEST_VERSION when editing.
 */

/** Dirty tokens that leak into reasoning (case-insensitive substring). */
export const DIRTY_TOKENS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'Nameeee', pattern: /\bNameeee\b/ },
  { id: 'antml:thinking', pattern: /antml:thinking/i },
  { id: '<antml', pattern: /<\/?antml\b/i },
  { id: 'EDMFunc', pattern: /\bEDMFunc\b/ },
  { id: 'everydaycalculation', pattern: /\beverydaycalculation\b/i },
]

/** Backend deployment strings (`fp_v4pro_…`). */
export const FINGERPRINT_RE = /\bfp_(?:v4pro_)?[a-zA-Z0-9][a-zA-Z0-9_\-]{3,}\b/g

/** `I'm doing` / `I am doing` / jammed `I'mdoing`. */
export const IM_DOING_RE = /\bi(?:['’]m| am)\s*doing\b/gi

/**
 * Opener fingerprints: the latest block's first line matching one of these is
 * stronger than a mid-block occurrence. `i` anchors the I'm-doing family.
 */
export const OPENERS: readonly { id: string; re: RegExp; weight: number }[] = [
  { id: 'im-doing-opener', re: /^i(?:['’]m| am)\s*doing\b/i, weight: 2 },
]

/** List / heading line prefixes that mark summary-shaped CoT. */
export const LIST_LINE_RE = /^(?:[-*•]|\d+[.)]|#{1,3}\s)/u
