import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab import __file__ as reportlab_file


SECTIONS = [
    ("Personal details", [
        ("First name", "firstName"), ("Last name", "lastName"),
        ("Email", "email"), ("Phone", "phone"),
        ("DOB", "dob"), ("Nationality", "nationality"),
        ("Country", "country"), ("City of Residence in the UK", "address"),
    ]),
    ("Education & English", [
        ("School", "school"), ("School country", "schoolCountry"), ("Qualification", "qualification"),
        ("Graduation year", "graduationYear"), ("English test", "englishTest"),
        ("English score", "englishScore"),
    ]),
    ("University choices", [
        ("University", "university"), ("Course", "course"),
        ("Level", "level"), ("Intake", "intake"),
    ]),
    ("Experience & statement", [
        ("Employment", "employment"), ("Motivation", "motivation"),
        ("Support needs", "supportNeeds"),
    ]),
]
DOCUMENT_NAMES = {
    "passport": "Passport or Identity document",
    "transcript": "Academic transcript or certificate",
    "personalStatement": "Personal Statement",
    "proofAddress": "Proof of address",
    "reference": "Teacher or employer reference",
}


def text(value):
    return str(value if value not in (None, "") else "Not provided")


def register_fonts():
    font_dir = Path(reportlab_file).parent / "fonts"
    if "ApplicationRegular" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("ApplicationRegular", str(font_dir / "Vera.ttf")))
        pdfmetrics.registerFont(TTFont("ApplicationBold", str(font_dir / "VeraBd.ttf")))


def wrapped_lines(value, max_width, font="ApplicationRegular", size=9):
    lines = []
    for paragraph in text(value).splitlines() or [""]:
        line = ""
        for word in paragraph.split():
            candidate = f"{line} {word}".strip()
            if line and pdfmetrics.stringWidth(candidate, font, size) > max_width:
                lines.append(line)
                line = ""
            while pdfmetrics.stringWidth(word, font, size) > max_width:
                length = len(word)
                while length > 1 and pdfmetrics.stringWidth(word[:length], font, size) > max_width:
                    length -= 1
                if line:
                    lines.append(line)
                    line = ""
                lines.append(word[:length])
                word = word[length:]
            line = f"{line} {word}".strip()
        lines.append(line)
    return lines or ["Not provided"]


