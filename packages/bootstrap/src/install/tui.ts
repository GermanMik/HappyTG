import readline from "node:readline";

import type { BackgroundMode, InstallRuntimeErrorDetail, InstallStepRecord, PostInstallCheck, RepoModeChoice, TelegramSetup } from "./types.js";
import { maskTelegramToken } from "./telegram.js";

const COLORS = {
  blue: "\u001B[38;2;77;163;255m",
  cyan: "\u001B[38;2;45;212;191m",
  violet: "\u001B[38;2;139;92;246m",
  text: "\u001B[38;2;230;241;255m",
  warn: "\u001B[38;2;251;191;36m",
  error: "\u001B[38;2;248;113;113m",
  info: "\u001B[38;2;148;163;184m",
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m"
} as const;

function tint(text: string, color: string): string {
  return `${color}${text}${COLORS.reset}`;
}

function bright(text: string): string {
  return tint(text, `${COLORS.bold}${COLORS.text}`);
}

function dim(text: string): string {
  return tint(text, COLORS.dim);
}

function statusIcon(status: "pass" | "warn" | "fail" | "info"): string {
  switch (status) {
    case "pass":
      return tint("✓", COLORS.cyan);
    case "warn":
      return tint("!", COLORS.warn);
    case "fail":
      return tint("x", COLORS.error);
    case "info":
    default:
      return tint("i", COLORS.blue);
  }
}

function clearScreen(stdout: NodeJS.WriteStream): void {
  stdout.write("\u001B[2J\u001B[H");
}

function header(title: string, subtitle: string): string[] {
  return [
    tint("HappyTG Installer", `${COLORS.bold}${COLORS.violet}`),
    bright(title),
    dim(subtitle),
    ""
  ];
}

function keyboardHints(extra?: string): string {
  return dim(`↑↓ navigate   SPACE toggle   ENTER confirm   ESC cancel${extra ? `   ${extra}` : ""}`);
}

function renderStatusBlock(items: Array<{ status: "pass" | "warn" | "fail" | "info"; label: string; detail: string }>): string[] {
  return items.flatMap((item) => [
    `${statusIcon(item.status)} ${bright(item.label)}`,
    `   ${item.detail}`
  ]);
}

function renderIndentedDetail(detail: string): string[] {
  return detail
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => `   ${line}`);
}

function renderOptions(options: Array<{ label: string; detail: string; active: boolean; selected?: boolean }>): string[] {
  return options.flatMap((option) => {
    const pointer = option.active ? tint("›", COLORS.cyan) : dim(" ");
    const selection = option.selected === undefined
      ? ""
      : option.selected
        ? tint("[x]", COLORS.cyan)
        : dim("[ ]");

    return [
      `${pointer} ${selection ? `${selection} ` : ""}${bright(option.label)}`,
      `   ${option.detail}`
    ];
  });
}

