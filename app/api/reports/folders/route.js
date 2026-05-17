/**
 * GET /api/reports/folders
 *
 * Returns all Salesforce reports with folder grouping data.
 * Mirrors list_all_reports() + list_all_report_folders() in exporter.py.
 *
 * Uses SOQL on the Report object — simpler and more reliable than the
 * Analytics folder tree API for bulk listing.
 *
 * Response: { reports: ReportItem[], folders: string[] }
 */

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session.accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const client = SalesforceClient.fromSession(session)

    // Query all reports — same fields the Python app uses
    const { records } = await client.queryAll(
      `SELECT Id, Name, DeveloperName, FolderName, Format,
              Description, LastModifiedDate, CreatedDate, OwnerId
       FROM Report
       ORDER BY FolderName ASC NULLS LAST, Name ASC`
    )

    const reports = records.map(r => ({
      id:           r.Id,
      name:         r.Name,
      developerName:r.DeveloperName || '',
      folderName:   r.FolderName || 'Unfiled Public Reports',
      format:       r.Format || 'TABULAR',   // TABULAR | SUMMARY | MATRIX | JOINED
      description:  r.Description || '',
      lastModified: r.LastModifiedDate,
      createdDate:  r.CreatedDate,
    }))

    // Unique folder names for filter dropdown
    const folders = [...new Set(reports.map(r => r.folderName))].sort()

    return NextResponse.json({ reports, folders, total: reports.length })

  } catch (err) {
    if (err.code === 'SESSION_EXPIRED') {
      return NextResponse.json({ error: 'Session expired. Please reconnect.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
