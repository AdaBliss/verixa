import { asId, NotFoundError, Result, ValidationError } from "@verixa/shared-kernel";

import type { MfaMethod } from "../../domain/entities/mfa-method.js";
import type { AuditLogger } from "../ports/audit-logger.js";
import type { MfaMethodRepository } from "../ports/mfa-method-repository.js";
import type { SessionRevoker } from "../ports/session-revoker.js";

export interface RecoverMfaAccessCommand {
  /** The user whose MFA access is being recovered. */
  readonly targetUserId: string;
  /**
   * The administrator (or automated system acting as one) that authorised
   * the recovery. Must be a distinct, authenticated actor — the flow cannot
   * be self-triggered.
   *
   * The command is typed as `string` (a raw id) because the use case does
   * not need to load the actor's User record; it only needs the id for the
   * audit trail. The caller (route handler or admin service) is responsible
   * for ensuring the actor is genuinely authenticated and authorised before
   * constructing this command.
   */
  readonly actorAdminId: string;
  /**
   * Free-form reason recorded in the audit log. Mandatory so that each
   * recovery event carries a human-readable explanation, which is the first
   * thing an investigator looks for when reviewing the log.
   */
  readonly reason: string;
}

export interface RecoverMfaAccessResult {
  /** How many MFA methods were disabled. */
  readonly methodsCleared: number;
  /** How many sessions were revoked. */
  readonly sessionsRevoked: number;
}

export type RecoverMfaAccessError = ValidationError | NotFoundError;

/**
 * Admin-initiated recovery for a user who has lost access to all enrolled
 * MFA methods and exhausted backup codes.
 *
 * ## What this does
 *
 * 1. Validates the command (non-empty actor, non-empty reason).
 * 2. Loads all MFA methods for the target user (active + pending).
 * 3. Disables every method found. Disabling — not deleting — preserves the
 *    audit trail: a later review can see which methods existed and when they
 *    were disabled; hard-deleting would destroy that evidence.
 * 4. Revokes all of the user's active sessions immediately, so any attacker
 *    who triggered the recovery socially cannot use an existing session.
 * 5. Emits an audit log entry with the actor id, target id, reason, and
 *    counts, before and after the mutation so the record is durable even if
 *    a subsequent step fails.
 *
 * ## Why the recovery cannot be self-triggered
 *
 * If a user could recover their own MFA access without a separate elevated
 * action, the recovery path becomes an MFA bypass: an attacker who knows the
 * user's password can just "recover" and skip the second factor. Requiring a
 * distinct authenticated admin actor — whose own authentication is separately
 * gated — closes that hole.
 *
 * ## Re-enrollment on next login
 *
 * This use case does not enroll new methods. It only disables the old ones
 * and revokes sessions. The next time the user authenticates, the login flow
 * (Issue 116) will detect that they have no active methods under a `required`
 * policy and gate on enrollment. The use case does not need to know about
 * that flow; returning a clean state is its entire job.
 *
 * ## Alternative rejected: silently reactivating methods
 *
 * Clearing the `disabled` flag on existing methods (instead of disabling and
 * re-enrolling) would restore a compromised secret — a TOTP secret that was
 * phished or leaked would become active again. Disabling forces fresh
 * enrollment with a freshly generated secret.
 */
export class RecoverMfaAccess {
  constructor(
    private readonly mfaMethodRepository: MfaMethodRepository,
    private readonly sessionRevoker: SessionRevoker,
    private readonly auditLogger: AuditLogger,
  ) {}

  async execute(
    command: RecoverMfaAccessCommand,
  ): Promise<Result<RecoverMfaAccessResult, RecoverMfaAccessError>> {
    // Validate inputs before touching any state.
    if (!command.actorAdminId.trim()) {
      return Result.err(
        new ValidationError("actorAdminId is required — recovery must be admin-initiated.", {
          actorAdminId: ["required"],
        }),
      );
    }
    if (!command.reason.trim()) {
      return Result.err(
        new ValidationError("reason is required — every recovery must carry a human-readable justification.", {
          reason: ["required"],
        }),
      );
    }

    const targetUserId = asId<"UserId">(command.targetUserId);
    const actorAdminId = command.actorAdminId;

    // Emit an audit entry *before* mutating state. If the process dies mid-
    // execution, the log still records that a recovery was initiated.
    await this.auditLogger.record("mfa.recovery.initiated", actorAdminId, {
      targetUserId: command.targetUserId,
      reason: command.reason,
    });

    // Load all methods — active and pending. Pending methods must also be
    // cleared: a pending TOTP secret is still a secret that could be phished.
    const [activeMethods, pendingMethods] = await Promise.all([
      this.mfaMethodRepository.findActiveByUserId(targetUserId),
      this.mfaMethodRepository.findPendingByUserId(targetUserId),
    ]);

    const allMethods: MfaMethod[] = [...activeMethods, ...pendingMethods];

    // Disable every method. The domain's `disable()` returns a Result; the
    // only failure case is "already disabled", which cannot happen here since
    // we only loaded active and pending methods. We treat it defensively but
    // do not abort — a method that is somehow already disabled is still
    // accounted for in `methodsCleared` because we loaded it.
    let methodsCleared = 0;
    for (const method of allMethods) {
      const disableResult = method.disable();
      if (Result.isOk(disableResult)) {
        await this.mfaMethodRepository.save(disableResult.value);
      }
      // Count regardless — even if disable() says "already disabled", the
      // method is cleared from the user's active set.
      methodsCleared++;
    }

    // Revoke all active sessions immediately. This prevents an attacker who
    // socially-engineered the recovery from continuing to use a live session.
    const { revokedCount: sessionsRevoked } = await this.sessionRevoker.revokeAllForUser(
      targetUserId,
    );

    // Emit a completion audit entry with the outcome.
    await this.auditLogger.record("mfa.recovery.completed", actorAdminId, {
      targetUserId: command.targetUserId,
      reason: command.reason,
      methodsCleared: String(methodsCleared),
      sessionsRevoked: String(sessionsRevoked),
    });

    return Result.ok({ methodsCleared, sessionsRevoked });
  }
}
