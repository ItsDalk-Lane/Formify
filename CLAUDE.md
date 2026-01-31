# CLAUDE.md - AI Assistant Guide for Formify

> This file provides comprehensive guidance for AI assistants working with the Formify codebase.

## Project Overview

**Formify** is a powerful Obsidian plugin that combines form workflow systems with AI chat functionality. It merges two open-source projects:
- **obsidian-form-flow** - Form workflow system foundation
- **obsidian-tars** - Multi-AI provider integration

**Current Version**: 0.2.8.260130
**Plugin ID**: `formify`
**License**: MIT
**Target Platform**: Obsidian 1.8.0+

### Core Features
1. **Form Workflow System** - 15+ field types, 20+ action types, serial/parallel execution
2. **AI Chat Integration** - 17+ AI providers, skill system, tool calling
3. **TARS Features** - Tab completion, ghost text, reasoning mode support

---

## Repository Structure

```
/home/user/Formify/
├── plugin/                           # Main plugin source code
│   ├── src/
│   │   ├── main.ts                  # Plugin entry point & lifecycle
│   │   ├── api/                     # External API interface (FormFlowApi)
│   │   ├── component/               # 30+ React UI components
│   │   │   ├── modal/               # Modal dialogs
│   │   │   ├── button/              # Button components
│   │   │   ├── form-fields/         # Form field inputs
│   │   │   ├── combobox/            # Auto-suggest components
│   │   │   ├── filter/              # Filter UI components
│   │   │   ├── toast/               # Toast notifications
│   │   │   ├── dialog/              # Dialog components
│   │   │   ├── dropdown/            # Dropdown menus
│   │   │   └── popover/             # Floating popovers
│   │   ├── context/                 # React Context providers
│   │   │   ├── obsidianAppContext.tsx
│   │   │   ├── pluginSettingsContext.tsx
│   │   │   ├── serviceContainerContext.tsx
│   │   │   └── LoopContext.tsx
│   │   ├── features/                # Feature modules
│   │   │   ├── FeatureCoordinator.ts
│   │   │   ├── chat/                # AI Chat feature
│   │   │   │   ├── ChatFeatureManager.tsx
│   │   │   │   ├── services/        # Chat business logic
│   │   │   │   ├── views/           # Chat UI components
│   │   │   │   ├── selection-toolbar/
│   │   │   │   ├── trigger/         # Chat trigger mechanisms
│   │   │   │   └── tools/           # Tool definitions
│   │   │   └── tars/                # AI text generation
│   │   │       ├── TarsFeatureManager.ts
│   │   │       ├── providers/       # 14+ AI provider implementations
│   │   │       ├── tab-completion/  # Tab completion system
│   │   │       └── system-prompts/
│   │   ├── hooks/                   # 14+ Custom React hooks
│   │   ├── i18n/                    # Internationalization (en, zh, zhTw)
│   │   ├── model/                   # Data models and enums
│   │   │   ├── FormConfig.ts        # Form definition model
│   │   │   ├── action/              # 22 action type models
│   │   │   ├── field/               # 12 field type models
│   │   │   ├── enums/               # 25+ enum definitions
│   │   │   └── filter/              # Filter/condition models
│   │   ├── service/                 # Business logic layer (65+ services)
│   │   │   ├── FormService.ts       # Core form submission
│   │   │   ├── ServiceContainer.ts  # Dependency injection
│   │   │   ├── action/              # Action service implementations
│   │   │   ├── command/             # Command registry
│   │   │   ├── filter/              # Condition evaluation
│   │   │   ├── engine/              # Template processing
│   │   │   └── startup-condition/   # Auto-trigger logic
│   │   ├── settings/                # Settings management
│   │   ├── style/                   # CSS files (base.css, chat.css)
│   │   ├── types/                   # TypeScript type definitions
│   │   ├── utils/                   # 40+ utility functions
│   │   └── view/                    # UI view layer
│   │       ├── edit/                # Form editor (100+ files)
│   │       ├── preview/             # Form preview/render
│   │       └── shared/              # Shared form components
│   ├── esbuild.config.mjs           # Build configuration
│   ├── tsconfig.json                # TypeScript config
│   ├── package.json                 # Dependencies
│   └── manifest.json                # Plugin manifest
├── docs/                            # Documentation & examples
└── README.md                        # Main documentation (Chinese)
```

