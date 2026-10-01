---
name: sailor-list-repair
description: Clean, de-duplicate, resolve and enrich messy contact or company lists (CSV/XLSX/Google Sheet exports from CRMs, events, scraped lists) using Fiber Kitchen Sink and Mosaic. Use when the user shares a file or sheet and wants it fixed, enriched, or matched to LinkedIn.
---

# Repairing messy lists

## Steps
1. Run `fiber_repair_list` with `preview: true` (free). Read the pre-flight card back to the user:
   rows, detected columns (email / LinkedIn / name / company / domain) with coverage %, encoding & delimiter, warnings (Excel-damaged phones, header not on row 1, duplicate columns), engine (Kitchen Sink ≤ 50 rows, Mosaic otherwise) and the estimate.
2. Ask which extras they want — **all default OFF**: work email, personal email, phone, company details. Mention Mosaic's first org run includes 1,000 free rows.
3. Run again without `preview` and the chosen flags. Sailor asks the user to approve the cost (and, for Mosaic, the temporary upload).
4. Mosaic runs async: tell the user they can keep working; the footer shows progress and Sailor imports results automatically (`/jobs` for status). Kitchen Sink finishes immediately.
5. After import: summarize found / not found / with contacts, point to `/list <id>`, and offer `export_list` (Sheets upsert keeps a shared sheet in sync).

## If Mosaic can't run yet
- Local file + no hosting → offer: (a) `/repair hosting gdrive` (after `/sheets connect`), (b) `/repair hosting s3`, or (c) a public link they paste as `sourceUrl`.
- Private Google Sheet → ask them to share "anyone with the link: viewer" or export CSV. Only the **first tab** is processed.
- Over 20,000 rows / 50 MiB → Sailor splits into multiple runs automatically when hosting is configured.

## Data hygiene tips to share
- Excel turns long phone numbers into `1.2E+10`; re-export the column as Text.
- Duplicates are merged by LinkedIn URL → email → name+domain.
- Rows marked `not_found` can be retried with more context (add company/domain) via `/list` → select → `r`.
