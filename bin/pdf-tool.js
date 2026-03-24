#!/usr/bin/env node
/**
 * pdf-tool — CLI for PDF operations
 *
 * Usage:
 *   pdf-tool read <file> [--page N] [--out <file>]
 *   pdf-tool info <file>
 *   pdf-tool write <file> [--title "..."] [--author "..."] [--font-size N] [--in <textfile>]
 *   pdf-tool merge <output> <pdf1> <pdf2> [<pdf3>...]
 *   pdf-tool extract <input> <output> <page,page,...>
 *   pdf-tool split <input> <outputDir>
 */

import { Command } from 'commander';
import fs from 'fs/promises';
import { readPDF, getPDFInfo, writePDF, mergePDFs, extractPages, splitPDF } from '../src/pdf-utils.js';

const program = new Command();

program
  .name('pdf-tool')
  .description('CLI tool for reading and writing PDF files (powered by Mozilla PDF.js + pdf-lib)')
  .version('1.0.0');

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------
program
  .command('read <file>')
  .description('Extract text from a PDF file')
  .option('-p, --page <number>', 'Extract a single page (1-based)')
  .option('-o, --out <file>', 'Write extracted text to a file instead of stdout')
  .action(async (file, opts) => {
    const result = await readPDF(file);
    const text = opts.page != null
      ? (result.pages[parseInt(opts.page) - 1] ?? `Page ${opts.page} not found`)
      : result.text;

    if (opts.out) {
      await fs.writeFile(opts.out, text, 'utf-8');
      console.log(`Wrote ${result.numPages} page(s) of text to ${opts.out}`);
    } else {
      process.stdout.write(text + '\n');
    }
  });

// ---------------------------------------------------------------------------
// info
// ---------------------------------------------------------------------------
program
  .command('info <file>')
  .description('Show metadata and info about a PDF')
  .action(async (file) => {
    const info = await getPDFInfo(file);
    console.log(JSON.stringify(info, null, 2));
  });

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------
program
  .command('write <file>')
  .description('Create a new PDF from text (reads from stdin or --in <textfile>)')
  .option('-t, --title <title>', 'Document title')
  .option('-a, --author <author>', 'Document author')
  .option('-f, --font-size <n>', 'Font size in points', '12')
  .option('-i, --in <textfile>', 'Read content from a text file instead of stdin')
  .action(async (file, opts) => {
    let content;
    if (opts.in) {
      content = await fs.readFile(opts.in, 'utf-8');
    } else if (!process.stdin.isTTY) {
      content = await readStdin();
    } else {
      console.error('Provide text via --in <file> or pipe to stdin');
      process.exit(1);
    }

    const result = await writePDF(file, content, {
      title: opts.title,
      author: opts.author,
      fontSize: parseInt(opts.fontSize, 10),
    });
    console.log(`Created: ${result.filePath}  (${result.numPages} page(s))`);
  });

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------
program
  .command('merge <output> <inputs...>')
  .description('Merge two or more PDFs into one')
  .action(async (output, inputs) => {
    if (inputs.length < 2) {
      console.error('Need at least 2 input files');
      process.exit(1);
    }
    const result = await mergePDFs(output, inputs);
    console.log(`Merged ${result.sources} file(s) → ${result.outputPath}  (${result.numPages} pages)`);
  });

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------
program
  .command('extract <input> <output> <pages>')
  .description('Extract specific pages into a new PDF (pages: comma-separated 1-based numbers)')
  .action(async (input, output, pagesArg) => {
    const pages = pagesArg.split(',').map(s => {
      const n = parseInt(s.trim(), 10);
      if (Number.isNaN(n)) throw new Error(`Invalid page number: ${s}`);
      return n;
    });
    const result = await extractPages(input, output, pages);
    console.log(`Extracted [${pages.join(', ')}] → ${result.outputPath}`);
  });

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------
program
  .command('split <input> <outputDir>')
  .description('Split a PDF into individual page files in a directory')
  .action(async (input, outputDir) => {
    const result = await splitPDF(input, outputDir);
    console.log(`Split ${result.numPages} pages → ${result.outputDir}`);
    result.files.forEach(f => console.log(`  ${f}`));
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => (buf += chunk));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

program.parseAsync().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
