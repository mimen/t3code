import {
  CommandId,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { threadHasUnfinishedWork } from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { resolveBaseDir } from "../os-jank.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ManagedProjectFolders from "./ManagedProjectFolders.ts";
import * as ProjectService from "./ProjectService.ts";

export class ThreadProjectMoveError extends Schema.TaggedError<ThreadProjectMoveError>()(
  "ThreadProjectMoveError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

/**
 * Moves a No project thread, and every No project thread sharing its folder, into an existing
 * project. The threads keep their folder, so their cwd never changes. Running it again finishes
 * a partial move.
 */
export const moveThreadToProject = Effect.fn("ForkThreadProjectMove.move")(function* (input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
}) {
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const random = yield* SecureRandom.SecureRandom;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realPath = (folder: string) =>
    fileSystem.realPath(folder).pipe(Effect.orElseSucceed(() => path.resolve(folder)));
  const fail = (reason: string) => (cause: unknown) =>
    new ThreadProjectMoveError({ reason, cause });

  // isScratchProject knows only this home's scratch folder; data carried over from the default
  // T3 home keeps a No project at that home's scratch folder too.
  const defaultScratch = ManagedProjectFolders.scratchFolderRoot(
    yield* resolveBaseDir(undefined),
    path,
  );
  const scratchRoots = new Set(
    yield* Effect.forEach(
      [...Option.toArray(yield* managedFolders.scratchRoot), defaultScratch],
      realPath,
    ),
  );
  const isScratch = Effect.fn(function* (projectId: ProjectId) {
    if (yield* managedFolders.isScratchProject(projectId)) return true;
    const project = yield* projects.getById(projectId).pipe(Effect.orElseSucceed(Option.none));
    return Option.isSome(project) && scratchRoots.has(yield* realPath(project.value.workspaceRoot));
  });

  const thread = yield* threads.getThreadShell(input.threadId).pipe(
    Effect.mapError(fail("Could not read the thread.")),
    Effect.filterOrFail(
      (shell): shell is OrchestrationV2ThreadShell => shell !== null && shell.deletedAt === null,
      () => new ThreadProjectMoveError({ reason: "Thread not found." }),
    ),
  );
  const target = yield* projects
    .getById(input.projectId)
    .pipe(Effect.mapError(fail("Could not read the project.")));
  if (Option.isNone(target) || target.value.deletedAt !== null) {
    return yield* new ThreadProjectMoveError({ reason: "Project not found." });
  }
  if (yield* isScratch(input.projectId)) {
    return yield* new ThreadProjectMoveError({ reason: "Pick a project other than No project." });
  }
  const folder = thread.worktreePath;
  const alreadyMoved = thread.projectId === input.projectId;
  if (folder === null || !(alreadyMoved || (yield* isScratch(thread.projectId)))) {
    return yield* new ThreadProjectMoveError({
      reason: "Only a No project thread with its own folder can move to another project.",
    });
  }

  const snapshot = yield* Effect.flatten(threads.readShellSnapshot({ worktreePath: folder })).pipe(
    Effect.mapError(fail("Could not read the threads in this folder.")),
  );
  const moveSet = new Map<ThreadId, OrchestrationV2ThreadShell>();
  if (!alreadyMoved) moveSet.set(thread.id, thread);
  for (const candidate of [...snapshot.threads, ...snapshot.archivedThreads]) {
    if (yield* isScratch(candidate.projectId)) moveSet.set(candidate.id, candidate);
  }

  for (const candidate of moveSet.values()) {
    const records = yield* threads
      .getThreadRecords(candidate.id, ["runs", "runtimeRequests"], { turnItemTypes: [] })
      .pipe(Effect.mapError(fail(`Could not read "${candidate.title}".`)));
    if (threadHasUnfinishedWork(records)) {
      return yield* new ThreadProjectMoveError({
        reason: `"${candidate.title}" is still working. Finish or stop it first.`,
      });
    }
  }

  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      yield* scheduledTasks
        .moveThreadTasks({ threadIds: [...moveSet.keys()], projectId: input.projectId })
        .pipe(Effect.mapError(fail("Could not move the thread's scheduled tasks.")));
      for (const candidate of moveSet.values()) {
        const commandId = CommandId.make(`fork-thread-move:${yield* random.uuidV4()}`);
        yield* threads
          .dispatch({
            type: "thread.project.adopt-folder",
            commandId,
            threadId: candidate.id,
            projectId: input.projectId,
            keepWorktreePath: true,
          })
          .pipe(Effect.mapError(fail(`Could not move "${candidate.title}". Try again.`)));
      }
      return { projectId: input.projectId, threadIds: [...moveSet.keys()] };
    }),
  );
});
