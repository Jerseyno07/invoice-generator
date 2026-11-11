# Invoice Generator

A static GST invoice generator, hosted on Netlify. Upload a CSV of order lines, it groups them into one tax invoice per customer, renders them in a standard Indian tax-invoice format (with a QR code per invoice), and lets you download all of them as individual A4 PDFs. Each generated PDF is also uploaded to Cloudflare R2, and its link is logged as a row in a Google Sheet.

## How it works

- **`index.html`** — the entire UI and invoice logic. No build step, no framework: vanilla JS in a single file.
  - Seller details are entered once and persisted in the browser's `localStorage`.
  - A CSV of order lines is parsed client-side and grouped into invoices (one per unique `ShipToAddress + BilledToAddress + GSTIN + PONumber + Date`, or by `InvoiceId` directly if that column is present).
  - **Generate All Invoices** renders every invoice to the page (with a QR code per invoice encoding its invoice number).
  - **Print / Save as PDF** opens the browser print dialog for all invoices at once (one combined PDF via print-to-PDF).
  - **Download All as PDFs + Upload Links to Sheet** renders each invoice individually (via `html2canvas` + `jsPDF`, fitted to A4), downloads each as its own PDF locally, and in parallel (3 at a time) POSTs each PDF to the Netlify function below.

- **`netlify/functions/upload-invoice.js`** — a serverless function that:
  1. Receives one invoice PDF (base64) from the browser.
  2. Uploads it to a Cloudflare R2 bucket via the S3-compatible API.
  3. Appends a row `[invoice number, customer, date, public R2 link]` to a Google Sheet via the Sheets API, authenticated as a service account.

  This function exists because uploading to R2 and writing to a Sheet both need secret credentials, which can't live in client-side JS on a static site. The browser only ever talks to this function — it never sees the R2 or Google credentials.

## Deploy

This repo is connected to Netlify directly (push to `main` → auto-deploy). `netlify.toml` points it at `netlify/functions` for the function and publishes the repo root.

### Required environment variables (set in Netlify → Site settings → Environment variables)

| Variable | Purpose |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token with write access to the bucket below |
| `R2_BUCKET` | R2 bucket invoices are uploaded to |
| `R2_PUBLIC_URL_BASE` | Bucket's public URL (e.g. `https://pub-xxxx.r2.dev`), no trailing slash |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email (must have Editor access on the target Sheet) |
| `GOOGLE_PRIVATE_KEY` | Service account private key, `\n`-escaped |
| `GOOGLE_SHEET_ID` | Target spreadsheet ID (from its URL) |
| `GOOGLE_SHEET_RANGE` | Sheet/tab + starting cell to append to (tab name followed by `!` and a cell, e.g. a tab named `Data` starting at column A would be `Data!A1`) |

None of these are stored in this repo — they only live in Netlify's environment, which is also why Netlify's secrets scanner is strict about any of these values appearing literally in committed code.

## Local development

There's no local dev server set up — this is meant to be edited and pushed, letting Netlify build and deploy. `npm install` will pull the function's dependencies (`@aws-sdk/client-s3`, `google-auth-library`) if you want to run it with `netlify dev`.
