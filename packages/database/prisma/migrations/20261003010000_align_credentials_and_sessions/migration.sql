-- Brings two tables back in line with schema.prisma.
--
-- Both were drift reported by `prisma migrate diff`: the schema described
-- something replaying the migrations would never produce.

-- `password_history` was created as JSON but the schema maps it to `Json`,
-- which Prisma emits as JSONB.
--
-- The difference is not cosmetic. JSON stores the original text and reparses
-- on every read; JSONB stores a decomposed binary form, which is what makes
-- containment operators and GIN indexes available. Code written against the
-- schema would assume the latter.
ALTER TABLE "credentials"
    ALTER COLUMN "password_history" TYPE JSONB USING "password_history"::JSONB;

-- `sessions.user_id` had a relation in the schema but no foreign key in the
-- database, so nothing stopped a session referencing a user that does not
-- exist, and deleting a user left its sessions behind.
--
-- CASCADE matches `credentials`: a session belonging to a deleted user is
-- unusable by definition, and retaining it keeps a record of who was signed
-- in from where after the account is gone.
ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
