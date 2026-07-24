import type { MenuAction } from "@react-native-menu/menu";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  ClaudeSessionCatalogEntry,
  ClaudeSessionCatalogueActivityWindow,
  ClaudeSessionCatalogueMode,
  ClaudeSessionCatalogueSort,
  ClaudeSessionCatalogueSourceStatus,
  ClaudeSessionPreview,
  EnvironmentId,
} from "@t3tools/contracts";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPill, ControlPillMenu } from "../../components/ControlPill";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { claudeSessionEnvironment } from "../../state/claudeSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { useClerkSettingsSheetDetent } from "../cloud/ClerkSettingsSheetDetent";
import {
  buildClaudeSessionCatalogueQuery,
  claudeSessionCatalogueTargetKey,
  CLAUDE_SESSION_ACTIVITY_WINDOWS,
  CLAUDE_SESSION_SORT_OPTIONS,
  isClaudeSessionEnvironmentAvailable,
  mergeClaudeSessionPages,
  presentClaudeSessionAttachment,
  presentClaudeSessionSourceStatus,
  type ClaudeSessionBrowserFilters,
  type ClaudeSessionSourcePresentation,
} from "./claudeSessionBrowser";

const SEARCH_DEBOUNCE_MS = 300;

function failureMessage(
  result: Parameters<typeof squashAtomCommandFailure>[0],
  fallback: string,
): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function selectedMenuState(selected: boolean): "on" | "off" {
  return selected ? "on" : "off";
}

function formattedActivityTime(input: string | null): string {
  if (input === null) {
    return "No activity timestamp";
  }
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : "Unknown activity time";
}

function SourceStatusCard(props: {
  readonly mode: ClaudeSessionCatalogueMode;
  readonly status: ClaudeSessionCatalogueSourceStatus;
}) {
  const presentation = presentClaudeSessionSourceStatus(props.status, props.mode);
  const refreshedAt = props.status.refreshedAt;
  return (
    <View
      className={cn(
        "gap-1 rounded-[18px] border px-4 py-3",
        presentation.tone === "error"
          ? "border-rose-300/60 bg-rose-100/70 dark:border-rose-400/25 dark:bg-rose-500/10"
          : presentation.tone === "warning"
            ? "border-amber-300/60 bg-amber-100/70 dark:border-amber-400/25 dark:bg-amber-500/10"
            : "border-border bg-card",
      )}
    >
      <Text className="text-sm font-t3-bold text-foreground">{presentation.title}</Text>
      <Text className="text-xs leading-relaxed text-foreground-muted">
        {presentation.detail}
        {refreshedAt ? ` · Updated ${formattedActivityTime(refreshedAt)}` : ""}
      </Text>
      {presentation.problem ? (
        <Text
          className={cn(
            "text-xs leading-relaxed",
            presentation.tone === "error"
              ? "text-rose-600 dark:text-rose-300"
              : "text-amber-700 dark:text-amber-200",
          )}
        >
          {presentation.problem}
        </Text>
      ) : null}
    </View>
  );
}

function SessionRow(props: {
  readonly onPreview: (session: ClaudeSessionCatalogEntry) => void;
  readonly session: ClaudeSessionCatalogEntry;
}) {
  const chevronColor = useThemeColor("--color-chevron");
  const attachment = presentClaudeSessionAttachment(props.session);
  const metadata = [
    props.session.projectName,
    props.session.branch,
    `${props.session.messageCount} message${props.session.messageCount === 1 ? "" : "s"}`,
    formattedActivityTime(props.session.latestActivityAt),
  ].filter((value): value is string => value !== null);

  return (
    <Pressable
      accessibilityHint="Loads a short server preview before attaching"
      accessibilityLabel={`Preview ${props.session.title}`}
      accessibilityRole="button"
      className="rounded-[20px] border border-border bg-card px-4 py-3.5 active:opacity-70"
      onPress={() => props.onPreview(props.session)}
    >
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="text-base font-t3-bold leading-snug text-foreground" numberOfLines={2}>
            {props.session.title}
          </Text>
          <Text className="text-xs leading-relaxed text-foreground-muted" numberOfLines={2}>
            {metadata.join(" · ")}
          </Text>
          <Text
            className="font-mono text-2xs leading-relaxed text-foreground-muted"
            ellipsizeMode="middle"
            numberOfLines={1}
          >
            {props.session.sourceCwd}
          </Text>
          <Text
            className={cn(
              "text-xs font-t3-bold",
              attachment.problem
                ? "text-rose-600 dark:text-rose-300"
                : props.session.attachment
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-foreground-muted",
            )}
          >
            {attachment.label}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5 pt-0.5">
          <Text className="text-xs font-t3-bold text-foreground-muted">Preview</Text>
          <SymbolView name="chevron.right" size={12} tintColor={chevronColor} type="monochrome" />
        </View>
      </View>
    </Pressable>
  );
}

