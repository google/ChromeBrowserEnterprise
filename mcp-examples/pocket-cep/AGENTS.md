# Pocket CEP - Agent Instructions

## Project Overview

Pocket CEP is an **educational** NextJS companion app for the Chrome Enterprise Premium MCP server.
It demonstrates how to connect to an MCP server using OAuth, call tools, and build an AI-powered
admin chat assistant. Code should be well-documented and beginner-friendly.

## Documentation Standards (JSDoc/TSDoc)

All code must be documented to help new engineers understand the codebase. Follow these requirements strictly.

> **Note:** ESLint doesn't enforce JSDoc presence in this project — the standards below are enforced through code review and AI agent instructions.

### File-Level Documentation

Every TypeScript file MUST begin with a file-level JSDoc comment describing its role:

```typescript
/**
 * @file Human-readable formatting utilities for Cloud Identity settings.
 */
```

### Function Documentation

Every exported function and class method MUST have a multi-line JSDoc comment:

```typescript
/**
 * Formats a Cloud Identity setting type into a human-readable name.
 */
export function formatSettingType(settingType: string) {
```

**Format requirements:**
- Use multi-line format with `/**` on its own line
- Description only - do NOT use `@param` or `@return` tags
- Keep descriptions concise but informative
- Explain the "why" not the "what" when the function name is self-explanatory

### Type and Interface Documentation

Every exported type, interface, and type alias MUST have a JSDoc comment:

```typescript
/**
 * Result from fetching Chrome audit events.
 */
export type ChromeEventsResult = { ... }

/**
 * Contract for CEP tool execution. Implementations include CepToolExecutor
 * for production API calls and FixtureToolExecutor for deterministic testing.
 */
export interface ToolExecutor { ... }
```

### What NOT to Document

- Private helper functions with obvious purpose (use judgment)
- Inline type definitions within function signatures

### Educational Comments

Comments should be descriptive and beginner-friendly, explaining extension points
and design decisions. Keep them proportional to the complexity they explain.

### Code Organization

- Two blank lines between top-level declarations (functions, classes, types)
- One blank line between substantially different blocks within a function
- Group related code together
- Do not re-export; do not clog code with backwards-compatibility shims

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Prefer clarity over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises returned from async functions
- Use `async/await` syntax instead of promise chains
- Handle errors in async code with try/catch
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- For this POC, structured `console.log` output is allowed; include a consistent tag and avoid secrets
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases
- Eval suites log per-case progress with `[eval]` prefix; keep logs concise and structured

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)

### Framework-Specific Guidance

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components
- Use ref as a prop instead of `React.forwardRef`

## Auth Error Contract

All Google API failures (ADC, Admin SDK, MCP tool errors) flow through `src/lib/auth-errors.ts`. When you add a new Google-backed call:

1. Let `AuthError` propagate from server-side helpers. Don't swallow it.
2. In a route handler: catch with `isAuthError(err)` and return `NextResponse.json({ error: err.toPayload() }, { status: 401 })`.
3. On the client: fetch through `authAwareFetch` so 401s light up the banner automatically.
4. For new error shapes Google throws, extend `toAuthError()` rather than adding ad-hoc substring checks at call sites.

Never add a `try/catch` that returns empty data on credential failure — that silently breaks the banner + doctor + chat card contract.

## Design System

The UI is deliberately Material Design 3 (MD3) in feel — a Google Workspace admin console, not a generic SaaS dashboard. Keep this coherent.

### Typography

- **Sans:** Roboto (`next/font/google`, weights 400/500/700). **Mono:** Roboto Mono. Do not swap to Inter or any other sans, even when a general UI guideline recommends it — Roboto is the deliberate stand-in for Google Sans Text that Workspace consoles ship with. The `@utility font-display` in `globals.css` carries the display tracking.
- Roboto has no 600 weight; `font-semibold` falls back to 700. That's intended — don't load a 600 subset.
- Never use `text-xs` for body paragraphs. Smallest body size is `text-sm`; use `text-xs` and `text-[0.6875rem]`/`text-[0.625rem]` only for secondary labels, eyebrows, keyboard hints, badges, and dense inspector data.
- Arbitrary font sizes must be in `rem`, not `px` — `text-[0.6875rem]` not `text-[11px]`.
- Never override heading line-heights (`leading-*` on `h1`–`h6`) — the default is tuned to work with the global tracking.

### Tokens and Tailwind

- Tailwind v4, CSS-first. All tokens live in `src/app/globals.css` under `@theme inline`. **There is no `tailwind.config.ts`** — do not add one.
- Colors are semantic MD3 tokens: `--color-primary`, `--color-surface*`, `--color-on-surface*`, `--color-error/warning/success*`, `--color-outline*`. Reference them via Tailwind class shorthands (`bg-primary`, `text-on-surface-variant`, `border-on-surface/10`). No raw hex in components.
- Radii come from the `--radius-xs`..`--radius-xl` scale, referenced as `rounded-[var(--radius-xs)]`. Don't hand-roll `rounded-[6px]` etc.
- Dividers and borders must use opacity-based colors (`border-on-surface/10`, `divide-on-surface/5`), never solid palette shades.
- Custom utilities are defined in `globals.css` (`@utility state-layer`, `surface-raised`, `section-label`, `panel-grid-bg`, `prose-chat`, animations). Extend by adding a new `@utility` block; do not copy the pattern inline.

### Component Library

- shadcn footprint is intentionally tiny: only `Badge` and `Skeleton` under `src/components/ui/`. Do not import more shadcn primitives — hand-rolled components (combobox in `user-selector.tsx`, model picker in `model-selector.tsx`, inspector, chat panel) carry domain-specific concerns that a generic primitive would strip out.
- Icons are `lucide-react` only. No custom SVG, no alternative icon sets.
- Use `size-{n}` when width and height are equal. Use `gap-*` on flex/grid parents instead of margin utilities between siblings.
