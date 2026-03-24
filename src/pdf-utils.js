/**
 * Core PDF utilities using pdfjs-dist (Mozilla) for reading
 * and pdf-lib for writing/manipulation.
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { getDocument, GlobalWorkerOptions, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from 'canvas';
import fs from 'fs/promises';
import path from 'path';

// Resolve pdfjs paths from the installed package
const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
GlobalWorkerOptions.verbosity = VerbosityLevel.ERRORS; // suppress non-error warnings

const pdfDistRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONT_DATA_URL = pathToFileURL(path.join(pdfDistRoot, 'standard_fonts')).href + '/';
const CMAP_URL = pathToFileURL(path.join(pdfDistRoot, 'cmaps')).href + '/';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Extract all text from a PDF, page by page.
 * Returns { text, numPages, metadata }
 */
export async function readPDF(filePath) {
  const absPath = path.resolve(filePath);
  const data = await fs.readFile(absPath);
  const loadingTask = getDocument({ data: new Uint8Array(data), standardFontDataUrl: STANDARD_FONT_DATA_URL, disableFontFace: true });
  const pdf = await loadingTask.promise;

  const numPages = pdf.numPages;
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Join items; preserve line breaks by watching y-position changes
    let lastY = null;
    let pageText = '';
    for (const item of content.items) {
      if ('str' in item) {
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
          pageText += '\n';
        }
        pageText += item.str;
        lastY = item.transform[5];
      }
    }
    pageTexts.push(pageText);
  }

  const metadata = await pdf.getMetadata().catch(() => ({}));
  await pdf.destroy();

  return {
    text: pageTexts.join('\n\n--- Page Break ---\n\n'),
    pages: pageTexts,
    numPages,
    metadata: metadata?.info ?? {},
  };
}

/**
 * Get PDF info/metadata without extracting all text.
 * Returns { numPages, title, author, subject, creator, producer, ... }
 */
export async function getPDFInfo(filePath) {
  const absPath = path.resolve(filePath);
  const data = await fs.readFile(absPath);
  const stat = await fs.stat(absPath);

  const loadingTask = getDocument({ data: new Uint8Array(data), standardFontDataUrl: STANDARD_FONT_DATA_URL, disableFontFace: true });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const meta = await pdf.getMetadata().catch(() => ({}));
  await pdf.destroy();

  // Also get pdf-lib metadata (title, author etc. from docinfo)
  const pdfDoc = await PDFDocument.load(data);

  return {
    filePath: absPath,
    fileSizeBytes: stat.size,
    numPages,
    title: pdfDoc.getTitle() ?? meta?.info?.Title ?? null,
    author: pdfDoc.getAuthor() ?? meta?.info?.Author ?? null,
    subject: pdfDoc.getSubject() ?? meta?.info?.Subject ?? null,
    keywords: pdfDoc.getKeywords() ?? meta?.info?.Keywords ?? null,
    creator: pdfDoc.getCreator() ?? meta?.info?.Creator ?? null,
    producer: pdfDoc.getProducer() ?? meta?.info?.Producer ?? null,
    creationDate: pdfDoc.getCreationDate()?.toISOString() ?? null,
    modificationDate: pdfDoc.getModificationDate()?.toISOString() ?? null,
    pdfFormatVersion: meta?.info?.PDFFormatVersion ?? null,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Create a new PDF file from plain text content.
 * Options: { title, author, fontSize, fontName }
 */
export async function writePDF(filePath, content, options = {}) {
  const {
    title = null,
    author = null,
    fontSize = 12,
    fontName = 'Helvetica',
  } = options;

  const absPath = path.resolve(filePath);
  const pdfDoc = await PDFDocument.create();

  if (title) pdfDoc.setTitle(title);
  if (author) pdfDoc.setAuthor(author);
  pdfDoc.setCreator('pdf-mcp');
  pdfDoc.setCreationDate(new Date());

  const fontKey = StandardFonts[fontName] ?? StandardFonts.Helvetica;
  const font = await pdfDoc.embedFont(fontKey);

  const PAGE_W = 595.28;  // A4
  const PAGE_H = 841.89;  // A4
  const MARGIN = 50;
  const LINE_H = fontSize * 1.5;
  const MAX_W = PAGE_W - MARGIN * 2;

  // Word-wrap all input lines
  const wrappedLines = [];
  for (const rawLine of content.split('\n')) {
    if (!rawLine.trim()) {
      wrappedLines.push('');
      continue;
    }
    const words = rawLine.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) > MAX_W && current) {
        wrappedLines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) wrappedLines.push(current);
  }

  // Render lines onto pages
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  for (const line of wrappedLines) {
    if (y - LINE_H < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    if (line) {
      page.drawText(line, { x: MARGIN, y, size: fontSize, font, color: rgb(0, 0, 0) });
    }
    y -= LINE_H;
  }

  const pdfBytes = await pdfDoc.save();
  await fs.writeFile(absPath, pdfBytes);

  return {
    filePath: absPath,
    numPages: pdfDoc.getPageCount(),
    linesWritten: wrappedLines.length,
  };
}

// ---------------------------------------------------------------------------
// Manipulation
// ---------------------------------------------------------------------------

/**
 * Merge multiple PDF files into a single output PDF.
 */
export async function mergePDFs(outputPath, inputPaths) {
  const absOutput = path.resolve(outputPath);
  const merged = await PDFDocument.create();

  for (const inputPath of inputPaths) {
    const bytes = await fs.readFile(path.resolve(inputPath));
    const src = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach(p => merged.addPage(p));
  }

  await fs.writeFile(absOutput, await merged.save());
  return { outputPath: absOutput, numPages: merged.getPageCount(), sources: inputPaths.length };
}

/**
 * Extract specific pages (1-based) from a PDF into a new file.
 */
export async function extractPages(inputPath, outputPath, pageNumbers) {
  const absInput = path.resolve(inputPath);
  const absOutput = path.resolve(outputPath);

  const bytes = await fs.readFile(absInput);
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();

  const indices = pageNumbers.map(n => {
    const idx = n - 1;
    if (idx < 0 || idx >= total) {
      throw new Error(`Page ${n} is out of range — PDF has ${total} page(s)`);
    }
    return idx;
  });

  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach(p => out.addPage(p));

  await fs.writeFile(absOutput, await out.save());
  return { outputPath: absOutput, extractedPages: pageNumbers.length };
}

/**
 * Split a PDF into individual single-page PDFs, saved to a directory.
 */
export async function splitPDF(inputPath, outputDir) {
  const absInput = path.resolve(inputPath);
  const absDir = path.resolve(outputDir);
  await fs.mkdir(absDir, { recursive: true });

  const bytes = await fs.readFile(absInput);
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const outputPaths = [];

  for (let i = 0; i < total; i++) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(src, [i]);
    single.addPage(copied);

    const outPath = path.join(absDir, `page-${String(i + 1).padStart(4, '0')}.pdf`);
    await fs.writeFile(outPath, await single.save());
    outputPaths.push(outPath);
  }

  return { outputDir: absDir, numPages: total, files: outputPaths };
}

