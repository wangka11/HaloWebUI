import pathlib
import sys


_BACKEND_DIR = pathlib.Path(__file__).resolve().parents[3]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from open_webui.routers.openai import (  # noqa: E402
    _connection_supports_native_file_inputs,
    _should_use_responses_api,
)


def test_should_use_responses_api_respects_exclude_patterns():
    assert (
        _should_use_responses_api(
            "https://api.openai.com/v1",
            {"use_responses_api": True, "responses_api_exclude_patterns": ["mini"]},
            "gpt-4.1-mini",
        )
        is False
    )
    assert (
        _should_use_responses_api(
            "https://api.openai.com/v1",
            {"use_responses_api": True, "responses_api_exclude_patterns": ["mini"]},
            "gpt-4.1",
        )
        is True
    )


def test_connection_supports_native_file_inputs_defaults_to_official_openai_only():
    assert (
        _connection_supports_native_file_inputs(
            "https://api.openai.com/v1",
            {"use_responses_api": True},
        )
        is True
    )
    assert (
        _connection_supports_native_file_inputs(
            "https://openrouter.ai/api/v1",
            {"use_responses_api": True},
        )
        is False
    )


def test_connection_supports_native_file_inputs_honors_explicit_flag_and_guards():
    assert (
        _connection_supports_native_file_inputs(
            "https://proxy.example.com/v1",
            {"use_responses_api": True, "native_file_inputs_enabled": True},
        )
        is True
    )
    assert (
        _connection_supports_native_file_inputs(
            "https://api.openai.com/v1/chat/completions",
            {"use_responses_api": True, "native_file_inputs_enabled": True, "force_mode": True},
        )
        is False
    )
    assert (
        _connection_supports_native_file_inputs(
            "https://my-azure.openai.azure.com/openai/deployments/foo",
            {"use_responses_api": True, "native_file_inputs_enabled": True, "azure": True},
        )
        is False
    )
    assert (
        _connection_supports_native_file_inputs(
            "https://api.openai.com/v1",
            {"use_responses_api": False, "native_file_inputs_enabled": True},
        )
        is False
    )
