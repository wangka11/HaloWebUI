import asyncio
import pathlib
import sys
from types import SimpleNamespace


_BACKEND_DIR = pathlib.Path(__file__).resolve().parents[3]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from open_webui.utils import middleware  # noqa: E402


def test_resolve_selected_chat_image_target_for_openai_image_model(monkeypatch):
    request = SimpleNamespace(state=SimpleNamespace())
    user = SimpleNamespace(id="user-1")
    model = {
        "id": "team.gpt-image-2",
        "original_id": "gpt-image-2",
        "name": "GPT Image 2",
        "owned_by": "openai",
        "openai": {
            "id": "gpt-image-2",
            "name": "GPT Image 2",
        },
    }

    monkeypatch.setattr(middleware.Models, "get_model_by_id", lambda _id: None)
    monkeypatch.setattr(
        middleware,
        "_get_openai_user_config",
        lambda _user: (["https://api.openai.com/v1"], ["sk-openai"], {}),
    )

    target = asyncio.run(
        middleware._resolve_selected_chat_image_target(
            request,
            user,
            model,
            model["id"],
        )
    )

    assert target is not None
    assert target["provider"] == "openai"
    assert target["model_id"] == "gpt-image-2"
    assert target["credential_source"] == "personal"
    assert target["connection_index"] == 0
    assert target["model_meta"]["generation_mode"] == "openai_images"


def test_build_generated_image_chat_response_embeds_files_in_message_content():
    response = middleware._build_generated_image_chat_response(
        model_id="gpt-image-2",
        images=[
            {"url": "/api/v1/files/img-1"},
            {"url": "/api/v1/files/img-2"},
        ],
    )

    message = response["choices"][0]["message"]
    assert message["role"] == "assistant"
    assert message["content"][0]["type"] == "text"
    assert message["content"][1] == {
        "type": "image_url",
        "image_url": {"url": "/api/v1/files/img-1"},
    }
    assert message["content"][2] == {
        "type": "image_url",
        "image_url": {"url": "/api/v1/files/img-2"},
    }
