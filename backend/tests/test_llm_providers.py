"""Provider adapters against local protocol stubs (no network, no key, no model needed).

The Anthropic tests drive the official SDK end to end — request building, headers, retries and
response parsing — against a stub that answers like the Messages API. The Ollama tests do the
same for its /api/tags and /api/chat endpoints.
"""

from __future__ import annotations

import json

import pytest
from pydantic import BaseModel, Field

from conftest import anthropic_message


class Pick(BaseModel):
    title: str = Field(max_length=40)
    score: int = Field(ge=0, le=10)


GOOD = json.dumps({"title": "Why saving early matters", "score": 8})
BAD = json.dumps({"title": "x" * 80, "score": 42})  # violates both bounds


def _usage_rows():
    from sqlmodel import select

    from clipforge.db import session_scope
    from clipforge.models import UsageRecord

    with session_scope() as s:
        return [r.model_dump() for r in s.exec(select(UsageRecord))]


# ----------------------------------------------------------------------------- Ollama
def test_ollama_status_reports_running_missing_model_and_offline(protocol_stub):
    from clipforge.ai.providers import OllamaProvider

    protocol_stub.handler = (200, {"models": [{"name": "qwen2.5:7b-instruct"}, {"name": "llama3.2:3b"}]})
    assert OllamaProvider(protocol_stub.url, "qwen2.5:7b-instruct").status()["available"] is True
    st = OllamaProvider(protocol_stub.url, "mistral:7b").status()
    assert st["available"] is False and "ollama pull mistral:7b" in st["reason"]
    assert protocol_stub.requests[0]["path"] == "/api/tags"
    off = OllamaProvider("http://127.0.0.1:9", "qwen2.5:7b-instruct").status()
    assert off["available"] is False and "not running" in off["reason"]


def test_ollama_structured_output_with_validation_retry(protocol_stub):
    from clipforge.ai.providers import OllamaProvider

    protocol_stub.queue = [
        (200, {"message": {"role": "assistant", "content": BAD}, "prompt_eval_count": 50, "eval_count": 20}),
        (200, {"message": {"role": "assistant", "content": GOOD}, "prompt_eval_count": 90, "eval_count": 18}),
    ]
    out, usage = OllamaProvider(protocol_stub.url, "qwen2.5:7b-instruct").generate_json("sys", "Rate this clip", Pick, "test")
    assert out == Pick(title="Why saving early matters", score=8)
    assert (usage.provider, usage.input_tokens, usage.output_tokens) == ("ollama", 90, 18)
    first, second = (r["json"] for r in protocol_stub.requests)
    assert first["stream"] is False and first["format"]["properties"]["score"]["maximum"] == 10  # schema-constrained decoding
    assert [m["role"] for m in second["messages"]] == ["system", "user", "assistant", "user"]
    assert "did not validate" in second["messages"][-1]["content"]


def test_ollama_gives_up_after_second_invalid_reply_and_on_http_errors(protocol_stub):
    from clipforge.ai.providers import OllamaProvider, ProviderError

    protocol_stub.handler = (200, {"message": {"content": BAD}})
    with pytest.raises(ProviderError, match="invalid structured output"):
        OllamaProvider(protocol_stub.url, "m").generate_json("s", "p", Pick, "test")
    assert len(protocol_stub.requests) == 2
    protocol_stub.handler = (500, {"error": "model crashed"})
    with pytest.raises(ProviderError, match="Ollama request failed"):
        OllamaProvider(protocol_stub.url, "m").generate_json("s", "p", Pick, "test")


