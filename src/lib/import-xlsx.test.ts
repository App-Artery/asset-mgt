// The AM-04 XLSX reader as a contract, and its guards as red-provable claims.
// Pure module, no DB.
//
// Every workbook here is built in code (advisor condition AM-04-C39). The
// client's real export is gitignored and carries three staff names; a fixture
// that reproduces its awkward SHAPES — sparse cells, text in a money column,
// two date encodings in one file — proves what the real file would prove and
// can be read by a reviewer.
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  ASSET_TIGER_HEADERS,
  assetTigerWorkbook,
  buildWorkbook,
  columnLetter,
  compressiblePayload,
  SAMPLE_ROW,
  understateEntrySize,
} from "../../test/xlsx-fixture";
import { parseAssetWorkbook, XLSX_LIMITS } from "@/lib/import-xlsx";

/** Caps wide enough that only the one a test lowers can be the one that fires. */
const WIDE = {
  maxInputBytes: 64 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 1_000_000,
  maxEntries: 4096,
};

const BOMB_BYTES = 4 * 1024 * 1024;

/** A workbook whose worksheet entry IS the bomb — the name is the allowlist's. */
function bombAtWorksheet(): Uint8Array {
  return buildWorkbook({
    extraEntries: {
      "xl/worksheets/sheet1.xml": compressiblePayload(BOMB_BYTES),
    },
    rows: [{ row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] }],
  });
}

function messageFrom(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the parse to throw, and it did not");
}

// ---------------------------------------------------------------------------

describe("parseAssetWorkbook — the export's real shape (AM-04-C39)", () => {
  it("reads the 21 headers and the single data row, dropping the 187 formatting-only rows", () => {
    const sheet = parseAssetWorkbook(assetTigerWorkbook());

    expect(sheet.headers).toEqual([...ASSET_TIGER_HEADERS]);
    // Exact count, not a floor: the template's trailing rows carry a currency
    // style on D and F and no value anywhere, and emitting them would hand the
    // batch runner 187 spurious quarantines.
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0].rowNumber).toBe(2);
    expect(sheet.rows[0].cells).toEqual(SAMPLE_ROW);
  });

  it("returns raw cell values — the serial as a number, the cost as text", () => {
    const [row] = parseAssetWorkbook(assetTigerWorkbook()).rows;

    // 45177 is 2023-09-08. Turning it into a Date is the mapper's job, and the
    // reader handing it over as a number is what keeps that decision in one
    // place instead of half-made here.
    expect(row.cells["Purchase Date"]).toBe(45177);
    expect(typeof row.cells["Purchase Date"]).toBe("number");
    // Design F-F: a shared STRING sitting in a `$0.00`-formatted cell. The
    // strict decimal rule (AM-04-C13) needs to see the text exactly as typed.
    expect(row.cells.Cost).toBe("229.81");
    expect(typeof row.cells.Cost).toBe("string");
    // The other half of F-B: a US-format date string in the same file.
    expect(row.cells["Date Created"]).toBe("07/29/2024 07:08 AM");
  });

  it("omits the four columns with no <c> element rather than inventing empties", () => {
    const [row] = parseAssetWorkbook(assetTigerWorkbook()).rows;

    for (const absent of ["Brand", "Model", "PID", "Site"]) {
      expect(row.cells).not.toHaveProperty(absent);
    }
    // Paired positive: the columns either side of each gap did arrive, so the
    // assertions above are about absent cells and not about an empty parse.
    expect(row.cells["Purchase Date"]).toBe(45177);
    expect(row.cells["Serial No"]).toBe("SN0000000001");
  });
});

describe("columns are resolved by header NAME (AM-04-C14)", () => {
  it("keys sparse cells by name, not by their position among the row's <c> elements", () => {
    const [row] = parseAssetWorkbook(assetTigerWorkbook()).rows;

    // THE misalignment this guard exists for. Serial No is column H, but it is
    // only the SIXTH `<c>` element in the row, because Brand (E) and Model (G)
    // have none. A reader that zipped cells against headers positionally would
    // file "SN0000000001" under "Cost" — which is the sixth HEADER.
    expect(row.cells["Serial No"]).toBe("SN0000000001");
    expect(row.cells.Cost).toBe("229.81");
    expect(row.cells["Asset Type"]).toBe("CE");
  });

  it("does not assume the column order the client's file happens to use", () => {
    const shuffled = [...ASSET_TIGER_HEADERS].reverse();
    const sheet = parseAssetWorkbook(
      assetTigerWorkbook({ headerOrder: shuffled }),
    );

    expect(sheet.headers).toEqual(shuffled);
    expect(sheet.rows[0].cells).toEqual(SAMPLE_ROW);
  });

  it("refuses a value sitting in a column the header row does not name", () => {
    const workbook = buildWorkbook({
      rows: [
        { row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] },
        {
          row: 2,
          cells: [
            { col: "A", text: "KE000001" },
            { col: "C", text: "orphaned" },
          ],
        },
      ],
    });

    expect(() => parseAssetWorkbook(workbook)).toThrow(
      /cell C2 carries a value in a column the header row does not name/,
    );
  });

  it('refuses a cell with no r="" reference rather than guessing its column', () => {
    const workbook = buildWorkbook({
      rows: [{ row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] }],
      sheetDataXml:
        `<row r="1"><c r="A1" t="s"><v>0</v></c></row>` +
        `<row r="2"><c t="s"><v>0</v></c></row>`,
    });

    expect(() => parseAssetWorkbook(workbook)).toThrow(
      /no usable r="" reference/,
    );
  });

  it("refuses a header row that names the same column twice", () => {
    const workbook = buildWorkbook({
      rows: [
        {
          row: 1,
          cells: [
            { col: "A", text: "Cost" },
            { col: "B", text: "Cost" },
          ],
        },
      ],
    });

    expect(() => parseAssetWorkbook(workbook)).toThrow(/names "Cost" twice/);
  });
});

