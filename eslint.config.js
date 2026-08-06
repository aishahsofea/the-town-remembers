import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Server-only module specifiers the browser bundle must never reach. */
const NODE_BUILTIN_PATTERNS = ["node:*", "fs", "path", "crypto", "child_process"];

/** Packages whose published surface must stay usable inside a browser bundle. */
const BROWSER_SAFE_SOURCES = [
  "apps/web/src/**/*.{ts,tsx}",
  "packages/http-contracts/src/**/*.ts",
  "packages/browser-config/src/**/*.ts",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-types/**",
      "**/coverage/**",
      "**/cdk.out/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Every TypeScript file belongs to exactly one of these programs: a
        // package build project, or the root test-only project for its
        // runtime. Listing them explicitly keeps lint coverage identical to
        // `pnpm typecheck` instead of silently inferring a looser program.
        project: [
          "./packages/*/tsconfig.json",
          "./apps/*/tsconfig.json",
          "./tsconfig.tests.node.json",
          "./tsconfig.tests.web.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": "error",
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
  {
    files: BROWSER_SAFE_SOURCES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: NODE_BUILTIN_PATTERNS,
              message:
                "Browser-reachable code must not import Node built-ins. Move the logic behind a server package.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    // Repository tooling runs directly on Node without a TypeScript program.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.nodeBuiltin },
    rules: { "no-console": "off" },
  },
);
