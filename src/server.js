#!/usr/bin/env node
/**
 * PDF MCP Server
 * Exposes PDF tools (read, write, merge, extract, split, info) via stdio.
 *
 * Add to Claude Desktop: %APPDATA%\Claude\claude_desktop_config.json
 * Add to Claude Code:    claude mcp add pdf-mcp -- node /path/to/pdf-mcp/src/server.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  readPDF,
  getPDFInfo,
  writePDF,
  mergePDFs,
  extractPages,
  splitPDF,
} from './pdf-utils.js';

const server = new McpServer({
  name: 'pdf-mcp',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// pdf_read — extract text from a PDF
// ---------------------------------------------------------------------------
server.tool(
  'pdf_read',
  'Extract all text content from a PDF file. Returns text with page breaks marked.',
  {
    file_path: z.string().describe('Absolute or relative path to the PDF file'),
    page: z.number().int().positive().optional()
      .describe('Extract a single page only (1-based). Omit for all pages.'),
  },
  async ({ file_path, page }) => {
    const result = await readPDF(file_path);
    const text = page != null
      ? (result.pages[page - 1] ?? `Page ${page} does not exist (PDF has ${result.numPages} pages)`)
      : result.text;

    return {
      content: [{
        type: 'text',
        text: `Pages: ${result.numPages}\n\n${text}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// pdf_info — get metadata
// ---------------------------------------------------------------------------
server.tool(
  'pdf_info',
  'Get metadata and information about a PDF: page count, title, author, dates, file size.',
  {
    file_path: z.string().describe('Absolute or relative path to the PDF file'),
  },
  async ({ file_path }) => {
    const info = await getPDFInfo(file_path);
    return {
      content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// pdf_write — create a new PDF
// ---------------------------------------------------------------------------
server.tool(
  'pdf_write',
  'Create a new PDF file from plain text content. Text is automatically word-wrapped and paginated.',
  {
    file_path: z.string().describe('Output path for the new PDF file'),
    content: z.string().describe('Text content to write into the PDF'),
    title: z.string().optional().describe('PDF document title metadata'),
    author: z.string().optional().describe('PDF author metadata'),
    font_size: z.number().positive().optional().describe('Font size in points (default: 12)'),
  },
  async ({ file_path, content, title, author, font_size }) => {
    const result = await writePDF(file_path, content, { title, author, fontSize: font_size });
    return {
      content: [{
        type: 'text',
        text: `PDF created: ${result.filePath}\nPages: ${result.numPages}\nLines: ${result.linesWritten}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// pdf_merge — merge multiple PDFs
// ---------------------------------------------------------------------------
server.tool(
  'pdf_merge',
  'Merge multiple PDF files into a single PDF, in the order provided.',
  {
    output_path: z.string().describe('Output path for the merged PDF'),
    input_paths: z.array(z.string()).min(2)
      .describe('List of PDF file paths to merge, in order'),
  },
  async ({ output_path, input_paths }) => {
    const result = await mergePDFs(output_path, input_paths);
    return {
      content: [{
        type: 'text',
        text: `Merged ${result.sources} PDF(s) → ${result.outputPath}\nTotal pages: ${result.numPages}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// pdf_extract_pages — pull specific pages into a new file
// ---------------------------------------------------------------------------
server.tool(
  'pdf_extract_pages',
  'Extract specific pages from a PDF into a new PDF file. Page numbers are 1-based.',
  {
    input_path: z.string().describe('Source PDF file path'),
    output_path: z.string().describe('Output PDF file path'),
    pages: z.array(z.number().int().positive())
      .describe('Page numbers to extract (1-based, e.g. [1, 3, 5])'),
  },
  async ({ input_path, output_path, pages }) => {
    const result = await extractPages(input_path, output_path, pages);
    return {
      content: [{
        type: 'text',
        text: `Extracted pages [${pages.join(', ')}] → ${result.outputPath}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// pdf_split — split into individual page files
// ---------------------------------------------------------------------------
server.tool(
  'pdf_split',
  'Split a PDF into individual single-page PDFs, saved into a directory.',
  {
    input_path: z.string().describe('Source PDF file path'),
    output_dir: z.string().describe('Directory to save the split page PDFs (created if missing)'),
  },
  async ({ input_path, output_dir }) => {
    const result = await splitPDF(input_path, output_dir);
    return {
      content: [{
        type: 'text',
        text: `Split ${result.numPages} pages → ${result.outputDir}\nFiles:\n${result.files.join('\n')}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('pdf-mcp server running on stdio');
