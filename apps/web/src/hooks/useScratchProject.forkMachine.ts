import type { EnvironmentId } from "@t3tools/contracts";
import { Schema } from "effect";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";

const STORAGE_KEY = "fork:scratch-machine";

export function readRememberedScratchMachine(): EnvironmentId | null {
  try {
    return getLocalStorageItem(STORAGE_KEY, Schema.String) as EnvironmentId | null;
  } catch {
    return null;
  }
}

export function rememberScratchMachine(environmentId: EnvironmentId) {
  try {
    setLocalStorageItem(STORAGE_KEY, environmentId, Schema.String);
  } catch {}
}
