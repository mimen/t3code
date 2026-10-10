// Every value that keeps this fork's desktop app apart from upstream's, so the two
// install side by side and never share a profile, state directory, or update feed.
export const FORK_IDENTITY = {
  appId: "com.mimen.t3code.fork",
  productName: "T3 Code (Fork)",
  homeDirName: ".t3-fork",
  userDataDirName: "t3code-fork",
  updateRepository: "mimen/t3code",
} as const;
