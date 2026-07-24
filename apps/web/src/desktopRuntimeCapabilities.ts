import type { DesktopRuntimeCapabilities } from "@t3tools/contracts";

export const REMOTE_ONLY_LOCAL_ENVIRONMENT_ITEM = "__t3code-unavailable-local-environment__";

/**
 * Returns desktop runtime capabilities when the renderer is running inside a
 * current desktop shell. Older desktop shells intentionally fall back to full
 * local execution so the hosted and browser clients remain unaffected.
 */
export function getDesktopRuntimeCapabilities(): DesktopRuntimeCapabilities | null {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.getRuntimeCapabilities?.() ?? null;
}

export function isRemoteOnlyDesktop(): boolean {
  return getDesktopRuntimeCapabilities()?.executionMode === "remote-only";
}

export function isLocalBackendAvailable(): boolean {
  return getDesktopRuntimeCapabilities()?.localBackendAvailable ?? true;
}
