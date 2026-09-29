import { Result, ValidationError } from "@verixa/shared-kernel";
import type { VerificationRequest } from "../../domain/entities/verification-request.js";
import type { VerificationRequestRepository } from "../ports/verification-request-repository.js";

export interface RequestMoreInformationCommand {
  readonly requestId: string;
  readonly reviewerId: string;
  readonly note: string;
}

export type RequestMoreInformationError = ValidationError | Error;

export class RequestMoreInformation {
  constructor(private readonly verificationRequestRepository: VerificationRequestRepository) {}

  async execute(
    command: RequestMoreInformationCommand,
  ): Promise<Result<VerificationRequest, RequestMoreInformationError>> {
    if (!command.note || command.note.trim() === "") {
      return Result.err(new ValidationError("A note describing what missing information is required."));
    }

    const request = await this.verificationRequestRepository.findById(command.requestId as any);
    if (!request) {
      return Result.err(new ValidationError("Verification request not found."));
    }

    const transitionResult = request.requestMoreInformation(command.reviewerId, command.note);
    if (Result.isErr(transitionResult)) {
      return transitionResult;
    }

    await this.verificationRequestRepository.save(request);

    return Result.ok(request);
  }
}