---

## Technology Stack

### Core Technologies
- **TypeScript 4.7** - Main language (strict mode enabled)
- **React 18.3** - UI framework with hooks
- **Obsidian API** - Plugin foundation
- **esbuild 0.17** - Fast bundling/minification

### UI Libraries
- **Radix UI** - Accessible component library
- **Lucide React** - Icon library
- **@floating-ui/react** - Floating UI positioning
- **@atlaskit/pragmatic-drag-and-drop** - Drag-and-drop
- **@tanstack/react-virtual** - Virtual scrolling
- **CodeMirror 6** - Code/text editor

### AI Integration
- **@anthropic-ai/sdk** - Claude API
- **openai** - OpenAI API
- **@google/generative-ai** - Gemini API
- **ollama** - Local Ollama models
- **gpt-tokenizer** - Token counting

### Utilities
- **luxon** - Date/time handling
- **handlebars** - Template engine
- **uuid** - Unique IDs
- **jose** - JWT encryption

---

## Development Commands

```bash
# Navigate to plugin directory first
cd plugin

# Development mode (watch with hot reload)
npm run dev

# Production build (minified)
npm run build

# Build and copy to local Obsidian vault
npm run build:local

# Version bump
npm run version
```

### Build Output
- **Development**: Outputs to `plugin/` directory with inline source maps
- **Production**: Minified bundle, outputs to configured Obsidian plugin directory

---

## Architecture Patterns

### 1. Plugin Lifecycle (`src/main.ts`)

```typescript
class FormPlugin extends Plugin {
    settings: PluginSettings;
    featureCoordinator: FeatureCoordinator;
    services: ServiceContainer;

    async onload() {
        // 1. Load settings
        // 2. Initialize service container
        // 3. Setup commands and views
        // 4. Initialize features on layout ready
    }

    onunload() {
        // Cleanup services and features
    }
}
```

### 2. Service Container Pattern

The `ServiceContainer` class manages all services with dependency injection:

```typescript
// Access services via container
const container = getServiceContainer();
container.formService.submit(...);

// Or via React context
const { formService } = useServiceContainer();
```

**Core Services**:
- `FormService` - Form submission and lifecycle
- `FormScriptService` - Custom script execution
- `ApplicationCommandService` - Command registration
- `ContextMenuService` - Right-click menus
- `FormIntegrationService` - Form discovery
- `AutoTriggerService` - Auto-execution

### 3. Feature Coordination

`FeatureCoordinator` manages independent features:
- **TarsFeatureManager** - Text generation & tab completion
- **ChatFeatureManager** - AI chat interface & tools

### 4. Action Visitor Pattern

Actions use a visitor pattern with specialized services:

```typescript
interface IActionService {
    accept(action: Action): boolean;
    run(context: ActionContext): Promise<void>;
}
```

### 5. React Context Providers

```typescript
// Obsidian App access
<ObsidianAppContext.Provider value={app}>

// Plugin settings
<PluginSettingsContext.Provider value={settings}>

// Service container
<ServiceContainerContext.Provider value={services}>

// Loop state for iterations
<LoopContext.Provider value={loopState}>
```

---

## Code Conventions

### TypeScript

1. **Strict Mode** - `noImplicitAny` and `strictNullChecks` enabled
2. **Path Aliases**:
   - `src/*` → source files
   - `tars/*` → `src/features/tars/*`
3. **Target**: ES2018
4. **JSX**: react-jsx

### File Organization

1. **Models** in `model/` - Pure data types and enums
2. **Services** in `service/` - Business logic, no UI
3. **Components** in `component/` - Reusable React components
4. **Views** in `view/` - Feature-specific UI
5. **Hooks** in `hooks/` - Custom React hooks
6. **Utils** in `utils/` - Pure utility functions

