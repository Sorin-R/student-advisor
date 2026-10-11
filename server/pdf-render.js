import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
function parseDocumentSubmissions(value) { if (value && typeof value === 'object' && !Array.isArray(value)) return value; try { return JSON.parse(value || '{}') } catch { return {} } }
function parseDocumentKeys(value) { if (Array.isArray(value)) return value; try { return JSON.parse(value || '[]') } catch { return [] } }
const applicationPdfSections = [
  { heading: 'APPLICANT INFORMATION', fields: [['Title', 'title'], ['First name', 'firstName'], ['Last name', 'lastName'], ['Date of birth', 'dob'], ['Nationality', 'nationality'], ['Country of birth', 'countryOfBirth'], ['Country of residence', 'country'], ['Email address', 'email'], ['Phone number', 'phone'], ['Home address number and street', 'homeAddress'], ['City', 'city'], ['Postal code', 'postalCode'], ['Next of Kin/Emergency Contact Name', 'nextOfKinName'], ['Next of Kin Phone number', 'nextOfKinPhone']] },
  { heading: 'EDUCATION AND STUDY CHOICES', fields: [['School or college', 'school'], ['School or college country', 'schoolCountry'], ['Highest qualification', 'qualification'], ['Graduation year', 'graduationYear'], ['English test', 'englishTest'], ['Overall English score', 'englishScore'], ['University name', 'university'], ['Which course are you applying for?', 'course'], ['Study level', 'level'], ['Preferred intake', 'intake']] },
  { heading: 'WORKING HISTORY AND SUPPORT', fields: [['Employment or volunteering', 'employment'], ['Support needed', 'supportNeeds'], ['Why do you want to study this course?', 'motivation']] },
]
function pdfSafeText(value) { return String(value ?? 'Not provided').replace(/[^\x20-\x7E]/g, '?') }
function pdfWrappedLines(value, maxLength = 88) {
  const words = pdfSafeText(value).split(/\s+/)
  const lines = []
  let line = ''
  words.forEach((word) => {
    if ((line + ' ' + word).trim().length > maxLength && line) { lines.push(line); line = word } else line = (line + ' ' + word).trim()
  })
  if (line || !lines.length) lines.push(line || 'Not provided')
  return lines
}
function pdfApplicationPage(pdf, fonts, title, subtitle = '') {
  const page = pdf.addPage([595.28, 841.89])
  const { regular, bold } = fonts
  page.drawText(pdfSafeText(title), { x: 48, y: 785, size: 23, font: bold, color: rgb(0.06, 0.08, 0.11) })
  if (subtitle) page.drawText(pdfSafeText(subtitle), { x: 48, y: 756, size: 10, font: regular, color: rgb(0.35, 0.35, 0.35) })
  page.drawLine({ start: { x: 48, y: 738 }, end: { x: 547, y: 738 }, thickness: 1, color: rgb(0.85, 0.84, 0.8) })
  return page
}
function pdfTablePage(pdf, fonts) {
  const page = pdf.addPage([595.28, 841.89])
  page.drawText('STUDENT ADVISOR', { x: 48, y: 804, size: 10, font: fonts.bold, color: rgb(0.06, 0.08, 0.11) })
  return { page, y: 776 }
}
function drawPdfTableSection(pdf, fonts, state, heading, fields, data) {
  let { page, y } = state
  const x = 48; const width = 499; const labelWidth = 205; const valueWidth = width - labelWidth
  const beginSection = () => {
    if (y < 100) ({ page, y } = pdfTablePage(pdf, fonts))
    page.drawRectangle({ x, y: y - 25, width, height: 25, color: rgb(0.95, 0.16, 0.08) })
    page.drawText(heading, { x: x + 10, y: y - 17, size: 10, font: fonts.bold, color: rgb(1, 1, 1) })
    y -= 25
  }
  beginSection()
  fields.forEach(([label, key]) => {
    const value = key === 'phone' && data.phoneCountry ? `${data.phoneCountry} ${data.phone || ''}`.trim() : data[key]
    const labelLines = pdfWrappedLines(label, 31)
    const valueLines = pdfWrappedLines(value || 'Not provided', 44)
    const rowHeight = Math.max(28, (Math.max(labelLines.length, valueLines.length) * 12) + 12)
    if (y - rowHeight < 55) { ({ page, y } = pdfTablePage(pdf, fonts)); beginSection() }
    page.drawRectangle({ x, y: y - rowHeight, width, height: rowHeight, borderColor: rgb(0.12, 0.12, 0.12), borderWidth: 0.6 })
    page.drawLine({ start: { x: x + labelWidth, y }, end: { x: x + labelWidth, y: y - rowHeight }, thickness: 0.6, color: rgb(0.12, 0.12, 0.12) })
    labelLines.forEach((line, index) => page.drawText(pdfSafeText(line), { x: x + 8, y: y - 16 - (index * 12), size: 9, font: fonts.bold, color: rgb(0.06, 0.08, 0.11) }))
    valueLines.forEach((line, index) => page.drawText(pdfSafeText(line), { x: x + labelWidth + 10, y: y - 16 - (index * 12), size: 9, font: fonts.regular, color: rgb(0.06, 0.08, 0.11) }))
    y -= rowHeight
  })
  return { page, y: y - 18 }
}
async function buildApplicationPdfWithPdfLib(row) {
  const pdf = await PDFDocument.create()
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) }
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {})
  const submissions = parseDocumentSubmissions(row.documentSubmissions)
  const studentName = [data.firstName || row.firstName, data.lastName || row.lastName].filter(Boolean).join(' ') || 'Student application'
  let tableState = pdfTablePage(pdf, fonts)
  applicationPdfSections.forEach((section) => { tableState = drawPdfTableSection(pdf, fonts, tableState, section.heading, section.fields, data) })
  let page = tableState.page
  let y = tableState.y
  const requested = parseDocumentKeys(row.requestedDocuments)
  if (requested.length) {
    page = pdfApplicationPage(pdf, fonts, 'Uploaded documents', studentName)
    y = 710
    page.drawText('Uploaded documents are listed below and can be downloaded separately.', { x: 48, y, size: 10, font: fonts.regular, color: rgb(0.35, 0.35, 0.35) })
    y -= 30
    for (const key of requested) {
      const submission = submissions[key]
      if (submission?.fileName) {
        page.drawText(pdfSafeText(submission.fileName), { x: 48, y, size: 11, font: fonts.bold, color: rgb(0.06, 0.08, 0.11) })
        page.drawText(`Status: ${pdfSafeText(submission.status || 'submitted')}`, { x: 48, y: y - 16, size: 9, font: fonts.regular, color: rgb(0.35, 0.35, 0.35) })
        y -= 42
      }
    }
  }
  for (const key of requested) {
    const submission = submissions[key]
    const storedFile = row.documentFiles?.[key]
    if (!submission?.storageName || !storedFile?.content) continue
    try {
      const content = Buffer.from(storedFile.content)
      const mimeType = storedFile.mimeType || submission.mimeType
      if (mimeType === 'application/pdf') {
        const source = await PDFDocument.load(content)
        const copiedPages = await pdf.copyPages(source, source.getPageIndices())
        copiedPages.forEach((copiedPage) => pdf.addPage(copiedPage))
      } else if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
        const image = mimeType === 'image/jpeg' ? await pdf.embedJpg(content) : await pdf.embedPng(content)
        const imagePage = pdf.addPage([595.28, 841.89])
        const fitted = image.scaleToFit(499, 730)
        imagePage.drawText(pdfSafeText(storedFile.fileName || submission.fileName || key), { x: 48, y: 805, size: 10, font: fonts.bold, color: rgb(0.06, 0.08, 0.11) })
        imagePage.drawImage(image, { x: 48 + ((499 - fitted.width) / 2), y: 45 + ((730 - fitted.height) / 2), width: fitted.width, height: fitted.height })
      }
    } catch (error) {
      const failedPage = pdfApplicationPage(pdf, fonts, 'Uploaded document', pdfSafeText(storedFile.fileName || submission.fileName || key))
      failedPage.drawText('This uploaded file could not be embedded.', { x: 48, y: 700, size: 10, font: fonts.regular, color: rgb(0.7, 0.1, 0.05) })
    }
  }
  return pdf.save()
}
export async function buildApplicationPdf(row) {
  return buildApplicationPdfWithPdfLib(row)
}
