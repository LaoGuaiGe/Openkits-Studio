# OpenKits Studio

**Cursor for Embedded** — a VS Code OSS based embedded AI development studio.

OpenKits Studio reuses mature VS Code capabilities (editor, file tree, terminal, Git, Diff, Problems, command palette) and adds embedded-specific AI workflows: board selection, project creation, toolchain management, build, flash, and an AI Agent with diff-first code review.

It is not a Keil replacement, a CCS replacement, or a new editor.

## MVP Scope

- Windows first
- MSPM0 first
- Primary board: Tianqiaoxing MSPM0G3519
- CCS compiler / gmake for builds
- XDS110 for flash
- All AI file changes go through VS Code Diff before writing

## Features

### Toolchain Manager
- Detects Git, Node.js, MSPM0 SDK, CCS Compiler (TI ARM Clang), XDS110, J-Link
- Supports bundled runtime directory and system PATH fallback
- Reports version info and provides fix hints for missing tools

### Project Creation
- Creates MSPM0G3519 projects from SDK examples when available
- Falls back to minimal scaffold with clear SDK installation guidance
- Generates `.openkits/project.json` manifest and CCS Makefile structure

### Build & Flash
- Real CCS gmake build integration with user confirmation
- XDS110 flash with firmware auto-detection (`.out` / `.hex`)
- All destructive operations require explicit user approval

### AI Agent Toolset
| Tool | Description | Approval |
|------|-------------|----------|
| ReadProject | Read project structure and config | No |
| SearchProject | Search source files by keyword/regex | No |
| ReadFile | Read a specific project file | No |
| ProposePatch | Propose code changes via VS Code Diff | Yes |
| RunBuild | Trigger compilation | Yes |
| AnalyzeBuildLog | Parse build errors and warnings | No |
| DetectProbe | Detect connected debug probes | Yes |
| FlashFirmware | Flash firmware to board | Yes |

## Repository Layout

```
product/              VS Code OSS branding and default settings
extensions/           OpenKits VS Code extension
  openkits-embedded/    Board, toolchain, build, flash, and AI Agent
packages/             Core logic packages
  openkits-core/        Board packages, toolchain, build/flash adapters, agent tools
scripts/              Validation and test helpers
docs/                 Implementation notes and acceptance criteria
```

## Quick Start (Development)

1. Open this repo in VS Code
2. Press `F5` to launch Extension Development Host
3. In the new window, press `Ctrl+Shift+P` and type `OpenKits`

## Validation

```bash
node scripts/validate-mvp.js
node scripts/test-toolchain.js
```

## Architecture

Three-layer design:

1. **VS Code OSS distribution** — branded product, existing workbench unchanged
2. **OpenKits extension** — board selection, project creation, AI Agent chat, Diff-first patch review, build/flash commands
3. **OpenKits agent engine** — embedded-specific tool registry, workspace-bound permissions, human approval gates

## License

MIT
