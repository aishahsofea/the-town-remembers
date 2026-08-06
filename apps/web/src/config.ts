/**
 * The single place the bundle reads build-time configuration.
 *
 * `loadBrowserConfig` refuses to build when any `VITE_`-prefixed name looks
 * like a credential, so this module failing is the intended outcome of a
 * secret being given a browser prefix.
 */

import { loadBrowserConfig } from "@the-town-remembers/browser-config";

export const browserConfig = loadBrowserConfig(import.meta.env);
