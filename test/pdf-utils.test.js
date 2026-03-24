import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

import {
  writePDF,
  readPDF,
  getPDFInfo,
  mergePDFs,
  extractPages,
  splitPDF,
} from '../src/pdf-utils.js';

// ---------------------------------------------------------------------------
// Shared temp directory — created before all tests, deleted after
// ---------------------------------------------------------------------------
let tmp;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-mcp-test-'));
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const p = name => path.join(tmp, name); // short helper

// ---------------------------------------------------------------------------
// writePDF
// ---------------------------------------------------------------------------
describe('writePDF', () => {
  test('creates a PDF file on disk', async () => {
    const out = p('write-basic.pdf');
    const result = await writePDF(out, 'Hello world.');

    assert.equal(result.filePath, out);
    assert.ok(result.numPages >= 1);

    const stat = await fs.stat(out);
    assert.ok(stat.size > 0);
  });

  test('starts with PDF magic bytes', async () => {
    const out = p('write-magic.pdf');
    await writePDF(out, 'Magic byte check.');

    const buf = await fs.readFile(out);
    assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF');
  });

  test('produces multiple pages for long content', async () => {
    const out = p('write-multipage.pdf');
    const content = Array.from({ length: 200 }, (_, i) =>
      `Line ${i + 1}: some content to push onto the page and eventually overflow onto the next one.`
    ).join('\n');

    const result = await writePDF(out, content);
    assert.ok(result.numPages > 1, `Expected >1 page, got ${result.numPages}`);
  });

  test('respects title and author options', async () => {
    const out = p('write-meta.pdf');
    await writePDF(out, 'Metadata test.', { title: 'My Title', author: 'Jane Doe' });

    const info = await getPDFInfo(out);
    assert.equal(info.title, 'My Title');
    assert.equal(info.author, 'Jane Doe');
  });

  test('handles blank lines in content', async () => {
    const out = p('write-blanks.pdf');
    const result = await writePDF(out, 'Para one.\n\nPara two.');
    assert.ok(result.numPages >= 1);
  });
});

// ---------------------------------------------------------------------------
// readPDF
// ---------------------------------------------------------------------------
describe('readPDF', () => {
  test('extracts text from a single-page PDF', async () => {
    const out = p('read-single.pdf');
    await writePDF(out, 'Extract this text.\nAnd this second line.');

    const result = await readPDF(out);
    assert.ok(result.text.includes('Extract this text.'));
    assert.ok(result.text.includes('And this second line.'));
    assert.equal(result.numPages, 1);
  });

  test('reports correct page count', async () => {
    const out = p('read-pages.pdf');
    const content = Array.from({ length: 150 }, (_, i) => `Line ${i + 1}`).join('\n');
    const written = await writePDF(out, content);

    const result = await readPDF(out);
    assert.equal(result.numPages, written.numPages);
    assert.equal(result.pages.length, written.numPages);
  });

  test('pages array has one entry per page', async () => {
    const out = p('read-pages-array.pdf');
    const content = Array.from({ length: 150 }, () => 'A'.repeat(80)).join('\n');
    const { numPages } = await writePDF(out, content);

    const result = await readPDF(out);
    assert.equal(result.pages.length, numPages);
    result.pages.forEach(pageText => assert.equal(typeof pageText, 'string'));
  });

  test('throws ENOENT for a missing file', async () => {
    await assert.rejects(
      () => readPDF(p('does-not-exist.pdf')),
      /ENOENT/
    );
  });
});

// ---------------------------------------------------------------------------
// getPDFInfo
// ---------------------------------------------------------------------------
describe('getPDFInfo', () => {
  test('returns page count and file size', async () => {
    const out = p('info-basic.pdf');
    await writePDF(out, 'Info content.');

    const info = await getPDFInfo(out);
    assert.equal(info.numPages, 1);
    assert.ok(info.fileSizeBytes > 0);
  });

  test('reports creator as pdf-mcp', async () => {
    const out = p('info-creator.pdf');
    await writePDF(out, 'Creator check.');

    const info = await getPDFInfo(out);
    assert.equal(info.creator, 'pdf-mcp');
  });

  test('returns null for unset optional fields', async () => {
    const out = p('info-nulls.pdf');
    await writePDF(out, 'No title or author.');

    const info = await getPDFInfo(out);
    // title and author not set → null
    assert.equal(info.title, null);
    assert.equal(info.author, null);
  });

  test('creationDate is a valid ISO string', async () => {
    const out = p('info-date.pdf');
    await writePDF(out, 'Date check.');

    const info = await getPDFInfo(out);
    assert.ok(info.creationDate, 'Expected a creationDate');
    assert.doesNotThrow(() => new Date(info.creationDate));
  });
});

