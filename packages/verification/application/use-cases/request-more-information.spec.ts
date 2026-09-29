import { Result } from "@verixa/shared-kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { VerificationRequest } from "../../domain/entities/verification-request.js";
import { InMemoryVerificationRequestRepository } from "../../infrastructure/fakes/in-memory-verification-request-repository.js";
import { RequestMoreInformation } from "./request-more-information.js";

describe("RequestMoreInformation", () => {
  let repository: InMemoryVerificationRequestRepository;
  let useCase: RequestMoreInformation;

  beforeEach(() => {
    repository = new InMemoryVerificationRequestRepository();
    useCase = new RequestMoreInformation(repository);
  });

  it("transitions request to needs_more_info with a note", async () => {
    const request = VerificationRequest.register({
      subjectUserId: "user-1" as any,
      orgId: "org-1" as any,
      verificationType: "identity-document",
    });
    await repository.save(request);

    const result = await useCase.execute({
      requestId: request.id,
      reviewerId: "reviewer-1",
      note: "Please provide a clearer photo of the ID front.",
    });

    expect(Result.isOk(result)).toBe(true);
    if (!Result.isOk(result)) return;

    expect(result.value.status).toBe("needs_more_info");
    expect(result.value.reviewNote).toBe("Please provide a clearer photo of the ID front.");
  });

  it("rejects empty notes", async () => {
    const request = VerificationRequest.register({
      subjectUserId: "user-1" as any,
      orgId: "org-1" as any,
      verificationType: "identity-document",
    });
    await repository.save(request);

    const result = await useCase.execute({
      requestId: request.id,
      reviewerId: "reviewer-1",
      note: "   ",
    });

    expect(Result.isErr(result)).toBe(true);
  });
});
