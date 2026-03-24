import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

import { writePDF, mergePDFs, pageToImage, pdfToImages } from '../src/pdf-utils.js';

// PNG magic bytes: 89 50 4E 47
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// JPEG magic bytes: FF D8 FF
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

let tmp;
let singlePage;   // path to a single-page test PDF
let multiPage;    // path to a 3-page test PDF

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-mcp-img-test-'));

  // Build reusable source PDFs once
  singlePage = path.join(tmp, '_single.pdf');
  await writePDF(singlePage, 'Image test page one.');

  const pages = [];
  for (let i = 1; i <= 3; i++) {
    const pg = path.join(tmp, `_pg${i}.pdf`);
    await writePDF(pg, `Page ${i} of the multi-page test document.`);
    pages.push(pg);
  }
  multiPage = path.join(tmp, '_multi.pdf');
  await mergePDFs(multiPage, pages);
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const p = name => path.join(tmp, name);

// ---------------------------------------------------------------------------
// pageToImage
// ---------------------------------------------------------------------------
describe('pageToImage', () => {
  test('creates a PNG file with correct magic bytes', async () => {
    const out = p('single.png');
    await pageToImage(singlePage, 1, out);

    const buf = await fs.readFile(out);
    assert.ok(buf.slice(0, 4).equals(PNG_MAGIC), 'Expected PNG magic bytes');
    assert.ok(buf.length > 1000, 'PNG file should not be empty');
  });

  test('creates a JPEG file with correct magic bytes', async () => {
    const out = p('single.jpg');
    await pageToImage(singlePage, 1, out, { format: 'jpeg' });

    const buf = await fs.readFile(out);
    assert.ok(buf.slice(0, 3).equals(JPEG_MAGIC), 'Expected JPEG magic bytes');
    assert.ok(buf.length > 1000, 'JPEG file should not be empty');
  });

  test('infers format from .jpg extension', async () => {
    const out = p('inferred.jpg');
    const result = await pageToImage(singlePage, 1, out);
    assert.equal(result.format, 'jpeg');

    const buf = await fs.readFile(out);
    assert.ok(buf.slice(0, 3).equals(JPEG_MAGIC));
  });

  test('infers format from .png extension', async () => {
    const out = p('inferred.png');
    const result = await pageToImage(singlePage, 1, out);
    assert.equal(result.format, 'png');
  });

  test('returns correct dimensions for default scale (2×)', async () => {
    const out = p('dims-2x.png');
    const result = await pageToImage(singlePage, 1, out);

    // A4 at 72 DPI = 595×842 pts; at 2× = 1190×1684px (±1 for rounding)
    assert.ok(result.width >= 1189 && result.width <= 1192, `Unexpected width ${result.width}`);
    assert.ok(result.height >= 1683 && result.height <= 1686, `Unexpected height ${result.height}`);
    assert.equal(result.scale, 2);
  });

  test('scale option changes output dimensions', async () => {
    const out1x = p('scale-1x.png');
    const out3x = p('scale-3x.png');

    const r1 = await pageToImage(singlePage, 1, out1x, { scale: 1 });
    const r3 = await pageToImage(singlePage, 1, out3x, { scale: 3 });

    assert.ok(r3.width > r1.width * 2, '3× should be significantly wider than 1×');
    assert.ok(r3.height > r1.height * 2, '3× should be significantly taller than 1×');
  });

  test('renders a specific page from a multi-page PDF', async () => {
    const out2 = p('page2.png');
    const out3 = p('page3.png');

    const r2 = await pageToImage(multiPage, 2, out2);
    const r3 = await pageToImage(multiPage, 3, out3);

    assert.equal(r2.page, 2);
    assert.equal(r3.page, 3);

    const buf2 = await fs.readFile(out2);
    const buf3 = await fs.readFile(out3);
    assert.ok(buf2.length > 1000);
    assert.ok(buf3.length > 1000);
  });

  test('throws on out-of-range page number', async () => {
    const out = p('oob.png');
    await assert.rejects(
      () => pageToImage(singlePage, 99, out),
      /out of range/
    );
  });

  test('throws ENOENT for a missing input file', async () => {
    await assert.rejects(
      () => pageToImage(p('no-such.pdf'), 1, p('no-such.png')),
      /ENOENT/
    );
  });

  test('returns metadata in result object', async () => {
    const out = p('meta-result.png');
    const result = await pageToImage(singlePage, 1, out, { scale: 1.5 });

    assert.equal(result.page, 1);
    assert.equal(result.scale, 1.5);
    assert.equal(result.format, 'png');
    assert.equal(result.outputPath, out);
    assert.ok(typeof result.width === 'number');
    assert.ok(typeof result.height === 'number');
  });
});

