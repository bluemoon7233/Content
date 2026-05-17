import json
import anthropic
from backend.models import ExtractedPost, ExtractionResult, Platform


SYSTEM_PROMPT = """You are a social media content strategist. Your job is to read a content plan document and extract individual social media posts from it.

For each post you identify, extract:
- platform: "facebook", "instagram", or "both" (default to "both" if not specified)
- caption: the post text/copy (full caption, ready to publish)
- hashtags: a list of hashtag strings without the # symbol (e.g. ["marketing", "smallbusiness"])
- scheduled_time: ISO 8601 datetime string if a date/time is mentioned (null if none)
- image_url: a URL to an image if one is referenced or described (null if none)
- post_type: one of "text", "image", "video", "reel", "story" (default "text", use "image" if image_url is set)
- notes: any production notes or instructions for the post (null if none)

Return ONLY valid JSON in this exact format:
{
  "posts": [...],
  "raw_summary": "Brief 1-2 sentence summary of the content plan"
}

If the document does not contain clear social media posts or content, extract what you can and make reasonable inferences. Always return valid JSON."""


def extract_posts_from_text(text: str, api_key: str) -> ExtractionResult:
    client = anthropic.Anthropic(api_key=api_key)

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Please extract all social media posts from this content plan:\n\n{text}",
            }
        ],
    )

    raw = message.content[0].text.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.rsplit("```", 1)[0].strip()

    data = json.loads(raw)

    posts = []
    for item in data.get("posts", []):
        # Normalise platform value
        platform_raw = (item.get("platform") or "both").lower().strip()
        if platform_raw not in ("facebook", "instagram", "both"):
            platform_raw = "both"

        posts.append(
            ExtractedPost(
                platform=Platform(platform_raw),
                caption=item.get("caption", ""),
                hashtags=item.get("hashtags") or [],
                scheduled_time=item.get("scheduled_time"),
                image_url=item.get("image_url"),
                post_type=item.get("post_type", "text"),
                notes=item.get("notes"),
            )
        )

    return ExtractionResult(
        posts=posts,
        raw_summary=data.get("raw_summary", ""),
    )