def summary_pdf(row):
    register_fonts()
    data = row.get("data") or {}
    if isinstance(data, str):
        data = json.loads(data)
    name = " ".join(filter(None, [data.get("firstName") or row.get("firstName"), data.get("lastName") or row.get("lastName")])) or "Student application"
    output = io.BytesIO()
    page = canvas.Canvas(output, pagesize=A4)
    width, height = A4
    margin = 46
    gap = 25
    column_width = (width - 2 * margin - gap) / 2
    columns = (margin, margin + column_width + gap)
    bottom = 55
    y = 0
    page_number = 0

    def footer():
        page.setStrokeColorRGB(0.88, 0.87, 0.84)
        page.line(margin, 43, width - margin, 43)
        page.setFont("ApplicationRegular", 7.5)
        page.setFillColorRGB(0.47, 0.47, 0.47)
        page.drawString(margin, 29, "Student Advisor | Application")
        page.drawRightString(width - margin, 29, str(page_number))

    def new_page(first=False):
        nonlocal y, page_number
        if page_number:
            footer()
            page.showPage()
        page_number += 1
        page.setFillColorRGB(0.95, 0.32, 0.21)
        page.setFont("ApplicationBold", 8)
        page.drawString(margin, height - 49, "STUDENT APPLICATION")
        page.setFillColorRGB(0.06, 0.08, 0.11)
        title = name if first else f"{name} - continued"
        title_lines = wrapped_lines(title, width - 2 * margin, "ApplicationBold", 21)
        title_y = height - 80
        page.setFont("ApplicationBold", 21)
        for title_line in title_lines:
            page.drawString(margin, title_y, title_line)
            title_y -= 27
        page.setFont("ApplicationRegular", 9)
        page.setFillColorRGB(0.35, 0.35, 0.35)
        subtitle = f"{data.get('email') or row.get('email') or 'Email not provided'}  |  {data.get('university') or 'University not selected'}  |  {data.get('course') or 'Course not selected'}"
        for subtitle_line in wrapped_lines(subtitle, width - 2 * margin, size=9):
            page.drawString(margin, title_y - 3, subtitle_line)
            title_y -= 15
        page.setStrokeColorRGB(0.85, 0.84, 0.81)
        page.line(margin, title_y - 8, width - margin, title_y - 8)
        y = title_y - 29

    def section_heading(title, percentage, continued=False):
        nonlocal y
        page.setFont("ApplicationBold", 13)
        page.setFillColorRGB(0.06, 0.08, 0.11)
        page.drawString(margin, y, title + (" (continued)" if continued else ""))
        if percentage is not None:
            page.setFont("ApplicationBold", 8)
            page.setFillColorRGB(0.95, 0.32, 0.21)
            page.drawRightString(width - margin, y + 2, f"{percentage}%")
        y -= 17
        page.setStrokeColorRGB(0.85, 0.84, 0.81)
        page.line(margin, y, width - margin, y)
        y -= 14

    def draw_pair(pair, section_title, percentage):
        nonlocal y
        entries = [
            (label, wrapped_lines(data.get(key), column_width - 5))
            for label, key in pair
        ]
        offsets = [0 for _ in entries]
        while any(offsets[index] < len(lines) for index, (_, lines) in enumerate(entries)):
            if y < bottom + 50:
                new_page()
                section_heading(section_title, percentage, continued=True)
            available_lines = max(1, int((y - bottom - 33) / 13))
            count = min(available_lines, max(len(lines) - offsets[index] for index, (_, lines) in enumerate(entries)))
            page.setStrokeColorRGB(0.92, 0.91, 0.89)
            page.setLineWidth(0.6)
            for index, (label, lines) in enumerate(entries):
                if offsets[index] >= len(lines):
                    continue
                x = columns[index]
                page.line(x, y, x + column_width, y)
                page.setFont("ApplicationRegular", 7)
                page.setFillColorRGB(0.51, 0.51, 0.51)
                page.drawString(x, y - 13, label.upper() + (" (CONTINUED)" if offsets[index] else ""))
                page.setFont("ApplicationRegular", 9)
                page.setFillColorRGB(0.06, 0.08, 0.11)
                for line_number, line in enumerate(lines[offsets[index]:offsets[index] + count]):
                    page.drawString(x, y - 30 - line_number * 13, line)
                offsets[index] += count
            y -= max(49, 34 + 13 * count)
            if any(offsets[index] < len(lines) for index, (_, lines) in enumerate(entries)):
                new_page()
                section_heading(section_title, percentage, continued=True)

    new_page(first=True)
    status_label = {"draft": "Draft", "submitted": "Submitted", "in_review": "In processing", "complete": "Processed"}.get(row.get("status"), text(row.get("status")))
    page.setFont("ApplicationBold", 8)
    page.setFillColorRGB(0.95, 0.32, 0.21)
    page.drawString(margin, y, status_label.upper())
    y -= 29
    for title, fields in SECTIONS:
        pairs = [fields[index:index + 2] for index in range(0, len(fields), 2)]
        estimated_height = 46 + sum(max(49, 34 + 13 * max(len(wrapped_lines(data.get(key), column_width - 5)) for _, key in pair)) for pair in pairs)
        if y - 80 < bottom or (y - estimated_height < bottom and estimated_height < height - 180):
            new_page()
        filled = sum(bool(str(data.get(key) or "").strip()) for _, key in fields)
        percentage = round(100 * filled / len(fields))
        section_heading(title, percentage)
        for pair in pairs:
            if y < bottom + 50:
                new_page()
                section_heading(title, percentage, continued=True)
            draw_pair(pair, title, percentage)
        y -= 21

    submissions = row.get("documentSubmissions") or {}
    if isinstance(submissions, str):
        submissions = json.loads(submissions)
    requested = row.get("requestedDocuments") or []
    if isinstance(requested, str):
        requested = json.loads(requested)
    if requested:
        new_page()
        section_heading("Uploaded documents", None)
        page.setFont("ApplicationRegular", 9)
        page.setFillColorRGB(0.35, 0.35, 0.35)
        page.drawString(margin, y, "Uploaded files follow this page in the same PDF.")
        y -= 30
        for key in requested:
            submission = submissions.get(key) or {}
            if submission.get("fileName"):
                document_label = text(DOCUMENT_NAMES.get(key, submission["fileName"]))
                label_lines = wrapped_lines(document_label, width - 2 * margin, "ApplicationBold", 10)
                document_detail = f"{text(submission['fileName'])}  |  Status: {text(submission.get('status') or 'submitted')}"
                detail_lines = wrapped_lines(document_detail, width - 2 * margin, size=8)
                row_height = 33 + 13 * len(label_lines) + 11 * len(detail_lines)
                if y - row_height < bottom:
                    new_page()
                    section_heading("Uploaded documents", None, continued=True)
                page.setStrokeColorRGB(0.92, 0.91, 0.89)
                page.line(margin, y, width - margin, y)
                page.setFont("ApplicationBold", 10)
                page.setFillColorRGB(0.06, 0.08, 0.11)
                for index, line in enumerate(label_lines):
                    page.drawString(margin, y - 17 - index * 13, line)
                page.setFont("ApplicationRegular", 8)
                page.setFillColorRGB(0.35, 0.35, 0.35)
                for index, line in enumerate(detail_lines):
                    page.drawString(margin, y - 21 - 13 * len(label_lines) - index * 11, line)
                y -= row_height
    footer()
    page.save()
    return output.getvalue()


