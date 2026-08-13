/**
 * Branded string types so a bundle-assembly parameter list documents, at the
 * type level, which values are safe to place in front of a model and which
 * are explicitly untrusted. Branding cannot stop a caller determined to lie
 * about a string's provenance, but it does mean doing so takes a visible,
 * grep-able cast rather than happening by accident from an unannotated
 * `string` parameter.
 */

declare const authoredTemplateBrand: unique symbol;
declare const playerSafeBrand: unique symbol;

/** Text sourced only from `content/dialogue/templates.ts`'s authored constants — never interpolated with a runtime value. */
export type AuthoredTemplateText = string & { readonly [authoredTemplateBrand]: true };

/** Canonical, vetted-safe text (a display name, a spoiler-safe episode summary, a voice rule) — not raw player input. */
export type PlayerSafeText = string & { readonly [playerSafeBrand]: true };

export function authoredTemplateText(text: string): AuthoredTemplateText {
  return text as AuthoredTemplateText;
}

export function playerSafeText(text: string): PlayerSafeText {
  return text as PlayerSafeText;
}