# ----------------------------------------------------------------------------- Anthropic
def test_anthropic_request_shape_usage_and_cost(data_dir, anthropic_stub):
    from clipforge.ai.providers import AnthropicProvider

    anthropic_stub.handler = (200, anthropic_message(GOOD, inp=2000, out=500))
    out, usage = AnthropicProvider(effort="low").generate_json("You are an editor.", "Rate this clip", Pick, "highlight_refine")
    assert out.score == 8
    req = anthropic_stub.requests[0]
    body = req["json"]
    assert req["path"].startswith("/v1/messages")
    h = req["headers"]
    assert h.get("x-api-key") == "sk-ant-test-0000" or h.get("authorization") == "Bearer sk-ant-test-0000"
    assert "server-side-fallback-2026-07-01" in req["headers"].get("anthropic-beta", "")
    assert body["model"] == "claude-opus-5-5" and body["fallbacks"] == "default"
    assert body["system"] == "You are an editor." and body["messages"] == [{"role": "user", "content": "Rate this clip"}]
    fmt = body["output_config"]["format"]
    assert body["output_config"]["effort"] == "low" and fmt["type"] == "json_schema"
    assert fmt["schema"]["additionalProperties"] is False and set(fmt["schema"]["required"]) == {"title", "score"}
    assert '"maxLength":' not in json.dumps(fmt) and '"maximum":' not in json.dumps(fmt)  # unsupported keywords stripped…
    assert "maxLength: 40" in fmt["schema"]["properties"]["title"]["description"]  # …but still shown to the model
    assert "thinking" not in body  # Opus 5.5: thinking is always on; depth is set with effort
    assert usage.cost_usd == pytest.approx((2000 * 4.0 + 500 * 20.0) / 1e6)
    rows = _usage_rows()
    assert len(rows) == 1 and rows[0]["purpose"] == "highlight_refine" and rows[0]["input_tokens"] == 2000
    assert rows[0]["estimated_cost_usd"] == pytest.approx(0.018)


def test_anthropic_retries_once_with_the_validation_error(data_dir, anthropic_stub):
    from clipforge.ai.providers import AnthropicProvider

    anthropic_stub.queue = [(200, anthropic_message(BAD, inp=1000, out=100)), (200, anthropic_message(GOOD, inp=1200, out=80))]
    out, usage = AnthropicProvider().generate_json("s", "p", Pick, "social_copy")
    assert out.title == "Why saving early matters"
    msgs = anthropic_stub.requests[1]["json"]["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"] and msgs[1]["content"] == BAD
    assert "Validation failed" in msgs[2]["content"]
    assert (usage.input_tokens, usage.output_tokens) == (2200, 180)  # both attempts are billed and recorded
    assert _usage_rows()[0]["output_tokens"] == 180


