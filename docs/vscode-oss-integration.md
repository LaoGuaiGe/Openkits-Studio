# VS Code OSS Integration Strategy

OpenKits Studio ships as a branded VS Code OSS distribution plus a built-in
OpenKits extension.

## Reused VS Code Capabilities

- Monaco editor through VS Code workbench.
- Explorer file tree.
- Integrated terminal.
- Source Control / Git.
- Diff editor.
- Problems panel.
- Command palette.

## OpenKits-Owned Capabilities

- Board selection and board package loading.
- Project creation from SDK examples or templates.
- Toolchain detection and repair prompts.
- Build and flash commands.
- AI Agent chat view.
- Diff-first file modification workflow.

## Build Handoff

When the VS Code OSS source tree is added, use `product/openkits.product.json`
as the product metadata source and package `extensions/openkits-embedded` as a
built-in extension.
