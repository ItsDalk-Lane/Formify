# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Formify** is an Obsidian plugin combining a form workflow system with multi-AI-provider chat integration. It merges two open-source projects: **obsidian-form-flow** (form workflows) and **obsidian-tars** (AI providers). Plugin ID: `formify`, target: Obsidian 1.8.0+.

## Development Commands

All commands run from the `plugin/` directory:

```bash
cd plugin

npm run dev          # Development mode with watch + inline source maps
npm run build        # Production build (minified, no source maps)
npm run build:local  # Production build + copy to local Obsidian vault
npm run lint         # ESLint check
npm run version      # Bump version in manifest.json and versions.json
```

### Local Development Setup

1. Copy `plugin/.env.example` to `plugin/.env`
2. Set `OBSIDIAN_VAULT_PATH` to your Obsidian vault root (not `.obsidian/plugins/`)
3. Run `npm run build:local` to build and sync to vault, or `npm run dev` for watch mode with manual copy

Build output: `plugin/main.js` + `plugin/styles.css` (CSS is auto-renamed from `main.css` by the esbuild plugin). The `copy-to-vault.mjs` script reads `.env` from either `plugin/.env` or repo root `.env`.

### Build System

esbuild bundles `src/main.ts` → `main.js` (CJS format, ES2018 target). External dependencies provided by Obsidian at runtime: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, and Node.js builtins.

## Architecture

### Layered Architecture (top-down)

```
Plugin Entry (main.ts)
  → FeatureCoordinator          // manages independent feature modules
    → TarsFeatureManager        // AI text generation, tab completion
    → ChatFeatureManager        // AI chat interface, tools, skills
  → ServiceContainer            // dependency injection for all services
    → FormService               // core form submission + validation
    → ActionChain               // recursive action execution engine
    → 15 IActionService impls   // one per action type
  → Model layer                 // pure data types, enums, configs
```

### Form Submission Data Flow

This is the critical path to understand:

1. **FormService.submit()** receives a `FormConfig` + user field values
2. **Field processing**: validates fields → replaces built-in variables (`{{date}}`, `{{clipboard}}`, `{{selection}}`) → builds two parallel value maps:
   - `idValues` (keyed by field ID — used internally for conditions, variable substitution)
   - `values` (keyed by field label — used in AI prompts, user-facing output)
3. **ActionChain.next()** executes actions recursively:
   - Checks `abortSignal` (timeout/user cancellation)
   - Evaluates `action.condition` via `FilterService.match()` — skip if false
   - Finds matching `IActionService` via `accept()` pattern
   - Calls `service.run(action, context, chain)` → then `chain.next(context)`
4. **Background execution optimization**: When an AI action is encountered and background mode is enabled, the form UI closes immediately while AI actions continue in background

### ActionChain (src/service/action/IActionService.ts)

The chain is a recursive iterator over `IFormAction[]`. Each `IActionService` implements:
- `accept(action)` — returns true if this service handles the action type
- `run(action, context, chain)` — executes the action, then calls `chain.next(context)`

Special flow-control actions: `LOOP` creates nested `ActionChain` with `LoopVariableScope`; `BREAK`/`CONTINUE` throw sentinel values caught by the loop service.

### AI Action Pipeline (src/service/action/ai/AIActionService.ts)

The most complex service (~800 lines). Execution flow:

1. **Runtime model selection** — optionally picks model from form field values or shows a picker dialog
2. **Build system prompt** — `SystemPromptAssembler` with modes: DEFAULT / CUSTOM / NONE
3. **Build user prompt** — processes template variables:
   - `{{@fieldName}}` → field values
   - `{{output:varName}}` → output from previous actions
   - `{{[[path/to/file]]}}` → resolves Obsidian internal links (reads file content)
   - Built-in: `{{date}}`, `{{time}}`, `{{selection}}`, `{{clipboard}}`
4. **Call AI** via unified `Vendor` interface → async generator yields streaming chunks
5. **Post-process** — strips reasoning blocks (`$$think$$...$$end$$`), stores result in `state.values`

### AI Provider Architecture (src/features/tars/providers/)

All 17+ providers implement the `Vendor` interface:
```typescript
interface Vendor {
  name: string;
  sendRequestFunc: (options: BaseOptions) => SendRequest;  // returns async generator
  models: string[];
  capabilities: Capability[];
}
```

Providers: Claude, OpenAI, Gemini, Ollama, DeepSeek, Qwen, QianFan, Kimi, Azure, Grok, OpenRouter, SiliconFlow, Zhipu, Doubao, Poe, and more.

### ServiceContainer (src/service/ServiceContainer.ts)

Manual dependency injection with two-phase initialization:

- **Phase 1** (constructor): Services that don't need Obsidian `App` instance
- **Phase 2** (`initializeWithApp`): Services requiring `App` (e.g., `InternalLinkParserService`)

Access pattern: `getServiceContainer()` global function or `useServiceContainer()` React hook.

### React Context Hierarchy

```
ObsidianAppContext → PluginSettingsContext → ServiceContainerContext → LoopContext
```

Components access these via hooks: `useObsidianApp()`, `usePluginSettings()`, `useServiceContainer()`.

## Code Conventions

- **Indentation**: Tabs (enforced by ESLint)
- **TypeScript**: `noImplicitAny` + `strictNullChecks` enabled
- **Path aliases**: `src/*` → source files, `tars/*` → `src/features/tars/*`
- **File naming**: PascalCase for components/classes/services, camelCase for utils
- **Interface naming**: `I` prefix for service interfaces (e.g., `IActionService`)
- **JSX**: react-jsx (no `React` import needed)

### File Organization Pattern

- `model/` — pure data types and enums (no logic)
- `service/` — business logic (no UI)
- `component/` — reusable React components
- `view/` — feature-specific UI (form editor in `view/edit/`, preview in `view/preview/`)
- `hooks/` — custom React hooks
- `features/` — independent feature modules (chat, tars)
- `context/` — React context providers

## Key Extension Points

### Adding a New Field Type

1. Add enum in `model/enums/FormFieldType.ts`
2. Create field model in `model/field/`
3. Create field component in `component/form-fields/`
4. Add field value reader in `service/field-value/`
5. Update form editor in `view/edit/`
6. Add i18n strings in `i18n/en.ts`, `i18n/zh.ts`, `i18n/zhTw.ts`

### Adding a New Action Type

1. Add enum in `model/enums/FormActionType.ts`
2. Create action model in `model/action/`
3. Create `IActionService` implementation in `service/action/`
4. Register in the action service discovery chain
5. Add editor UI in `view/edit/action/`
6. Add i18n strings

### Adding a New AI Provider

1. Create provider file in `features/tars/providers/`
2. Implement the `Vendor` interface (especially `sendRequestFunc` returning an async generator)
3. Register in provider factory
4. Add settings UI and i18n strings

## i18n

Three locales: `en.ts`, `zh.ts`, `zhTw.ts` — all implement the `Local` interface. Access via `localInstance.key_name`.

## Debug

```typescript
DebugLogger.setDebugMode(true);
DebugLogger.setDebugLevel('debug'); // 'error' | 'warn' | 'info' | 'debug'
```
