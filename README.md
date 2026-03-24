# pdf-mcp

PDF tools for Claude — an MCP server, CLI, and Claude Code skill for reading and writing PDF files.

**Stack:** [Mozilla PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) for text extraction · [pdf-lib](https://github.com/Hopding/pdf-lib) for creating and manipulating PDFs · [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) for the MCP server.

No build step — plain JavaScript ESM, runs directly with Node.js 18+.

---

## MCP Server

### Setup

Clone the repo and link it globally so `pdf-mcp` is on your PATH:

```bash
git clone https://github.com/angshuman/pdf-mcp.git
cd pdf-mcp
npm install
npm link          # registers the pdf-mcp command globally
```

**Claude Code:**
```bash
claude mcp add pdf-mcp -- pdf-mcp
```

**Claude Desktop** — add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "pdf-mcp": {
      "command": "pdf-mcp"
    }
  }
}
```

If you'd rather not use `npm link`, point directly at the script:

```bash
claude mcp add pdf-mcp -- node /path/to/pdf-mcp/src/server.js
```

```json
{
  "mcpServers": {
    "pdf-mcp": {
      "command": "node",
      "args": ["/path/to/pdf-mcp/src/server.js"]
    }
  }
}
```

### Tools

| Tool | Description |
|------|-------------|
| `pdf_read` | Extract text from a PDF. Optional `page` param for a single page (1-based). |
| `pdf_info` | Get metadata: page count, title, author, file size, dates. |
| `pdf_write` | Create a new PDF from plain text. Supports `title`, `author`, `font_size`. |
| `pdf_merge` | Merge an ordered list of PDFs into one file. |
| `pdf_extract_pages` | Pull specific pages (1-based array) into a new PDF. |
| `pdf_split` | Split a PDF into one file per page in an output directory. |

---

## CLI

### Install

```bash
npm install
npm link          # makes pdf-tool available globally
```

### Usage

```bash
# Extract text
pdf-tool read report.pdf
pdf-tool read report.pdf --page 3
pdf-tool read report.pdf --out extracted.txt

# Show metadata
pdf-tool info report.pdf

# Create a PDF from a text file or stdin
pdf-tool write out.pdf --in content.txt --title "My Doc" --author "Jane"
cat content.txt | pdf-tool write out.pdf

# Merge PDFs
pdf-tool merge combined.pdf a.pdf b.pdf c.pdf

# Extract specific pages (1-based, comma-separated)
pdf-tool extract input.pdf output.pdf 1,3,5

# Split into individual page files
pdf-tool split input.pdf ./pages/
```

---

## Claude Code Skill

The `/pdf` slash command is in `.claude/commands/pdf.md` and is available automatically within this project.

```
/pdf read ./report.pdf
/pdf write ./out.pdf summarize the meeting notes
/pdf merge ./combined.pdf a.pdf b.pdf
/pdf extract ./in.pdf ./out.pdf 1,3,5
/pdf split ./in.pdf ./pages/
```

---

## Tests

Uses the Node.js built-in test runner — no extra dependencies.

```bash
npm test
```

22 tests covering all six core operations: write, read, info, merge, extract pages, and split.

---

## Notes

- pdfjs-dist emits a stderr warning about `LiberationSans.ttf` when reading PDFs whose fonts are not embedded (including PDFs created by pdf-lib with standard Type1 fonts). This is cosmetic — text extraction is unaffected.
- All file paths passed to the MCP tools and CLI can be absolute or relative to the current working directory.
- Page numbers are always 1-based in both the MCP tools and CLI.
