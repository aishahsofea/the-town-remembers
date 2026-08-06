/**
 * Neutral illustrated placeholder.
 *
 * Phase 0 ships no final illustration. The manifest resolves every authored
 * key to this asset so the lookup path, the fallback path, and the client
 * error record are all real and testable before art exists. Phase 6 owns the
 * presentation assets themselves.
 */

export const PLACEHOLDER_ASSET_SOURCE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20" role="presentation">' +
      '<rect width="32" height="20" fill="#dcd6c8"/>' +
      '<path d="M0 15h32v5H0z" fill="#c4bca8"/>' +
      '<circle cx="16" cy="9" r="4" fill="#b3a992"/>' +
      "</svg>",
  );

export const PLACEHOLDER_ASSET_LABEL = "Illustration not yet available";