describe("cell types fail closed (AM-04-C37)", () => {
  const workbookWithCell = (cellXml: string) =>
    buildWorkbook({
      rows: [
        {
          row: 1,
          cells: [
            { col: "A", text: "Asset Tag ID" },
            { col: "B", text: "Serial No" },
          ],
        },
        {
          row: 2,
          cells: [
            { col: "A", text: "KE000001" },
            { col: "B", xml: cellXml },
          ],
        },
      ],
    });

  it.each([
    ["inlineStr", `<c r="B2" t="inlineStr"><is><t>SN0000000001</t></is></c>`],
    ["str", `<c r="B2" t="str"><v>SN0000000001</v></c>`],
    ["b", `<c r="B2" t="b"><v>1</v></c>`],
    ["e", `<c r="B2" t="e"><v>#N/A</v></c>`],
    // Legal OOXML and identical in meaning to a bare numeric — refused anyway,
    // because widening the allowlist is a ruling, not a guess.
    ["n", `<c r="B2" t="n"><v>1234</v></c>`],
  ])('refuses t="%s" instead of reading it as empty', (type, cellXml) => {
    expect(() => parseAssetWorkbook(workbookWithCell(cellXml))).toThrow(
      new RegExp(`has cell type "${type}"`),
    );
  });

  it("reads the two types it does handle, so the refusals above are not a dead parse", () => {
    const sheet = parseAssetWorkbook(
      workbookWithCell(`<c r="B2" t="s"><v>1</v></c>`),
    );
    // Shared string index 1 is "Serial No" — the second string interned by the
    // fixture. The point is that the value arrived at all.
    expect(sheet.rows[0].cells["Serial No"]).toBe("Serial No");
  });

  it("refuses a bare numeric cell whose value is not a number", () => {
    expect(() =>
      parseAssetWorkbook(workbookWithCell(`<c r="B2"><v>1,229.81</v></c>`)),
    ).toThrow(/holds "1,229.81", which is not a number/);
  });

  it("refuses a shared-string index the table does not hold", () => {
    expect(() =>
      parseAssetWorkbook(workbookWithCell(`<c r="B2" t="s"><v>9999</v></c>`)),
    ).toThrow(/references shared string 9999/);
  });
});

describe("the 1904 date system is refused outright (AM-04-C36)", () => {
  it("rejects the whole file rather than importing every date 1462 days out", () => {
    expect(() => parseAssetWorkbook(assetTigerMacExport())).toThrow(
      /1904 date system/,
    );
  });

  it("accepts the same workbook without the flag", () => {
    expect(parseAssetWorkbook(assetTigerWorkbook()).rows).toHaveLength(1);
  });

  function assetTigerMacExport(): Uint8Array {
    return buildWorkbook({
      date1904: true,
      rows: [
        { row: 1, cells: [{ col: "A", text: "Purchase Date" }] },
        { row: 2, cells: [{ col: "A", num: 45177, style: "2" }] },
      ],
    });
  }
});

