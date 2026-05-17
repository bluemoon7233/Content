import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from backend.config import get_settings
from backend.models import (
    ExtractionResult,
    PublishRequest,
    PublishResult,
    PostResult,
    PostStatus,
    Platform,
)
from backend.parsers.pdf_parser import extract_text_from_pdf
from backend.parsers.html_parser import extract_text_from_html
from backend.ai.claude_extractor import extract_posts_from_text
from backend.meta.graph_api import MetaGraphClient

app = FastAPI(title="Social Media Scheduler", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.post("/api/extract", response_model=ExtractionResult)
async def extract_content(file: UploadFile = File(...)):
    content = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith(".pdf"):
        text = extract_text_from_pdf(content)
    elif filename.endswith((".html", ".htm")):
        text = extract_text_from_html(content)
    else:
        # Try HTML first, then plain text
        try:
            text = extract_text_from_html(content)
        except Exception:
            text = content.decode("utf-8", errors="replace")

    if not text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from file.")

    settings = get_settings()
    try:
        result = extract_posts_from_text(text, settings.anthropic_api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {e}")

    return result


@app.post("/api/publish", response_model=PublishResult)
async def publish_posts(request: PublishRequest):
    settings = get_settings()

    if not settings.meta_page_access_token:
        raise HTTPException(
            status_code=503,
            detail="Meta credentials not configured. Set META_PAGE_ACCESS_TOKEN in .env",
        )

    client = MetaGraphClient(
        page_access_token=settings.meta_page_access_token,
        page_id=settings.meta_page_id,
        ig_user_id=settings.meta_ig_user_id,
    )

    results: list[PostResult] = []

    for post in request.posts:
        as_draft = request.action == "draft"
        scheduled_time = post.scheduled_time if request.action == "schedule" else None

        caption_with_tags = post.caption
        if post.hashtags:
            tag_str = " ".join(f"#{t}" for t in post.hashtags)
            caption_with_tags = f"{post.caption}\n\n{tag_str}"

        platforms = (
            [Platform.facebook, Platform.instagram]
            if post.platform == Platform.both
            else [post.platform]
        )

        for platform in platforms:
            if platform == Platform.facebook:
                resp = client.publish_facebook_post(
                    caption=caption_with_tags,
                    image_url=post.image_url,
                    scheduled_time=scheduled_time,
                    as_draft=as_draft,
                )
            else:
                resp = client.publish_instagram_post(
                    caption=caption_with_tags,
                    image_url=post.image_url,
                    scheduled_time=scheduled_time,
                    as_draft=as_draft,
                )

            if "error" in resp:
                # Fallback: try as draft
                fallback_resp = _try_draft_fallback(
                    client, platform, caption_with_tags, post.image_url
                )
                if fallback_resp and "error" not in fallback_resp:
                    results.append(
                        PostResult(
                            post_id=post.id,
                            platform=platform,
                            status=PostStatus.draft,
                            meta_id=fallback_resp.get("id"),
                            notes=f"Fallback to draft: {resp['error']}",
                        )
                    )
                else:
                    results.append(
                        PostResult(
                            post_id=post.id,
                            platform=platform,
                            status=PostStatus.failed,
                            error=resp["error"],
                        )
                    )
            else:
                status = PostStatus.draft if as_draft else (
                    PostStatus.scheduled if scheduled_time else PostStatus.published
                )
                results.append(
                    PostResult(
                        post_id=post.id,
                        platform=platform,
                        status=status,
                        meta_id=resp.get("id") or resp.get("post_id"),
                        scheduled_time=scheduled_time,
                    )
                )

    return PublishResult(results=results)


def _try_draft_fallback(client, platform, caption, image_url):
    try:
        if platform == Platform.facebook:
            return client.publish_facebook_post(
                caption=caption, image_url=image_url, as_draft=True
            )
        else:
            return client.publish_instagram_post(
                caption=caption, image_url=image_url, as_draft=True
            )
    except Exception:
        return None


@app.get("/api/meta/verify")
async def verify_meta_connection():
    settings = get_settings()
    if not settings.meta_page_access_token:
        return {"connected": False, "reason": "META_PAGE_ACCESS_TOKEN not set"}
    client = MetaGraphClient(
        page_access_token=settings.meta_page_access_token,
        page_id=settings.meta_page_id,
        ig_user_id=settings.meta_ig_user_id,
    )
    info = client.get_page_info()
    if "error" in info:
        return {"connected": False, "reason": info["error"]}
    return {"connected": True, "page": info}


# Serve frontend static files
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
