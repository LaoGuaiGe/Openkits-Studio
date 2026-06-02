# Implementation Handoff

This repository now contains the OpenKits-owned part of the MVP. The VS Code
OSS source tree should consume it as a branded distribution, not as a custom
IDE rewrite.

## VS Code OSS Packaging Steps

1. Add or checkout the VS Code OSS source tree in the release workspace.
2. Use `product/openkits.product.json` as the product metadata baseline.
3. Apply `product/default-settings.json` as the bundled default settings.
4. Package `extensions/openkits-embedded` as a built-in extension.
5. Keep VS Code Explorer, editor, terminal, Git, Diff, Problems, and command
   palette unchanged.

## MVP Commands

- `OpenKits: Show Welcome`
- `OpenKits: Select Board`
- `OpenKits: Create MSPM0 Project`
- `OpenKits: Check Toolchain`
- `OpenKits: Build`
- `OpenKits: Flash`
- `OpenKits Agent: Preview ADC Patch`

## Current Adapter Status

- Board package: Tianqiaoxing MSPM0G3519.
- Build adapter: CCS gmake command spec scaffold.
- Flash adapter: XDS110 command spec scaffold.
- Toolchain manager: local runtime path inspection scaffold.
- Agent: webview and VS Code Diff-first patch preview scaffold.

The next implementation step is replacing the placeholder build and flash
commands in the extension with concrete paths resolved from the runtime manager.

## Open Source References

Use `docs/open-source-reference-map.md` before implementing the next agent
iteration. The recommended direction is VS Code OSS for the application
framework and Cline as the primary agent architecture reference.