def test_anthropic_fallback_served_turn_is_billed_at_the_serving_model(data_dir, anthropic_stub):
    from clipforge.ai.providers import AnthropicProvider

    content = [{"type": "fallback", "from": {"model": "claude-opus-5-5"}, "to": {"model": "claude-opus-4-8"},
                "trigger": {"type": "refusal", "category": None}},
               {"type": "text", "text": GOOD}]
    iters = [{"type": "message", "input_tokens": 1000, "output_tokens": 5, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
             {"type": "fallback_message", "model": "claude-opus-4-8", "input_tokens": 1000, "output_tokens": 300,
              "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}]
    anthropic_stub.handler = (200, anthropic_message(content=content, model="claude-opus-4-8", inp=1000, out=300, iterations=iters))
    out, usage = AnthropicProvider().generate_json("s", "p", Pick, "social_copy")
    assert out.score == 8 and usage.fallback_used and usage.model == "claude-opus-4-8"
    assert usage.cost_usd == pytest.approx((1000 * 5.0 + 300 * 25.0) / 1e6)
    assert _usage_rows()[0]["model"] == "claude-opus-4-8"


def test_anthropic_refusal_truncation_and_api_errors_become_provider_errors(data_dir, anthropic_stub):
    from clipforge.ai.providers import AnthropicProvider, ProviderError

    p = AnthropicProvider()
    anthropic_stub.handler = (200, anthropic_message(content=[], stop="refusal",
                                                     stop_details={"type": "refusal", "category": None, "explanation": "declined"}))
    with pytest.raises(ProviderError, match="declined"):
        p.generate_json("s", "p", Pick, "t")
    anthropic_stub.handler = (200, anthropic_message('{"title": "cut', stop="max_tokens"))
    with pytest.raises(ProviderError, match="truncated"):
        p.generate_json("s", "p", Pick, "t")
    anthropic_stub.handler = (401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
    with pytest.raises(ProviderError, match="key was rejected") as e:
        p.generate_json("s", "p", Pick, "t")
    assert "Settings" in (e.value.hint or "")
    n = len(anthropic_stub.requests)
    anthropic_stub.handler = (429, {"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}}, {"retry-after-ms": "5"})
    with pytest.raises(ProviderError, match="rate limit"):
        p.generate_json("s", "p", Pick, "t")
    assert len(anthropic_stub.requests) - n == 3  # SDK retries 429 twice (max_retries=2) before giving up


def test_anthropic_falls_back_to_plain_request_when_fallback_beta_is_rejected(data_dir, anthropic_stub):
    from clipforge.ai.providers import AnthropicProvider

    anthropic_stub.queue = [
        (400, {"type": "error", "error": {"type": "invalid_request_error", "message": "fallbacks: not supported for this organization"}}),
        (200, anthropic_message(GOOD)),
    ]
    out, _ = AnthropicProvider().generate_json("s", "p", Pick, "t")
    assert out.score == 8
    retry = anthropic_stub.requests[1]
    assert "fallbacks" not in retry["json"] and "server-side-fallback" not in retry["headers"].get("anthropic-beta", "")


def test_anthropic_requires_cloud_consent_and_a_key(data_dir, protocol_stub, monkeypatch):
    from clipforge.ai import providers

    with pytest.raises(providers.ProviderError, match="Cloud processing is not enabled"):
        providers.get_provider("anthropic", {"ai": {}})
    monkeypatch.setenv("ANTHROPIC_BASE_URL", protocol_stub.url)
    monkeypatch.setattr(providers, "get_secret", lambda name: None)
    p = providers.get_provider("anthropic", {"ai": {"cloud_consent": True}})
    assert p.status()["available"] is False
    with pytest.raises(providers.ProviderError, match="No Anthropic API key") as e:
        p.generate_json("s", "p", Pick, "t")
    assert "subscription does not include API access" in (e.value.hint or "")
    assert protocol_stub.requests == []  # nothing left the machine


def test_anthropic_key_verification(data_dir, anthropic_stub):
    from clipforge.ai.providers import AnthropicProvider

    anthropic_stub.queue = [
        (200, {"type": "model", "id": "claude-opus-5-5", "display_name": "Claude Opus 5.5", "created_at": "2026-01-01T00:00:00Z"}),
        (401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}}),
        (404, {"type": "error", "error": {"type": "not_found_error", "message": "model not found"}}),
    ]
    p = AnthropicProvider()
    assert p.verify_key() == {"ok": True, "model": "claude-opus-5-5"}
    assert p.verify_key() == {"ok": False, "error": "Invalid API key."}
    assert "not available" in p.verify_key()["error"]
    assert anthropic_stub.requests[0]["path"] == "/v1/models/claude-opus-5-5"


def test_structured_output_schemas_keep_every_field():
    """Regression: a property literally named "title" must survive schema preparation."""
    import anthropic

    from clipforge.ai.refine import RefineResponse
    from clipforge.social.generate import LLMPackage

    cj = anthropic.transform_schema(RefineResponse)["$defs"]["CandidateJudgement"]
    assert set(cj["required"]) == set(cj["properties"]) and "title" in cj["required"] and cj["additionalProperties"] is False
    pk = anthropic.transform_schema(LLMPackage)
    assert set(pk["required"]) == set(LLMPackage.model_fields)