function renderFrame(lines: string[]): string {
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

export function renderWelcomeScreen(input: {
  osLabel: string;
  shell: string;
  packageManager: string;
  statuses: Array<{ status: "pass" | "warn" | "fail" | "info"; label: string; detail: string }>;
}): string {
  return renderFrame([
    ...header("Welcome / Preflight", `${input.osLabel}  |  shell ${input.shell}  |  installer ${input.packageManager}`),
    ...renderStatusBlock(input.statuses),
    "",
    keyboardHints("ENTER continue")
  ]);
}

export function renderRepoModeScreen(input: {
  choices: RepoModeChoice[];
  activeMode: string;
}): string {
  return renderFrame([
    ...header("Repo Mode", "Choose how HappyTG should get the workspace ready."),
    ...renderOptions(input.choices.map((choice) => ({
      label: choice.label,
      detail: choice.detail,
      active: choice.mode === input.activeMode
    }))),
    "",
    keyboardHints()
  ]);
}

export function renderDirtyWorktreeScreen(input: {
  active: "stash" | "keep" | "cancel";
  repoPath: string;
}): string {
  const options = [
    {
      id: "stash",
      label: "Stash local changes and update",
      detail: "Create a safety stash, then fetch and fast-forward the checkout."
    },
    {
      id: "keep",
      label: "Keep current checkout as-is",
      detail: "Do not pull. Continue install against the current local state."
    },
    {
      id: "cancel",
      label: "Cancel install",
      detail: "Stop here without touching the dirty worktree."
    }
  ] as const;

  return renderFrame([
    ...header("Dirty Worktree", `${input.repoPath} has local changes. Choose a safe path.`),
    ...renderOptions(options.map((option) => ({
      label: option.label,
      detail: option.detail,
      active: option.id === input.active
    }))),
    "",
    keyboardHints()
  ]);
}

export function renderTelegramScreen(input: {
  form: TelegramSetup;
  activeRow: number;
  editing: boolean;
}): string {
  const rows = [
    {
      label: "Bot token",
      value: input.form.botToken ? maskTelegramToken(input.form.botToken) : "<required>"
    },
    {
      label: "Allowed user IDs",
      value: input.form.allowedUserIds.length > 0 ? input.form.allowedUserIds.join(", ") : "<optional>"
    },
    {
      label: "Home channel",
      value: input.form.homeChannel || "<optional>"
    },
    {
      label: "Continue",
      value: input.editing ? "finish editing first" : "confirm Telegram setup"
    }
  ];

  return renderFrame([
    ...header("Telegram Setup", "Store bot access now so setup and later /pair flows do not stop on a missing token."),
    ...renderOptions(rows.map((row, index) => ({
      label: row.label,
      detail: row.value,
      active: index === input.activeRow
    }))),
    "",
    keyboardHints(input.editing ? "typing…" : "ENTER edit / confirm")
  ]);
}

export function renderBackgroundModeScreen(input: {
  platformLabel: string;
  activeMode: BackgroundMode;
  modes: Array<{ mode: BackgroundMode; label: string; detail: string }>;
}): string {
  return renderFrame([
    ...header("Background Run Mode", `${input.platformLabel} background daemon preference`),
    ...renderOptions(input.modes.map((mode) => ({
      label: mode.label,
      detail: mode.detail,
      active: mode.mode === input.activeMode
    }))),
    "",
    keyboardHints()
  ]);
}

export function renderPostCheckScreen(input: {
  activeIndex: number;
  selected: PostInstallCheck[];
}): string {
  const options: Array<{ id: PostInstallCheck; label: string; detail: string }> = [
    {
      id: "setup",
      label: "Run setup",
      detail: "Short first-run checklist for the selected checkout."
    },
    {
      id: "doctor",
      label: "Run doctor",
      detail: "Detailed machine-readiness report after install."
    },
    {
      id: "verify",
      label: "Run verify",
      detail: "Deeper verification pass. Often warns until infra is up."
    }
  ];

  return renderFrame([
    ...header("Post-Install Checks", "Use SPACE to toggle the unified flow steps you want to run now."),
    ...renderOptions(options.map((option, index) => ({
      label: option.label,
      detail: option.detail,
      active: index === input.activeIndex,
      selected: input.selected.includes(option.id)
    }))),
    "",
    keyboardHints()
  ]);
}

export function renderProgressScreen(input: {
  title: string;
  steps: InstallStepRecord[];
}): string {
  const lines = [
    ...header("Installation Progress", input.title)
  ];

  for (const step of input.steps) {
    const icon = step.status === "passed"
      ? tint("✓", COLORS.cyan)
      : step.status === "warn"
        ? tint("!", COLORS.warn)
        : step.status === "failed"
          ? tint("x", COLORS.error)
          : step.status === "running"
            ? tint("…", COLORS.violet)
            : step.status === "skipped"
              ? dim("-")
              : dim("·");
    lines.push(`${icon} ${bright(step.label)}`);
    lines.push(...renderIndentedDetail(step.detail));
  }

  lines.push("");
  lines.push(keyboardHints("progress is automatic"));
  return renderFrame(lines);
}

export function renderFailureScreen(input: {
  repoPath: string;
  error: InstallRuntimeErrorDetail;
}): string {
  return renderFrame([
    ...header("Installer Error", input.repoPath),
    ...renderStatusBlock([
      {
        status: "fail",
        label: input.error.message,
        detail: input.error.lastError
      },
      {
        status: input.error.retryable ? "warn" : "info",
        label: `Suggested action${input.error.attempts ? ` (${input.error.attempts} attempts)` : ""}`,
        detail: input.error.suggestedAction
      }
    ]),
    "",
    keyboardHints("ENTER close")
  ]);
}

function stripBracketedPasteMarkers(chunk: string): string {
  return chunk
    .replace(/\u001B\[200~?/gu, "")
    .replace(/\u001B\[201~?/gu, "");
}

function appendInputChunk(draft: string, chunk: string): string {
  const normalized = stripBracketedPasteMarkers(chunk);
  if (!normalized) {
    return draft;
  }

  return `${draft}${normalized}`;
}

export interface TelegramFormControllerState {
  form: TelegramSetup;
  activeRow: number;
  editing: boolean;
  draft: string;
}

export function createTelegramFormController(initial: TelegramSetup): TelegramFormControllerState {
  return {
    form: {
      botToken: initial.botToken,
      allowedUserIds: [...initial.allowedUserIds],
      homeChannel: initial.homeChannel
    },
    activeRow: 0,
    editing: false,
    draft: ""
  };
}

export function reduceTelegramFormKeypress(
  state: TelegramFormControllerState,
  input: {
    chunk: string;
    key: readline.Key;
  }
): {
  state: TelegramFormControllerState;
  done: boolean;
} {
  const fieldOrder = ["botToken", "allowedUserIds", "homeChannel", "continue"] as const;
  const next: TelegramFormControllerState = {
    form: {
      botToken: state.form.botToken,
      allowedUserIds: [...state.form.allowedUserIds],
      homeChannel: state.form.homeChannel
    },
    activeRow: state.activeRow,
    editing: state.editing,
    draft: state.draft
  };

  if (!next.editing) {
    if (input.key.name === "up") {
      next.activeRow = (next.activeRow - 1 + fieldOrder.length) % fieldOrder.length;
      return { state: next, done: false };
    }
    if (input.key.name === "down") {
      next.activeRow = (next.activeRow + 1) % fieldOrder.length;
      return { state: next, done: false };
    }
    if (input.key.name === "return") {
      if (fieldOrder[next.activeRow] === "continue") {
        if (!next.form.botToken.trim()) {
          next.activeRow = 0;
          return { state: next, done: false };
        }
        return { state: next, done: true };
      }

      next.editing = true;
      next.draft = fieldOrder[next.activeRow] === "botToken"
        ? next.form.botToken
        : fieldOrder[next.activeRow] === "allowedUserIds"
          ? next.form.allowedUserIds.join(", ")
          : next.form.homeChannel;
      return { state: next, done: false };
    }
    if (input.key.name === "escape" || (input.key.ctrl && input.key.name === "c")) {
      throw new Error("Installer cancelled.");
    }
    return { state: next, done: false };
  }

  if (input.key.name === "return") {
    if (fieldOrder[next.activeRow] === "botToken") {
      next.form.botToken = next.draft.trim();
    } else if (fieldOrder[next.activeRow] === "allowedUserIds") {
      next.form.allowedUserIds = next.draft.split(",").map((item) => item.trim()).filter(Boolean);
    } else if (fieldOrder[next.activeRow] === "homeChannel") {
      next.form.homeChannel = next.draft.trim();
    }
    next.editing = false;
    return { state: next, done: false };
  }
  if (input.key.name === "backspace") {
    next.draft = next.draft.slice(0, -1);
    return { state: next, done: false };
  }
  if (input.key.name === "escape") {
    next.editing = false;
    return { state: next, done: false };
  }
  if (input.chunk && !input.key.ctrl && !input.key.meta && input.key.name !== "tab") {
    next.draft = appendInputChunk(next.draft, input.chunk);
  }
  return { state: next, done: false };
}

export function renderSummaryScreen(input: {
  repoPath: string;
  warnings: string[];
  nextSteps: string[];
  backgroundDetail: string;
}): string {
  const lines = [
    ...header("Final Summary", input.repoPath),
    `${statusIcon("pass")} ${bright("Install flow is complete.")}`,
    `   ${input.backgroundDetail}`,
    ""
  ];

  if (input.warnings.length > 0) {
    lines.push(bright("Warnings"));
    lines.push(...input.warnings.map((warning) => `- ${warning}`));
    lines.push("");
  }

  lines.push(bright("Next steps"));
  lines.push(...input.nextSteps.map((step) => `- ${step}`));
  lines.push("");
  lines.push(keyboardHints("ENTER close"));
  return renderFrame(lines);
}

async function readKeypress(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  render: () => string,
  onKeypress: (chunk: string, key: readline.Key) => boolean
): Promise<void> {
  readline.emitKeypressEvents(stdin);
  const canRawMode = stdin.isTTY && typeof stdin.setRawMode === "function";

  if (canRawMode) {
    stdin.setRawMode(true);
  }

  clearScreen(stdout);
  stdout.write(render());

  await new Promise<void>((resolve, reject) => {
    const handler = (chunk: string, key: readline.Key) => {
      try {
        const done = onKeypress(chunk, key);
        clearScreen(stdout);
        stdout.write(render());
        if (done) {
          stdin.off("keypress", handler);
          resolve();
        }
      } catch (error) {
        stdin.off("keypress", handler);
        reject(error);
      }
    };

    stdin.on("keypress", handler);
  }).finally(() => {
    if (canRawMode) {
      stdin.setRawMode(false);
    }
  });
}

export async function promptSelect<T extends string>(input: {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  items: T[];
  initial: T;
  render: (active: T) => string;
}): Promise<T> {
  let activeIndex = Math.max(0, input.items.indexOf(input.initial));
  let confirmed = input.items[activeIndex] ?? input.initial;

  await readKeypress(input.stdin, input.stdout, () => input.render(input.items[activeIndex]!), (_chunk, key) => {
    if (key.name === "up") {
      activeIndex = (activeIndex - 1 + input.items.length) % input.items.length;
      return false;
    }
    if (key.name === "down") {
      activeIndex = (activeIndex + 1) % input.items.length;
      return false;
    }
    if (key.name === "return") {
      confirmed = input.items[activeIndex]!;
      return true;
    }
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      throw new Error("Installer cancelled.");
    }

    return false;
  });

  return confirmed;
}

export async function promptMultiSelect<T extends string>(input: {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  items: T[];
  initial: T[];
  render: (activeIndex: number, selected: T[]) => string;
}): Promise<T[]> {
  let activeIndex = 0;
  const selected = new Set(input.initial);

  await readKeypress(input.stdin, input.stdout, () => input.render(activeIndex, [...selected]), (_chunk, key) => {
    if (key.name === "up") {
      activeIndex = (activeIndex - 1 + input.items.length) % input.items.length;
      return false;
    }
    if (key.name === "down") {
      activeIndex = (activeIndex + 1) % input.items.length;
      return false;
    }
    if (key.name === "space") {
      const item = input.items[activeIndex]!;
      if (selected.has(item)) {
        selected.delete(item);
      } else {
        selected.add(item);
      }
      return false;
    }
    if (key.name === "return") {
      return true;
    }
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      throw new Error("Installer cancelled.");
    }
    return false;
  });

  return [...selected];
}

export async function promptTelegramForm(input: {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  initial: TelegramSetup;
}): Promise<TelegramSetup> {
  let controller = createTelegramFormController(input.initial);

  await readKeypress(
    input.stdin,
    input.stdout,
    () => renderTelegramScreen({
      form: controller.editing
        ? {
          botToken: controller.activeRow === 0 ? controller.draft : controller.form.botToken,
          allowedUserIds: controller.activeRow === 1 ? controller.draft.split(",").map((item) => item.trim()).filter(Boolean) : controller.form.allowedUserIds,
          homeChannel: controller.activeRow === 2 ? controller.draft : controller.form.homeChannel
        }
        : controller.form,
      activeRow: controller.activeRow,
      editing: controller.editing
    }),
    (chunk, key) => {
      const reduced = reduceTelegramFormKeypress(controller, { chunk, key });
      controller = reduced.state;
      return reduced.done;
    }
  );

  return controller.form;
}

export function renderProgress(stdout: NodeJS.WriteStream, title: string, steps: InstallStepRecord[]): void {
  clearScreen(stdout);
  stdout.write(renderProgressScreen({
    title,
    steps
  }));
}

export async function waitForEnter(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream, screen: string): Promise<void> {
  await readKeypress(stdin, stdout, () => screen, (_chunk, key) => {
    if (key.name === "return") {
      return true;
    }
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      throw new Error("Installer cancelled.");
    }
    return false;
  });
}
