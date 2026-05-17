import httpx
import time
from datetime import datetime, timezone
from typing import Optional

GRAPH_BASE = "https://graph.facebook.com/v21.0"


class MetaGraphClient:
    def __init__(self, page_access_token: str, page_id: str, ig_user_id: str):
        self.token = page_access_token
        self.page_id = page_id
        self.ig_user_id = ig_user_id

    # -------------------------------------------------------------------------
    # Facebook
    # -------------------------------------------------------------------------

    def publish_facebook_post(
        self,
        caption: str,
        image_url: Optional[str] = None,
        scheduled_time: Optional[datetime] = None,
        as_draft: bool = False,
    ) -> dict:
        endpoint = f"{GRAPH_BASE}/{self.page_id}/feed"
        params: dict = {"access_token": self.token, "message": caption}

        if image_url:
            # Use photo endpoint instead when there's an image
            return self._publish_facebook_photo(caption, image_url, scheduled_time, as_draft)

        if as_draft:
            params["published"] = "false"
        elif scheduled_time:
            future_ts = int(scheduled_time.astimezone(timezone.utc).timestamp())
            now_ts = int(time.time())
            min_ts = now_ts + 600  # 10 minutes minimum
            if future_ts < min_ts:
                # Too close — fall back to draft
                params["published"] = "false"
            else:
                params["published"] = "false"
                params["scheduled_publish_time"] = future_ts
        else:
            params["published"] = "true"

        with httpx.Client() as client:
            resp = client.post(endpoint, data=params)
        return self._handle_response(resp)

    def _publish_facebook_photo(
        self,
        caption: str,
        image_url: str,
        scheduled_time: Optional[datetime],
        as_draft: bool,
    ) -> dict:
        endpoint = f"{GRAPH_BASE}/{self.page_id}/photos"
        params: dict = {
            "access_token": self.token,
            "caption": caption,
            "url": image_url,
        }

        if as_draft:
            params["published"] = "false"
        elif scheduled_time:
            future_ts = int(scheduled_time.astimezone(timezone.utc).timestamp())
            now_ts = int(time.time())
            if future_ts < now_ts + 600:
                params["published"] = "false"
            else:
                params["published"] = "false"
                params["scheduled_publish_time"] = future_ts
        else:
            params["published"] = "true"

        with httpx.Client() as client:
            resp = client.post(endpoint, data=params)
        return self._handle_response(resp)

    # -------------------------------------------------------------------------
    # Instagram
    # -------------------------------------------------------------------------

    def publish_instagram_post(
        self,
        caption: str,
        image_url: Optional[str] = None,
        scheduled_time: Optional[datetime] = None,
        as_draft: bool = False,
    ) -> dict:
        if not self.ig_user_id:
            return {"error": "META_IG_USER_ID not configured"}

        if not image_url:
            # Instagram requires media — cannot publish text-only
            return {
                "error": "Instagram requires an image or video URL. Post saved as draft intent.",
                "draft": True,
                "caption": caption,
            }

        # Step 1: Create media container
        container_params: dict = {
            "access_token": self.token,
            "caption": caption,
            "image_url": image_url,
        }

        if scheduled_time and not as_draft:
            future_ts = int(scheduled_time.astimezone(timezone.utc).timestamp())
            now_ts = int(time.time())
            if future_ts >= now_ts + 600:
                container_params["published"] = "false"
                container_params["scheduled_publish_time"] = future_ts
            else:
                as_draft = True

        with httpx.Client() as client:
            container_resp = client.post(
                f"{GRAPH_BASE}/{self.ig_user_id}/media",
                data=container_params,
            )
        container_data = self._handle_response(container_resp)

        if "error" in container_data:
            return container_data

        creation_id = container_data.get("id")

        if as_draft or "scheduled_publish_time" in container_params:
            return {"id": creation_id, "status": "scheduled_or_draft"}

        # Step 2: Publish immediately
        with httpx.Client() as client:
            publish_resp = client.post(
                f"{GRAPH_BASE}/{self.ig_user_id}/media_publish",
                data={"access_token": self.token, "creation_id": creation_id},
            )
        return self._handle_response(publish_resp)

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _handle_response(self, resp: httpx.Response) -> dict:
        try:
            data = resp.json()
        except Exception:
            return {"error": f"HTTP {resp.status_code}: {resp.text}"}

        if resp.status_code >= 400 or "error" in data:
            error_msg = data.get("error", {})
            if isinstance(error_msg, dict):
                error_msg = error_msg.get("message", str(data))
            return {"error": error_msg}

        return data

    def get_page_info(self) -> dict:
        with httpx.Client() as client:
            resp = client.get(
                f"{GRAPH_BASE}/{self.page_id}",
                params={"access_token": self.token, "fields": "name,id"},
            )
        return self._handle_response(resp)
