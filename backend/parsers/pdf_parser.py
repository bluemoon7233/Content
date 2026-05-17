import pdfplumber
from io import BytesIO


def extract_text_from_pdf(content: bytes) -> str:
    text_parts = []
    with pdfplumber.open(BytesIO(content)) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            text = page.extract_text()
            if text and text.strip():
                text_parts.append(f"[Page {i}]\n{text.strip()}")
            # Also extract tables as text
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    row_text = " | ".join(cell or "" for cell in row)
                    if row_text.strip():
                        text_parts.append(row_text)
    return "\n\n".join(text_parts)
