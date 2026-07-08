/**
 * Typed errors used across the agent-router core.
 *
 * Why typed errors instead of plain `Error`? The CLI maps each subclass to a
 * specific exit code (see `src/cli.ts`); the plugin tools map them to
 * structured tool-error responses opencode can render. Untyped Errors would
 * force string-matching at the boundary, which is brittle.
 *
 * All errors below carry an `exitCode` static so the CLI can do
 * `if (err instanceof RouterError) process.exit(err.constructor.exitCode)`.
 */

export abstract class RouterError extends Error {
  /** CLI exit code for this error class. Subclasses override. */
  static readonly exitCode: number = 1;
  override readonly name: string = "RouterError";
}

/** User passed a stack name that doesn't exist on disk. */
export class StackNotFoundError extends RouterError {
  static override readonly exitCode = 2;
  override readonly name = "StackNotFoundError";
  constructor(
    public readonly stackName: string,
    public readonly available: ReadonlyArray<string>,
  ) {
    super(
      `Stack "${stackName}" not found. Available: ${available.length ? available.join(", ") : "(none)"}.`,
    );
  }
}

/**
 * An agent `.md` file a stack references is missing, or exists but has no
 * frontmatter `model:` line to rewrite. `apply` is strict: it fails before
 * writing anything rather than leaving the suite half-switched.
 */
export class AgentFileError extends RouterError {
  static override readonly exitCode = 2;
  override readonly name = "AgentFileError";
  constructor(
    public readonly agentName: string,
    public readonly filePath: string,
    reason: string,
  ) {
    super(`Agent "${agentName}" (${filePath}): ${reason}`);
  }
}

/** state.json missing or corrupt and the operation needs it. */
export class NoActiveStackError extends RouterError {
  static override readonly exitCode = 1;
  override readonly name = "NoActiveStackError";
  constructor(message = "No active stack. Run `agent-router init` first.") {
    super(message);
  }
}

/** A JSON file on disk failed schema validation. */
export class ValidationError extends RouterError {
  static override readonly exitCode = 4;
  override readonly name = "ValidationError";
  constructor(
    message: string,
    public readonly path?: string,
    public readonly issues?: ReadonlyArray<string>,
  ) {
    super(message);
  }
}

/** Model IDs in a stack are not reachable through current opencode auth. */
export class ModelValidationError extends RouterError {
  static override readonly exitCode = 4;
  override readonly name = "ModelValidationError";
  constructor(
    public readonly stackName: string,
    public readonly missing: ReadonlyArray<{ path: string; modelId: string }>,
  ) {
    super(
      `Stack "${stackName}" references ${missing.length} unreachable model ID${missing.length === 1 ? "" : "s"}.`,
    );
  }
}

/** Filesystem op failed (read/write/permission/etc.). */
export class IOError extends RouterError {
  static override readonly exitCode = 3;
  override readonly name = "IOError";
  readonly causedBy: unknown;
  constructor(message: string, causedBy?: unknown) {
    super(message);
    this.causedBy = causedBy;
  }
}

/** User passed bad arguments or attempted a refused operation (e.g. rm active without --force). */
export class UserError extends RouterError {
  static override readonly exitCode = 1;
  override readonly name = "UserError";
}
