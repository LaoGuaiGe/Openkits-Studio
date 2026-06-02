# Open Source Reference Map

This project should avoid rebuilding mature editor and agent infrastructure.
The MVP should reference these open-source projects and reuse their patterns
where licensing and integration fit.

## VS Code OSS Framework

Reference: <https://github.com/microsoft/vscode>

Use VS Code OSS as the desktop application framework and extension host model.
Important areas to study:

- `product.json` for branded product metadata.
- `extensions/` for built-in extension layout.
- `src/vs/workbench` for workbench composition.
- `src/vs/platform` for services such as configuration, files, terminal,
  dialogs, telemetry, storage, and commands.
- VS Code extension API for commands, tree views, webviews, terminal tasks,
  diff editor, diagnostics, and settings.

OpenKits Studio should keep Explorer, Monaco editor, terminal, Git, Diff,
Problems, and command palette intact. The OpenKits-owned code should live as
one or more built-in extensions plus a small runtime/toolchain service.

## Agent References

### Recommended Primary Reference: Cline

Reference: <https://github.com/cline/cline>

Cline is the closest shape for OpenKits Studio:

- VS Code extension surface.
- Shared agent core / SDK.
- CLI support.
- Tool use for reading files, editing files, and running terminal commands.
- Human-in-the-loop approval before file edits and commands.
- Diff review for agent edits.
- Multi-provider model support, including OpenAI-compatible APIs and local
  models.

OpenKits should study Cline's separation between the IDE UI and agent engine,
then replace the generic coding toolset with embedded-safe tools:

- `ReadProject`
- `SearchProject`
- `ReadFile`
- `ProposePatch`
- `RunBuild`
- `AnalyzeBuildLog`
- `DetectProbe`
- `FlashFirmware`

### Secondary Reference: Continue

Reference: <https://github.com/continuedev/continue>

Continue is useful for:

- Source-controlled agent/check definitions.
- Provider configuration patterns.
- Repository-level rules and checks.
- CLI integration.

It is less directly aligned with the OpenKits MVP than Cline because the first
MVP is an IDE-side build/flash assistant, not a CI-first PR check product.

### Secondary Reference: OpenHands

Reference: <https://github.com/OpenHands/OpenHands>

OpenHands is useful for:

- Agent SDK architecture.
- Sandboxed execution concepts.
- Long-running autonomous software engineering tasks.

It is heavier than the OpenKits MVP needs. Use it as a reference for sandbox
and agent orchestration, not as the default embedded IDE integration.

### Engine Reference: CodeWhale

Reference: <https://github.com/Hmbown/CodeWhale>

CodeWhale is a terminal-native Rust coding agent. It is not a VS Code extension,
so it should not be the primary OpenKits Studio UI base. It is useful as an
agent engine reference because it has:

- A typed tool registry for shell, file operations, Git, web, sub-agents, MCP,
  and persistent reasoning sessions.
- Approval gates for side-effectful operations.
- A plan/read-only mode and stronger execution modes.
- Post-edit LSP diagnostics feeding back into the next agent turn.
- A local HTTP/SSE runtime API for headless workflows.
- Side-git snapshots for turn-level restore.
- Rust binary packaging, which may fit a Windows desktop distribution better
  than a Node-only agent runtime.

The main OpenKits caveats are:

- It is DeepSeek-centered, while OpenKits needs a provider-neutral model layer.
- Its UI is terminal/TUI first, while OpenKits should surface actions through
  VS Code webviews, tasks, Diff, terminal, and Problems.
- Its Windows sandbox is described as not yet advertised as full containment,
  so OpenKits must implement its own Windows-safe command/file policy.
- It requires Rust 1.88+ if building from source.

Recommended use: study or adapt its engine concepts only. Do not use it as the
first MVP's primary IDE integration layer.

### Avoid As Primary Base: Roo Code

Reference: <https://github.com/RooCodeInc/Roo-Code>

Roo Code has useful ideas around agent modes, but the repository is archived.
It should be studied for patterns only, not adopted as a dependency.

### Useful CLI Reference: Aider

Reference: <https://github.com/Aider-AI/aider>

Aider is useful for:

- Codebase map / context selection.
- Git-aware edits.
- Terminal-first pair-programming workflow.
- Lint/test repair loop.

It is not the best primary base for OpenKits because OpenKits needs a native
VS Code sidebar, Diff, command palette, and embedded build/flash integration.

## Recommended OpenKits Architecture

OpenKits Studio should use a three-layer architecture:

1. VS Code OSS distribution
   - Branded product metadata.
   - Built-in OpenKits extension.
   - Existing workbench, editor, terminal, Git, Diff, and Problems.

2. OpenKits extension
   - Board selection.
   - Project creation.
   - AI Agent chat.
   - VS Code Diff-first patch review.
   - Build, flash, and toolchain commands.

3. OpenKits agent engine
   - Inspired by Cline's SDK/agent core split.
   - Embedded-specific tool registry.
   - Strict workspace-bound permission model.
   - Human approval gates for file writes, shell commands, and flashing.
   - Provider adapter layer for OpenAI, DeepSeek, Claude, OpenRouter, and
     OpenAI-compatible local endpoints.

## MVP Adoption Decision

For the 1-2 month MVP, do not fork an entire open-source agent project.
Instead:

- Reference Cline as the primary design model.
- Implement a small OpenKits-specific agent engine with the minimum tools.
- Keep the API shaped so Cline SDK or another open-source agent core can be
  swapped in later if license, bundle size, and Windows packaging are proven.
- Preserve all agent actions as explicit VS Code-visible operations:
  diff preview, terminal task, output channel, diagnostic marker, or command.
