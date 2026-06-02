# OpenKits Studio MVP Acceptance

OpenKits Studio MVP succeeds when a clean Windows machine can install the app
and complete this flow without manually configuring Node, Git, SDK, compiler,
or flasher paths:

1. Launch OpenKits Studio.
2. Select Tianqiaoxing MSPM0G3519.
3. Create an MSPM0 project.
4. Ask the AI Agent to add ADC sampling.
5. Review generated changes in VS Code Diff.
6. Accept the changes.
7. Build with the CCS compiler / gmake flow.
8. Flash with XDS110.
9. Confirm firmware runs on the board.

## Non Goals

- Custom editor.
- Custom file tree.
- Custom terminal.
- Custom Git UI.
- Custom Diff UI.
- Full Keil or CCS replacement.
- Debugger, waveform analysis, RTOS visualization, or graphical pinmux UI.
