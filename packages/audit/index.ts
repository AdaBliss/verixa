// Curated public surface of @verixa/audit. Deep imports are blocked by the
// boundary rule in eslint.config.mjs — see docs/guides/domain-modeling.md.

// Domain: AuditLogEntry (Phase 01 hash-chained audit log)
export {
  type AuditAction as AuditLogAction,
  AuditLogEntry,
  type AuditLogEntryId,
  type ChainBreak,
  GENESIS_HASH,
  verifyChain,
} from "./domain/entities/audit-log-entry.js";

// Domain: AuditEvent (Phase 10 structured audit events)
export { AuditEvent, type AuditEventId } from "./domain/entities/audit-event.js";
export type {
  AuditAction,
  ResourceType,
  OrganizationId,
} from "./domain/entities/audit-event.js";
export { type AuditAction as AuditActionType } from "./domain/value-objects/audit-action.js";
export { isAuditAction } from "./domain/value-objects/audit-action.js";

// Domain: AuditMetadata (Issue 196 — the bounds and per-sink encodings that
// keep a crafted metadata value from speaking for the record)
export {
  AuditMetadata,
  escapeForText,
  escapeJsonLineTerminators,
  MAX_METADATA_ENTRIES,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
  METADATA_REJECTED_KEY,
  neutralizeFormulaPrefix,
  rejectionReasonOf,
  utf8ByteLength,
} from "./domain/value-objects/audit-metadata.js";
export type { AuditMetadataRejectionReason } from "./domain/value-objects/audit-metadata.js";

// Application: ports (AuditLogRepository - Phase 01)
export type {
  AnchorFailure,
  AnchorReceiptLike,
  AnchorRecord,
  AnchorRecordRepository,
  AuditLogFilters,
  AuditLogRepository,
  FindWithFiltersParams,
  HashAnchorPort,
} from "./application/ports/audit-log-repository.js";

// Application: ports (AuditEventRepository - Phase 10)
export type {
  AuditEventRepository,
  AuditEventFilters,
  PaginationParams,
  PaginatedAuditEvents,
  AppendAuditEventError,
} from "./application/ports/audit-event-repository.js";
export {
  databaseUnavailableError,
  constraintViolationError,
  unknownAppendError,
} from "./application/ports/audit-event-repository.js";

// Application: use cases
export {
  AnchorAuditLog,
  type AnchorAuditLogError,
  type AnchorAuditLogResult,
} from "./application/use-cases/anchor-audit-log.js";
export {
  RecordAuditEvent,
  type RecordAuditEventCommand,
} from "./application/use-cases/record-audit-event.js";
export {
  AUDIT_EXPORT_HEADER,
  DEFAULT_EXPORT_MAX_RECORDS,
  ExportAuditEvents,
  type AuditExportFormat,
  type AuditExportLogger,
  type ExportAuditEventsCommand,
  type ExportAuditEventsResult,
} from "./application/use-cases/export-audit-events.js";
export {
  AgeRetentionPolicy,
  DEFAULT_RETENTION_POLICY,
  DEFAULT_RETENTION_WINDOW_DAYS,
  type RetentionPolicy,
  type RetentionWindow,
} from "./application/ports/retention-policy.js";
export {
  ApplyAuditRetentionPolicy,
  type ApplyRetentionPolicyCommand,
  type RetentionCandidate,
  type RetentionReview,
} from "./application/use-cases/apply-audit-retention-policy.js";
export {
  QueryAuditEvents,
  type QueryAuditEventsCommand,
  type QueryAuditEventsFilters,
  type QueryAuditEventsResult,
} from "./application/use-cases/query-audit-events.js";

// Application: subscribers
export { AuditEventSubscriber } from "./application/subscribers/audit-event-subscriber.js";
export {
  SessionCreatedAuditSubscriber,
  SessionRevokedAuditSubscriber,
} from "./application/subscribers/session-audit-subscriber.js";
export {
  RoleAssignedAuditSubscriber,
  PermissionGrantedAuditSubscriber,
} from "./application/subscribers/rbac-audit-subscriber.js";

// Infrastructure
export {
  AuditLogEntryMapper,
  PrismaAnchorRecordRepository,
  PrismaAuditLogRepository,
} from "./infrastructure/persistence/prisma-audit-repositories.js";
export {
  InMemoryAnchorRecordRepository,
  InMemoryAuditLogRepository,
} from "./infrastructure/testing/in-memory-audit-repositories.js";
