import readline from "node:readline";

import { automationItemRenderLines, groupAutomationItems, type AutomationItem } from "../finalization.js";
import type {
  BackgroundMode,
  InstallOutcome,
  InstallRuntimeErrorDetail,
  InstallStepRecord,
  PostInstallCheck,
  RepoModeChoice,
  TelegramSetup
} from "./types.js";
import { normalizeTelegramAllowedUserIds, validateTelegramBotToken } from "./telegram.js";

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

function finalActionHints(actionLabel: string): string {
  return keyboardHints(`ENTER ${actionLabel}`);
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

function pushUniqueLine(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized || lines.includes(normalized)) {
    return;
  }

  lines.push(normalized);
}

function appendAutomationSection(lines: string[], title: string, items: readonly AutomationItem[]): void {
  if (items.length === 0) {
    return;
  }

  lines.push(bright(title));
  for (const item of items) {
    lines.push(...automationItemRenderLines(item));
  }
  lines.push("");
}

function appendWarningSection(lines: string[], warnings: readonly string[], warningItems: readonly AutomationItem[]): void {
  const rendered: string[] = [];
  const seen = new Set<string>();

  for (const warning of warnings) {
    const normalized = warning.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    rendered.push(`- ${normalized}`);
    seen.add(normalized);
  }

  for (const item of warningItems) {
    const normalized = item.message.trim();
    if (!normalized) {
      continue;
    }

    if (!seen.has(normalized)) {
      rendered.push(...automationItemRenderLines(item));
      seen.add(normalized);
      continue;
    }

    for (const solution of item.solutions ?? []) {
      const normalizedSolution = solution.trim();
      if (normalizedSolution) {
        rendered.push(`  - ${normalizedSolution}`);
      }
    }
  }

  if (rendered.length === 0) {
    return;
  }

  lines.push(bright("Warnings"));
  lines.push(...rendered);
  lines.push("");
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

export function renderMaskedSecretPreview(rawValue: string): string {
  const normalized = stripBracketedPasteMarkers(rawValue).replace(/[\r\n]/gu, "").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= 8) {
    return "*".repeat(normalized.length);
  }

  return `${normalized.slice(0, 4)}${"*".repeat(normalized.length - 8)}${normalized.slice(-4)}`;
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
  validationMessage?: string;
}): string {
  const rows = [
    {
      label: "Bot token",
      value: input.form.botToken ? renderMaskedSecretPreview(input.form.botToken) : "<required>"
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
    ...(input.validationMessage
      ? [
        "",
        `${statusIcon("warn")} ${bright("Validation")}`,
        `   ${input.validationMessage}`
      ]
      : []),
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

export function renderPortConflictScreen(input: {
  serviceLabel: string;
  occupiedPort: number;
  detectedOwner: string;
  classification: string;
  detail: string;
  suggestedPorts: number[];
  overrideEnv: string;
  envFilePath: string;
  activeChoice: string;
}): string {
  const options = [
    ...input.suggestedPorts.map((port) => ({
      id: `use:${port}`,
      label: `Use ${port}`,
      detail: `Save \`${input.overrideEnv}=${port}\` in \`${input.envFilePath}\` and continue.`
    })),
    {
      id: "manual",
      label: "Enter custom port",
      detail: `Type your own port and save it as \`${input.overrideEnv}\` in \`${input.envFilePath}\`.`
    },
    {
      id: "abort",
      label: "Abort install",
      detail: "Stop here without changing the planned HappyTG ports."
    }
  ];

  const lines = [
    ...header("Port Conflict", `${input.serviceLabel} cannot use occupied port ${input.occupiedPort}. Choose an explicit next step.`),
    `${statusIcon("warn")} ${bright("Detected owner")}`,
    `   ${input.detectedOwner}`,
    `${statusIcon("warn")} ${bright("Classification")}`,
    `   ${input.classification}`,
    `${statusIcon("info")} ${bright("Detail")}`,
    `   ${input.detail}`,
    `${statusIcon("info")} ${bright("Nearest free ports")}`,
    `   ${input.suggestedPorts.length > 0 ? input.suggestedPorts.join(", ") : "No nearby free ports detected automatically."}`,
    `${statusIcon("info")} ${bright("Config write")}`,
    `   Installer will save the selected override as \`${input.overrideEnv}\` in \`${input.envFilePath}\`.`,
    "",
    ...renderOptions(options.map((option) => ({
      label: option.label,
      detail: option.detail,
      active: option.id === input.activeChoice
    }))),
    "",
    keyboardHints()
  ];

  return renderFrame(lines);
}

export function renderPortValueScreen(input: {
  serviceLabel: string;
  occupiedPort: number;
  overrideEnv: string;
  envFilePath: string;
  suggestedPorts: number[];
  draft: string;
  validationMessage?: string;
}): string {
  return renderFrame([
    ...header("Custom Port", `${input.serviceLabel} needs an explicit replacement for occupied port ${input.occupiedPort}.`),
    `${statusIcon("info")} ${bright("Save target")}`,
    `   \`${input.overrideEnv}\` in \`${input.envFilePath}\``,
    `${statusIcon("info")} ${bright("Nearest free ports")}`,
    `   ${input.suggestedPorts.length > 0 ? input.suggestedPorts.join(", ") : "No nearby free ports detected automatically."}`,
    `${statusIcon("info")} ${bright("Port value")}`,
    `   ${input.draft || "<enter port>"}`,
    ...(input.validationMessage
      ? [
        "",
        `${statusIcon("warn")} ${bright("Validation")}`,
        `   ${input.validationMessage}`
      ]
      : []),
    "",
    keyboardHints("typing...   ESC back")
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
            ? tint(">", COLORS.violet)
            : step.status === "skipped"
              ? dim("-")
              : dim(".");
    const label = step.status === "passed"
      ? tint(step.label, `${COLORS.bold}${COLORS.cyan}`)
      : step.status === "warn"
        ? tint(step.label, `${COLORS.bold}${COLORS.warn}`)
        : step.status === "failed"
          ? tint(step.label, `${COLORS.bold}${COLORS.error}`)
          : step.status === "running"
            ? tint(step.label, `${COLORS.bold}${COLORS.violet}`)
            : bright(step.label);
    lines.push(`${icon} ${label}`);
    lines.push(...renderIndentedDetail(step.detail));
  }

  lines.push("");
  lines.push(keyboardHints("progress is automatic"));
  return renderFrame(lines);
}

function finalHeadline(outcome: InstallOutcome): string {
  switch (outcome) {
    case "success":
      return "Install flow is complete.";
    case "success-with-warnings":
      return "Install flow is complete with warnings.";
    case "recoverable-failure":
      return "Install finished with recoverable issues.";
    case "fatal-failure":
    default:
      return "Installer stopped before completion.";
  }
}

function finalTitle(outcome: InstallOutcome): string {
  switch (outcome) {
    case "success":
    case "success-with-warnings":
      return "Final Summary";
    case "recoverable-failure":
      return "Needs Attention";
    case "fatal-failure":
    default:
      return "Installer Error";
  }
}

function finalHeadlineStatus(outcome: InstallOutcome): "pass" | "warn" | "fail" {
  switch (outcome) {
    case "success":
      return "pass";
    case "success-with-warnings":
      return "warn";
    case "recoverable-failure":
    case "fatal-failure":
    default:
      return "fail";
  }
}

export function renderFinalScreen(input: {
  outcome: InstallOutcome;
  repoPath: string;
  detail: string;
  finalizationItems?: AutomationItem[];
  warnings: string[];
  nextSteps: string[];
  suggestedAction?: string;
  closeLabel?: string;
}): string {
  const lines = [
    ...header(finalTitle(input.outcome), input.repoPath),
    `${statusIcon(finalHeadlineStatus(input.outcome))} ${bright(finalHeadline(input.outcome))}`,
    ...renderIndentedDetail(input.detail),
    ""
  ];

  if (input.suggestedAction) {
    lines.push(bright("Action"));
    lines.push(`- ${input.suggestedAction}`);
    lines.push("");
  }

  const grouped = input.finalizationItems ? groupAutomationItems(input.finalizationItems) : undefined;

  appendAutomationSection(lines, "Auto-run", grouped?.auto ?? []);
  appendAutomationSection(lines, "Requires user", grouped?.manual ?? []);
  appendAutomationSection(lines, "Blocked", grouped?.blocked ?? []);
  appendAutomationSection(lines, "Reuse", grouped?.reuse ?? []);
  appendAutomationSection(lines, "Conflicts", grouped?.conflict ?? []);
  appendWarningSection(lines, input.warnings, grouped?.warning ?? []);

  if (!grouped && input.nextSteps.length > 0) {
    lines.push(bright("Next steps"));
    lines.push(...input.nextSteps.map((step) => `- ${step}`));
    lines.push("");
  }

  lines.push(finalActionHints(input.closeLabel ?? "close"));
  return renderFrame(lines);
}

export function renderFailureScreen(input: {
  outcome: Extract<InstallOutcome, "recoverable-failure" | "fatal-failure">;
  repoPath: string;
  error: InstallRuntimeErrorDetail;
  finalizationItems?: AutomationItem[];
  warnings?: string[];
  nextSteps?: string[];
}): string {
  return renderFinalScreen({
    outcome: input.outcome,
    repoPath: input.repoPath,
    detail: input.error.lastError,
    finalizationItems: input.finalizationItems,
    warnings: input.warnings ?? [],
    nextSteps: input.nextSteps ?? [],
    suggestedAction: input.error.suggestedAction
  });
}

function stripBracketedPasteMarkers(chunk: string): string {
  return chunk
    .replace(/\u001B\[200~?/gu, "")
    .replace(/\u001B\[201~?/gu, "");
}

const TELEGRAM_FIELD_ORDER = ["botToken", "allowedUserIds", "homeChannel", "continue"] as const;
type TelegramField = typeof TELEGRAM_FIELD_ORDER[number];
type EditableTelegramField = Exclude<TelegramField, "continue">;

function activeTelegramField(activeRow: number): TelegramField {
  return TELEGRAM_FIELD_ORDER[activeRow] ?? "continue";
}

function draftForTelegramField(form: TelegramSetup, field: EditableTelegramField): string {
  if (field === "botToken") {
    return form.botToken;
  }
  if (field === "allowedUserIds") {
    return form.allowedUserIds.join(", ");
  }
  return form.homeChannel;
}

function parseInputChunk(chunk: string): { text: string; submit: boolean } {
  const normalized = stripBracketedPasteMarkers(chunk);
  const trailingNewlines = normalized.match(/[\r\n]+$/u)?.[0] ?? "";
  return {
    text: trailingNewlines ? normalized.slice(0, -trailingNewlines.length) : normalized,
    submit: trailingNewlines.length > 0
  };
}

function appendInputChunk(field: EditableTelegramField, draft: string, chunk: string): string {
  const normalized = field === "allowedUserIds"
    ? chunk.replace(/[\r\n]+/gu, ", ")
    : chunk.replace(/[\r\n]+/gu, "");
  if (!normalized) {
    return draft;
  }

  return `${draft}${normalized}`;
}

function commitTelegramDraft(state: TelegramFormControllerState, field: EditableTelegramField): void {
  if (field === "botToken") {
    state.form.botToken = state.draft.trim();
    state.validationMessage = validateTelegramBotToken(state.form.botToken);
    return;
  }

  if (field === "allowedUserIds") {
    state.form.allowedUserIds = normalizeTelegramAllowedUserIds([state.draft]);
    return;
  }

  state.form.homeChannel = state.draft.trim();
}

export interface TelegramFormControllerState {
  form: TelegramSetup;
  activeRow: number;
  editing: boolean;
  draft: string;
  validationMessage?: string;
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
    draft: "",
    validationMessage: undefined
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
  const next: TelegramFormControllerState = {
    form: {
      botToken: state.form.botToken,
      allowedUserIds: [...state.form.allowedUserIds],
      homeChannel: state.form.homeChannel
    },
    activeRow: state.activeRow,
    editing: state.editing,
    draft: state.draft,
    validationMessage: state.validationMessage
  };

  if (!next.editing) {
    if (input.key.name === "up") {
      next.activeRow = (next.activeRow - 1 + TELEGRAM_FIELD_ORDER.length) % TELEGRAM_FIELD_ORDER.length;
      return { state: next, done: false };
    }
    if (input.key.name === "down") {
      next.activeRow = (next.activeRow + 1) % TELEGRAM_FIELD_ORDER.length;
      return { state: next, done: false };
    }
    if (input.key.name === "return") {
      const activeField = activeTelegramField(next.activeRow);
      if (activeField === "continue") {
        const validationMessage = validateTelegramBotToken(next.form.botToken);
        if (validationMessage) {
          next.activeRow = 0;
          next.validationMessage = validationMessage;
          return { state: next, done: false };
        }
        return { state: next, done: true };
      }

      next.editing = true;
      next.validationMessage = undefined;
      next.draft = draftForTelegramField(next.form, activeField);
      return { state: next, done: false };
    }
    if (input.key.name === "escape" || (input.key.ctrl && input.key.name === "c")) {
      throw new Error("Installer cancelled.");
    }
    return { state: next, done: false };
  }

  const activeField = activeTelegramField(next.activeRow);
  const parsedChunk = input.chunk && !input.key.ctrl && !input.key.meta && input.key.name !== "tab"
    ? parseInputChunk(input.chunk)
    : {
      text: "",
      submit: false
    };

  if (input.key.name === "backspace") {
    next.draft = next.draft.slice(0, -1);
    if (activeField === "botToken") {
      next.validationMessage = undefined;
    }
    return { state: next, done: false };
  }
  if (input.key.name === "escape") {
    next.editing = false;
    return { state: next, done: false };
  }
  if (activeField !== "continue" && parsedChunk.text) {
    next.draft = appendInputChunk(activeField, next.draft, parsedChunk.text);
    if (activeField === "botToken") {
      next.validationMessage = undefined;
    }
  }
  if (input.key.name === "return" || parsedChunk.submit) {
    if (activeField !== "continue") {
      commitTelegramDraft(next, activeField);
    }
    next.editing = false;
    return { state: next, done: false };
  }
  return { state: next, done: false };
}

export function renderSummaryScreen(input: {
  outcome: InstallOutcome;
  repoPath: string;
  finalizationItems?: AutomationItem[];
  warnings: string[];
  nextSteps: string[];
  detail: string;
  suggestedAction?: string;
}): string {
  return renderFinalScreen({
    outcome: input.outcome,
    repoPath: input.repoPath,
    detail: input.detail,
    finalizationItems: input.finalizationItems,
    warnings: input.warnings,
    nextSteps: input.nextSteps,
    suggestedAction: input.suggestedAction
  });
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
        if (done) {
          stdin.off("keypress", handler);
          resolve();
          return;
        }
        clearScreen(stdout);
        stdout.write(render());
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
          allowedUserIds: controller.activeRow === 1 ? normalizeTelegramAllowedUserIds([controller.draft]) : controller.form.allowedUserIds,
          homeChannel: controller.activeRow === 2 ? controller.draft : controller.form.homeChannel
        }
        : controller.form,
      activeRow: controller.activeRow,
      editing: controller.editing,
      validationMessage: controller.validationMessage
    }),
    (chunk, key) => {
      const reduced = reduceTelegramFormKeypress(controller, { chunk, key });
      controller = reduced.state;
      return reduced.done;
    }
  );

  return controller.form;
}

export async function promptPortValue(input: {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  serviceLabel: string;
  occupiedPort: number;
  overrideEnv: string;
  envFilePath: string;
  suggestedPorts: number[];
  validate: (value: string) => string | undefined;
}): Promise<number | undefined> {
  let draft = "";
  let validationMessage: string | undefined;
  let confirmed: number | undefined;
  let wentBack = false;

  await readKeypress(
    input.stdin,
    input.stdout,
    () => renderPortValueScreen({
      serviceLabel: input.serviceLabel,
      occupiedPort: input.occupiedPort,
      overrideEnv: input.overrideEnv,
      envFilePath: input.envFilePath,
      suggestedPorts: input.suggestedPorts,
      draft,
      validationMessage
    }),
    (chunk, key) => {
      const parsedChunk = chunk && !key.ctrl && !key.meta && key.name !== "tab"
        ? parseInputChunk(chunk)
        : {
          text: "",
          submit: false
        };

      if (key.name === "backspace") {
        draft = draft.slice(0, -1);
        validationMessage = undefined;
        return false;
      }
      if (key.name === "escape") {
        wentBack = true;
        return true;
      }
      if (parsedChunk.text) {
        draft = `${draft}${parsedChunk.text.replace(/[^\d]/gu, "")}`;
        validationMessage = undefined;
      }
      if (key.name === "return" || parsedChunk.submit) {
        validationMessage = input.validate(draft);
        if (validationMessage) {
          return false;
        }
        confirmed = Number(draft.trim());
        return true;
      }

      return false;
    }
  );

  return wentBack ? undefined : confirmed;
}

export async function promptPortConflictResolution(input: {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  serviceLabel: string;
  occupiedPort: number;
  detectedOwner: string;
  classification: string;
  detail: string;
  suggestedPorts: number[];
  overrideEnv: string;
  envFilePath: string;
  validateManualPort: (value: string) => string | undefined;
}): Promise<number | undefined> {
  const choices = [
    ...input.suggestedPorts.map((port) => `use:${port}`),
    "manual",
    "abort"
  ] as const;

  while (true) {
    const selected = await promptSelect({
      stdin: input.stdin,
      stdout: input.stdout,
      items: [...choices],
      initial: choices[0] ?? "manual",
      render: (activeChoice) => renderPortConflictScreen({
        serviceLabel: input.serviceLabel,
        occupiedPort: input.occupiedPort,
        detectedOwner: input.detectedOwner,
        classification: input.classification,
        detail: input.detail,
        suggestedPorts: input.suggestedPorts,
        overrideEnv: input.overrideEnv,
        envFilePath: input.envFilePath,
        activeChoice
      })
    });

    if (selected === "abort") {
      return undefined;
    }
    if (selected === "manual") {
      const manualPort = await promptPortValue({
        stdin: input.stdin,
        stdout: input.stdout,
        serviceLabel: input.serviceLabel,
        occupiedPort: input.occupiedPort,
        overrideEnv: input.overrideEnv,
        envFilePath: input.envFilePath,
        suggestedPorts: input.suggestedPorts,
        validate: input.validateManualPort
      });
      if (manualPort !== undefined) {
        return manualPort;
      }
      continue;
    }

    return Number(selected.slice("use:".length));
  }
}

export function renderProgress(stdout: NodeJS.WriteStream, title: string, steps: InstallStepRecord[]): void {
  clearScreen(stdout);
  stdout.write(renderProgressScreen({
    title,
    steps
  }));
}

function isConfirmKey(chunk: string, key: readline.Key): boolean {
  return key.name === "return" || key.name === "enter" || chunk === "\r" || chunk === "\n";
}

export async function waitForEnter(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream, screen: string): Promise<void> {
  await readKeypress(stdin, stdout, () => screen, (_chunk, key) => {
    if (isConfirmKey(_chunk, key)) {
      return true;
    }
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      throw new Error("Installer cancelled.");
    }
    return false;
  });
}
