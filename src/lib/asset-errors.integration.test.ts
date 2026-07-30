// @vitest-environment node
//
// Nit N2. The error classifier is defence in depth: every application path
// that could produce a tag CHECK violation is stopped earlier by
// TagRequiredError, so driving these branches through a server action is not
// possible. That is exactly why the classifier is tested directly — and
// against errors Postgres genuinely raised, never hand-built fakes, because
// the whole question is what Prisma's real error objects look like.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALREADY_ASSIGNED_MESSAGE,
  DUPLICATE_TAG_MESSAGE,
  TAG_REQUIRED_MESSAGE,
  isTagConstraintViolation,
  mapAssetError,
} from "@/lib/asset-errors";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/**
 * The client's tag scheme is numeric, so a tag containing the SQLSTATE digits
 * is entirely plausible. A unique suffix keeps the shared test database from
 * colliding across runs; what matters is that "23514" appears in the tag, and
 * therefore in the text of any error Prisma raises about that row.
 */
const SQLSTATE_DIGITS = "23514";
const lookalikeTag = () => `${SQLSTATE_DIGITS}-${randomUUID().slice(0, 8)}`;

describe.skipIf(!testDatabaseUrl)("asset error mapping (real DB)", () => {
  let db: PrismaClient;
  let categoryId: string;

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const category = await db.category.create({
      data: { name: `Errors ${randomUUID()}` },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  /** Runs a failing write and hands back the error Postgres/Prisma produced. */
  async function capture(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      await fn();
    } catch (error) {
      return error;
    }
    throw new Error("Expected the operation to fail, but it succeeded");
  }

  async function anAsset(tag: string | null) {
    return db.asset.create({
      data: {
        categoryId,
        make: "Errors",
        model: "Probe",
        tag,
        status: tag === null ? "ON_ORDER" : "IN_STOCK",
      },
    });
  }

  it("maps a model-layer CHECK violation to the tag message", async () => {
    const asset = await anAsset(`ERR-${randomUUID().slice(0, 8)}`);
    // Prisma reports this shape as PrismaClientUnknownRequestError with no
    // `code` field — the constraint name lives only in the message text.
    const error = await capture(() =>
      db.asset.update({ where: { id: asset.id }, data: { tag: null } }),
    );

    expect(isTagConstraintViolation(error)).toBe(true);
    expect(mapAssetError(error)).toEqual({
      ok: false,
      message: TAG_REQUIRED_MESSAGE,
    });
  });

  it("maps a raw-query CHECK violation (P2010) to the tag message", async () => {
    const asset = await anAsset(`ERR-${randomUUID().slice(0, 8)}`);
    const error = await capture(() =>
      db.$executeRawUnsafe(
        `UPDATE "Asset" SET "tag" = '' WHERE "id" = $1`,
        asset.id,
      ),
    );

    expect(isTagConstraintViolation(error)).toBe(true);
    expect(mapAssetError(error)).toEqual({
      ok: false,
      message: TAG_REQUIRED_MESSAGE,
    });
  });

  // The N2 regression itself.
  //
  // Postgres puts the offending row values into the DETAIL line of a raw-query
  // error ("Key (tag)=(23514-…) already exists"), and Prisma passes that text
  // through on P2010. So an asset whose tag contains the SQLSTATE digits — the
  // client's tag scheme is numeric — plants "23514" inside an error that is
  // NOT a check violation. The bare-SQLSTATE matcher classified that as a tag
  // problem and swallowed it into a form message; matching the constraint name
  // rethrows it, which is what a unique-index failure deserves.
  describe(`an unrelated raw failure dumping a tag containing "${SQLSTATE_DIGITS}"`, () => {
    it("is not classified as a tag-constraint violation", async () => {
      const takenTag = lookalikeTag();
      await anAsset(takenTag);
      const other = await anAsset(`ERR-${randomUUID().slice(0, 8)}`);

      // Raw, so the failure arrives as P2010 with Postgres' DETAIL text
      // attached, rather than as a Prisma-normalised P2002.
      const error = await capture(() =>
        db.$executeRawUnsafe(
          `UPDATE "Asset" SET "tag" = $2 WHERE "id" = $1`,
          other.id,
          takenTag,
        ),
      );

      // Guard the premise: the test is only meaningful because the digits are
      // genuinely present in the message text.
      expect((error as Error).message).toContain(SQLSTATE_DIGITS);
      expect((error as Error).message).not.toContain(
        "Asset_tag_required_when_tracked",
      );

      expect(isTagConstraintViolation(error)).toBe(false);
      // null means "the caller must rethrow" — a unique-index failure is not a
      // missing tag, and reporting it as one hides a real bug.
      expect(mapAssetError(error)).toBeNull();
    });
  });

  it("maps a duplicate tag to the duplicate message, not the tag message", async () => {
    const tag = `ERR-${randomUUID().slice(0, 8)}`;
    await anAsset(tag);
    const error = await capture(() => anAsset(tag));

    expect(mapAssetError(error)).toEqual({
      ok: false,
      message: DUPLICATE_TAG_MESSAGE,
    });
  });

  it("maps an open-assignment collision to the assignment message, not the tag one", async () => {
    // AM-03 made P2002 ambiguous: it now means EITHER a duplicate tag OR a
    // second open assignment. The discriminator reads Prisma's meta.target, so
    // it must be pinned against an error Postgres genuinely raised — an assumed
    // error shape is precisely what this cannot rest on.
    //
    // Unreachable through the actions (the lifecycle guard rejects
    // ASSIGNED -> ASSIGNED before the index is consulted), which is exactly why
    // it is driven directly here — same reasoning as the CHECK branches above.
    const asset = await anAsset(`ASG-${randomUUID().slice(0, 8)}`);
    const holder = await db.person.create({
      data: {
        name: "Errors Holder",
        email: `errors-holder-${randomUUID()}@example.com`,
      },
    });
    const other = await db.person.create({
      data: {
        name: "Errors Other",
        email: `errors-other-${randomUUID()}@example.com`,
      },
    });
    await db.assignment.create({
      data: { assetId: asset.id, personId: holder.id },
    });

    const error = await capture(() =>
      db.assignment.create({
        data: { assetId: asset.id, personId: other.id },
      }),
    );

    expect(mapAssetError(error)).toEqual({
      ok: false,
      message: ALREADY_ASSIGNED_MESSAGE,
    });
  });

  it("returns null for an error it does not recognise", async () => {
    expect(mapAssetError(new Error("something else entirely"))).toBeNull();
    expect(isTagConstraintViolation(new Error("23514"))).toBe(false);
  });
});
