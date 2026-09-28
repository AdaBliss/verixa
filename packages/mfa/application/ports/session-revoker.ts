import type { Id } from "@verixa/shared-kernel";

/**
 * Port for revoking all active sessions belonging to a user.
 *
 * Provided as a port rather than a direct dependency on `@verixa/sessions`
 * to keep the `@verixa/mfa` package free of a hard session-layer dependency.
 * The adapter — wired up by the application host — delegates to `LogoutEverywhere`
 * from `@verixa/sessions`.
 *
 * Why a separate port rather than importing `LogoutEverywhere` directly?
 * `@verixa/mfa` should not know about `@verixa/sessions` — the dependency
 * would flow the wrong way. The recovery use case needs to revoke sessions,
 * but it should not understand how sessions work. A thin port describes the
 * capability needed; the host wires in whatever satisfies it.
 */
export interface SessionRevoker {
  revokeAllForUser(userId: Id<"UserId">): Promise<{ revokedCount: number }>;
}
