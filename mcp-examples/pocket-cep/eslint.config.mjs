/**
 * @file ESLint flat config for Pocket CEP.
 *
 * Uses the modern flat config format (eslint.config.mjs) with
 * Next.js recommended rules, TypeScript-aware rules, and Prettier
 * as a fixable ESLint rule. Running `eslint --fix` handles both
 * code quality and formatting in one pass.
 */

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Prettier as a fixable ESLint rule — `eslint --fix` formats code too.
  prettier,
  {
    plugins: { prettier: prettierPlugin },
    rules: {
      "prettier/prettier": "warn",
    },
  },

  // Project rules.
  {
    rules: {
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],

      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-empty-interface": "off",

      "react/jsx-key": "error",
      "jsx-a11y/alt-text": "error",

      // eslint-plugin-react-hooks 7.x's React-Compiler-aware
      // `react-hooks/refs` rule false-positives the canonical
      // stable-callback-via-ref pattern (e.g. a `useCallback` with
      // `[]` deps that reads a ref at call-time so a memoized
      // consumer sees fresh values without re-creating). Disabled
      // until the rule learns to look through the deferred-call
      // boundary; the pattern is intentional and documented at use.
      "react-hooks/refs": "off",
    },
  },

  globalIgnores([".next/**", "out/**", "build/**", "node_modules/**", "next-env.d.ts"]),
]);

export default eslintConfig;