// ---------------------------------------------------------------------------
// Image rendering
// ---------------------------------------------------------------------------

// pdfjs-dist NodeCanvasFactory — required for rendering pages to canvas in Node.js
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset({ canvas }, width, height) {
    canvas.width = width;
    canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

/**
 * Render a single PDF page to an image file (PNG or JPEG).
 *
 * @param {string} inputPath  - Source PDF
 * @param {number} pageNumber - 1-based page number
 * @param {string} outputPath - Output image path (.png or .jpg/.jpeg)
 * @param {object} options    - { scale: number (default 2.0), format: 'png'|'jpeg' }
 */
export async function pageToImage(inputPath, pageNumber, outputPath, options = {}) {
  const { scale = 2.0, format } = options;
  const absInput = path.resolve(inputPath);
  const absOutput = path.resolve(outputPath);

  // Infer format from extension if not provided
  const ext = path.extname(absOutput).toLowerCase();
  const imgFormat = format ?? (ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png');
  const mimeType = imgFormat === 'jpeg' ? 'image/jpeg' : 'image/png';

  const data = await fs.readFile(absInput);
  const pdf = await getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    useSystemFonts: true,
  }).promise;

  const total = pdf.numPages;
  if (pageNumber < 1 || pageNumber > total) {
    throw new Error(`Page ${pageNumber} is out of range — PDF has ${total} page(s)`);
  }

  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvasFactory = new NodeCanvasFactory();
  const { canvas, context } = canvasFactory.create(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );

  await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
  await pdf.destroy();

  const buffer = canvas.toBuffer(mimeType);
  await fs.writeFile(absOutput, buffer);

  return {
    outputPath: absOutput,
    format: imgFormat,
    width: canvas.width,
    height: canvas.height,
    scale,
    page: pageNumber,
  };
}

/**
 * Render every page of a PDF to image files in a directory.
 *
 * @param {string} inputPath - Source PDF
 * @param {string} outputDir - Directory to write images into (created if missing)
 * @param {object} options   - { scale: number, format: 'png'|'jpeg' }
 */
export async function pdfToImages(inputPath, outputDir, options = {}) {
  const { scale = 2.0, format = 'png' } = options;
  const absInput = path.resolve(inputPath);
  const absDir = path.resolve(outputDir);
  await fs.mkdir(absDir, { recursive: true });

  const data = await fs.readFile(absInput);
  const pdf = await getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    useSystemFonts: true,
  }).promise;

  const total = pdf.numPages;
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const canvasFactory = new NodeCanvasFactory();
  const files = [];

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const { canvas, context } = canvasFactory.create(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );

    await page.render({ canvasContext: context, viewport, canvasFactory }).promise;

    const outPath = path.join(absDir, `page-${String(i).padStart(4, '0')}.${ext}`);
    await fs.writeFile(outPath, canvas.toBuffer(mimeType));
    canvasFactory.destroy({ canvas });
    files.push(outPath);
  }

  await pdf.destroy();
  return { outputDir: absDir, numPages: total, format, scale, files };
}
