import type { BootstrapReport } from "../../protocol/src/index.js";

export type AutomationItemKind = "auto" | "manual" | "warning" | "reuse" | "conflict" | "blocked";

export interface AutomationItem {
  id: string;
  kind: AutomationItemKind;
  message: string;
  solutions?: string[];
}

export interface GroupedAutomationItems {
  auto: AutomationItem[];
  manual: AutomationItem[];
  warning: AutomationItem[];
  reuse: AutomationItem[];
  conflict: AutomationItem[];
  blocked: AutomationItem[];
}

const GROUP_ORDER: AutomationItemKind[] = ["auto", "manual", "blocked", "reuse", "conflict", "warning"];

export function pushAutomationItem(items: AutomationItem[], item: AutomationItem): void {
  const existingIndex = items.findIndex((existing) => existing.id === item.id);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1, item);
    return;
  }

  items.push(item);
}

export function pushAutomationItems(items: AutomationItem[], next: readonly AutomationItem[]): void {
  for (const item of next) {
    pushAutomationItem(items, item);
  }
}

export function groupAutomationItems(items: readonly AutomationItem[]): GroupedAutomationItems {
  return {
    auto: items.filter((item) => item.kind === "auto"),
    manual: items.filter((item) => item.kind === "manual"),
    warning: items.filter((item) => item.kind === "warning"),
    reuse: items.filter((item) => item.kind === "reuse"),
    conflict: items.filter((item) => item.kind === "conflict"),
    blocked: items.filter((item) => item.kind === "blocked")
  };
}

export function legacyPlanPreviewFromAutomation(
  items: readonly AutomationItem[],
  includeKinds: readonly AutomationItemKind[] = ["manual", "blocked", "reuse", "conflict", "warning"]
): string[] {
  const kinds = new Set(includeKinds);
  return items
    .filter((item) => kinds.has(item.kind))
    .flatMap((item) => automationItemSteps(item));
}

export function legacyNextStepsFromAutomation(items: readonly AutomationItem[]): string[] {
  return legacyPlanPreviewFromAutomation(items, ["manual", "blocked"]);
}

function isAutomationItem(value: unknown): value is AutomationItem {
  const solutions = (value as AutomationItem | undefined)?.solutions;
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as AutomationItem).id === "string"
    && typeof (value as AutomationItem).kind === "string"
    && typeof (value as AutomationItem).message === "string"
    && (
      solutions === undefined
      || (Array.isArray(solutions) && solutions.every((solution) => typeof solution === "string"))
    );
}

export function onboardingItemsFromReport(report: BootstrapReport): AutomationItem[] {
  const onboarding = (report.reportJson as { onboarding?: { items?: unknown } }).onboarding;
  if (!onboarding || !Array.isArray(onboarding.items)) {
    return [];
  }

  return onboarding.items.filter(isAutomationItem);
}

export function orderedAutomationKinds(): AutomationItemKind[] {
  return [...GROUP_ORDER];
}

export function automationItemSteps(item: AutomationItem): string[] {
  const steps = [item.message.trim()];
  for (const solution of item.solutions ?? []) {
    const normalized = solution.trim();
    if (normalized) {
      steps.push(normalized);
    }
  }

  return steps.filter(Boolean);
}

export function automationItemRenderLines(item: AutomationItem): string[] {
  const lines = [`- ${item.message}`];
  for (const solution of item.solutions ?? []) {
    const normalized = solution.trim();
    if (normalized) {
      lines.push(`  - ${normalized}`);
    }
  }

  return lines;
}