function PreviewExcerpt(props: { readonly label: string; readonly text: string | null }) {
  return (
    <View className="gap-1.5 rounded-[18px] border border-border bg-card px-4 py-3.5">
      <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
        {props.label}
      </Text>
      <Text className="text-sm leading-relaxed text-foreground">
        {props.text ?? "No excerpt available."}
      </Text>
    </View>
  );
}

function ClaudeSessionPreviewModal(props: {
  readonly available: boolean;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isOpening: boolean;
  readonly onClose: () => void;
  readonly onOpen: () => void;
  readonly preview: ClaudeSessionPreview | null;
  readonly session: ClaudeSessionCatalogEntry | null;
}) {
  const insets = useSafeAreaInsets();
  const iconColor = useThemeColor("--color-icon");
  const primaryColor = useThemeColor("--color-primary-foreground");
  const attachment = props.session === null ? null : presentClaudeSessionAttachment(props.session);

  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      visible={props.session !== null}
    >
      <View
        className="flex-1 bg-sheet"
        style={{ paddingTop: Platform.OS === "android" ? insets.top : 0 }}
      >
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
          <Pressable
            accessibilityLabel="Close Claude session preview"
            accessibilityRole="button"
            className="size-10 items-center justify-center rounded-full bg-subtle active:opacity-70"
            onPress={props.onClose}
          >
            <SymbolView name="xmark" size={15} tintColor={iconColor} type="monochrome" />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="text-lg font-t3-bold text-foreground">Session preview</Text>
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {props.session?.projectName ?? "Claude Code"}
            </Text>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-3 px-4 py-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 96 }}
          showsVerticalScrollIndicator={false}
        >
          {props.session ? (
            <View className="gap-1 rounded-[18px] border border-border bg-card px-4 py-3.5">
              <Text className="text-lg font-t3-bold leading-snug text-foreground">
                {props.session.title}
              </Text>
              <Text
                className="font-mono text-xs leading-relaxed text-foreground-muted"
                ellipsizeMode="middle"
                numberOfLines={2}
              >
                {props.session.sourceCwd}
              </Text>
              {attachment ? (
                <Text
                  className={cn(
                    "text-xs font-t3-bold",
                    attachment.problem
                      ? "text-rose-600 dark:text-rose-300"
                      : props.session.attachment
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-foreground-muted",
                  )}
                >
                  {attachment.label}
                </Text>
              ) : null}
              {attachment?.detail ? (
                <Text className="text-xs leading-relaxed text-rose-600 dark:text-rose-300">
                  {attachment.detail}
                </Text>
              ) : null}
            </View>
          ) : null}

          {props.error ? <ErrorBanner message={props.error} /> : null}

          {props.isLoading ? (
            <View className="items-center gap-3 py-12">
              <ActivityIndicator />
              <Text className="text-sm text-foreground-muted">Loading a short preview…</Text>
            </View>
          ) : props.preview ? (
            <>
              <PreviewExcerpt label="First request" text={props.preview.firstUserExcerpt} />
              <PreviewExcerpt label="Latest request" text={props.preview.latestUserExcerpt} />
              <PreviewExcerpt
                label="Latest Claude response"
                text={props.preview.latestAssistantExcerpt}
              />
              {props.preview.isPartial ? (
                <Text className="px-1 text-xs leading-relaxed text-foreground-muted">
                  This is a bounded preview. Open the session to synchronize its available history.
                </Text>
              ) : null}
              <Text className="px-1 text-xs leading-relaxed text-foreground-muted">
                Imported history is display-only and transcripted tool activity is never replayed.
                New messages continue through the environment’s normal Claude provider session.
              </Text>
            </>
          ) : null}
        </ScrollView>

        <View
          className="absolute inset-x-0 bottom-0 border-t border-border bg-sheet/95 px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Pressable
            accessibilityRole="button"
            className={cn(
              "min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary px-5 active:opacity-70",
              (!props.available || props.preview === null || props.isOpening) && "opacity-50",
            )}
            disabled={!props.available || props.preview === null || props.isOpening}
            onPress={props.onOpen}
          >
            {props.isOpening ? (
              <ActivityIndicator color={primaryColor} />
            ) : (
              <SymbolView name="terminal" size={16} tintColor={primaryColor} type="monochrome" />
            )}
            <Text className="text-sm font-t3-bold text-primary-foreground">
              {props.isOpening ? "Opening…" : (attachment?.actionLabel ?? "Attach and open")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function ClaudeSessionsRouteScreen() {
  const navigation = useNavigation();
  const { expand } = useClerkSettingsSheetDetent();
  const { connectedEnvironments, onReconnectEnvironment } = useRemoteConnections();
  const listSessions = useAtomCommand(claudeSessionEnvironment.listPage, { reportFailure: false });
  const previewSession = useAtomCommand(claudeSessionEnvironment.preview, { reportFailure: false });
  const openSession = useAtomCommand(claudeSessionEnvironment.open, { reportFailure: false });
  const mutedColor = useThemeColor("--color-icon-muted");
  const environments = useMemo(
    () =>
      [...connectedEnvironments].sort((left, right) =>
        left.environmentLabel.localeCompare(right.environmentLabel),
      ),
    [connectedEnvironments],
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const [searchText, setSearchText] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [activityWindow, setActivityWindow] = useState<ClaudeSessionCatalogueActivityWindow>("30d");
  const [sort, setSort] = useState<ClaudeSessionCatalogueSort>("nativeActivity");
  const [sessions, setSessions] = useState<ReadonlyArray<ClaudeSessionCatalogEntry>>([]);
  const [loadedCatalogueKey, setLoadedCatalogueKey] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<ClaudeSessionCatalogueSourceStatus | null>(null);
  const [catalogueMode, setCatalogueMode] = useState<ClaudeSessionCatalogueMode | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedSession, setSelectedSession] = useState<ClaudeSessionCatalogEntry | null>(null);
  const [preview, setPreview] = useState<ClaudeSessionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const listRequestVersionRef = useRef(0);
  const previewRequestVersionRef = useRef(0);

  const selectedEnvironment = useMemo(
    () =>
      environments.find((environment) => environment.environmentId === selectedEnvironmentId) ??
      null,
    [environments, selectedEnvironmentId],
  );
  const environmentAvailable =
    selectedEnvironment !== null &&
    isClaudeSessionEnvironmentAvailable(selectedEnvironment.connectionState);
  const filters = useMemo<ClaudeSessionBrowserFilters>(
    () => ({ activityWindow, searchQuery: committedSearch, sort }),
    [activityWindow, committedSearch, sort],
  );
  const catalogueKey = useMemo(
    () =>
      selectedEnvironmentId === null
        ? null
        : claudeSessionCatalogueTargetKey(selectedEnvironmentId, filters),
    [filters, selectedEnvironmentId],
  );
  const catalogueMatchesTarget = catalogueKey !== null && loadedCatalogueKey === catalogueKey;

  useFocusEffect(
    useCallback(() => {
      expand();
    }, [expand]),
  );

  useEffect(() => {
    if (
      selectedEnvironmentId !== null &&
      environments.some((environment) => environment.environmentId === selectedEnvironmentId)
    ) {
      return;
    }
    const nextEnvironment =
      environments.find((environment) => environment.connectionState === "connected") ??
      environments[0] ??
      null;
    setSelectedEnvironmentId(nextEnvironment?.environmentId ?? null);
  }, [environments, selectedEnvironmentId]);

  useEffect(() => {
    previewRequestVersionRef.current += 1;
    setSelectedSession(null);
    setPreview(null);
    setPreviewError(null);
    setIsPreviewLoading(false);
    setIsOpening(false);
  }, [selectedEnvironmentId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setCommittedSearch(searchText);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchText]);

  const clearBrowserData = useCallback(() => {
    setSessions([]);
    setLoadedCatalogueKey(null);
    setSourceStatus(null);
    setCatalogueMode(null);
    setNextCursor(null);
  }, []);

  const loadFirstPage = useCallback(async () => {
    if (selectedEnvironmentId === null || catalogueKey === null || !environmentAvailable) {
      return;
    }
    const requestVersion = listRequestVersionRef.current + 1;
    listRequestVersionRef.current = requestVersion;
    clearBrowserData();
    setListError(null);
    setIsLoadingMore(false);
    setIsLoading(true);
    try {
      const result = await listSessions({
        environmentId: selectedEnvironmentId,
        input: buildClaudeSessionCatalogueQuery({
          filters,
          freshness: "allow-stale",
        }),
      });
      if (requestVersion !== listRequestVersionRef.current) {
        return;
      }
      if (result._tag === "Failure") {
        setLoadedCatalogueKey(catalogueKey);
        setListError(
          failureMessage(result, "Could not query Claude Code sessions in this environment."),
        );
        return;
      }
      setSessions(result.value.sessions);
      setLoadedCatalogueKey(catalogueKey);
      setNextCursor(result.value.nextCursor);
      setSourceStatus(result.value.sourceStatus);
      setCatalogueMode(result.value.mode);
    } finally {
      if (requestVersion === listRequestVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    catalogueKey,
    clearBrowserData,
    environmentAvailable,
    filters,
    listSessions,
    selectedEnvironmentId,
  ]);

  const refresh = useCallback(async () => {
    if (selectedEnvironmentId === null || catalogueKey === null || !environmentAvailable) {
      return;
    }
    const requestVersion = listRequestVersionRef.current + 1;
    listRequestVersionRef.current = requestVersion;
    clearBrowserData();
    setListError(null);
    setIsLoadingMore(false);
    setIsLoading(true);
    try {
      const result = await listSessions({
        environmentId: selectedEnvironmentId,
        input: buildClaudeSessionCatalogueQuery({
          filters,
          freshness: "require-fresh",
        }),
      });
      if (requestVersion !== listRequestVersionRef.current) {
        return;
      }
      if (result._tag === "Failure") {
        setLoadedCatalogueKey(catalogueKey);
        setListError(
          failureMessage(result, "Could not refresh Claude Code sessions in this environment."),
        );
        return;
      }
      setSessions(result.value.sessions);
      setLoadedCatalogueKey(catalogueKey);
      setNextCursor(result.value.nextCursor);
      setSourceStatus(result.value.sourceStatus);
      setCatalogueMode(result.value.mode);
    } finally {
      if (requestVersion === listRequestVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    catalogueKey,
    clearBrowserData,
    environmentAvailable,
    filters,
    listSessions,
    selectedEnvironmentId,
  ]);

  useEffect(() => {
    if (!environmentAvailable) {
      listRequestVersionRef.current += 1;
      previewRequestVersionRef.current += 1;
      clearBrowserData();
      setListError(null);
      setIsLoading(false);
      setIsLoadingMore(false);
      setSelectedSession(null);
      setPreview(null);
      setPreviewError(null);
      setIsPreviewLoading(false);
      setIsOpening(false);
      return;
    }
    void loadFirstPage();
  }, [clearBrowserData, environmentAvailable, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (
      selectedEnvironmentId === null ||
      !environmentAvailable ||
      !catalogueMatchesTarget ||
      nextCursor === null ||
      isLoading ||
      isLoadingMore
    ) {
      return;
    }
    const requestVersion = listRequestVersionRef.current;
    setListError(null);
    setIsLoadingMore(true);
    try {
      const result = await listSessions({
        environmentId: selectedEnvironmentId,
        input: buildClaudeSessionCatalogueQuery({
          cursor: nextCursor,
          filters,
          freshness: "allow-stale",
        }),
      });
      if (requestVersion !== listRequestVersionRef.current) {
        return;
      }
      if (result._tag === "Failure") {
        setListError(failureMessage(result, "Could not load more Claude Code sessions."));
        return;
      }
      setSessions((current) => mergeClaudeSessionPages(current, result.value.sessions));
      setNextCursor(result.value.nextCursor);
      setSourceStatus(result.value.sourceStatus);
      setCatalogueMode(result.value.mode);
    } finally {
      if (requestVersion === listRequestVersionRef.current) {
        setIsLoadingMore(false);
      }
    }
  }, [
    catalogueMatchesTarget,
    environmentAvailable,
    filters,
    isLoading,
    isLoadingMore,
    listSessions,
    nextCursor,
    selectedEnvironmentId,
  ]);

  const closePreview = useCallback(() => {
    previewRequestVersionRef.current += 1;
    setSelectedSession(null);
    setPreview(null);
    setPreviewError(null);
    setIsPreviewLoading(false);
    setIsOpening(false);
  }, []);

  const showPreview = useCallback(
    async (session: ClaudeSessionCatalogEntry) => {
      if (selectedEnvironmentId === null || !environmentAvailable) {
        return;
      }
      const requestVersion = previewRequestVersionRef.current + 1;
      previewRequestVersionRef.current = requestVersion;
      setSelectedSession(session);
      setPreview(null);
      setPreviewError(null);
      setIsPreviewLoading(true);
      try {
        const result = await previewSession({
          environmentId: selectedEnvironmentId,
          input: {
            nativeSessionId: session.nativeSessionId,
            cwd: session.sourceCwd,
          },
        });
        if (requestVersion !== previewRequestVersionRef.current) {
          return;
        }
        if (result._tag === "Failure") {
          setPreviewError(failureMessage(result, "Could not load this Claude Code preview."));
          return;
        }
        setPreview(result.value);
      } finally {
        if (requestVersion === previewRequestVersionRef.current) {
          setIsPreviewLoading(false);
        }
      }
    },
    [environmentAvailable, previewSession, selectedEnvironmentId],
  );

  const attachAndOpen = useCallback(async () => {
    if (selectedEnvironmentId === null || selectedSession === null || !environmentAvailable) {
      return;
    }
    const requestVersion = previewRequestVersionRef.current;
    setPreviewError(null);
    setIsOpening(true);
    try {
      const result = await openSession({
        environmentId: selectedEnvironmentId,
        input: {
          nativeSessionId: selectedSession.nativeSessionId,
          cwd: selectedSession.sourceCwd,
        },
      });
      if (requestVersion !== previewRequestVersionRef.current) {
        return;
      }
      if (result._tag === "Failure") {
        setPreviewError(failureMessage(result, "Could not open this Claude Code session in T3."));
        return;
      }
      if (!result.value.ok) {
        setPreviewError(result.value.error.message);
        return;
      }
      const params = {
        environmentId: String(selectedEnvironmentId),
        threadId: String(result.value.value.threadId),
      };
      closePreview();
      const parentNavigation = navigation.getParent();
      if (parentNavigation) {
        parentNavigation.dispatch(StackActions.replace("Thread", params));
      } else {
        navigation.navigate("Thread", params);
      }
    } finally {
      if (requestVersion === previewRequestVersionRef.current) {
        setIsOpening(false);
      }
    }
  }, [
    closePreview,
    environmentAvailable,
    navigation,
    openSession,
    selectedEnvironmentId,
    selectedSession,
  ]);

  const environmentMenuActions = useMemo<MenuAction[]>(
    () =>
      environments.map((environment) => ({
        id: `environment:${environment.environmentId}`,
        title: environment.environmentLabel,
        subtitle:
          environment.connectionState === "connected"
            ? environment.displayUrl
            : `${environment.displayUrl} · Unavailable`,
        state: selectedMenuState(environment.environmentId === selectedEnvironmentId),
      })),
    [environments, selectedEnvironmentId],
  );
  const activityMenuActions = useMemo<MenuAction[]>(
    () =>
      CLAUDE_SESSION_ACTIVITY_WINDOWS.map((option) => ({
        id: `activity:${option.value}`,
        title: option.label,
        state: selectedMenuState(option.value === activityWindow),
      })),
    [activityWindow],
  );
  const sortMenuActions = useMemo<MenuAction[]>(
    () =>
      CLAUDE_SESSION_SORT_OPTIONS.map((option) => ({
        id: `sort:${option.value}`,
        title: option.label,
        state: selectedMenuState(option.value === sort),
      })),
    [sort],
  );
  const selectedActivityLabel =
    CLAUDE_SESSION_ACTIVITY_WINDOWS.find((option) => option.value === activityWindow)?.label ??
    "Activity";
  const selectedSortLabel =
    CLAUDE_SESSION_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Sort";
  const sourcePresentation: ClaudeSessionSourcePresentation | null =
    catalogueMatchesTarget && sourceStatus !== null && catalogueMode !== null
      ? presentClaudeSessionSourceStatus(sourceStatus, catalogueMode)
      : null;
  const visibleSessions = catalogueMatchesTarget ? sessions : [];
  const visibleSourceStatus = catalogueMatchesTarget ? sourceStatus : null;
  const visibleCatalogueMode = catalogueMatchesTarget ? catalogueMode : null;
  const visibleNextCursor = catalogueMatchesTarget ? nextCursor : null;
  const showInitialLoading = isLoading || !catalogueMatchesTarget;

  return (
    <View className="flex-1 bg-sheet">
      <View className="gap-3 border-b border-border px-4 pb-3 pt-3">
        <View className="flex-row items-center gap-2">
          <ControlPillMenu
            actions={environmentMenuActions}
            onPressAction={(event) => {
              const id = event.nativeEvent.event;
              if (!id.startsWith("environment:")) {
                return;
              }
              const environmentId = id.slice("environment:".length);
              const environment = environments.find(
                (candidate) => candidate.environmentId === environmentId,
              );
              if (environment) {
                setSelectedEnvironmentId(environment.environmentId);
              }
            }}
          >
            <ControlPill
              accessibilityLabel="Choose environment"
              icon="desktopcomputer"
              label={selectedEnvironment?.environmentLabel ?? "Environment"}
              variant="pill"
            />
          </ControlPillMenu>
          <View className="min-h-11 flex-1 flex-row items-center gap-2 rounded-full border border-input-border bg-input px-3.5">
            <SymbolView name="magnifyingglass" size={15} tintColor={mutedColor} type="monochrome" />
            <TextInput
              accessibilityLabel="Search Claude sessions"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-w-0 flex-1 py-2 text-sm text-foreground"
              onChangeText={setSearchText}
              placeholder="Search sessions"
              placeholderTextColorClassName="accent-placeholder"
              value={searchText}
            />
            {searchText.length > 0 ? (
              <Pressable
                accessibilityLabel="Clear search"
                hitSlop={10}
                onPress={() => setSearchText("")}
              >
                <SymbolView
                  name="xmark.circle.fill"
                  size={15}
                  tintColor={mutedColor}
                  type="monochrome"
                />
              </Pressable>
            ) : null}
          </View>
        </View>
        <View className="flex-row items-center gap-2">
          <ControlPillMenu
            actions={activityMenuActions}
            onPressAction={(event) => {
              const value = event.nativeEvent.event.slice("activity:".length);
              const option = CLAUDE_SESSION_ACTIVITY_WINDOWS.find(
                (candidate) => candidate.value === value,
              );
              if (option) {
                setActivityWindow(option.value);
              }
            }}
          >
            <ControlPill
              icon="line.3.horizontal.decrease.circle"
              label={selectedActivityLabel}
              variant="pill"
            />
          </ControlPillMenu>
          <ControlPillMenu
            actions={sortMenuActions}
            onPressAction={(event) => {
              const value = event.nativeEvent.event.slice("sort:".length);
              const option = CLAUDE_SESSION_SORT_OPTIONS.find(
                (candidate) => candidate.value === value,
              );
              if (option) {
                setSort(option.value);
              }
            }}
          >
            <ControlPill icon="slider.horizontal.3" label={selectedSortLabel} variant="pill" />
          </ControlPillMenu>
          <View className="flex-1" />
          <ControlPill
            accessibilityLabel="Refresh Claude sessions"
            disabled={!environmentAvailable || isLoading}
            icon="arrow.clockwise"
            onPress={() => void refresh()}
          />
        </View>
      </View>

      {selectedEnvironment === null ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow justify-center px-5 py-8"
        >
          <EmptyState
            title="No environment selected"
            detail="Add an environment before browsing the Claude Code sessions available on that host."
          />
        </ScrollView>
      ) : !environmentAvailable ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow justify-center px-5 py-8"
        >
          <EmptyState
            title="Environment unavailable"
            detail={
              selectedEnvironment.connectionError ??
              "Claude sessions are queried live from the selected environment and are not cached on this device."
            }
            actionLabel="Reconnect"
            onAction={() => onReconnectEnvironment(selectedEnvironment.environmentId)}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={visibleSessions}
          keyExtractor={(session) =>
            `${session.providerInstanceId}:${session.localSourceHost}:${session.nativeSessionId}`
          }
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 10, padding: 16, paddingBottom: 32 }}
          renderItem={({ item }) => <SessionRow session={item} onPreview={showPreview} />}
          ListHeaderComponent={
            <View className="gap-3 pb-1">
              {visibleSourceStatus && visibleCatalogueMode ? (
                <SourceStatusCard status={visibleSourceStatus} mode={visibleCatalogueMode} />
              ) : null}
              {catalogueMatchesTarget && listError ? <ErrorBanner message={listError} /> : null}
            </View>
          }
          ListEmptyComponent={
            showInitialLoading ? (
              <View className="items-center gap-3 py-12">
                <ActivityIndicator />
                <Text className="text-sm text-foreground-muted">Querying this environment…</Text>
              </View>
            ) : (
              <EmptyState
                variant="plain"
                title="No Claude sessions found"
                detail={
                  committedSearch.trim().length > 0
                    ? "Try a different search or activity window."
                    : (sourcePresentation?.problem ??
                      "This environment did not report any sessions for the selected activity window.")
                }
              />
            )
          }
          ListFooterComponent={
            visibleNextCursor === null || visibleSessions.length === 0 ? null : (
              <Pressable
                accessibilityRole="button"
                className={cn(
                  "mt-1 min-h-11 flex-row items-center justify-center gap-2 rounded-full border border-border bg-card px-4 active:opacity-70",
                  isLoadingMore && "opacity-50",
                )}
                disabled={isLoadingMore}
                onPress={() => void loadMore()}
              >
                {isLoadingMore ? <ActivityIndicator size="small" /> : null}
                <Text className="text-sm font-t3-bold text-foreground">
                  {isLoadingMore ? "Loading…" : "Load more"}
                </Text>
              </Pressable>
            )
          }
        />
      )}

      <ClaudeSessionPreviewModal
        available={environmentAvailable}
        error={previewError}
        isLoading={isPreviewLoading}
        isOpening={isOpening}
        onClose={closePreview}
        onOpen={() => void attachAndOpen()}
        preview={preview}
        session={selectedSession}
      />
    </View>
  );
}