describe("the worksheet is resolved through the rels (AM-04-C35)", () => {
  it("reads the entry the rels name, not a hardcoded xl/worksheets/sheet1.xml", () => {
    // There is deliberately NO xl/worksheets/sheet1.xml in this archive. A
    // reader that hardcoded that path finds nothing and throws.
    const workbook = buildWorkbook({
      sheetTarget: "worksheets/renamedByExcel.xml",
      rows: [
        { row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] },
        { row: 2, cells: [{ col: "A", text: "KE000001" }] },
      ],
    });

    expect(parseAssetWorkbook(workbook).rows[0].cells["Asset Tag ID"]).toBe(
      "KE000001",
    );
  });

  it("refuses a workbook holding more than one sheet", () => {
    const workbook = buildWorkbook({
      sheets: [
        { name: "Export", rid: "rId1" },
        { name: "Notes", rid: "rId4" },
      ],
      rows: [{ row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] }],
    });

    expect(() => parseAssetWorkbook(workbook)).toThrow(/holds 2 sheets/);
  });

  it("refuses a sheet relationship pointing at a part that is not a worksheet", () => {
    const workbook = buildWorkbook({
      sheetRelType:
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
      rows: [{ row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] }],
    });

    expect(() => parseAssetWorkbook(workbook)).toThrow(/not a worksheet/);
  });

  it("cannot be walked out of the archive by a traversing Target", () => {
    const workbook = buildWorkbook({
      sheetTarget: "../../../../etc/passwd",
      sheetEntry: "xl/worksheets/sheet1.xml",
      rows: [{ row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] }],
    });

    // The name is matched against the archive's entries as a string and matches
    // nothing. Nothing was resolved as a filesystem path, so there is no
    // sanitiser here to get wrong.
    expect(() => parseAssetWorkbook(workbook)).toThrow(
      /missing "xl\/\.\.\/\.\.\/\.\.\/\.\.\/etc\/passwd"/,
    );
  });
});

describe("zip caps (AM-04-C34)", () => {
  it("pins the ruled cap values", () => {
    // Written out as literals rather than derived, so a test cannot agree with
    // a mistake in the constants it is checking.
    expect(XLSX_LIMITS).toEqual({
      maxInputBytes: 10 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
      maxEntryBytes: 64 * 1024 * 1024,
      maxCompressionRatio: 100,
      maxEntries: 64,
      pushChunkBytes: 16 * 1024,
    });
  });

  it("refuses an oversized input before inflating anything", () => {
    const workbook = assetTigerWorkbook({ trailingRows: 0 });

    expect(() =>
      parseAssetWorkbook(workbook, { maxInputBytes: workbook.length - 1 }),
    ).toThrow(/bytes, past the .* limit/);
    expect(
      parseAssetWorkbook(workbook, { maxInputBytes: workbook.length }).rows,
    ).toHaveLength(1);
  });

  it("refuses an archive with too many entries", () => {
    const extraEntries = Object.fromEntries(
      Array.from({ length: 60 }, (_unused, index) => [
        `xl/media/image${index}.png`,
        strToU8("."),
      ]),
    );
    const workbook = buildWorkbook({
      extraEntries,
      rows: [{ row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] }],
    });

    expect(() => parseAssetWorkbook(workbook, { maxEntries: 64 })).toThrow(
      /holds more than 64 entries/,
    );
    // Paired positive: the same archive reads fine when the cap admits it, so
    // the refusal above is about the count and not about the archive.
    expect(parseAssetWorkbook(workbook, { maxEntries: 128 }).headers).toEqual([
      "Asset Tag ID",
    ]);
  });

  // -------------------------------------------------------------------------
  // The two-variant bomb. Both entries hold the same payload; only the NAME
  // differs, and that difference is the whole test. A reader that inflated
  // everything and discarded what it did not want would pass the first and die
  // on the second.
  // -------------------------------------------------------------------------

  it("variant 1 — never inflates a bomb outside the four-entry allowlist", () => {
    const workbook = buildWorkbook({
      extraEntries: { "xl/media/bomb.bin": compressiblePayload(BOMB_BYTES) },
      rows: [
        { row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] },
        { row: 2, cells: [{ col: "A", text: "KE000001" }] },
      ],
    });

    // The caps are the REAL ones here. 4 MB is well inside them individually,
    // but the file is ~4 KB packed, so inflating the bomb would blow the 100:1
    // ratio instantly. Success is the assertion: the entry was never started.
    expect(parseAssetWorkbook(workbook).rows[0].cells["Asset Tag ID"]).toBe(
      "KE000001",
    );
  });

  it("variant 2 — aborts PART WAY THROUGH a bomb named as the worksheet", () => {
    // The local header's declared size is zeroed first, so the free pre-check
    // cannot fire and the running byte count is the only thing left standing —
    // which is the point. A liar's header is the case the pre-check is not a
    // defence against.
    const workbook = understateEntrySize(
      bombAtWorksheet(),
      "xl/worksheets/sheet1.xml",
    );

    const message = messageFrom(() =>
      parseAssetWorkbook(workbook, {
        ...WIDE,
        maxEntryBytes: 512 * 1024,
        // A small push chunk bounds how much one inflate call can allocate; see
        // XlsxLimits.pushChunkBytes. Lowered here so the abort lands early
        // enough to be visibly partial without a gigabyte-sized fixture.
        pushChunkBytes: 256,
      }),
    );

    expect(message).toMatch(/per-entry limit/);
    // THE assertion that separates a streaming abort from a post-mortem. If
    // this module inflated the entry and then measured it, the reported figure
    // would be the bomb's full size. It must be a fraction of it.
    const aborted = Number(/aborted after (\d+) bytes/.exec(message)?.[1]);
    expect(aborted).toBeGreaterThan(512 * 1024);
    expect(aborted).toBeLessThan(BOMB_BYTES / 2);
  });

  it("refuses an entry whose own header declares more than the per-entry cap", () => {
    const message = messageFrom(() =>
      parseAssetWorkbook(bombAtWorksheet(), {
        ...WIDE,
        maxEntryBytes: 512 * 1024,
      }),
    );

    // Refused on the declaration, so not one byte was inflated. Free when the
    // file is honest; worth nothing when it is not, which is why the running
    // count above exists as well.
    expect(message).toMatch(/declares 4194304 bytes/);
  });

  it("refuses a run whose entries are individually small but jointly too large", () => {
    const workbook = buildWorkbook({
      extraEntries: {
        "xl/sharedStrings.xml": compressiblePayload(3 * 1024 * 1024),
        "xl/worksheets/sheet1.xml": compressiblePayload(3 * 1024 * 1024),
      },
      rows: [{ row: 1, cells: [{ col: "A", text: "Asset Tag ID" }] }],
    });

    expect(() =>
      parseAssetWorkbook(workbook, {
        ...WIDE,
        maxEntryBytes: 4 * 1024 * 1024,
        maxTotalBytes: 5 * 1024 * 1024,
      }),
    ).toThrow(/total limit/);
  });

  it("refuses a file that expands further than the ratio cap allows", () => {
    expect(() =>
      parseAssetWorkbook(bombAtWorksheet(), {
        ...WIDE,
        maxCompressionRatio: 100,
      }),
    ).toThrow(/expands more than 100× its packed size/);
  });
});

