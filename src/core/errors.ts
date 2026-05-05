/**
 * Typed errors used across the omo-router core.
 *
 * Why typed errors instead of plain `Error`? The CLI maps each subclass to a
 * specific exit code (see `src/cli.ts`); the plugin tools map them to
 * structured tool-error responses opencode can render. Untyped Errors would
 * force string-matching at the boundary, which is brittle.
 *
 * All errors below carry an `exitCode` static so the CLI can do
 * `if (err instanceof OmoError) process.exit(err.constructor.exitCode)`.
 */

export abstract class OmoError extends Error {
  /** CLI exit code for this error class. Subclasses override. */
  static readonly exitCode: number = 1;
  override readonly name: string = "OmoError";
}

/** User passed a stack name that doesn't exist on disk. */
export class StackNotFoundError extends OmoError {
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

/** History entry id that doesn't resolve to a file. */
export class HistoryEntryNotFoundError extends OmoError {
  static override readonly exitCode = 2;
  override readonly name = "HistoryEntryNotFoundError";
  constructor(public readonly id: string) {
    super(`History entry "${id}" not found.`);
  }
}

/** state.json missing or corrupt and the operation needs it. */
export class NoActiveStackError extends OmoError {
  static override readonly exitCode = 1;
  override readonly name = "NoActiveStackError";
  constructor(message = "No active stack. Run `omo-router init` first.") {
    super(message);
  }
}

/** A JSON file on disk failed schema validation. */
export class ValidationError extends OmoError {
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
export class ModelValidationError extends OmoError {
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
export class IOError extends OmoError {
  static override readonly exitCode = 3;
  override readonly name = "IOError";
  readonly causedBy: unknown;
  constructor(message: string, causedBy?: unknown) {
    super(message);
    this.causedBy = causedBy;
  }
}

/** User passed bad arguments or attempted a refused operation (e.g. rm active without --force). */
export class UserError extends OmoError {
  static override readonly exitCode = 1;
  override readonly name = "UserError";
}