// ---------------------------------------------------------------------------
// mergePDFs
// ---------------------------------------------------------------------------
describe('mergePDFs', () => {
  test('merges two single-page PDFs into a 2-page PDF', async () => {
    const a = p('merge-a.pdf');
    const b = p('merge-b.pdf');
    const out = p('merge-out.pdf');

    await writePDF(a, 'Document Alpha.');
    await writePDF(b, 'Document Beta.');

    const result = await mergePDFs(out, [a, b]);
    assert.equal(result.numPages, 2);
    assert.equal(result.sources, 2);

    const read = await readPDF(out);
    assert.equal(read.numPages, 2);
  });

  test('preserves text from all source files', async () => {
    const a = p('merge-text-a.pdf');
    const b = p('merge-text-b.pdf');
    const out = p('merge-text-out.pdf');

    await writePDF(a, 'UniqueAlphaString');
    await writePDF(b, 'UniqueBetaString');
    await mergePDFs(out, [a, b]);

    const read = await readPDF(out);
    assert.ok(read.text.includes('UniqueAlphaString'));
    assert.ok(read.text.includes('UniqueBetaString'));
  });

  test('output page count equals sum of source page counts', async () => {
    const sources = [];
    let expectedTotal = 0;

    for (let i = 0; i < 3; i++) {
      const src = p(`merge-sum-${i}.pdf`);
      const content = Array.from({ length: 80 * (i + 1) }, (_, j) => `File ${i} line ${j}`).join('\n');
      const { numPages } = await writePDF(src, content);
      sources.push(src);
      expectedTotal += numPages;
    }

    const out = p('merge-sum-out.pdf');
    const result = await mergePDFs(out, sources);
    assert.equal(result.numPages, expectedTotal);
  });
});

// ---------------------------------------------------------------------------
// extractPages
// ---------------------------------------------------------------------------
describe('extractPages', () => {
  // Helper: build a 3-page PDF
  async function make3PagePDF(name) {
    const pages = [];
    for (let i = 1; i <= 3; i++) {
      const pg = p(`${name}-pg${i}.pdf`);
      await writePDF(pg, `Page ${i} unique marker: X${i}X`);
      pages.push(pg);
    }
    const src = p(`${name}-src.pdf`);
    await mergePDFs(src, pages);
    return src;
  }

  test('extracts a single page into a 1-page PDF', async () => {
    const src = await make3PagePDF('ext-single');
    const out = p('ext-single-out.pdf');

    const result = await extractPages(src, out, [1]);
    assert.equal(result.extractedPages, 1);

    const read = await readPDF(out);
    assert.equal(read.numPages, 1);
  });

  test('extracts multiple non-contiguous pages', async () => {
    const src = await make3PagePDF('ext-multi');
    const out = p('ext-multi-out.pdf');

    const result = await extractPages(src, out, [1, 3]);
    assert.equal(result.extractedPages, 2);

    const read = await readPDF(out);
    assert.equal(read.numPages, 2);
  });

  test('throws an error for out-of-range page numbers', async () => {
    const src = await make3PagePDF('ext-range');
    const out = p('ext-range-out.pdf');

    await assert.rejects(
      () => extractPages(src, out, [99]),
      /out of range/
    );
  });
});

// ---------------------------------------------------------------------------
// splitPDF
// ---------------------------------------------------------------------------
describe('splitPDF', () => {
  test('splits a 3-page PDF into 3 single-page files', async () => {
    const pages = [];
    for (let i = 1; i <= 3; i++) {
      const pg = p(`split-pg${i}.pdf`);
      await writePDF(pg, `Split page ${i}.`);
      pages.push(pg);
    }
    const src = p('split-src.pdf');
    await mergePDFs(src, pages);

    const outDir = p('split-out');
    const result = await splitPDF(src, outDir);

    assert.equal(result.numPages, 3);
    assert.equal(result.files.length, 3);

    for (const file of result.files) {
      const read = await readPDF(file);
      assert.equal(read.numPages, 1);
    }
  });

  test('creates the output directory if it does not exist', async () => {
    const src = p('split-mkdir-src.pdf');
    await writePDF(src, 'Single page for mkdir test.');

    const outDir = p('split-mkdir/nested/dir');
    await splitPDF(src, outDir);

    const stat = await fs.stat(outDir);
    assert.ok(stat.isDirectory());
  });

  test('output files are named with zero-padded page numbers', async () => {
    const src = p('split-names-src.pdf');
    await writePDF(src, 'Naming test.');

    const outDir = p('split-names-out');
    const result = await splitPDF(src, outDir);

    assert.ok(result.files[0].includes('page-0001.pdf'));
  });
});