def image_pdf(content, filename):
    register_fonts()
    output = io.BytesIO()
    page = canvas.Canvas(output, pagesize=A4)
    width, height = A4
    page.setFont("ApplicationBold", 10)
    for index, line in enumerate(wrapped_lines(filename, width - 96, "ApplicationBold", 10)):
        page.drawString(48, height - 38 - index * 13, line)
    with Image.open(io.BytesIO(content)) as image:
        image.load()
        if image.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", image.size, "white")
            background.paste(image, mask=image.getchannel("A") if "A" in image.getbands() else None)
            image = background
        image_reader = ImageReader(image)
        max_width, max_height = width - 96, height - 100
        scale = min(max_width / image.width, max_height / image.height, 1)
        image_width, image_height = image.width * scale, image.height * scale
        page.drawImage(image_reader, (width - image_width) / 2, 42 + (max_height - image_height) / 2, image_width, image_height, preserveAspectRatio=True, mask="auto")
    page.save()
    return output.getvalue()


def main():
    payload = json.load(sys.stdin)
    row = payload["row"]
    root = Path(payload["uploadsDir"]).resolve()
    writer = PdfWriter()
    summary_reader = PdfReader(io.BytesIO(summary_pdf(row)))
    for page in summary_reader.pages:
        writer.add_page(page)
    submissions = row.get("documentSubmissions") or {}
    if isinstance(submissions, str):
        submissions = json.loads(submissions)
    requested = row.get("requestedDocuments") or []
    if isinstance(requested, str):
        requested = json.loads(requested)
    document_files = row.get("documentFiles") or {}
    for key in requested:
        submission = submissions.get(key) or {}
        storage_name = submission.get("storageName")
        if not storage_name:
            continue
        try:
            stored_file = document_files.get(key) or {}
            if stored_file.get("contentBase64"):
                content = base64.b64decode(stored_file["contentBase64"])
            else:
                stored = (root / storage_name).resolve()
                if root != stored and root not in stored.parents:
                    continue
                content = stored.read_bytes()
            mime_type = stored_file.get("mimeType") or submission.get("mimeType")
            if mime_type == "application/pdf":
                reader = PdfReader(io.BytesIO(content), strict=False)
                for page in reader.pages:
                    writer.add_page(page)
            elif mime_type in ("image/jpeg", "image/png"):
                reader = PdfReader(io.BytesIO(image_pdf(content, submission.get("fileName") or key)))
                for page in reader.pages:
                    writer.add_page(page)
        except Exception:
            continue
    output = io.BytesIO()
    writer.write(output)
    sys.stdout.buffer.write(output.getvalue())


if __name__ == "__main__":
    main()
