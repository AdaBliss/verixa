import { asId } from "@verixa/shared-kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { StepUpAuthentication } from "./step-up-authentication.js";
import { InMemoryMfaMethodRepository } from "../../infrastructure/fakes/in-memory-mfa-method-repository.js";
import { MfaMethod, type UserId } from "../../domain/entities/mfa-method.js";
import { TotpAlgorithm } from "../../domain/services/totp-algorithm.js";
import { TotpSecret } from "../../domain/value-objects/totp-secret.js";
import { InMemorySessionRepository } from "../../../sessions/infrastructure/testing/in-memory-session-repository.js";
import { Session, type SessionUserId } from "../../../sessions/domain/entities/session.js";
import { BackupCodeSet } from "../../domain/services/backup-code-set.js";

class FakeAuditLogger {
  async record(event: string, userId: string, metadata?: Record<string, string>): Promise<void> {}
}

const userId = asId<"UserId">("11111111-1111-1111-1111-111111111111");

describe("StepUpAuthentication", () => {
  let mfaMethodRepository: InMemoryMfaMethodRepository;
  let sessionRepository: InMemorySessionRepository;
  let totpAlgorithm: TotpAlgorithm;
  let auditLogger: FakeAuditLogger;
  let stepUpAuthentication: StepUpAuthentication;

  beforeEach(async () => {
    mfaMethodRepository = new InMemoryMfaMethodRepository();
    sessionRepository = new InMemorySessionRepository();
    totpAlgorithm = new TotpAlgorithm();
    auditLogger = new FakeAuditLogger();
    stepUpAuthentication = new StepUpAuthentication(
      mfaMethodRepository,
      sessionRepository,
      totpAlgorithm,
      auditLogger
    );
  });

  it("succeeds with fresh TOTP verification and updates session stepUpVerifiedAt", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const secretResult = TotpSecret.generate();
    const secret = secretResult.value.secret;

    const method = MfaMethod.create(userId, "totp", secret);
    const activated = method.activate(now);
    await mfaMethodRepository.save(activated);

    const validCode = totpAlgorithm.generate(secret, now);

    const sessionIssuance = Session.issue({
      userId,
      metadata: {},
      accessToken: { tokenId: "token-1", expiresAt: new Date(now.getTime() + 60_000) },
      now,
    });
    await sessionRepository.save(sessionIssuance.session);

    const result = await stepUpAuthentication.execute({
      sessionId: sessionIssuance.session.id,
      userId,
      methodType: "totp",
      code: validCode,
      now,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.value.stepUpVerifiedAt).toEqual(now);
    expect(result.value.isStepUpFresh(300_000, now)).toBe(true);
  });

  it("rejects stale step-up state when max age has passed", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const sessionIssuance = Session.issue({
      userId,
      metadata: {},
      accessToken: { tokenId: "token-1", expiresAt: new Date(now.getTime() + 60_000) },
      now,
    });
    const steppedUp = sessionIssuance.session.recordStepUp(now);

    const later = new Date(now.getTime() + 400_000);
    expect(steppedUp.isStepUpFresh(300_000, later)).toBe(false);
  });

  it("succeeds using backup codes and updates session stepUpVerifiedAt", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const gen = await BackupCodeSet.generate();
    const backupMethod = MfaMethod.create(userId, "backup_codes", JSON.stringify(gen.hashedCodes));
    backupMethod.activate(now);
    await mfaMethodRepository.save(backupMethod);

    const sessionIssuance = Session.issue({
      userId,
      metadata: {},
      accessToken: { tokenId: "token-1", expiresAt: new Date(now.getTime() + 60_000) },
      now,
    });
    await sessionRepository.save(sessionIssuance.session);

    const result = await stepUpAuthentication.execute({
      sessionId: sessionIssuance.session.id,
      userId,
      methodType: "backup_codes",
      code: gen.rawCodes[0]!,
      now,
    });

    expect(result.kind).toBe(
      "ok"
    );
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.value.stepUpVerifiedAt).toEqual(now);
  });
});
