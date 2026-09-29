import { Result, type Id } from "@verixa/shared-kernel";

export type VerificationRequestId = Id<"VerificationRequestId">;
export type ReviewerId = Id<"ReviewerId">;

export interface ReviewAssignmentProps {
  readonly requestId: VerificationRequestId;
  readonly reviewerId: ReviewerId;
  readonly assignedAt: Date;
  readonly claimExpiresAt: Date;
}

/**
 * Represents a reviewer's temporary optimistic lease (claim) on a verification
 * request in the review queue. Prevents multiple reviewers from working the
 * same case simultaneously and auto-releases stale claims when sessions expire.
 */

export class ReviewAssignment {
  readonly requestId: VerificationRequestId;
  readonly reviewerId: ReviewerId;
  readonly assignedAt: Date;
  readonly claimExpiresAt: Date;

  private constructor(props: ReviewAssignmentProps) {
    this.requestId = props.requestId;
    this.reviewerId = props.reviewerId;
    this.assignedAt = props.assignedAt;
    this.claimExpiresAt = props.claimExpiresAt;
  }

  static create(props: ReviewAssignmentProps): Result<ReviewAssignment, Error> {
    if (props.claimExpiresAt <= props.assignedAt) {
      return Result.err(new Error("Claim expiration must be later than assignment time"));
    }
    return Result.ok(new ReviewAssignment(props));
  }

  isExpired(now: Date = new Date()): boolean {
    return now >= this.claimExpiresAt;
  }

  isActive(now: Date = new Date()): boolean {
    return !this.isExpired(now);
  }

  extend(newExpiry: Date): Result<ReviewAssignment, Error> {
    if (newExpiry <= this.assignedAt) {
      return Result.err(new Error("New claim expiration must be later than assignment time"));
    }
    return Result.ok(
      new ReviewAssignment({
        requestId: this.requestId,
        reviewerId: this.reviewerId,
        assignedAt: this.assignedAt,
        claimExpiresAt: newExpiry,
      }),
    );
  }
}
