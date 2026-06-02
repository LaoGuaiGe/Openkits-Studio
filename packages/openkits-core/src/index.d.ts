export interface BoardPackage {
  id: string;
  name: string;
  family: string;
  vendor: string;
}

export interface ToolchainCheck {
  id: string;
  label: string;
  expectedPath: string;
  required: boolean;
  installed?: boolean;
}

export interface CommandSpec {
  command: string;
  args: string[];
  cwd: string;
}

export interface Builder {
  id: string;
  build(): CommandSpec;
  clean(): CommandSpec;
  rebuild(): CommandSpec;
}

export interface Flasher {
  id: string;
  detect(): CommandSpec;
  flash(): CommandSpec;
  verify(): CommandSpec;
}

export const BOARD_MSPM0G3519: BoardPackage;
export function getBundledBoards(): BoardPackage[];
export function getBoard(boardId: string): BoardPackage;
export function getDefaultRuntimeRoot(): string;
export function inspectToolchain(runtimeRoot?: string): ToolchainCheck[];
export function getMissingRequiredTools(runtimeRoot?: string): ToolchainCheck[];
