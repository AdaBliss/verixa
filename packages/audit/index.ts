// Curated public surface of @verixa/audit. Deep imports are blocked by the
// boundary rule in eslint.config.mjs — see docs/guides/domain-modeling.md.

// Domain
export {
  type AuditAction,
  AuditLogEntry,
  type AuditLogEntryId,
  type ChainBreak,
  GENESIS_HASH,
  verifyChain,
} from "./domain/entities/audit-log-entry.js";

// Application: ports
export { ChainConflictError } from "./application/ports/audit-log-repository.js";
export type {
  AnchorFailure,
  AnchorReceiptLike,
  AnchorRecord,
  AnchorRecordRepository,
  AuditLogRepository,
  HashAnchorPort,
} from "./application/ports/audit-log-repository.js";

// Application: use cases
export {
  AnchorAuditLog,
  type AnchorAuditLogError,
  type AnchorAuditLogResult,
} from "./application/use-cases/anchor-audit-log.js";
export {
  type AuditRecorder,
  RecordAuditEvent,
  type RecordAuditEventCommand,
  recordAuditEventBatch,
} from "./application/use-cases/record-audit-event.js";

// Infrastructure
export {
  AuditQueueFullError,
  type AuditBatchFailureReport,
  type AuditOverflowReport,
  type AuditWriterStats,
  BatchedAuditWriter,
  type BatchedAuditWriterOptions,
} from "./infrastructure/persistence/batched-audit-writer.js";
export {
  type AuditDelegate,
  AuditLogEntryMapper,
  type AuditTransaction,
  PrismaAnchorRecordRepository,
  PrismaAuditLogRepository,
} from "./infrastructure/persistence/prisma-audit-repositories.js";
export {
  InMemoryAnchorRecordRepository,
  InMemoryAuditLogRepository,
} from "./infrastructure/testing/in-memory-audit-repositories.js";
