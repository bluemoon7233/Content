from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime
from enum import Enum


class Platform(str, Enum):
    facebook = "facebook"
    instagram = "instagram"
    both = "both"


class PostStatus(str, Enum):
    pending = "pending"
    scheduled = "scheduled"
    published = "published"
    draft = "draft"
    failed = "failed"


class ExtractedPost(BaseModel):
    id: str = Field(default_factory=lambda: __import__("uuid").uuid4().hex)
    platform: Platform = Platform.both
    caption: str
    hashtags: list[str] = []
    scheduled_time: Optional[datetime] = None
    image_url: Optional[str] = None
    post_type: Literal["text", "image", "video", "reel", "story"] = "text"
    notes: Optional[str] = None


class ExtractionResult(BaseModel):
    posts: list[ExtractedPost]
    raw_summary: str


class PublishRequest(BaseModel):
    posts: list[ExtractedPost]
    action: Literal["publish_now", "schedule", "draft"]


class PostResult(BaseModel):
    post_id: str
    platform: Platform
    status: PostStatus
    meta_id: Optional[str] = None
    error: Optional[str] = None
    scheduled_time: Optional[datetime] = None


class PublishResult(BaseModel):
    results: list[PostResult]