### Naming Conventions

- **Files**: PascalCase for components/classes, camelCase for utils
- **Components**: `ComponentName.tsx`
- **Services**: `ServiceName.ts`
- **Hooks**: `useHookName.tsx`
- **Enums**: `EnumName.ts` with PascalCase values
- **Interfaces**: Prefix with `I` for service interfaces (e.g., `IActionService`)

### Indentation

- **Tab indentation** (per ESLint config)
- Exception: Object expressions may use different indentation

---

## Key Models

### FormConfig (`model/FormConfig.ts`)

```typescript
interface FormConfig {
    id: string;
    name: string;
    fields: Field[];
    actions: Action[];
    settings: FormSettings;
}
```

### Field Types (`model/field/`)

- Text, Textarea, Password, Number
- Date, DateTime, Time
- Checkbox, Toggle, Radio, Select
- PropertyValues, FileList, FolderPath

### Action Types (`model/action/`)

- AI, CreateFile, InsertText, RunScript
- UpdateFrontmatter, Loop, Break, Continue
- Button, Collect, GenerateForm, and more

---

## Internationalization

**Supported Languages**:
- English (`i18n/en.ts`)
- Chinese Simplified (`i18n/zh.ts`)
- Chinese Traditional (`i18n/zhTw.ts`)

**Usage Pattern**:
```typescript
import { localInstance } from 'src/i18n/local';
const text = localInstance.field_name;
```

All locale classes implement the `Local` interface.

---

## Testing

Currently minimal test coverage. Tests use Jest.

---

## Common Tasks for AI Assistants

### Adding a New Field Type

1. Create field model in `model/field/`
2. Add enum value in `model/enums/FieldType.ts`
3. Create field component in `component/form-fields/`
4. Add field reader in `service/field-value/`
5. Update form editor views
6. Add i18n strings

### Adding a New Action Type

1. Create action model in `model/action/`
2. Add enum value in `model/enums/ActionType.ts`
3. Create action service in `service/action/`
4. Register in action chain
5. Add action editor UI in `view/edit/action/`
6. Add i18n strings

### Adding a New AI Provider

1. Create provider in `features/tars/providers/`
2. Implement provider interface
3. Register in provider factory
4. Add settings UI
5. Add i18n strings

### Adding a Chat Tool

1. Create tool definition in `features/chat/tools/`
2. Implement tool interface
3. Register in tool registry
4. Add approval handling if needed

---

## Important Files to Know

| File | Purpose |
|------|---------|
| `src/main.ts` | Plugin entry point |
| `src/service/ServiceContainer.ts` | Dependency injection |
| `src/service/FormService.ts` | Core form logic |
| `src/features/FeatureCoordinator.ts` | Feature management |
| `src/settings/PluginSettings.ts` | Settings schema |
| `src/model/FormConfig.ts` | Form data model |
| `esbuild.config.mjs` | Build configuration |
| `manifest.json` | Plugin metadata |

---

## Debug Mode

Enable debug logging via settings:

```typescript
DebugLogger.setDebugMode(true);
DebugLogger.setDebugLevel('debug'); // 'error' | 'warn' | 'info' | 'debug'
```

Access via `DebugLogger.debug()`, `DebugLogger.info()`, `DebugLogger.warn()`, `DebugLogger.error()`.

---

## External Dependencies Note

The plugin uses several external dependencies that are bundled with esbuild. The following are marked as external and provided by Obsidian:
- `obsidian`
- `electron`
- `@codemirror/*` modules
- `@lezer/*` modules
- Node.js built-ins

---

## Git Workflow

- Main development happens on feature branches
- Commit messages should describe the "why" not just the "what"
- Version bumping uses `npm run version`

---

## Questions or Issues

For questions about this codebase or to report issues:
- Check existing code patterns in similar features
- Reference the README.md for user-facing documentation
- Debug logging is available for troubleshooting
