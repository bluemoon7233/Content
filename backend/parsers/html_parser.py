from bs4 import BeautifulSoup


def extract_text_from_html(content: bytes) -> str:
    soup = BeautifulSoup(content, "lxml")

    # Remove scripts, styles, nav, footer noise
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    # Preserve structure with newlines around block elements
    for tag in soup.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "br"]):
        tag.insert_before("\n")
        tag.insert_after("\n")

    text = soup.get_text(separator=" ")

    # Collapse excessive whitespace while preserving paragraph breaks
    lines = [line.strip() for line in text.splitlines()]
    cleaned = []
    blank_count = 0
    for line in lines:
        if not line:
            blank_count += 1
            if blank_count <= 2:
                cleaned.append("")
        else:
            blank_count = 0
            cleaned.append(line)

    return "\n".join(cleaned).strip()
