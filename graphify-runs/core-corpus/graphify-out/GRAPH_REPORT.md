# Graph Report - core-corpus  (2026-07-11)

## Corpus Check
- 110 files · ~164,263 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2041 nodes · 4936 edges · 92 communities (91 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 116 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 89
- Community 90
- CORPUS_MANIFEST.md

## God Nodes (most connected - your core abstractions)
1. `runHappyTGInstall()` - 92 edges
2. `HappyTGControlPlaneService` - 64 edges
3. `nowIso()` - 54 edges
4. `createMiniAppServer()` - 51 edges
5. `resolveExecutable()` - 37 edges
6. `CodexDesktopStateAdapter` - 33 edges
7. `escapeHtml()` - 30 edges
8. `getLocalStateDir()` - 28 edges
9. `detectFindings()` - 26 edges
10. `fileExists()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `createDefaultSendTelegramMessage()` --indirect_call--> `text()`  [INFERRED]
  apps/bot/src/index.ts → packages/shared/src/index.ts
- `currentTimestamp()` --calls--> `nowIso()`  [EXTRACTED]
  apps/worker/src/reconcile.ts → packages/shared/src/index.ts
- `createApiServer()` --calls--> `createDevCorsOptions()`  [EXTRACTED]
  apps/api/src/index.ts → packages/shared/src/index.ts
- `createApiServer()` --calls--> `getControlPlaneStorePath()`  [EXTRACTED]
  apps/api/src/index.ts → packages/shared/src/index.ts
- `createApiServer()` --calls--> `renderPrometheusMetrics()`  [EXTRACTED]
  apps/api/src/index.ts → packages/shared/src/index.ts

## Import Cycles
- None detected.

## Communities (92 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (103): appendUserId(), approvalActionButton(), AppShellStatus, AppShellStatusItem, attentionLabel(), BadgeTone, buildMiniAppTaskPrompt(), codexPanelHref() (+95 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (73): pushAutomationItem(), pushAutomationItems(), addNpmGlobalBinToPath(), AppliedPortOverride, backgroundOptionsForPlatform(), bootstrapPortReports(), bootstrapReportSignature(), bootstrapReportSummary() (+65 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (48): BootstrapCommand, buildWindowsShellCommand(), canConnect(), CodexInstallCheck, CodexReadinessResolution, criticalPortDefinitions, detectCodexInstallCheck(), detectCriticalPorts() (+40 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (50): approvalActionLabel(), approvalCallbackData(), codexMenuKeyboard(), createBotHandlers(), defaultMiniAppBaseUrl(), desktopProjectsKeyboard(), desktopSessionCallbackRef(), desktopSessionKeyboard() (+42 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (54): createInstallRuntimeError(), detailFromUnknown(), isInstallRuntimeError(), isRetryableCommandOutput(), isRetryableRepoFailureMessage(), repoFailureCode(), repoFailureSuggestedAction(), toInstallRuntimeErrorDetail() (+46 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (32): ApiStartupResult, logger, port, CodexDesktopControlError, defaultRepoProofOperations, ensureMiniAppCollections(), makePairingCode(), miniAppLaunchSecret() (+24 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (14): approvalCard(), hostCard(), isTerminalSessionState(), projectCard(), reportCards(), scopedMiniAppStore(), sessionCard(), MiniAppApprovalCard (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (41): CodexDesktopHistoryEntry, appServerHistoryFromThread(), AppServerThread, AppServerThreadListResponse, AppServerThreadResponse, AppServerThreadStatus, appServerThreadTitle(), appServerThreadUpdatedAt() (+33 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (41): botEnvironment, BotStartupResult, clearWindowsPowerShellTelegramApiPreference(), close(), createBotRuntime(), createBotServer(), createDefaultApiFetch(), createDefaultSendTelegramMessage() (+33 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (48): appendAutomationSection(), appendWarningSection(), bright(), clearScreen(), COLORS, dim(), EditableTelegramField, ExistingEnvReuseChoice (+40 more)

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (7): listenOnRandomPort(), CodexAppServerJsonRpcClient, isJavaScriptEntrypoint(), jsonRpcErrorMessage(), PendingJsonRpcRequest, retainTail(), listenTestServer()

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (41): defineHook(), executeHook(), HookPoint, createDefaultPolicies(), evaluatePolicies(), findMatchingRules(), LAYER_ORDER, policyAppliesToScope() (+33 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (38): DOM, ES2022, node, packages/approval-engine/src, packages/bootstrap/src, packages/hooks/src, packages/policy-engine/src, packages/protocol/src (+30 more)

### Community 13 - "Community 13"
Cohesion: 0.10
Nodes (34): ackDispatch(), apiFetch(), compactJournal(), completeDispatch(), DaemonJournal, DaemonState, DaemonWorkspace, heartbeat() (+26 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (35): devDependencies, tsx, turbo, @types/node, typescript, turbo, name, packageManager (+27 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (24): appendAudit(), appendEvent(), assertHostUserAccess(), ensurePolicies(), getHostRecord(), getHostWorkspace(), getOrCreateUser(), makeDispatch() (+16 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (29): botConfigurationMessage(), hydrateTelegramTokenFromEnvFile(), initializeBotEnvironment(), CaddyRoutePreflight, checkCaddyMiniAppRoute(), envValue(), firstMeaningfulBodyDetail(), hasHappyTGMiniAppIdentity() (+21 more)

### Community 17 - "Community 17"
Cohesion: 0.17
Nodes (28): RepoProofOperations, saveJournal(), TaskPhase, VerificationState, advanceTaskPhase(), CANONICAL_REQUIRED_FILES, defaultArtifactManifest(), freezeTaskSpec() (+20 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (23): clearStartupNotice(), configuredBotTarget(), defaultFingerprint(), defaultWorkspaces(), emitStartupNotice(), firstRunGuidance(), hello(), hostNotPairedMessage() (+15 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (31): appendAutomationSection(), appendAutomationSections(), appendWarningSection(), CliRequest, CliUsageError, collectWarningMessages(), executeHappyTG(), findingLabel() (+23 more)

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (31): commandOutput(), commandResult(), COMPOSE_PORT_OVERRIDES, composeArgs(), composeCommand(), composeDisplayPrefix(), composeFileArgs(), composeHealthCheck() (+23 more)

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (17): AutomationItem, AutomationItemKind, automationItemSteps(), GROUP_ORDER, GroupedAutomationItems, isAutomationItem(), legacyNextStepsFromAutomation(), legacyPlanPreviewFromAutomation() (+9 more)

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (25): ActionKind, RuntimeExecutionResult, ToolCategory, ACTION_TOOL_CATEGORIES, BENIGN_CODEX_SMOKE_WARNING_PATTERNS, BoundedOutputBuffer, buildWindowsShellCommand(), checkCodexReadiness() (+17 more)

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (25): appendEvent(), compactArray(), compactControlPlaneRecords(), ControlPlaneCompactionConfig, ControlPlaneCompactionResult, currentTimestamp(), findLatestDispatch(), hasRetentionElapsed() (+17 more)

### Community 24 - "Community 24"
Cohesion: 0.17
Nodes (21): BackgroundResetCommandRecord, BackgroundResetResult, configureBackgroundMode(), configureLaunchAgent(), configureScheduledTask(), configureStartupShortcut(), configureSystemdUser(), defaultBackgroundArtifacts() (+13 more)

### Community 25 - "Community 25"
Cohesion: 0.20
Nodes (17): createApiServer(), authorizationToken(), CodexDesktopProxyHttpError, createCodexDesktopHostProxyServer(), createDefaultCodexDesktopAdapter(), isLoopbackBindHost(), proxyErrorPayload(), proxyErrorStatus() (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.04
Nodes (43): Architecture Invariants, Canonical Proof Bundle, Done criteria, Engineering rules, Existing project approach, External Discipline Sources, graphify, Graphify (+35 more)

### Community 27 - "Community 27"
Cohesion: 0.11
Nodes (30): buildCodexDesktopDockerPlan(), buildDockerServiceStrategyPlan(), buildSystemCaddyPlan(), candidateCaddyfilePaths(), COMPOSE_APP_SERVICES, COMPOSE_APP_SERVICES_WITH_CADDY, detectExistingHappyTGCaddy(), dockerHostPath() (+22 more)

### Community 28 - "Community 28"
Cohesion: 0.20
Nodes (23): bootstrapRepoScope(), cleanupBackgroundArtifacts(), cleanupFailureMessage(), createUninstallFailureResult(), defaultLauncherPath(), defaultLocalStateDir(), detectRepoRoot(), normalizeComparePath() (+15 more)

### Community 29 - "Community 29"
Cohesion: 0.08
Nodes (35): AuditRecord, CorsOptions, createDevCorsOptions(), effectiveHomeDirectory(), envKeyFor(), envPathExtValue(), envPathValue(), envValue() (+27 more)

### Community 30 - "Community 30"
Cohesion: 0.17
Nodes (14): TelegramPollingController, createWorkerRuntime(), delay(), detectPortOccupant(), formatWorkerPortConflictMessageDetailed(), formatWorkerPortReuseMessage(), port, PortOccupantInfo (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.09
Nodes (22): bin, happytg, happytg-bootstrap, main, name, private, scripts, build (+14 more)

### Community 32 - "Community 32"
Cohesion: 0.06
Nodes (26): delay(), detectHappyTGServiceOnPort(), formatApiPortConflictMessage(), formatApiPortReuseMessage(), startApiServer(), desktopSession(), delay(), waitForCondition() (+18 more)

### Community 33 - "Community 33"
Cohesion: 0.21
Nodes (11): describeTelegramFetchError(), errorCode(), errorMessage(), fetchTelegramBotIdentity(), FetchTelegramBotIdentityOptions, networkFollowUpMessage(), TelegramFetchErrorDescription, TelegramFetchErrorKind (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.14
Nodes (10): classifyActionKind(), planToolExecutionBatches(), batchQuote(), createCodexHarness(), createStrictWindowsCodexShim(), createWindowsCodexShim(), shellQuote(), writeExecutable() (+2 more)

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (21): ^build, dist/**, ^lint, .next/**, ^test, ^typecheck, dependsOn, outputs (+13 more)

### Community 36 - "Community 36"
Cohesion: 0.19
Nodes (16): EventName, SessionEvent, SessionState, assertSessionTransition(), canTransitionSession(), InvalidSessionTransitionError, isTerminalSessionState(), nextResumeState() (+8 more)

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (8): BotDependencies, detectPortOccupant(), formatBotPortConflictMessageDetailed(), formatBotPortReuseMessage(), inspectTelegramWebhookDelivery(), startBotServer(), closeServer(), error()

### Community 38 - "Community 38"
Cohesion: 0.24
Nodes (9): batchQuote(), isWslBashLauncher(), makeWindowsBootstrapHarness(), REPO_ROOT, resolveBash(), resolvePowerShell(), toBashPath(), writeWindowsCommand() (+1 more)

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (17): current_node_probe(), has_ignored_build_scripts_warning(), log(), node_probe(), path_within(), run_root(), run_shared_installer(), install.sh script (+9 more)

### Community 40 - "Community 40"
Cohesion: 0.21
Nodes (19): Describe-NodeFailure(), Get-NodePreloadFailure(), Get-NodeProbe(), Get-PnpmExecutable(), Invoke-PnpmCaptured(), Invoke-PnpmPassthrough(), Invoke-SharedInstallerBootstrapPreflight(), Ensure-Git() (+11 more)

### Community 41 - "Community 41"
Cohesion: 0.32
Nodes (8): runCommand(), runShellCommand(), InstallRuntimeDependencies, installDraftPath(), readInstallDraft(), writeInstallDraft(), git(), UninstallDependencies

### Community 42 - "Community 42"
Cohesion: 0.19
Nodes (15): assertApprovalNonce(), CreateApprovalInput, isApprovalResolved(), isApprovalWaitingForHuman(), refreshExpiredApproval(), RESOLVABLE_APPROVAL_STATES, ResolveApprovalInput, resolveApprovalRequest() (+7 more)

### Community 43 - "Community 43"
Cohesion: 0.20
Nodes (15): resolveInstallerRepoSources(), cachedManifests, InstallerManifest, loadInstallerManifest(), parseSimpleInstallerManifest(), resolveInstallerInstruction(), detectInstallerEnvironment(), detectLinuxFamily() (+7 more)

### Community 44 - "Community 44"
Cohesion: 0.20
Nodes (14): collectJsonlFiles(), collectPathStrings(), extractFileSessionId(), hostProxyErrorMessage(), looksPathLike(), metadataFromSessionRecords(), normalizePathKey(), projectLabel() (+6 more)

### Community 45 - "Community 45"
Cohesion: 0.15
Nodes (19): buildOnboardingItems(), buildPortConflictItem(), buildPortConflictMessage(), buildTokenMessage(), codexSmokeFailedMessage(), codexSmokeFailureMessage(), codexSmokeOutputLooksSuccessful(), codexSmokeWarningsMessage() (+11 more)

### Community 46 - "Community 46"
Cohesion: 0.20
Nodes (14): base64Url(), dataCheckString(), fromBase64Url(), makeLaunchGrantId(), makeMiniAppSessionToken(), safeEqualHex(), signMiniAppLaunchPayload(), TelegramMiniAppUser (+6 more)

### Community 47 - "Community 47"
Cohesion: 0.12
Nodes (15): main, name, private, scripts, build, desktop-proxy, dev, lint (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.16
Nodes (15): CommandRunResult, PnpmInstallResult, DaemonStateSnapshot, defaultApiBaseUrl(), evaluateInstallPairingDecision(), fetchPairingHostStatus(), InstallPairingDecision, PairingCommandResult (+7 more)

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (9): InstallRuntimeError, deriveInstallOutcome(), firstDetailLine(), installOutcomeFromError(), RECOVERABLE_ERROR_CODES, InstallOutcome, InstallRuntimeErrorDetail, InstallStatus (+1 more)

### Community 50 - "Community 50"
Cohesion: 0.29
Nodes (13): buildWindowsShellCommand(), CommandExecutionError, hasWindowsShellExtension(), isExecutableFile(), isJavaScriptEntrypoint(), isPathLike(), quoteWindowsShellArg(), recoverLaunchPlan() (+5 more)

### Community 51 - "Community 51"
Cohesion: 0.17
Nodes (5): CodexDesktopControlResult, CodexDesktopSession, CreateCodexDesktopTaskRequest, CodexDesktopControlContract, CodexDesktopStateAdapter

### Community 52 - "Community 52"
Cohesion: 0.10
Nodes (7): MiniAppOverview, SessionDetail, HappyTGStore, Host, TaskBundle, Workspace, FileStateStore

### Community 53 - "Community 53"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, start (+4 more)

### Community 54 - "Community 54"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, start (+4 more)

### Community 55 - "Community 55"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, start (+4 more)

### Community 56 - "Community 56"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, start (+4 more)

### Community 57 - "Community 57"
Cohesion: 0.17
Nodes (11): main, name, private, scripts, build, lint, test, typecheck (+3 more)

### Community 58 - "Community 58"
Cohesion: 0.15
Nodes (7): classifyArtifactPath(), HappyTGControlPlaneService, hashToken(), ContinueCodexDesktopSessionRequest, MiniAppDiffProjection, User, validateTaskBundle()

### Community 59 - "Community 59"
Cohesion: 0.20
Nodes (7): TelegramUpdate, CreateDefaultSendTelegramMessageOptions, startTelegramPolling(), StartTelegramPollingOptions, waitForDelay(), CodexDesktopProxyOptions, Logger

### Community 60 - "Community 60"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, lint, test, typecheck (+2 more)

### Community 61 - "Community 61"
Cohesion: 0.26
Nodes (13): detectPnpmBuildScriptGuidance(), ExistingInstallEnvSetup, formatPackageList(), normalizedCommandOutput(), normalizeIgnoredBuildScriptPackages(), parseIgnoredBuildScriptsWarning(), runCriticalPnpmToolchainCheck(), runPnpmInstall() (+5 more)

### Community 62 - "Community 62"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, lint, test, typecheck (+2 more)

### Community 63 - "Community 63"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, lint, test, typecheck (+2 more)

### Community 64 - "Community 64"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, lint, test, typecheck (+2 more)

### Community 65 - "Community 65"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, lint, test, typecheck (+2 more)

### Community 66 - "Community 66"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, lint, test, typecheck (+2 more)

### Community 67 - "Community 67"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, lint, test, typecheck (+2 more)

### Community 68 - "Community 68"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, lint, test, typecheck (+2 more)

### Community 69 - "Community 69"
Cohesion: 0.33
Nodes (10): Get-GitLines(), Get-GitRequiredValue(), Get-ManualMemoryChanges(), Get-RangeMemoryChanges(), Get-Sha256Hex(), Get-StateFingerprint(), Resolve-Commit(), Resolve-GitDir() (+2 more)

### Community 70 - "Community 70"
Cohesion: 0.18
Nodes (5): isDevCodexDesktopReadOnlyUser(), CodexDesktopControlStatus, CodexDesktopProject, CodexDesktopSessionDetail, readJsonlBounded()

### Community 71 - "Community 71"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 72 - "Community 72"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 73 - "Community 73"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 74 - "Community 74"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 75 - "Community 75"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 76 - "Community 76"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 77 - "Community 77"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 78 - "Community 78"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 79 - "Community 79"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 80 - "Community 80"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 81 - "Community 81"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 82 - "Community 82"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 83 - "Community 83"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 84 - "Community 84"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 85 - "Community 85"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 86 - "Community 86"
Cohesion: 0.60
Nodes (5): assertCondition(), main(), normalizeVersion(), readArg(), readJson()

### Community 89 - "Community 89"
Cohesion: 0.13
Nodes (23): mergeEnvTemplate(), parseTemplateKeys(), serializeEnvValue(), writeMergedEnvFile(), validateTelegramBotToken(), activeTelegramField(), appendInputChunk(), commitTelegramDraft() (+15 more)

### Community 90 - "Community 90"
Cohesion: 0.22
Nodes (8): artifactKey(), backgroundModeOrFallback(), installStatePath(), normalizeComparePath(), normalizeOwnedBackgroundArtifacts(), ownedBackgroundArtifactsFromBackground(), readInstallState(), writeInstallState()

## Knowledge Gaps
- **495 isolated node(s):** `name`, `version`, `private`, `type`, `main` (+490 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `nowIso()` connect `Community 15` to `Community 1`, `Community 2`, `Community 36`, `Community 5`, `Community 90`, `Community 41`, `Community 42`, `Community 11`, `Community 13`, `Community 17`, `Community 18`, `Community 22`, `Community 23`, `Community 58`, `Community 29`, `Community 30`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `resolveExecutable()` connect `Community 38` to `Community 1`, `Community 2`, `Community 7`, `Community 41`, `Community 10`, `Community 43`, `Community 45`, `Community 50`, `Community 22`, `Community 24`, `Community 27`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `TaskBundle` connect `Community 52` to `Community 0`, `Community 3`, `Community 5`, `Community 6`, `Community 11`, `Community 13`, `Community 15`, `Community 17`, `Community 19`, `Community 58`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Are the 16 inferred relationships involving `runHappyTGInstall()` (e.g. with `configureBackgroundMode()` and `resetBackgroundModeArtifacts()`) actually correct?**
  _`runHappyTGInstall()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _495 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05634725634725635 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._