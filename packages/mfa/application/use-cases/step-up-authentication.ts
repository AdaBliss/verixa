import { Result, AccountLockedError, ValidationError, asId } from "@verixa/shared-kernel";
import type { MfaMethodRepository } from "../ports/mfa-method-repository.js";
import type { AuditLogger } from "../ports/audit-logger.js";
import type { TotpAlgorithm } from "../../domain/services/totp-algorithm.js";
import { BackupCodeSet } from "../../domain/services/backup-code-set.js";
import type { SessionRepository } from "../../../sessions/application/ports/session-repository.js";
import type { Session, SessionId } from "../../../sessions/domain/entities/session.js";

export interface StepUpAuthenticationCommand {
  readonly sessionId: string;
  readonly userId: string;
  readonly methodType: "totp" | "backup_codes";
  readonly code: string;
  readonly maxAgeMs?: number;
  readonly now?: Date;
}

export type StepUpAuthenticationResult = Result<Session, Error | AccountLockedError | ValidationError>;

/**
 * Requires re-verification of an active MFA method for an already-authenticated session
 * before allowing a sensitive action, issuing a short-lived stepUpVerifiedAt claim.
 */
export class StepUpAuthentication {
  constructor(
    private readonly mfaMethodRepository: MfaMethodRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly totpAlgorithm: TotpAlgorithm,
    private readonly auditLogger: AuditLogger
  ) {}

  async execute(command: StepUpAuthenticationCommand): Promise<StepUpAuthenticationResult> {
    const now = command.now ?? new Date();
    const sessionId = asId<"SessionId">(command.sessionId);
    const userId = command.userId as any;

    // 1. Fetch the session
    const session = await this.sessionRepository.findById(sessionId);
    if (!session || !session.isActiveAt(now)) {
      return Result.err(new ValidationError("Active session not found."));
    }

    if (session.userId !== userId) {
      return Result.err(new ValidationError("Session does not belong to the specified user."));
    }

    // 2. Verify according to method type reusing existing logic
    if (command.methodType === "totp") {
      if (!command.code || command.code.length !== 6) {
        return Result.err(new ValidationError("TOTP code must be 6 digits."));
      }

      const activeMethods = await this.mfaMethodRepository.findActiveByUserId(userId);
      const totpMethod = activeMethods.find(m => m.type === "totp");
      if (!totpMethod || !totpMethod.secret) {
        return Result.err(new Error("No active TOTP method found."));
      }

      if (totpMethod.isLockedAt(now)) {
        return Result.err(new AccountLockedError("MFA verification is rate-limited."));
      }

      const matchedStep = await this.totpAlgorithm.verify(totpMethod.secret, command.code);
      if (matchedStep === null) {
        const updatedMethod = totpMethod.recordFailedAttempt(now);
        await this.mfaMethodRepository.save(updatedMethod);
        await this.auditLogger.record("step_up.failed", userId, { type: "totp" });
        return Result.err(new Error("Invalid TOTP code."));
      }

      // Reset failed attempts on success
      await this.mfaMethodRepository.save(totpMethod);
    } else if (command.methodType === "backup_codes") {
      if (!command.code) {
        return Result.err(new ValidationError("Backup code is required."));
      }

      const activeMethods = await this.mfaMethodRepository.findActiveByUserId(userId);
      const backupMethod = activeMethods.find(m => m.type === "backup_codes");
      if (!backupMethod || !backupMethod.secret) {
        await this.auditLogger.record("step_up.failed", userId, { type: "backup_codes" });
        return Result.err(new Error("Invalid backup code."));
      }

      let hashes: string[];
      try {
        hashes = JSON.parse(backupMethod.secret);
      } catch {
        return Result.err(new Error("Invalid backup code storage."));
      }

      let matchedIndex = -1;
      for (let i = 0; i < hashes.length; i++) {
        const isValid = await BackupCodeSet.verify(command.code, hashes[i]!);
        if (isValid) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex === -1) {
        await this.auditLogger.record("step_up.failed", userId, { type: "backup_codes" });
        return Result.err(new Error("Invalid backup code."));
      }

      hashes.splice(matchedIndex, 1);
      backupMethod.updateSecret(JSON.stringify(hashes));
      await this.mfaMethodRepository.save(backupMethod);
    } else {
      return Result.err(new ValidationError("Unsupported MFA method type for step-up."));
    }

    // 3. Update session with stepUpVerifiedAt
    const steppedUpSession = session.recordStepUp(now);
    await this.sessionRepository.save(steppedUpSession);

    await this.auditLogger.record("step_up.success", userId, { type: command.methodType });

    return Result.ok(steppedUpSession);
  }
}