describe("package metadata is never read or surfaced (AM-04-C38)", () => {
  it("returns nothing from docProps or the workbook's absPath", () => {
    const sheet = parseAssetWorkbook(assetTigerWorkbook());
    const serialised = JSON.stringify(sheet);

    // The fixture carries both, in the shapes the real export carries them:
    // a `<cp:lastModifiedBy>` full name and a Windows user directory.
    expect(serialised).not.toContain("Nobody Fictional");
    expect(serialised).not.toContain("NOBODY");
    expect(serialised).not.toContain("absPath");
    // The positive marker, without which the three assertions above would pass
    // just as happily against a parse that returned nothing at all.
    expect(serialised).toContain("KE000001");
  });
});

describe("XML entities are expanded from a fixed table, never a document's own", () => {
  const workbookWithSharedStrings = (sst: string) =>
    buildWorkbook({
      extraEntries: { "xl/sharedStrings.xml": strToU8(sst) },
      sheetDataXml:
        `<row r="1"><c r="A1" t="s"><v>0</v></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>1</v></c></row>`,
    });

  it("expands the five predefined references and numeric ones", () => {
    const sheet = parseAssetWorkbook(
      workbookWithSharedStrings(
        `<sst><si><t>Purchased from</t></si>` +
          `<si><t>Read &amp; Co &#65;&lt;B&gt;</t></si></sst>`,
      ),
    );

    expect(sheet.rows[0].cells["Purchased from"]).toBe("Read & Co A<B>");
  });

  it("refuses a document that declares its own entity", () => {
    // A hand-rolled scanner has no entity table to recurse through, which is
    // most of why billion-laughs is not reachable here (AM-04-C40). What it
    // must not do is treat `&lol1;` as literal text, which would write a
    // corrupted supplier name into the register without a word.
    const hostile = workbookWithSharedStrings(
      `<!DOCTYPE sst [<!ENTITY lol "ha"><!ENTITY lol1 "&lol;&lol;&lol;">]>` +
        `<sst><si><t>Purchased from</t></si><si><t>&lol1;</t></si></sst>`,
    );

    expect(() => parseAssetWorkbook(hostile)).toThrow(
      /unsupported XML entity "&lol1;"/,
    );
  });
});

describe("the reader's own preconditions", () => {
  it("refuses an archive missing one of the four entries it reads", () => {
    const workbook = zipSync({ "xl/workbook.xml": strToU8("<workbook/>") });

    expect(() => parseAssetWorkbook(workbook)).toThrow(
      /missing "xl\/_rels\/workbook.xml.rels"/,
    );
  });

  it("refuses a worksheet with no header row", () => {
    expect(() => parseAssetWorkbook(buildWorkbook({ rows: [] }))).toThrow(
      /no header row/,
    );
  });

  it("numbers columns past Z the way Excel does", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(20)).toBe("U");
    expect(columnLetter(26)).toBe("AA");
  });
});
