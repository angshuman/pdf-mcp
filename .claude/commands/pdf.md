Use the pdf-mcp MCP server tools to help the user work with PDF files.

$ARGUMENTS

## Available tools

| Tool | Purpose |
|------|---------|
| `pdf_read` | Extract text from a PDF. Optional `page` param for a single page (1-based). |
| `pdf_info` | Get metadata: page count, title, author, file size, dates. |
| `pdf_write` | Create a new PDF from plain text. Supports `title`, `author`, `font_size`. |
| `pdf_merge` | Merge a list of PDFs into one (`input_paths` array, `output_path`). |
| `pdf_extract_pages` | Pull specific pages (1-based array) into a new PDF. |
| `pdf_split` | Split a PDF into one file per page in an output directory. |

## How to respond

1. Determine the operation from the user's arguments above.
2. Resolve any relative file paths against the current working directory.
3. Call the appropriate tool. If a required argument is missing (e.g. output path for merge), ask before proceeding.
4. After the tool returns, summarize the result concisely. For `pdf_read`, present the extracted text (or a summary if it is long).

## Quick reference

- `/pdf read ./report.pdf` → `pdf_read { file_path }`
- `/pdf info ./report.pdf` → `pdf_info { file_path }`
- `/pdf write ./out.pdf some text here` → `pdf_write { file_path, content }`
- `/pdf merge ./combined.pdf a.pdf b.pdf` → `pdf_merge { output_path, input_paths }`
- `/pdf extract ./in.pdf ./out.pdf 1,3,5` → `pdf_extract_pages { input_path, output_path, pages }`
- `/pdf split ./in.pdf ./pages/` → `pdf_split { input_path, output_dir }`
