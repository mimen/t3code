import * as Schema from "effect/Schema";

export const DesktopDistributionProfileSchema = Schema.Literals(["alpha", "fork-staging"]);
export type DesktopDistributionProfile = typeof DesktopDistributionProfileSchema.Type;

export interface DesktopDistributionIdentity {
  readonly appId: string;
  readonly productName: string;
  readonly stageLabel: "Alpha" | "Fork Staging";
  readonly rendererScheme: string;
  readonly userDataDirName: string;
  readonly stateDirName: string;
  readonly linuxDesktopEntryName: string;
  readonly linuxWmClass: string;
  readonly allowsLegacyAlphaUserDataMigration: boolean;
  readonly autoUpdatesEnabled: boolean;
  readonly artifactNameSegment: string;
}

const ALPHA_IDENTITY: DesktopDistributionIdentity = {
  appId: "com.t3tools.t3code",
  productName: "T3 Code (Alpha)",
  stageLabel: "Alpha",
  rendererScheme: "t3code",
  userDataDirName: "t3code",
  stateDirName: "userdata",
  linuxDesktopEntryName: "t3code.desktop",
  linuxWmClass: "t3code",
  allowsLegacyAlphaUserDataMigration: true,
  autoUpdatesEnabled: true,
  artifactNameSegment: "",
};

const FORK_STAGING_IDENTITY: DesktopDistributionIdentity = {
  appId: "com.t3tools.t3code.fork-staging",
  productName: "T3 Code (Fork Staging)",
  stageLabel: "Fork Staging",
  rendererScheme: "t3code-fork-staging",
  userDataDirName: "t3code-fork-staging",
  stateDirName: "fork-staging",
  linuxDesktopEntryName: "t3code-fork-staging.desktop",
  linuxWmClass: "t3code-fork-staging",
  allowsLegacyAlphaUserDataMigration: false,
  autoUpdatesEnabled: false,
  artifactNameSegment: "Fork-Staging-",
};

export function resolveDesktopDistributionIdentity(
  profile: DesktopDistributionProfile,
): DesktopDistributionIdentity {
  return profile === "fork-staging" ? FORK_STAGING_IDENTITY : ALPHA_IDENTITY;
}