// ---------------------------------------------------------------------------
// pdfToImages
// ---------------------------------------------------------------------------
describe('pdfToImages', () => {
  test('renders all pages of a multi-page PDF', async () => {
    const outDir = p('all-pages');
    const result = await pdfToImages(multiPage, outDir);

    assert.equal(result.numPages, 3);
    assert.equal(result.files.length, 3);
  });

  test('output files are valid PNGs by default', async () => {
    const outDir = p('all-png');
    const result = await pdfToImages(multiPage, outDir);

    for (const file of result.files) {
      const buf = await fs.readFile(file);
      assert.ok(buf.slice(0, 4).equals(PNG_MAGIC), `${path.basename(file)} is not a PNG`);
      assert.ok(buf.length > 1000);
    }
  });

  test('outputs JPEG files when format is jpeg', async () => {
    const outDir = p('all-jpeg');
    const result = await pdfToImages(multiPage, outDir, { format: 'jpeg' });

    assert.equal(result.format, 'jpeg');
    for (const file of result.files) {
      assert.ok(file.endsWith('.jpg'), `Expected .jpg extension, got ${file}`);
      const buf = await fs.readFile(file);
      assert.ok(buf.slice(0, 3).equals(JPEG_MAGIC), `${path.basename(file)} is not a JPEG`);
    }
  });

  test('files are named with zero-padded page numbers', async () => {
    const outDir = p('padded-names');
    const result = await pdfToImages(multiPage, outDir);

    assert.ok(result.files[0].includes('page-0001.png'));
    assert.ok(result.files[1].includes('page-0002.png'));
    assert.ok(result.files[2].includes('page-0003.png'));
  });

  test('creates the output directory if it does not exist', async () => {
    const outDir = p('nonexistent/nested/img-dir');
    await pdfToImages(singlePage, outDir);

    const stat = await fs.stat(outDir);
    assert.ok(stat.isDirectory());
  });

  test('respects scale option', async () => {
    const dir1x = p('img-1x');
    const dir3x = p('img-3x');

    await pdfToImages(singlePage, dir1x, { scale: 1 });
    await pdfToImages(singlePage, dir3x, { scale: 3 });

    const size1x = (await fs.stat(path.join(dir1x, 'page-0001.png'))).size;
    const size3x = (await fs.stat(path.join(dir3x, 'page-0001.png'))).size;

    // 3× image should be substantially larger in file size
    assert.ok(size3x > size1x * 2, `3× PNG (${size3x}B) should be much larger than 1× (${size1x}B)`);
  });

  test('returns correct metadata', async () => {
    const outDir = p('meta-check');
    const result = await pdfToImages(multiPage, outDir, { scale: 1.5, format: 'jpeg' });

    assert.equal(result.numPages, 3);
    assert.equal(result.scale, 1.5);
    assert.equal(result.format, 'jpeg');
    assert.equal(result.outputDir, outDir);
    assert.equal(result.files.length, 3);
  });

  test('single-page PDF produces exactly one image', async () => {
    const outDir = p('single-img');
    const result = await pdfToImages(singlePage, outDir);

    assert.equal(result.numPages, 1);
    assert.equal(result.files.length, 1);
  });
});
