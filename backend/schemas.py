from pydantic import BaseModel


class ScheduleBody(BaseModel):
    enabled: bool


class RadaTriggerBody(BaseModel):
    section_codes: list[str] | None = None


class AskRequest(BaseModel):
    question: str
    max_docs: int = 12
    filter_domains: list[str] | None = None
    filter_sources: list[str] | None = None
    response_features: list[str] = []
    user_profile: dict | None = None
    history: list[dict] | None = None
    context_summary: str | None = None
    ai_personal_prompt: str | None = None
    response_length_pref: str = "standard"
    response_lang_style: str = "legal"


class GenerateUserPromptRequest(BaseModel):
    role: str | None = None
    sub_role: list[str] = []
    segment: list[str] = []


class SummarizeHistoryBody(BaseModel):
    messages: list[dict]
    existing_summary: str | None = None


class EvalRunBody(BaseModel):
    cases: list[dict]


class GenerateNameRequest(BaseModel):
    question: str
    answer: str
