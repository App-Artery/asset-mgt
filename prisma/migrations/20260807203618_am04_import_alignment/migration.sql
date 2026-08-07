-- AM-04 — align the schema with the client's Asset Tiger export.
--
-- Prisma's generated warning about the two required ImportBatch columns is
-- correct in general and moot here: ImportBatch has existed since the init
-- migration and has never been written to (it was scaffolded for this story).
-- Verified empty before applying. If that were ever untrue, these two would
-- need a backfill rather than a bare NOT NULL.
--
-- The Asset_tag_required_when_tracked CHECK from am02_asset_lifecycle is NOT
-- touched by anything below: it constrains "tag" against "status", and no
-- column in that expression is altered here. Dropping NOT NULL from make and
-- model cannot weaken it.

-- Asset ------------------------------------------------------------------
--
-- Five new columns for export fields with a settled meaning. `PID` and
-- `Asset Type` deliberately get NO column (AM-04-C4): the one observed value
-- of Asset Type is the code "CE" and nobody can state what it means. A column
-- holding an unexplained value gets rendered, exported and depended upon —
-- worse than no column. Decided from the full-export census instead (C31).
--
-- make and model lose NOT NULL because the client's real rows leave Brand and
-- Model BLANK and carry the whole of what an asset is in Description. The two
-- alternatives were both worse: deriving make from the description works for
-- "HP …" and invents a manufacturer for everything else, unrecoverably; and
-- rejecting blank-Brand rows would have quarantined most of a ~400-row cutover.
--
-- NOTE for anyone reading asset-search.ts afterwards: the empty-term guard
-- there (`if (contains === "") return {}`) is masked by a non-nullable column
-- making ILIKE '%%' match everything anyway. This migration does not expose it
-- — the masking MOVES from make/model to category.name, which is non-nullable
-- behind a required FK. Do not write a test claiming to red-prove that guard;
-- it is still not result-set-falsifiable (AM-04-C26).
ALTER TABLE "Asset" ADD COLUMN     "costCentre" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "poNumber" TEXT,
ALTER COLUMN "make" DROP NOT NULL,
ALTER COLUMN "model" DROP NOT NULL;

-- ImportBatch ------------------------------------------------------------
--
-- Becomes a bounded STATE row (AM-04-C5): written once at run start, updated
-- exactly once at run end, never deleted. Hence the counts gaining defaults
-- and report becoming nullable — at run start neither is known.
--
-- sourceSha256 + rowsHash are what make "the committed data is the previewed
-- data" provable with zero server-side parsed state (AM-04-C21): --commit
-- re-parses the file and recomputes both, refusing on any difference. Two
-- hashes, not one — sourceSha256 catches a swapped file, rowsHash catches a
-- file that differs only in ways the parser normalises away.
ALTER TABLE "ImportBatch" ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "rowsHash" TEXT NOT NULL,
ADD COLUMN     "sourceSha256" TEXT NOT NULL,
ALTER COLUMN "rowsOk" SET DEFAULT 0,
ALTER COLUMN "rowsFailed" SET DEFAULT 0,
ALTER COLUMN "report" DROP NOT NULL;

-- Person -----------------------------------------------------------------
--
-- A HOLDER IS NOT NECESSARILY A SYSTEM USER. Login identity is User.email,
-- which keeps NOT NULL and its unique index. The schema already agreed
-- everywhere else: Person.user is optional, and assertPersonAssignable
-- documents that a person with no User is fully assignable.
--
-- The unique index is KEPT. Postgres permits many NULLs in a unique index, so
-- any number of imported people may have no email — but exactly one '', which
-- is why a blank email must normalise to NULL (AM-04-C2). Identical trap to
-- Asset.tag in am02_asset_lifecycle.
--
-- What this costs, accepted deliberately: it removes the dedupe key for
-- exactly the rows the import creates. Assignee resolution is therefore
-- exact-unique-or-nothing with human sign-off (C8/C9), and two concurrent
-- import runs are kept apart by a session advisory lock rather than by this
-- index (C22).
ALTER TABLE "Person" ALTER COLUMN "email" DROP NOT NULL;
