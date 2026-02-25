import asyncio
import io
import json
import logging
import os
import re
import shutil
import time
import uuid
import zipfile
from pathlib import Path
from concurrent.futures import Executor
from typing import TYPE_CHECKING, Any, AsyncGenerator, Dict, List, Optional, cast

import pandas as pd
from fastapi import APIRouter, Body, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse

from dbgpt._private.config import Config
from dbgpt.agent.resource.tool.base import tool
from dbgpt.component import ComponentType
from dbgpt.configs import TAG_KEY_KNOWLEDGE_CHAT_DOMAIN_TYPE
from dbgpt.configs.model_config import resolve_root_path
from dbgpt.core import ModelOutput, PromptTemplate
from dbgpt.core.awel import BaseOperator, CommonLLMHttpRequestBody
from dbgpt.core.awel.dag.dag_manager import DAGManager
from dbgpt.core.awel.util.chat_util import (
    _v1_create_completion_response,
    safe_chat_stream_with_dag_task,
)
from dbgpt.core.interface.file import FileStorageClient
from dbgpt.core.schema.api import (
    ChatCompletionResponseStreamChoice,
    ChatCompletionStreamResponse,
    DeltaMessage,
    UsageInfo,
)
from dbgpt.model.base import FlatSupportedModel
from dbgpt.model.cluster import BaseModelController, WorkerManager, WorkerManagerFactory
from dbgpt.util.executor_utils import (
    DefaultExecutorFactory,
    ExecutorFactory,
)
from dbgpt.util.file_client import FileClient
from dbgpt.util.tracer import SpanType, root_tracer
from dbgpt_app.knowledge.request.request import KnowledgeSpaceRequest
from dbgpt_app.knowledge.service import KnowledgeService
from dbgpt_app.openapi.api_view_model import (
    ChatSceneVo,
    ConversationVo,
    MessageVo,
    Result,
)
from dbgpt_app.scene import BaseChat, ChatFactory, ChatParam, ChatScene
from dbgpt_serve.agent.db.gpts_app import UserRecentAppsDao, adapt_native_app_model
from dbgpt_serve.core import blocking_func_to_async
from dbgpt.agent.skill.manage import get_skill_manager
from dbgpt_serve.datasource.manages.db_conn_info import DBConfig, DbTypeInfo
from dbgpt_serve.datasource.service.db_summary_client import DBSummaryClient
from dbgpt_serve.flow.service.service import Service as FlowService
from dbgpt_serve.utils.auth import UserRequest, get_user_from_headers

router = APIRouter()
CFG = Config()
CHAT_FACTORY = ChatFactory()
logger = logging.getLogger(__name__)
knowledge_service = KnowledgeService()


async def _execute_skill_script_impl(skill_name: str, script_name: str, args: dict) -> str:
    """Execute a script from a skill (implementation)."""
    skill_manager = get_skill_manager(CFG.SYSTEM_APP)
    result = await skill_manager.execute_script(skill_name, script_name, args)
    return result


@tool(description="执行技能中的脚本。参数: {\"skill_name\": \"技能名称\", \"script_name\": \"脚本名称\", \"args\": {参数}}")
async def execute_skill_script(skill_name: str, script_name: str, args: dict) -> str:
    """Execute a script from a skill."""
    return await _execute_skill_script_impl(skill_name, script_name, args)


@tool(
    description="获取技能资源文件内容。"
    "根据路径读取技能中的参考文档、配置文件等非脚本资源。"
    "参数: {\"skill_name\": \"技能名称\", \"resource_path\": \"资源路径\"}"
    "\\n示例:"
    "\\n- 读取参考文档: {\"skill_name\": \"my-skill\", \"resource_path\": \"references/analysis_framework.md\"}"
    "\\n注意: 执行脚本请使用 execute_skill_script_file 工具"
)
async def get_skill_resource(
    skill_name: str, resource_path: str, args: Optional[dict] = None
) -> str:
    from dbgpt.agent.skill.manage import get_skill_manager

    try:
        sm = get_skill_manager(CFG.SYSTEM_APP)
        result = await sm.get_skill_resource(skill_name, resource_path, args or {})
        return result
    except Exception as e:
        import json
        return json.dumps(
            {"error": True, "message": f"Error: {str(e)}"},
            ensure_ascii=False,
        )


@tool(description="执行技能scripts目录下的脚本文件。参数: {\"skill_name\": \"技能名称\", \"script_file_name\": \"脚本文件名\", \"args\": {参数}}")
async def execute_skill_script_file(
    skill_name: str, script_file_name: str, args: Optional[dict] = None
) -> str:
    """Execute a script file from a skill's scripts directory."""
    from dbgpt.agent.skill.manage import get_skill_manager

    try:
        sm = get_skill_manager(CFG.SYSTEM_APP)
        result = await sm.execute_skill_script_file(skill_name, script_file_name, args or {})
        return result
    except Exception as e:
        import json
        return json.dumps(
            {"chunks": [{"output_type": "text", "content": f"Error: {str(e)}"}]},
            ensure_ascii=False,
        )


model_semaphore = None
global_counter = 0


user_recent_app_dao = UserRecentAppsDao()

if TYPE_CHECKING:
    from dbgpt.agent.core.memory.gpts import GptsMemory

REACT_AGENT_MEMORY_CACHE: Dict[str, "GptsMemory"] = {}

DEFAULT_SKILLS_DIR = resolve_root_path("skills") or "skills"


@router.get("/v1/skills/list", response_model=Result)
async def list_skills(
    user_token: UserRequest = Depends(get_user_from_headers),
):
    """List all available skills from the skills directory.

    Returns a list of skills with their metadata, including:
    - id: Unique identifier for the skill
    - name: Display name of the skill
    - description: Brief description of what the skill does
    - version: Skill version
    - author: Skill author
    - skill_type: Type of skill (e.g., data_analysis, chat, coding)
    - tags: List of tags for categorization
    - type: 'official' for claude/ directory, 'personal' for user/ directory
    - file_path: Relative path to the skill file
    """
    from dbgpt.agent.skill.loader import SkillLoader

    skills_data = []
    skills_dir = DEFAULT_SKILLS_DIR
    skills_dir_resolved = Path(skills_dir).expanduser().resolve()

    try:
        loader = SkillLoader()
        skills = loader.load_skills_from_directory(skills_dir, recursive=True)

        for skill in skills:
            if not skill or not skill.metadata:
                continue

            metadata = skill.metadata
            # Determine if the skill is official or personal based on file path
            file_path = getattr(metadata, "file_path", None) or ""
            if not file_path and hasattr(skill, "_config"):
                file_path = skill._config.get("file_path", "")

            # Convert absolute file_path to relative (relative to skills_dir)
            if file_path:
                try:
                    file_path = str(
                        Path(file_path).expanduser().resolve().relative_to(
                            skills_dir_resolved
                        )
                    )
                except Exception:
                    pass

            # Determine type based on directory structure
            skill_type_category = "official"
            if "user/" in file_path or "/user/" in file_path:
                skill_type_category = "personal"
            elif "claude/" in file_path or "/claude/" in file_path:
                skill_type_category = "official"

            # Get skill_type value
            skill_type_val = metadata.skill_type
            if hasattr(skill_type_val, "value"):
                skill_type_val = skill_type_val.value

            skill_info = {
                "id": metadata.name,
                "name": metadata.name,
                "description": metadata.description or "",
                "version": getattr(metadata, "version", "1.0.0") or "1.0.0",
                "author": getattr(metadata, "author", None),
                "skill_type": skill_type_val,
                "tags": getattr(metadata, "tags", []) or [],
                "type": skill_type_category,
                "file_path": file_path,
            }
            skills_data.append(skill_info)

        # Sort skills: official first, then by name
        skills_data.sort(key=lambda x: (0 if x["type"] == "official" else 1, x["name"]))

        return Result.succ(skills_data)
    except Exception as e:
        logger.exception("Failed to load skills from directory")
        return Result.failed(code="E5001", msg=f"Failed to load skills: {str(e)}")


@router.get("/v1/skills/detail", response_model=Result)
async def skill_detail(
    skill_name: str = Query("", description="Skill name"),
    file_path: str = Query("", description="Skill file path"),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    """Load a skill detail, including file tree and SKILL.md content."""
    if not file_path:
        return Result.failed(code="E4001", msg="file_path is required")

    skills_dir = Path(DEFAULT_SKILLS_DIR).expanduser().resolve()

    # Always treat file_path as relative to skills_dir.
    # If an absolute path was provided (legacy), try to make it relative first.
    fp = Path(file_path).expanduser()
    if fp.is_absolute():
        try:
            fp = fp.resolve().relative_to(skills_dir)
        except Exception:
            return Result.failed(code="E4002", msg="Invalid skill file path")
    target = (skills_dir / fp).resolve()

    # Security: ensure target is under skills_dir
    try:
        target.relative_to(skills_dir)
    except Exception:
        return Result.failed(code="E4002", msg="Invalid skill file path")

    if not target.exists():
        return Result.failed(code="E4040", msg="Skill file not found")

    root_dir = target if target.is_dir() else target.parent

    def build_tree(path: Path, base: Path) -> Dict[str, Any]:
        rel = path.relative_to(base)
        node: Dict[str, Any] = {
            "title": path.name,
            "key": str(rel),
        }
        if path.is_dir():
            children = sorted(
                [p for p in path.iterdir() if not p.name.startswith(".")],
                key=lambda p: (not p.is_dir(), p.name.lower()),
            )
            node["children"] = [build_tree(child, base) for child in children]
        return node

    tree = build_tree(root_dir, root_dir)

    skill_md_path = root_dir / "SKILL.md"
    frontmatter = ""
    instructions = ""
    raw_content = ""
    content_type = ""

    if skill_md_path.exists():
        raw_content = skill_md_path.read_text(encoding="utf-8")
        content_type = "skill_md"
        content = raw_content.strip()
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                frontmatter = parts[1].strip()
                instructions = parts[2].strip()
            else:
                instructions = content
        else:
            instructions = content
    elif target.is_file():
        raw_content = target.read_text(encoding="utf-8")
        suffix = target.suffix.lower()
        if suffix in {".yaml", ".yml"}:
            content_type = "yaml"
            frontmatter = raw_content
        elif suffix == ".json":
            content_type = "json"
            frontmatter = raw_content
        else:
            content_type = "text"
            instructions = raw_content

    metadata: Dict[str, Any] = {}
    try:
        from dbgpt.agent.skill.loader import SkillLoader

        loader = SkillLoader()
        skill = loader.load_skill_from_file(str(target))
        if skill and getattr(skill, "metadata", None):
            try:
                metadata = skill.metadata.to_dict()  # type: ignore[attr-defined]
            except Exception:
                metadata = {
                    "name": getattr(skill.metadata, "name", ""),
                    "description": getattr(skill.metadata, "description", ""),
                    "version": getattr(skill.metadata, "version", ""),
                    "author": getattr(skill.metadata, "author", ""),
                    "skill_type": getattr(skill.metadata, "skill_type", ""),
                    "tags": getattr(skill.metadata, "tags", []) or [],
                }
    except Exception:
        metadata = {}

    if not frontmatter and metadata:
        frontmatter = "\n".join(
            [
                f"name: {metadata.get('name', '')}",
                f"description: {metadata.get('description', '')}",
                f"version: {metadata.get('version', '')}",
                f"author: {metadata.get('author', '')}",
                f"skill_type: {metadata.get('skill_type', '')}",
            ]
        ).strip()

    display_path = str(target)
    display_root = str(root_dir)
    try:
        display_path = str(target.relative_to(skills_dir))
        display_root = str(root_dir.relative_to(skills_dir))
    except Exception:
        pass

    return Result.succ(
        {
            "skill_name": skill_name or metadata.get("name", ""),
            "file_path": display_path,
            "root_dir": display_root,
            "tree": tree,
            "frontmatter": frontmatter,
            "instructions": instructions,
            "raw_content": raw_content,
            "content_type": content_type,
            "metadata": metadata,
        }
    )


@router.post("/v1/skills/upload", response_model=Result)
async def skill_upload(
    file: UploadFile = File(...),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    """Upload a skill package (.zip, .skill) or a single file to pilot/tmp/."""
    if not file.filename:
        return Result.failed(code="E4001", msg="No file provided")

    upload_dir = Path(resolve_root_path("pilot/tmp") or "pilot/tmp").resolve()
    upload_dir.mkdir(parents=True, exist_ok=True)

    skills_dir = Path(DEFAULT_SKILLS_DIR).expanduser().resolve()
    user_dir = skills_dir / "user"
    user_dir.mkdir(parents=True, exist_ok=True)

    filename = file.filename
    suffix = Path(filename).suffix.lower()
    stem = Path(filename).stem

    try:
        content_bytes = await file.read()

        tmp_file = upload_dir / filename
        tmp_file.write_bytes(content_bytes)

        is_archive = False
        if suffix == ".zip":
            is_archive = True
        elif suffix == ".skill":
            buf = io.BytesIO(content_bytes)
            is_archive = zipfile.is_zipfile(buf)

        if is_archive:
            buf = io.BytesIO(content_bytes)
            with zipfile.ZipFile(buf, "r") as zf:
                for name in zf.namelist():
                    if ".." in name or name.startswith("/"):
                        return Result.failed(
                            code="E4002",
                            msg=f"Unsafe path in archive: {name}",
                        )

                top_dirs = {n.split("/")[0] for n in zf.namelist() if "/" in n}
                if len(top_dirs) == 1:
                    dest_name = top_dirs.pop()
                else:
                    dest_name = stem

                dest = user_dir / dest_name
                if dest.exists():
                    shutil.rmtree(dest)

                if len(top_dirs) <= 1 and all(
                    n.startswith(dest_name + "/") or n == dest_name
                    for n in zf.namelist()
                    if n
                ):
                    zf.extractall(user_dir)
                else:
                    dest.mkdir(parents=True, exist_ok=True)
                    zf.extractall(dest)

            rel_path = str(dest.relative_to(skills_dir))

        else:
            dest = user_dir / stem
            dest.mkdir(parents=True, exist_ok=True)

            if suffix in (".md", ".skill"):
                target_name = "SKILL.md"
            else:
                target_name = filename
            target_file = dest / target_name

            target_file.write_bytes(content_bytes)

            rel_path = str(dest.relative_to(skills_dir))

        return Result.succ(
            {
                "file_path": rel_path,
                "tmp_path": str(tmp_file),
                "message": f"Skill uploaded successfully: {rel_path}",
            }
        )
    except Exception as e:
        logger.exception("Failed to upload skill")
        return Result.failed(code="E5002", msg=f"Upload failed: {str(e)}")


def _sse_event(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _react_agent_stream(
    dialogue: ConversationVo,
) -> AsyncGenerator[str, None]:
    from dbgpt.agent import AgentContext, AgentMemory, AgentMessage
    from dbgpt.agent.claude_skill import get_registry, load_skills_from_dir
    from dbgpt.agent.core.memory.gpts import (
        DefaultGptsPlansMemory,
        GptsMemory,
    )
    from dbgpt.agent.expand.actions.react_action import Terminate
    from dbgpt.agent.expand.react_agent import ReActAgent
    from dbgpt.agent.resource import ResourcePack, ToolPack, tool
    from dbgpt.agent.resource.base import AgentResource, ResourceType
    from dbgpt.agent.resource.manage import get_resource_manager
    from dbgpt.agent.util.llm.llm import LLMConfig
    from dbgpt.agent.util.react_parser import ReActOutputParser
    from dbgpt.core import StorageConversation
    from dbgpt.model.cluster.client import DefaultLLMClient
    from dbgpt.util.code.server import get_code_server
    from dbgpt_serve.agent.agents.db_gpts_memory import MetaDbGptsMessageMemory
    from dbgpt_serve.conversation.serve import Serve as ConversationServe

    step = 0
    user_input = dialogue.user_input
    if not isinstance(user_input, str):
        user_input = str(user_input or "")

    file_path = None
    knowledge_space = None
    skill_name = None
    if dialogue.ext_info and isinstance(dialogue.ext_info, dict):
        file_path = dialogue.ext_info.get("file_path")
        skill_name = dialogue.ext_info.get("skill_name")
        # Support multiple field names for knowledge space
        knowledge_space = (
            dialogue.ext_info.get("knowledge_space")
            or dialogue.ext_info.get("knowledge_space_name")
            or dialogue.ext_info.get("knowledge_space_id")
        )

    def build_step(title: str, detail: str):
        nonlocal step
        step += 1
        step_id = f"step-{step}"
        return step_id, _sse_event(
            {
                "type": "step.start",
                "step": step,
                "id": step_id,
                "title": title,
                "detail": detail,
            }
        )

    def step_output(detail: str):
        return _sse_event({"type": "step.output", "step": step, "detail": detail})

    def step_chunk(step_id: str, output_type: str, content: Any):
        return _sse_event(
            {
                "type": "step.chunk",
                "id": step_id,
                "output_type": output_type,
                "content": content,
            }
        )

    def step_done(step_id: str, status: str = "done"):
        return _sse_event({"type": "step.done", "id": step_id, "status": status})

    def step_meta(
        step_id: str,
        thought: Optional[str],
        action: Optional[str],
        action_input: Optional[str],
        title: Optional[str] = None,
    ):
        return _sse_event(
            {
                "type": "step.meta",
                "id": step_id,
                "thought": thought,
                "action": action,
                "action_input": action_input,
                "title": title,
            }
        )

    def chunk_text(text: str, max_len: int = 800) -> List[str]:
        blocks = [block.strip() for block in text.split("\n\n") if block.strip()]
        chunks: List[str] = []
        for block in blocks:
            if len(block) <= max_len:
                chunks.append(block)
                continue
            start = 0
            while start < len(block):
                chunks.append(block[start : start + max_len])
                start += max_len
        return chunks

    def emit_tool_chunks(step_id: str, content: Any) -> List[str]:
        raw_chunks: List[str] = []
        if content is None:
            return raw_chunks
        parsed = None
        if isinstance(content, str):
            try:
                parsed = json.loads(content)
            except Exception:
                parsed = None
        if isinstance(parsed, dict) and isinstance(parsed.get("chunks"), list):
            for item in parsed["chunks"]:
                if not isinstance(item, dict):
                    continue
                output_type = item.get("output_type") or "text"
                payload = item.get("content")
                if output_type == "code" and isinstance(payload, str):
                    # Send code as a single chunk — never split it.
                    raw_chunks.append(step_chunk(step_id, output_type, payload))
                elif output_type in ["text", "markdown"] and isinstance(
                    payload, str
                ):
                    for chunk in chunk_text(payload, max_len=800):
                        raw_chunks.append(step_chunk(step_id, output_type, chunk))
                else:
                    raw_chunks.append(step_chunk(step_id, output_type, payload))
            return raw_chunks
        if isinstance(content, str) and content:
            for chunk in chunk_text(content, max_len=800):
                raw_chunks.append(step_chunk(step_id, "text", chunk))
        return raw_chunks

    skills_dir = DEFAULT_SKILLS_DIR
    registry = get_registry()

    # Step 1: Pre-load skills
    load_skills_from_dir(skills_dir, recursive=True)
    all_skills = registry.list_skills()

    # Step 2: Get business tools from ResourceManager
    rm = get_resource_manager(CFG.SYSTEM_APP)
    business_tools: List[Any] = []
    try:
        # Get all registered tool resources from ResourceManager
        tool_resources = rm._type_to_resources.get("tool", [])
        for reg_resource in tool_resources:
            if reg_resource.resource_instance is not None:
                business_tools.append(reg_resource.resource_instance)
    except Exception:
        pass  # If no business tools, continue with empty list

    # Step 3: Load knowledge space resource if specified in ext_info
    knowledge_resources: List[Any] = []
    knowledge_context = ""
    if knowledge_space:
        try:
            from dbgpt_serve.agent.resource.knowledge import (
                KnowledgeSpaceRetrieverResource,
            )

            knowledge_resource = KnowledgeSpaceRetrieverResource(
                name=f"knowledge_space_{knowledge_space}",
                space_name=knowledge_space,
                top_k=4,
                system_app=CFG.SYSTEM_APP,
            )
            knowledge_resources.append(knowledge_resource)
            knowledge_context = f"""
## Knowledge Base
- Knowledge space: {knowledge_resource.retriever_name or knowledge_space}
- Description: {knowledge_resource.retriever_desc or 'Knowledge retrieval available'}
- You can use the 'knowledge_retrieve' tool to search this knowledge base.
"""
            logger.info(
                f"Loaded knowledge space resource: {knowledge_space} "
                f"(name: {knowledge_resource.retriever_name})"
            )
        except Exception as e:
            logger.warning(f"Failed to load knowledge space resource: {e}", exc_info=e)
            knowledge_context = f"""
## Knowledge Base
- Warning: Failed to load knowledge space '{knowledge_space}'. Error: {str(e)}
"""

    react_state: Dict[str, Any] = {
        "skills_loaded": True,  # Skills are pre-loaded now
        "matched": None,
        "skill_prompt": None,
        "file_path": file_path,
    }

    # Pre-select skill if skill_name provided in ext_info
    pre_matched_skill = None
    if skill_name:
        pre_matched_skill = registry.get_skill(skill_name)
        if not pre_matched_skill:
            # Try case-insensitive match
            for s in registry.list_skills():
                if s.name.lower() == skill_name.lower():
                    pre_matched_skill = registry.get_skill(s.name)
                    break
        if pre_matched_skill:
            react_state["matched"] = pre_matched_skill
            react_state["skill_prompt"] = pre_matched_skill.get_prompt()
            logger.info(f"Pre-selected skill from ext_info: {skill_name}")

    # Build skills_context based on whether skill is pre-selected
    if pre_matched_skill:
        # User specified a skill: show only the selected skill
        skills_context = f"- {pre_matched_skill.metadata.name}: {pre_matched_skill.metadata.description}"
    else:
        # User did not specify a skill: show all available skills
        skills_context = "\n".join(
            [f"- {s.name}: {s.description}" for s in all_skills]
        ) if all_skills else "No skills available."

    def _mentions_excel(text: str) -> bool:
        lowered = text.lower()
        keywords = [
            "excel",
            "xlsx",
            "xls",
            "spreadsheet",
            "workbook",
            "sheet",
            "工作表",
            "表格",
            "电子表格",
        ]
        return any(keyword in lowered for keyword in keywords)

    def _is_excel_skill(meta) -> bool:
        name = (meta.name or "").lower()
        desc = (meta.description or "").lower()
        tags = [tag.lower() for tag in (meta.tags or [])]
        return any(
            token in name or token in desc or token in tags
            for token in ["excel", "xlsx", "xls", "spreadsheet"]
        )

    @tool(
        description="Select the most relevant skill based on user query from the "
        "available skills list in system prompt."
    )
    def select_skill(query: str) -> str:
        match_input = query or ""
        if react_state.get("file_path"):
            match_input = f"{match_input} excel xlsx spreadsheet file"
        matched = registry.match_skill(match_input)
        if (
            matched
            and _is_excel_skill(matched.metadata)
            and not (_mentions_excel(query) or react_state.get("file_path"))
        ):
            matched = None
        react_state["matched"] = matched
        if matched:
            detail = (
                f"Matched: {matched.metadata.name} - {matched.metadata.description}"
            )
            return json.dumps(
                {"chunks": [{"output_type": "text", "content": detail}]},
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "chunks": [
                    {
                        "output_type": "text",
                        "content": "No skill matched; proceed without skill",
                    }
                ]
            },
            ensure_ascii=False,
        )

    @tool(
        description="Load skill content by skill name and file path. "
        "Returns the SKILL.md content of the specified skill. "
        "参数: {\"skill_name\": \"技能名称\", \"file_path\": \"技能文件路径\"}"
    )
    def load_skill(skill_name: str, file_path: str) -> str:
        """Load the skill content (SKILL.md) by skill name and file path.

        Args:
            skill_name: The name of the skill to load.
            file_path: The file path of the skill.
        """
        from dbgpt.agent.claude_skill import get_registry

        # Try to get skill from registry
        registry = get_registry()
        matched = registry.get_skill(skill_name)

        # If not found, try case-insensitive match
        if not matched:
            for s in registry.list_skills():
                if s.name.lower() == skill_name.lower():
                    matched = registry.get_skill(s.name)
                    break

        if not matched:
            return json.dumps(
                {"chunks": [{"output_type": "text", "content": f"Skill '{skill_name}' not found"}]},
                ensure_ascii=False,
            )

        # Update react_state for compatibility with existing logic
        react_state["matched"] = matched
        react_state["skill_prompt"] = matched.get_prompt()

        # Build response content
        chunks = [
            {
                "output_type": "text",
                "content": f"Skill: {matched.metadata.name}",
            },
            {
                "output_type": "text",
                "content": f"File path: {file_path}",
            },
            {"output_type": "text", "content": "---"},
        ]

        # Add skill content/prompt
        if matched.instructions:
            chunks.append({"output_type": "markdown", "content": matched.instructions})
        elif matched.prompt_template:
            prompt_text = (
                matched.prompt_template.template
                if hasattr(matched.prompt_template, "template")
                else str(matched.prompt_template)
            )
            chunks.append({"output_type": "markdown", "content": prompt_text})

        return json.dumps({"chunks": chunks}, ensure_ascii=False)

    @tool(description="Load uploaded file info if provided.")
    def load_file() -> str:
        if not react_state.get("file_path"):
            return json.dumps(
                {"chunks": [{"output_type": "text", "content": "No file uploaded"}]},
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "chunks": [
                    {"output_type": "text", "content": react_state["file_path"]},
                    {
                        "output_type": "text",
                        "content": "File path provided by user upload",
                    },
                ]
            },
            ensure_ascii=False,
        )

    @tool(description="Execute quick analysis on uploaded Excel/CSV file.")
    async def execute_analysis() -> str:
        matched = react_state.get("matched")
        if not react_state.get("file_path"):
            return json.dumps(
                {"chunks": [{"output_type": "text", "content": "No file to analyze"}]},
                ensure_ascii=False,
            )
        if matched and not _is_excel_skill(matched.metadata):
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": "Selected skill is not for Excel analysis",
                        }
                    ]
                },
                ensure_ascii=False,
            )
        code_server = await get_code_server(CFG.SYSTEM_APP)
        analysis_code = """
import json
import pandas as pd

file_path = r"{file_path}"
if file_path.lower().endswith((".xls", ".xlsx")):
    df = pd.read_excel(file_path)
else:
    df = pd.read_csv(file_path)
summary = {{
    "shape": list(df.shape),
    "columns": list(df.columns),
    "dtypes": {{col: str(dtype) for col, dtype in df.dtypes.items()}},
    "head": df.head(5).to_dict(orient="records"),
}}
print(json.dumps(summary, ensure_ascii=False))
""".format(file_path=react_state["file_path"])
        result = await code_server.exec(analysis_code, "python")
        output_text = (
            result.output.decode("utf-8") if isinstance(result.output, bytes) else ""
        )
        chunks: List[Dict[str, Any]] = [
            {"output_type": "code", "content": analysis_code.strip()}
        ]
        if output_text:
            try:
                summary = json.loads(output_text)
                chunks.append({"output_type": "json", "content": summary})
                head_rows = summary.get("head")
                columns = summary.get("columns")
                if isinstance(head_rows, list) and isinstance(columns, list):
                    chunks.append(
                        {
                            "output_type": "table",
                            "content": {
                                "columns": [
                                    {"title": col, "dataIndex": col, "key": col}
                                    for col in columns
                                ],
                                "rows": head_rows,
                            },
                        }
                    )
                numeric_columns = [
                    col
                    for col, dtype in (summary.get("dtypes") or {}).items()
                    if "int" in dtype or "float" in dtype
                ]
                if numeric_columns and isinstance(head_rows, list):
                    series_col = numeric_columns[0]
                    data = [
                        {"x": idx + 1, "y": row.get(series_col)}
                        for idx, row in enumerate(head_rows)
                        if row.get(series_col) is not None
                    ]
                    if data:
                        chunks.append(
                            {
                                "output_type": "chart",
                                "content": {
                                    "data": data,
                                    "xField": "x",
                                    "yField": "y",
                                },
                            }
                        )
            except Exception:
                chunks.append({"output_type": "text", "content": output_text})
        return json.dumps({"chunks": chunks}, ensure_ascii=False)

    @tool(description="Resolve required tools for the selected skill.")
    def load_tools() -> str:
        matched = react_state.get("matched")
        rm = get_resource_manager(CFG.SYSTEM_APP)
        required_tools = matched.metadata.required_tools if matched else []
        if not required_tools:
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": "No required tools specified",
                        }
                    ]
                },
                ensure_ascii=False,
            )
        loaded = []
        failed = []
        for tool_name in required_tools:
            try:
                rm.build_resource_by_type(
                    ResourceType.Tool.value,
                    AgentResource(type=ResourceType.Tool.value, value=tool_name),
                )
                loaded.append(tool_name)
            except Exception as e:
                failed.append(f"{tool_name} ({e})")
        chunks = []
        if loaded:
            chunks.append(
                {"output_type": "text", "content": f"Loaded: {', '.join(loaded)}"}
            )
        if failed:
            chunks.append(
                {"output_type": "text", "content": f"Failed: {', '.join(failed)}"}
            )
        return json.dumps({"chunks": chunks}, ensure_ascii=False)

    @tool(description="Execute a tool by name with JSON args.")
    async def execute_tool(tool_name: str, args: dict) -> str:
        rm = get_resource_manager(CFG.SYSTEM_APP)
        try:
            tool_resource = rm.build_resource_by_type(
                ResourceType.Tool.value,
                AgentResource(type=ResourceType.Tool.value, value=tool_name),
            )
            tool_pack = ToolPack([tool_resource])
            result = await tool_pack.async_execute(resource_name=tool_name, **args)
            return json.dumps(
                {"chunks": [{"output_type": "text", "content": str(result)}]},
                ensure_ascii=False,
            )
        except Exception as e:
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": f"Tool execute failed: {e}",
                        }
                    ]
                },
                ensure_ascii=False,
            )

    @tool(
        description="Retrieve relevant information from the knowledge base. "
        "Use this tool when the user question involves content that may be "
        "in the knowledge base. Parameters: {\"query\": \"search query\"}"
    )
    async def knowledge_retrieve(query: str) -> str:
        if not knowledge_resources:
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": "No knowledge base available",
                        }
                    ]
                },
                ensure_ascii=False,
            )

        resource = knowledge_resources[0]
        try:
            chunks = await resource.retrieve(query)
            if chunks:
                content = "\n".join(
                    [f"[{i+1}] {chunk.content}" for i, chunk in enumerate(chunks[:5])]
                )
                return json.dumps(
                    {
                        "chunks": [
                            {
                                "output_type": "text",
                                "content": f"Retrieved {len(chunks)} relevant documents",
                            },
                            {"output_type": "markdown", "content": content},
                        ]
                    },
                    ensure_ascii=False,
                )
            else:
                return json.dumps(
                    {
                        "chunks": [
                            {
                                "output_type": "text",
                                "content": "No relevant information found",
                            }
                        ]
                    },
                    ensure_ascii=False,
                )
        except Exception as e:
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": f"Knowledge retrieval failed: {str(e)}",
                        }
                    ]
                },
                ensure_ascii=False,
            )

    def _try_repair_truncated_code(raw_code: str) -> Optional[str]:
        """Attempt to fix code that was truncated by the LLM's token limit.

        Common symptoms: unterminated string literals, unclosed brackets/parens.
        Strategy:
          1. Remove the last (likely incomplete) logical line.
          2. Close any remaining open brackets / parentheses.
          3. Re-compile. If it passes, return the repaired code.
        Returns None if repair is not possible.
        """

        lines = raw_code.split("\n")
        # Try progressively removing trailing lines (up to 10) to find a
        # clean cut-off point.
        for trim in range(1, min(11, len(lines))):
            candidate_lines = lines[: len(lines) - trim]
            if not candidate_lines:
                continue
            candidate = "\n".join(candidate_lines)

            # Strip any trailing incomplete string by trying to tokenize
            # and removing broken tail tokens.
            # Close unmatched brackets/parens/braces
            open_chars = {"(": ")", "[": "]", "{": "}"}
            close_chars = set(open_chars.values())
            stack: list = []
            for ch in candidate:
                if ch in open_chars:
                    stack.append(open_chars[ch])
                elif ch in close_chars:
                    if stack and stack[-1] == ch:
                        stack.pop()

            # Append closing chars in reverse order
            if stack:
                candidate += "\n" + "".join(reversed(stack))

            try:
                compile(candidate, "<repair>", "exec")
                return candidate
            except SyntaxError:
                continue
        return None

    @tool(
        description="Execute Python code for data analysis and computation. "
        "Supports pandas, numpy, matplotlib, json, os, etc. "
        "Use this tool when you need to run Python code to process data, "
        "generate charts, or perform calculations. "
        'Parameters: {"code": "python code string"}'
    )
    async def code_interpreter(code: str) -> str:
        """Execute arbitrary Python code and return stdout/stderr.

        Runs in a subprocess using the project's Python interpreter,
        so all installed packages (pandas, numpy, etc.) are available.
        CRITICAL: Each call is completely independent — variables do NOT
        persist between calls. Every code snippet MUST include all necessary
        data loading (e.g. df = pd.read_csv(FILE_PATH)) and processing.
        Never assume df or any other variable already exists.
        Always print() results you want to see in the output.
        """
        import asyncio
        import shutil
        import sys
        import uuid

        from dbgpt.configs.model_config import PILOT_PATH, STATIC_MESSAGE_IMG_PATH

        if not code or not code.strip():
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": "No code provided",
                        }
                    ]
                },
                ensure_ascii=False,
            )

        # Use persistent work dir under pilot/tmp/{conv_id} so files
        # survive across calls and can be referenced later (e.g. in HTML).
        cid = react_state.get("conv_id") or "default"
        work_dir = os.path.join(PILOT_PATH, "tmp", cid)
        os.makedirs(work_dir, exist_ok=True)

        # Collect image files that existed BEFORE this run
        IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
        pre_existing_images: set = set()
        for root, _dirs, files in os.walk(work_dir):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in IMAGE_EXTS:
                    pre_existing_images.add(os.path.join(root, f))

        preamble_lines = [
            "import json",
            "import os",
            "import pandas as pd",
            "import numpy as np",
            f'PLOT_DIR = r"{work_dir}"',
            "os.makedirs(PLOT_DIR, exist_ok=True)",
        ]
        fp = react_state.get("file_path")
        if fp:
            preamble_lines.append(f'FILE_PATH = r"{fp}"')
        preamble = "\n".join(preamble_lines) + "\n"
        full_code = preamble + code

        try:
            compile(full_code, "<code_interpreter>", "exec")
        except SyntaxError as se:
            # Attempt auto-repair for truncated code (common with long LLM
            # outputs that hit the token limit).
            repaired = _try_repair_truncated_code(full_code)
            if repaired is not None:
                logger.warning(
                    "code_interpreter: auto-repaired truncated code "
                    f"(original SyntaxError: {se.msg} line {se.lineno})"
                )
                full_code = repaired
                # Strip the preamble back out for the "code" display chunk
                code = full_code[len(preamble):]
            else:
                error_msg = (
                    f"SyntaxError before execution: {se.msg} "
                    f"(line {se.lineno})\n"
                    "Please regenerate complete, syntactically valid Python "
                    "code. Keep code under 80 lines and split long tasks "
                    "into multiple code_interpreter calls."
                )
                return json.dumps(
                    {
                        "chunks": [
                            {"output_type": "code", "content": code.strip()},
                            {"output_type": "text", "content": error_msg},
                        ]
                    },
                    ensure_ascii=False,
                )

        try:
            tmp_path = os.path.join(work_dir, "_run.py")
            with open(tmp_path, "w") as tmp:
                tmp.write(full_code)

            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                tmp_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=work_dir,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=60
            )
            output_text = stdout.decode("utf-8", errors="replace")
            error_text = stderr.decode("utf-8", errors="replace")

            if proc.returncode != 0 and error_text:
                output_text = (
                    output_text + "\n[ERROR]\n" + error_text
                    if output_text
                    else error_text
                )
        except asyncio.TimeoutError:
            output_text = "Execution timed out (60s limit)"
        except Exception as e:
            output_text = f"Execution error: {e}"

        chunks: List[Dict[str, Any]] = [
            {"output_type": "code", "content": code.strip()},
        ]
        if output_text.strip():
            chunks.append({"output_type": "text", "content": output_text.strip()})
        else:
            chunks.append(
                {"output_type": "text", "content": "(no output — add print() to see results)"}
            )

        # Scan work_dir recursively for NEW image files generated by this run
        try:
            os.makedirs(STATIC_MESSAGE_IMG_PATH, exist_ok=True)
            for root, _dirs, files in os.walk(work_dir):
                for fname in files:
                    ext = os.path.splitext(fname)[1].lower()
                    full_path = os.path.join(root, fname)
                    if ext in IMAGE_EXTS and full_path not in pre_existing_images:
                        unique_name = f"{uuid.uuid4().hex[:8]}_{fname}"
                        dest = os.path.join(STATIC_MESSAGE_IMG_PATH, unique_name)
                        shutil.copy2(full_path, dest)
                        img_url = f"/images/{unique_name}"
                        chunks.append(
                            {
                                "output_type": "image",
                                "content": img_url,
                            }
                        )
                        # Track generated images in react_state for
                        # html_interpreter to reference later
                        react_state.setdefault(
                            "generated_images", []
                        ).append(img_url)
        except Exception:
            pass

        # Clean up the temp script file but keep work_dir for persistence
        try:
            script_path = os.path.join(work_dir, "_run.py")
            if os.path.exists(script_path):
                os.remove(script_path)
        except Exception:
            pass

        # Append a summary of ALL generated images so far, so the LLM
        # has a clear reference when generating HTML later.
        all_images = react_state.get("generated_images", [])
        if all_images:
            img_summary = "已生成的图片URL（在生成HTML时请使用这些URL）:\n" + "\n".join(
                f"  - {url}" for url in all_images
            )
            chunks.append({"output_type": "text", "content": img_summary})

        return json.dumps({"chunks": chunks}, ensure_ascii=False)


    @tool(
        description="执行技能scripts目录下的脚本文件。参数: "
        '{"skill_name": "技能名称", "script_file_name": "脚本文件名", "args": {参数}}'
    )
    async def execute_skill_script_file(
        skill_name: str, script_file_name: str, args: Optional[dict] = None
    ) -> str:
        """Execute a script file from a skill's scripts directory.

        After execution, any new image files (.png, .jpg, etc.) generated
        by the script are automatically copied to the static images directory
        and their URLs are returned in the output chunks.
        """
        import shutil
        import uuid

        from dbgpt.agent.skill.manage import get_skill_manager
        from dbgpt.configs.model_config import STATIC_MESSAGE_IMG_PATH

        try:
            from dbgpt.configs.model_config import PILOT_PATH
            sm = get_skill_manager(CFG.SYSTEM_APP)
            cid = react_state.get("conv_id") or "default"
            out_dir = os.path.join(PILOT_PATH, "tmp", cid)
            os.makedirs(out_dir, exist_ok=True)
            # Auto-inject the correct file path from react_state into args.
            # The LLM sometimes corrupts the uploaded file path (e.g. changing
            # 'dbgpt-app' to 'dbgpt_app'), so we override any file-path-like
            # keys in args with the known-good path from react_state.
            real_file_path = react_state.get("file_path")
            if real_file_path and args:
                _FILE_PATH_KEYS = {"input_file", "file_path", "data_path", "csv_path", "excel_path", "data_file"}
                for key in list(args.keys()):
                    if key in _FILE_PATH_KEYS:
                        args[key] = real_file_path
            result_str = await sm.execute_skill_script_file(
                skill_name, script_file_name, args or {},
                output_dir=out_dir,
            )


            # Read script source code and prepend as a 'code' chunk
            # so the frontend can display it in the left pane.
            try:
                _skill_path = sm._get_skill_path(skill_name)
                _sf = script_file_name.lstrip('/\\')
                if _sf.startswith('scripts/') or _sf.startswith('scripts\\'):
                    _sf = _sf[8:]
                _script_abs = os.path.join(_skill_path, 'scripts', _sf)
                with open(_script_abs, 'r', encoding='utf-8') as _f:
                    _script_source = _f.read()
            except Exception:
                _script_source = None

            # Post-process: copy image files to static dir and replace
            # absolute paths with /images/ URLs.
            try:
                result_obj = json.loads(result_str)
                chunks = result_obj.get("chunks", [])
                # Prepend script source code as a 'code' chunk
                if _script_source:
                    chunks.insert(0, {
                        "output_type": "code",
                        "content": _script_source,
                    })
                os.makedirs(STATIC_MESSAGE_IMG_PATH, exist_ok=True)
                IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
                for chunk in chunks:
                    if chunk.get("output_type") == "image":
                        abs_path = chunk["content"]
                        if os.path.isabs(abs_path) and os.path.isfile(abs_path):
                            ext = os.path.splitext(abs_path)[1].lower()
                            if ext in IMAGE_EXTS:
                                unique_name = (
                                    f"{uuid.uuid4().hex[:8]}_{os.path.basename(abs_path)}"
                                )
                                dest = os.path.join(
                                    STATIC_MESSAGE_IMG_PATH, unique_name
                                )
                                shutil.copy2(abs_path, dest)
                                img_url = f"/images/{unique_name}"
                                chunk["content"] = img_url
                                react_state.setdefault(
                                    "generated_images", []
                                ).append(img_url)
                                # Also store a map: original filename (no ext)
                                # -> served URL for template placeholder resolution.
                                # e.g. "financial_overview" -> "/images/abc_financial_overview.png"
                                orig_stem = os.path.splitext(
                                    os.path.basename(abs_path)
                                )[0].lower()
                                react_state.setdefault(
                                    "image_url_map", {}
                                )[orig_stem] = img_url

                # Append image URL summary for LLM reference
                all_images = react_state.get("generated_images", [])
                if all_images:
                    img_summary = (
                        "已生成的图片URL（在生成HTML报告时请使用这些URL）:\n"
                        + "\n".join(f"  - {url}" for url in all_images)
                    )
                    chunks.append(
                        {"output_type": "text", "content": img_summary}
                    )
                # Special handling for calculate_ratios.py output:
                # Store its output in react_state so html_interpreter can use it automatically
                # This prevents the LLM from having to echo back 30 keys of data in JSON
                if script_file_name == "calculate_ratios.py":
                    for chunk in chunks:
                        if chunk.get("output_type") == "text":
                            try:
                                ratio_data = json.loads(chunk["content"])
                                react_state["ratio_data"] = ratio_data
                            except Exception:
                                pass
                return json.dumps({"chunks": chunks}, ensure_ascii=False)
            except (json.JSONDecodeError, KeyError):
                return result_str
        except Exception as e:
            return json.dumps(
                {"chunks": [{"output_type": "text", "content": f"Error: {str(e)}"}]},
                ensure_ascii=False,
            )

    @tool(
        description="将 HTML 渲染为可交互的网页报告，这是向用户展示网页报告的唯一方式。"
        "【默认用法】直接传入完整的 HTML 字符串：{\"html\": \"<html>...</html>\", \"title\": \"报告标题\"}。"
        "你需要自己生成完整的 HTML 代码（包含 <!DOCTYPE html>、<html>、<head>、<body> 等），然后传给 html 参数即可。"
        "HTML 可以很长，没有长度限制，不需要分段传入。"
        "【禁止】不要用 code_interpreter 写 HTML 再 print，不要用 code_interpreter 把 HTML 写入文件再读取，直接把 HTML 传给本工具即可。"
        "【技能模式 - 仅在使用技能时可选】如果正在使用技能（skill），可以用模板模式："
        "{\"template_path\": \"技能名/templates/模板.html\", \"data\": {\"KEY\": \"值\"}, \"title\": \"标题\"}。"
        "也可以用文件模式：{\"file_path\": \"/path/to/report.html\"}"
    )
    async def html_interpreter(
        html: str = "",
        title: str = "Report",
        file_path: str = "",
        template_path: str = "",
        data: dict | str = None,
    ) -> str:
        """Render HTML as an interactive web report.
        
        Default usage: pass a complete HTML string via the `html` parameter.
        The HTML can be arbitrarily long — no length limit, no chunking needed.
        
        Skill template mode (optional): pass `template_path` (relative to skills
        dir) plus a `data` dict whose keys match {{PLACEHOLDER}} tokens in the
        template. The backend reads the template and performs all replacements.
        
        Legacy fallback: `file_path` reads HTML from a file on disk.
        """
        import re
        from dbgpt.configs.model_config import STATIC_MESSAGE_IMG_PATH
        # ── Mode 1: template_path + data ──────────────────────────────
        if template_path and template_path.strip():
            tp = template_path.strip()
            skills_dir = Path(DEFAULT_SKILLS_DIR).expanduser().resolve()
            target = (skills_dir / tp).resolve()
            # Security: must be under skills_dir
            try:
                target.relative_to(skills_dir)
            except ValueError:
                return json.dumps(
                    {"chunks": [{"output_type": "text", "content": f"Invalid template_path: {tp}"}]},
                    ensure_ascii=False,
                )
            if not target.is_file():
                return json.dumps(
                    {"chunks": [{"output_type": "text", "content": f"Template not found: {tp}"}]},
                    ensure_ascii=False,
                )
            try:
                raw_template = target.read_text(encoding="utf-8")
            except Exception as e:
                return json.dumps(
                    {"chunks": [{"output_type": "text", "content": f"Error reading template: {e}"}]},
                    ensure_ascii=False,
                )
            # Replace {{KEY}} placeholders with values from data dict
            # Sometimes the LLM passes data as a JSON string instead of a dict
            replacements = data
            if isinstance(replacements, str):
                try:
                    replacements = json.loads(replacements)
                except Exception as e:
                    logger.warning(f"html_interpreter failed to parse string data as json: {e}")
                    # Attempt to fix truncated JSON by appending closing braces/quotes
                    try:
                        fixed = str(replacements).rstrip()
                        if not fixed.endswith('}'):
                            if fixed.endswith('"'):
                                fixed += '}'
                            else:
                                fixed += '"}'
                        replacements = json.loads(fixed)
                    except Exception:
                        replacements = {}
            if not isinstance(replacements, dict):
                replacements = {}
            # Merge LLM replacements with ratio_data from calculate_ratios.py
            ratio_data = react_state.get("ratio_data", {})
            if isinstance(ratio_data, dict):
                # LLM's data overwrites ratio_data if keys overlap
                merged = {**ratio_data, **replacements}
                replacements = merged

            # Auto-resolve CHART_* placeholders from generated images.
            # image_url_map: {"financial_overview": "/images/abc_financial_overview.png"}
            # Template uses: {{CHART_FINANCIAL_OVERVIEW}} -> /images/abc_financial_overview.png
            image_url_map = react_state.get("image_url_map", {})
            if isinstance(image_url_map, dict):
                for stem, url in image_url_map.items():
                    chart_key = f"CHART_{stem.upper()}"
                    if chart_key not in replacements:
                        replacements[chart_key] = url

            def _replace_placeholder(m):
                key = m.group(1)
                return str(replacements.get(key, "NA"))
            html = re.sub(r"\{\{([A-Z_0-9]+)\}\}", _replace_placeholder, raw_template)
            if not title or title == "Report":
                title = target.stem
            logger.info(
                "html_interpreter: template=%s, %d placeholders replaced, html=%d chars",
                tp,
                len(replacements),
                len(html),
            )

        # ── Mode 2: file_path ─────────────────────────────────────────
        elif file_path and file_path.strip():
            fp = file_path.strip()
            if not os.path.isfile(fp):
                cid = react_state.get("conv_id") or "default"
                from dbgpt.configs.model_config import PILOT_PATH
                alt = os.path.join(PILOT_PATH, "data", cid, os.path.basename(fp))
                if os.path.isfile(alt):
                    fp = alt
                else:
                    return json.dumps(
                        {
                            "chunks": [
                                {
                                    "output_type": "text",
                                    "content": f"File not found: {file_path}",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    )
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    html = f.read()
                if not title or title == "Report":
                    title = os.path.splitext(os.path.basename(fp))[0]
                logger.info(
                    "html_interpreter: read %d chars from file %s",
                    len(html),
                    fp,
                )
            except Exception as e:
                return json.dumps(
                    {
                        "chunks": [
                            {
                                "output_type": "text",
                                "content": f"Error reading file: {e}",
                            }
                        ]
                    },
                    ensure_ascii=False,
                )

        # ── Mode 3: inline html ──────────────────────────────────────
        # Unescape literal \n sequences that LLM may produce
        if html and isinstance(html, str):
            if "\\n" in html:
                html = html.replace("\\n", "\n")
            if "\\t" in html:
                html = html.replace("\\t", "\t")
        if not html or not html.strip():
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": "No HTML content provided",
                        }
                    ]
                },
                ensure_ascii=False,
            )

        # Post-process: fix image URLs that the LLM may have guessed wrong.
        # Files in STATIC_MESSAGE_IMG_PATH are named "{uuid8}_{original}.ext".
        # The LLM might reference "/images/original.ext" (without UUID prefix)
        # or even just "original.ext".  Build a lookup and replace.
        fixed_html = html.strip()
        try:
            IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
            # Map: lowercase base name (without uuid prefix) -> served path
            # e.g. "monthly_sales_trend.png" -> "/images/a1b2c3ff_monthly_sales_trend.png"
            name_to_served: Dict[str, str] = {}
            if os.path.isdir(STATIC_MESSAGE_IMG_PATH):
                for fname in os.listdir(STATIC_MESSAGE_IMG_PATH):
                    ext = os.path.splitext(fname)[1].lower()
                    if ext not in IMAGE_EXTS:
                        continue
                    # Strip the 8-char hex UUID prefix + underscore
                    # Pattern: <8 hex chars>_<original_name>
                    m = re.match(r"^[0-9a-f]{8}_(.+)$", fname, re.IGNORECASE)
                    if m:
                        base_name = m.group(1).lower()
                        served_path = f"/images/{fname}"
                        # Keep the latest (last alphabetically = most recent UUID)
                        name_to_served[base_name] = served_path

            if name_to_served:
                # Replace patterns like:
                #   src="/images/monthly_sales_trend.png"
                #   src="images/monthly_sales_trend.png"
                #   src="monthly_sales_trend.png"
                # with the correct served path.
                def _fix_img_src(match: re.Match) -> str:
                    prefix = match.group(1)  # src=" or src='
                    raw_path = match.group(2)  # the path value
                    quote = match.group(3)  # closing quote

                    # Extract just the filename from the path
                    filename = raw_path.rsplit("/", 1)[-1].lower()

                    # Check if it's already a correct served path
                    if re.match(r"^[0-9a-f]{8}_.+$", filename, re.IGNORECASE):
                        return match.group(0)  # Already has UUID prefix

                    if filename in name_to_served:
                        return f"{prefix}{name_to_served[filename]}{quote}"
                    return match.group(0)  # No match, keep original

                # Match src="..." or src='...' containing image references
                fixed_html = re.sub(
                    r"""(src\s*=\s*["'])([^"']+\.(?:png|jpg|jpeg|gif|svg|webp))(["'])""",
                    _fix_img_src,
                    fixed_html,
                    flags=re.IGNORECASE,
                )
        except Exception:
            pass  # If post-processing fails, use original HTML

        # Auto-append images generated during this session that the LLM
        # forgot to include in the HTML.
        try:
            gen_images = react_state.get("generated_images", [])
            if gen_images:
                # Find which images are NOT already referenced in the HTML
                missing = [
                    url for url in gen_images
                    if url not in fixed_html
                ]
                if missing:
                    imgs_html = "".join(
                        f'<div style="margin:16px 0">'
                        f'<img src="{url}" '
                        f'style="max-width:100%;height:auto;border-radius:8px">'
                        f"</div>"
                        for url in missing
                    )
                    section = (
                        '<div style="margin-top:32px">'
                        "<h2>📊 分析图表</h2>"
                        f"{imgs_html}</div>"
                    )
                    # Insert before </body> if present, otherwise append
                    if "</body>" in fixed_html.lower():
                        fixed_html = re.sub(
                            r"(</body>)",
                            section + r"\1",
                            fixed_html,
                            count=1,
                            flags=re.IGNORECASE,
                        )
                    else:
                        fixed_html += section
        except Exception:
            pass

        chunks: List[Dict[str, Any]] = [
            {"output_type": "html", "content": fixed_html, "title": title},
        ]
        return json.dumps({"chunks": chunks}, ensure_ascii=False)

    llm_client = DefaultLLMClient(
        CFG.SYSTEM_APP.get_component(
            ComponentType.WORKER_MANAGER_FACTORY, WorkerManagerFactory
        ).create(),
        auto_convert_message=True,
    )
    llm_config = LLMConfig(llm_client=llm_client)

    conv_id = dialogue.conv_uid or str(uuid.uuid4())
    react_state["conv_id"] = conv_id
    if conv_id in REACT_AGENT_MEMORY_CACHE:
        gpt_memory = REACT_AGENT_MEMORY_CACHE[conv_id]
    else:
        gpt_memory = GptsMemory(
            plans_memory=DefaultGptsPlansMemory(),
            message_memory=MetaDbGptsMessageMemory(),
        )
        gpt_memory.init(conv_id, enable_vis_message=False)
        REACT_AGENT_MEMORY_CACHE[conv_id] = gpt_memory
    agent_memory = AgentMemory(gpts_memory=gpt_memory)

    # --- Persist conversation to chat_history for sidebar display ---
    conv_serve = ConversationServe.get_instance(CFG.SYSTEM_APP)
    storage_conv = StorageConversation(
        conv_uid=conv_id,
        chat_mode="chat_normal",
        user_name=dialogue.user_name,
        sys_code=dialogue.sys_code,
        summary=dialogue.user_input,
        app_code=dialogue.app_code,
        conv_storage=conv_serve.conv_storage,
        message_storage=conv_serve.message_storage,
    )
    storage_conv.save_to_storage()
    storage_conv.start_new_round()
    storage_conv.add_user_message(user_input)
    context = AgentContext(
        conv_id=conv_id,
        gpts_app_code="react_agent",
        gpts_app_name="ReAct",
        language="zh",
        temperature=dialogue.temperature or 0.2,
    )

    # Build file context if file uploaded
    file_context = ""
    if file_path:
        file_context = f"""
## User Uploaded File
- File path: {file_path}
- Analyze this file if needed for the user's request.
"""

    # Build business tools context
    business_tools_context = "\n".join(
        [f"- {t.name}: {t.description}" for t in business_tools]
    ) if business_tools else "No additional business tools available."

    # Build skill context for system prompt when skill is pre-selected
    skill_prompt_context = ""
    execution_instruction = ""
    if pre_matched_skill and react_state.get("skill_prompt"):
        skill_template = react_state["skill_prompt"]
        skill_text = (
            skill_template.template
            if hasattr(skill_template, "template")
            else str(skill_template)
        )
        skill_prompt_context = f"""
## 已加载技能指令（{pre_matched_skill.metadata.name}）
以下是用户选择的技能的完整指令，请严格按照这些指令进行操作：

{skill_text}
"""
        execution_instruction = f"""
## 执行要求
1. 用户已明确选择技能：{pre_matched_skill.metadata.name}
2. 你必须严格按照上述技能指令的步骤执行
3. 阅读技能指令，理解每一步需要调用的工具
4. 按顺序执行工具调用，完成技能目标
"""

    # Build a hint listing all images currently available in STATIC_MESSAGE_IMG_PATH
    # so the LLM can reference them correctly in html_interpreter.
    # NOTE: This is the initial hint at prompt build time.  Images generated during
    # the session are tracked in react_state["generated_images"] and appended to
    # html_interpreter output dynamically.
    available_images_hint = ""

    # Check if skill is pre-selected to use simplified prompt
    is_skill_mode = pre_matched_skill is not None

    if is_skill_mode:
        # Simplified prompt for skill mode - only skill-related tools + html_interpreter
        workflow_prompt = f"""
你是DB-GPT智能助手，正在执行用户选择的技能任务。

## 自主决策原则
1. 严格按照已加载技能的指令执行
2. 每个步骤输出 Thought → Action → Action Input
3. 等待系统返回 Observation 后，再决定下一步
4. 如果任务需要生成分析报告，流程为：`execute_skill_script_file` 执行 `extract_financials.py` 提取数据 → `execute_skill_script_file` 执行 `calculate_ratios.py` 计算比率（系统自动记录结果） → `execute_skill_script_file` 执行 `generate_charts.py` 生成图表（系统自动合并图片） → 调用 `html_interpreter(template_path=..., data={{...仅包含你写的分析文本}})` 渲染报告（系统自动合并数据和图片） → `terminate` 返回摘要
5. 如果任务不需要生成报告，直接调用 terminate 返回最终结果，Action Input 格式必须为 {{"result": "最终回答"}}

{skill_prompt_context}
{execution_instruction}

## 技能执行规范
### 资源使用
- **需要计算/处理数据** → 使用 `execute_skill_script_file` 执行技能 scripts 目录下的脚本
- **需要了解指标定义/分析框架** → 使用 `get_skill_resource` 并指定 `references/xxx.md` 路径读取参考文档
- **遇到图片文件** → 如果模型不支持图片输入，会返回错误提示
- **需要生成报告** → 调用 `html_interpreter`，传入 `template_path`（模板相对路径）和 `data`（仅包含你自己撰写的分析文本，由于后端会自动合并之前工具生成的30个数据指标和图片URL，请绝对不要在 `data` 里写这些数据指标，否则会导致超长截断）。**不要使用 `code_interpreter`，不要使用 `execute_skill_script_file` 生成报告，不需要先用 `get_skill_resource` 读取模板**

## 可用工具说明
1. **execute_skill_script_file**（推荐用于脚本执行）: 执行技能 scripts 目录下的脚本文件。
   参数: {{"skill_name": "技能名", "script_file_name": "脚本文件名", "args": {{"参数名": "参数值"}}}}
   - 示例: {{"skill_name": "{pre_matched_skill.metadata.name if pre_matched_skill else 'skill'}", "script_file_name": "calculate.py", "args": {{"param": "value"}}}}
2. **get_skill_resource**: 读取技能中的参考文档、配置、模板等非脚本资源文件。
   参数: {{"skill_name": "技能名", "resource_path": "资源路径"}}
   - 读取参考文档: {{"skill_name": "{pre_matched_skill.metadata.name if pre_matched_skill else 'skill'}", "resource_path": "references/analysis_framework.md"}}
   - 注意: 报告模板不需要用此工具读取，直接用 html_interpreter 的 template_path 参数
   - 注意: 执行脚本请使用 execute_skill_script_file，不要用此工具执行脚本
3. **execute_skill_script**: 执行技能中定义的内联脚本。参数: {{"skill_name": "技能名", "script_name": "脚本名", "args": {{"参数名": "参数值"}}}}

4. **html_interpreter**: 将 HTML 模板渲染为网页报告。
   推荐用法: {{"template_path": "技能名/templates/模板文件.html", "data": {{"PLACEHOLDER_KEY": "值", ...}}, "title": "报告标题"}}
   - 后端会自动把先前的财务数据计算结果合并进模板中。你只需要在 `data` 字典中返回诸如 `PROFITABILITY_ANALYSIS` 等你手写的分析段落即可，无需包含 `COMPANY_NAME` 或 `REVENUE` 等。
   - 示例: {{"template_path": "financial-report-analyzer/templates/report_template.html", "data": {{"PROFITABILITY_ANALYSIS": "从数据看，盈利能力良好...", "SOLVENCY_ANALYSIS": "..."}}, "title": "财报分析"}}
   {available_images_hint}
5. **terminate**: 任务完成时返回最终答案，Action Input 必须为 {{"result": "你的最终回答内容"}}

{file_context}
{knowledge_context}
## ReAct 输出格式
每轮交互必须输出：
Thought: 分析当前任务状态，思考下一步需要做什么
Action: 选择的工具名称（必须是上面列出的工具之一）
Action Input: 工具参数的 JSON 格式

系统会返回 Observation，然后你继续思考下一步。
""".strip()

        tool_pack = ToolPack(
            [
                execute_skill_script,
                get_skill_resource,
                execute_skill_script_file,
                html_interpreter,
                Terminate(),
            ]
            + business_tools
        )
    else:
        # Full prompt with all tools when no skill is pre-selected
        workflow_prompt = f"""
你是DB-GPT智能助手，可以根据用户任务自主选择工具来解决问题。

## 自主决策原则
1. 仔细分析用户的任务需求
2. 根据需求自主选择需要的工具（不要按固定顺序，按需选择）
3. 每个步骤输出 Thought → Action → Action Input
4. 等待系统返回 Observation 后，再决定下一步
5. 任务完成后调用 terminate 工具返回最终结果，Action Input 格式必须为 {{"result": "最终回答"}}
6. **【强制规则】当用户要求生成网页、HTML报告、交互式报告时，最终展示步骤必须调用 `html_interpreter` 渲染，禁止仅用 `code_interpreter` 输出 HTML 然后直接 terminate。正确流程：code_interpreter 写入 .html 文件 → html_interpreter(file_path=...) 渲染 → terminate**

## 可用技能列表（预加载）
选择合适的技能使用 select_skill 工具：
{skills_context}

## 技能执行规范（重要）
当使用技能时，必须遵循以下规则：

### 1. 理解工作流程
加载技能后，仔细阅读 SKILL.md 中的 **核心工作流程** 部分，按步骤顺序执行，不要跳跃。

### 2. 资源使用时机
- **需要计算/处理数据** → 使用 `execute_skill_script_file` 执行技能 scripts 目录下的脚本
- **需要了解指标定义/分析框架** → 使用 `get_skill_resource` 并指定 `references/xxx.md` 路径读取参考文档
- **遇到图片文件** → 如果模型不支持图片输入，会返回错误提示

### 3. 执行顺序
每个工作流程步骤完成后，再进入下一步。不要在同一步骤中混合调用多个工具。

### 4. 典型执行模式
```
Thought: 需要计算财务比率，先查看指标定义
Action: get_skill_resource
Action Input: {{"skill_name": "financial-report-analyzer", "resource_path": "references/financial_metrics.md"}}

Thought: 现在执行脚本计算比率
Action: execute_skill_script_file
Action Input: {{"skill_name": "financial-report-analyzer", "script_file_name": "calculate_ratios.py", "args": {{...}}}}
```

## 可用工具说明
1. **load_skill**: 加载指定技能的详细说明，参数: {{"skill_name": "技能名", "file_path": "技能文件路径"}}
2. **knowledge_retrieve**: 从知识库中检索相关信息，参数: {{"query": "检索问题"}}
3. **execute_skill_script**: 执行技能中定义的内联脚本，参数: {{"skill_name": "技能名", "script_name": 
"脚本名", "args": {{"参数名": "参数值"}}}}
4. **execute_skill_script_file**（推荐用于脚本执行）: 执行技能 scripts 目录下的脚本文件，参数: {{"skill_name": "技能名", 
"script_file_name": "脚本文件名如calculate_ratios.py", "args": {{"参数名": "参数值"}}}}
5. **get_skill_resource**: 读取技能中的参考文档、配置等非脚本资源文件。
   参数: {{"skill_name": "技能名", "resource_path": "资源路径"}}
   - 读取参考文档: {{"skill_name": "my-skill", "resource_path": "references/analysis_framework.md"}}
   - 注意: 执行脚本请使用 execute_skill_script_file，不要用此工具执行脚本
   - 图片文件会返回错误提示（模型不支持）
6. **code_interpreter**: 执行 Python 代码进行数据分析和计算。支持 pandas、numpy、matplotlib 等。已预导入 
   pandas(pd)、numpy(np)、json、os。如果用户上传了文件，FILE_PATH 变量已预设为文件路径。PLOT_DIR 变量已预设为图片保存目录。参数: {{"code": "python代码"}}
   **重要规则**:
   - **每次调用都是独立的**，变量不会在调用之间保留。每次代码都必须是**完整自包含**的：包含所有必要的 import、数据加载（如 `df = pd.read_csv(FILE_PATH)`）和处理逻辑。绝对不要假设 `df` 或其他变量已经存在。
   - 生成图表时，使用 `plt.savefig(os.path.join(PLOT_DIR, 'chart_name.png'), dpi=300)` 保存到 PLOT_DIR。不要自己创建目录，PLOT_DIR 已存在。
   - 生成的代码必须语法正确，确保所有字符串、f-string、括号、引号都正确闭合。不要截断代码。
   - **代码长度限制（极其重要）**: 每次调用 code_interpreter 的代码**不得超过 80 行**。如果任务复杂，**必须拆分为多次调用**，每次完成一个子任务。违反此规则会导致代码被截断产生语法错误。
   - 如果需要用到之前步骤的分析结果，必须在当前代码中重新加载数据并重新计算。
   - **禁止在 code_interpreter 中 print() HTML 内容**，用户看不到。生成网页报告时，直接调用 `html_interpreter` 工具，把完整 HTML 传给 `html` 参数即可。
   - **分步执行流程（推荐）**: 对于复杂分析任务，建议按以下顺序分步执行：
     ① **数据处理**：先加载数据，进行清洗、计算关键指标，用 print() 输出摘要
     ② **生成图表**：基于上一步的结果，生成可视化图表，保存到 PLOT_DIR
     ③ **生成网页报告（必须）**：直接调用 `html_interpreter`，把你生成的完整 HTML 字符串传给 `html` 参数，如 `Action: html_interpreter`，`Action Input: {{"html": "<!DOCTYPE html><html>...</html>", "title": "报告标题"}}`
   - **图片URL**: 执行后系统会在 Observation 中返回生成的图片URL（如 `/images/xxxx_chart.png`）。在后续生成 HTML 报告时，必须使用这些实际URL来嵌入图片。
7. **html_interpreter**: 将 HTML 渲染为可交互的网页报告，这是向用户展示网页报告的**唯一方式**。
   **默认用法 - 直接传 HTML（推荐）**：你自己生成完整的 HTML 代码，然后直接传给 html 参数：
   参数: {{"html": "<!DOCTYPE html><html><head>...</head><body>...</body></html>", "title": "报告标题"}}
   - HTML 可以很长，没有长度限制，不需要分段传入
   - 你需要自己在 HTML 中用 `<img src="/images/xxxx_chart.png">` 嵌入之前生成的图表
   - **不要**用 code_interpreter 写 HTML 再 print，**不要**用 code_interpreter 把 HTML 写入文件再读取，直接把 HTML 传给本工具即可
   **技能模式（仅在使用技能时可选）**：传入模板路径和数据字典：
   参数: {{"template_path": "技能名/templates/模板.html", "data": {{"KEY": "值"}}, "title": "报告标题"}}
   **HTML 生成规范**:
   - **精简至上**: 使用简洁的内联 style 属性，**禁止**写大段 `<style>` 块或 CSS 类定义。直接在元素上写 `style="..."`。
   - **图片嵌入与说明（重要）**: 之前 code_interpreter 的 Observation 中返回了图片URL（格式 `/images/xxxx_chart.png`），**必须使用这些完整的实际URL**。用 `<img src="/images/xxxx_chart.png" style="max-width:100%;height:auto">` 嵌入。**绝对不要**猜测或编造图片路径。
   - **图表说明规范**: 在每个 `<img>` 标签后添加文字说明，说明应包含：1) 图表类型 2) 关键数据发现 3) 业务洞察（1-2句话）
   {available_images_hint}
8. **terminate**: 任务完成时返回最终答案，Action Input 必须为 {{"result": "你的最终回答内容"}}


## ⚠️ 网页报告生成的强制流程（违反将导致用户看不到报告）
当用户要求生成「网页报告」「交互式报告」「HTML报告」「可视化报告」时，**必须**执行以下流程：
1. 用 `code_interpreter` 分析数据、生成图表（可多次调用，保存图表到 PLOT_DIR）
2. **直接调用 `html_interpreter`**，将完整 HTML 传给 `html` 参数：`Action: html_interpreter`，`Action Input: {{"html": "<!DOCTYPE html><html>...包含 <img src='/images/xxx.png'> 引用之前生成的图表...</html>", "title": "报告标题"}}`
3. 确认渲染成功后，调用 `terminate` 返回结果
**绝对禁止**：在 code_interpreter 中 print() HTML 内容后直接 terminate，用户无法看到网页。也不需要先用 code_interpreter 把 HTML 写入文件再用 html_interpreter(file_path=...) 读取，直接传 html 参数即可。

## 业务工具（可直接执行）
{file_context}
{knowledge_context}
{skill_prompt_context}
{execution_instruction}
## ReAct 输出格式
每轮交互必须输出：
Thought: 分析当前任务状态，思考下一步需要做什么
Action: 选择的工具名称（必须是上面列出的工具之一）
Action Input: 工具参数的 JSON 格式

系统会返回 Observation，然后你继续思考下一步。
""".strip()

        tool_pack = ToolPack(
            [
                load_skill,
                load_tools,
                knowledge_retrieve,
                execute_skill_script,
                get_skill_resource,
                execute_skill_script_file,
                code_interpreter,
                html_interpreter,
                Terminate(),
            ]
            + business_tools
        )

    # Debug: print all registered tools
    logger.info(f"ToolPack resources: {list(tool_pack._resources.keys())}")
    if "execute_skill_script" not in tool_pack._resources:
        logger.error("execute_skill_script NOT in ToolPack!")

    # Combine tool_pack and knowledge_resources into a single ResourcePack
    all_resources = [tool_pack]
    if knowledge_resources:
        all_resources.extend(knowledge_resources)
    combined_resource_pack = ToolPack(
        all_resources, name="React Agent Resource Pack"
    )

    # Convert workflow_prompt to PromptTemplate so it is used as system prompt
    # Use jinja2 format to avoid issues with JSON braces { } in the prompt
    workflow_prompt_template = PromptTemplate(
        template=workflow_prompt,
        input_variables=[],
        template_format="jinja2",
    )

    agent_builder = (
        ReActAgent(max_retry_count=10)
        .bind(context)
        .bind(agent_memory)
        .bind(llm_config)
        .bind(tool_pack)
        .bind(workflow_prompt_template)
    )

    agent = await agent_builder.build()

    parser = ReActOutputParser()
    received = AgentMessage(content=user_input)
    stream_queue: asyncio.Queue = asyncio.Queue()

    async def stream_callback(event_type: str, payload: Dict[str, Any]) -> None:
        await stream_queue.put({"type": event_type, **payload})

    async def run_agent():
        return await agent.generate_reply(
            received_message=received, sender=agent, stream_callback=stream_callback
        )

    agent_task = asyncio.create_task(run_agent())
    round_step_map: Dict[int, str] = {}
    pending_thoughts: Dict[int, List[str]] = {}  # Buffer thinking content for delayed step creation
    last_completed_step_id: Optional[str] = None  # Track last completed step for thought association

    # --- History persistence: collect step data during streaming ---
    history_steps: List[Dict[str, Any]] = []
    current_history_step: Optional[Dict[str, Any]] = None

    # Emit pre-loaded skill as an SSE step before agent starts processing
    if pre_matched_skill:
        skill_step_id, skill_step_event = build_step(
            f"Load Skill: {pre_matched_skill.metadata.name}",
            "Pre-loaded skill from user selection",
        )
        current_history_step = {
            "id": skill_step_id,
            "title": f"Load Skill: {pre_matched_skill.metadata.name}",
            "detail": "Pre-loaded skill from user selection",
            "thought": None,
            "action": None,
            "action_input": None,
            "outputs": [],
            "status": "done",
        }
        yield skill_step_event
        # Emit skill metadata as text chunk
        skill_desc = (
            f"Skill: {pre_matched_skill.metadata.name}"
            f" - {pre_matched_skill.metadata.description}"
        )
        yield step_chunk(skill_step_id, "text", skill_desc)
        current_history_step["outputs"].append(
            {"output_type": "text", "content": skill_desc}
        )
        # Emit skill instructions as markdown content (shows in right panel)
        if pre_matched_skill.instructions:
            yield step_chunk(
                skill_step_id, "markdown", pre_matched_skill.instructions
            )
            current_history_step["outputs"].append(
                {"output_type": "markdown", "content": pre_matched_skill.instructions}
            )
        yield step_done(skill_step_id)
        last_completed_step_id = skill_step_id
        history_steps.append(current_history_step)
        current_history_step = None

    while True:
        if agent_task.done() and stream_queue.empty():
            break
        try:
            event = await asyncio.wait_for(stream_queue.get(), timeout=0.1)
        except asyncio.TimeoutError:
            continue

        event_type = event.get("type")
        if event_type == "thinking":
            # Parse thinking content but don't create step yet
            # Step will be created when 'act' event arrives with confirmed action
            round_num = int(event.get("round") or (len(round_step_map) + 1))
            llm_reply = event.get("llm_reply") or ""
            thought = None
            action = None
            action_input = None
            try:
                steps = parser.parse(llm_reply)
                if steps:
                    thought = steps[0].thought
                    action = steps[0].action
                    action_input = steps[0].action_input
            except Exception:
                pass

            # Store parsed thinking info in pending_thoughts for later use
            if round_num not in pending_thoughts:
                pending_thoughts[round_num] = []
            if thought:
                pending_thoughts[round_num].append(thought)
            # Don't emit anything yet - wait for 'act' event to create step

        elif event_type == "thinking_chunk":
            round_num = int(event.get("round") or (len(round_step_map) + 1))
            delta_thinking = event.get("delta_thinking") or ""
            delta_text = event.get("delta_text") or ""

            chunk = delta_thinking or delta_text
            if chunk:
                # Clean chunk: remove Action Input JSON to keep thought pure
                # Split on Action Input pattern and keep only thought part
                clean_chunk = re.split(r'\n\s*Action\s*Input\s*:\s*\{', chunk, maxsplit=1)[0]
                # Also remove Action: lines
                clean_chunk = re.sub(r'\n\s*Action\s*:\s*\w+', '', clean_chunk)
                # Remove Thought: prefix if present
                if clean_chunk.startswith("Thought:"):
                    clean_chunk = clean_chunk[len("Thought:"):].strip()
                if clean_chunk:
                    if round_num not in pending_thoughts:
                        pending_thoughts[round_num] = []
                    pending_thoughts[round_num].append(clean_chunk)
                    if round_num not in round_step_map:
                        pending_step_id, pending_step_event = build_step("思考中", "Thought/Action/Observation")
                        round_step_map[round_num] = pending_step_id
                        yield pending_step_event
                    target_id = round_step_map[round_num]
                    yield _sse_event({"type": "step.thought", "id": target_id, "content": clean_chunk})

        elif event_type == "act":
            # Create step ONLY when action is confirmed
            round_num = int(event.get("round") or (len(round_step_map) + 1))

            action_output = event.get("action_output") or {}
            thoughts = action_output.get("thoughts")
            action = action_output.get("action")
            action_input = action_output.get("action_input")
            action_input_data = None
            if action_input is not None:
                if isinstance(action_input, str):
                    try:
                        action_input_data = json.loads(action_input)
                    except Exception:
                        action_input_data = action_input
                else:
                    action_input_data = action_input

            # Skip step display for terminate action — its output will be
            # sent as a streaming "final" event instead of a step card.
            # Also skip emitting the thought for terminate since it's noise.
            # Note: TerminateAction.run() sets terminate=True but does NOT
            # set the action field, so we must check the terminate boolean.
            is_terminate = action_output.get("terminate") or (
                action and action.lower() == "terminate"
            )
            if is_terminate:
                pending_thoughts.pop(round_num, [])
                continue

            # Collect buffered thoughts for history persistence
            # (already streamed to frontend via thinking_chunk handler)
            buffered_thoughts = pending_thoughts.pop(round_num, [])
            thought_text = None
            if buffered_thoughts:
                full_thought = "".join(buffered_thoughts)
                full_thought = re.split(
                    r"\n\s*Action\s*:", full_thought, maxsplit=1
                )[0].strip()
                if full_thought.startswith("Thought:"):
                    full_thought = full_thought[len("Thought:"):].strip()
                if full_thought:
                    thought_text = full_thought

            # Use the actual action name as the step title (Manus-style UI)
            action_title = action or f"ReAct Round {round_num}"
            if round_num in round_step_map:
                react_step_id = round_step_map[round_num]
            else:
                react_step_id, react_step_event = build_step(action_title, "Thought/Action/Observation")
                round_step_map[round_num] = react_step_id
                yield react_step_event

            # --- History: create step record ---
            action_input_str = None
            if action_input is not None:
                action_input_str = (
                    action_input if isinstance(action_input, str)
                    else json.dumps(action_input, ensure_ascii=False)
                )
            current_history_step = {
                "id": react_step_id,
                "title": action_title,
                "detail": "Thought/Action/Observation",
                "thought": thought_text,
                "action": action,
                "action_input": action_input_str,
                "outputs": [],
                "status": "running",
            }

            # Stream action code to frontend for right panel (code_interpreter)
            code_payload = None
            if action == "code_interpreter" and isinstance(action_input_data, dict):
                code_payload = action_input_data.get("code")
            if isinstance(code_payload, str) and code_payload.strip():
                for chunk in chunk_text(code_payload, max_len=800):
                    yield step_chunk(react_step_id, "code", chunk)
                if current_history_step is not None:
                    current_history_step["outputs"].append(
                        {"output_type": "code", "content": code_payload}
                    )

            # Emit thinking metadata
            if thoughts or action or action_input:
                step_action_input = None if action == "code_interpreter" else action_input
                yield step_meta(react_step_id, thoughts, action, step_action_input, action_title)

            # Emit observation (action execution result)
            observation_text = action_output.get("observations") or action_output.get(
                "content"
            )
            if observation_text:
                raw_chunks = emit_tool_chunks(react_step_id, observation_text)
                if raw_chunks:
                    for chunk in raw_chunks:
                        yield chunk
                else:
                    for chunk in chunk_text(str(observation_text), max_len=600):
                        yield step_chunk(react_step_id, "text", chunk)
                # --- History: collect outputs from observation ---
                if current_history_step is not None:
                    parsed_obs = None
                    if isinstance(observation_text, str):
                        try:
                            parsed_obs = json.loads(observation_text)
                        except Exception:
                            pass
                    if isinstance(parsed_obs, dict) and isinstance(
                        parsed_obs.get("chunks"), list
                    ):
                        for item in parsed_obs["chunks"]:
                            if isinstance(item, dict):
                                current_history_step["outputs"].append({
                                    "output_type": item.get("output_type", "text"),
                                    "content": item.get("content"),
                                })
                    elif isinstance(observation_text, str) and observation_text:
                        current_history_step["outputs"].append({
                            "output_type": "text",
                            "content": observation_text,
                        })

            # Mark step as done and track as last completed
            status = "done" if action_output.get("is_exe_success", True) else "failed"
            yield step_done(react_step_id, status)
            last_completed_step_id = react_step_id

            # --- History: finalize step ---
            if current_history_step is not None:
                current_history_step["status"] = status
                history_steps.append(current_history_step)
                current_history_step = None

    try:
        reply = await agent_task
    except Exception as e:
        err_msg = f"React agent failed: {e}"
        # Persist error reply with structured history payload
        error_payload = json.dumps(
            {
                "version": 1,
                "type": "react-agent",
                "final_content": err_msg,
                "steps": history_steps,
                "generated_images": react_state.get("generated_images", []),
            },
            ensure_ascii=False,
        )
        storage_conv.add_view_message(error_payload)
        storage_conv.end_current_round()
        storage_conv.save_to_storage()
        yield _sse_event({"type": "final", "content": err_msg})
        yield _sse_event({"type": "done"})
        return

    if reply.action_report and reply.action_report.terminate:
        raw_content = reply.action_report.content or ""
        # The terminate ActionOutput.content is the full raw LLM text, e.g.:
        # "Thought: ...\nAction: terminate\nAction Input: {"result": "..."}"
        # We need to extract the "result" value from Action Input.
        final_content = raw_content
        try:
            steps = parser.parse(raw_content)
            if steps:
                action_input = steps[0].action_input
                if action_input:
                    # action_input could be a string like '{"result": "..."}'
                    if isinstance(action_input, str):
                        parsed_input = json.loads(action_input)
                    else:
                        parsed_input = action_input
                    if isinstance(parsed_input, dict) and "result" in parsed_input:
                        final_content = parsed_input["result"]
        except Exception:
            pass
    elif reply.action_report:
        final_content = reply.content or reply.action_report.content
    else:
        final_content = reply.content or ""

    # Persist AI reply with structured history payload
    history_payload = json.dumps(
        {
            "version": 1,
            "type": "react-agent",
            "final_content": final_content,
            "steps": history_steps,
            "generated_images": react_state.get("generated_images", []),
        },
        ensure_ascii=False,
    )
    storage_conv.add_view_message(history_payload)
    storage_conv.end_current_round()
    storage_conv.save_to_storage()

    yield _sse_event({"type": "final", "content": final_content})
    yield _sse_event({"type": "done"})


@router.post("/v1/chat/react-agent")
async def chat_react_agent(
    dialogue: ConversationVo = Body(),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    logger.info(
        "chat_react_agent:%s,%s,%s",
        dialogue.chat_mode,
        dialogue.select_param,
        dialogue.model_name,
    )
    dialogue.user_name = user_token.user_id if user_token else dialogue.user_name
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Transfer-Encoding": "chunked",
    }
    try:
        return StreamingResponse(
            _react_agent_stream(dialogue),
            headers=headers,
            media_type="text/event-stream",
        )
    except Exception as e:
        logger.exception("React Agent Exception!%s", dialogue, exc_info=e)

        async def error_text(err_msg):
            yield f"data:{err_msg}\n\n"

        return StreamingResponse(
            error_text(str(e)),
            headers=headers,
            media_type="text/plain",
        )


def __get_conv_user_message(conversations: dict):
    messages = conversations["messages"]
    for item in messages:
        if item["type"] == "human":
            return item["data"]["content"]
    return ""


def __new_conversation(chat_mode, user_name: str, sys_code: str) -> ConversationVo:
    unique_id = uuid.uuid1()
    return ConversationVo(
        conv_uid=str(unique_id),
        chat_mode=chat_mode,
        user_name=user_name,
        sys_code=sys_code,
    )


def get_db_list(user_id: str = None):
    dbs = CFG.local_db_manager.get_db_list(user_id=user_id)
    db_params = []
    for item in dbs:
        params: dict = {}
        params.update({"param": item["db_name"]})
        params.update({"type": item["db_type"]})
        db_params.append(params)
    return db_params


def plugins_select_info():
    plugins_infos: dict = {}
    for plugin in CFG.plugins:
        plugins_infos.update(
            {f"【{plugin._name}】=>{plugin._description}": plugin._name}
        )
    return plugins_infos


def get_db_list_info(user_id: str = None):
    dbs = CFG.local_db_manager.get_db_list(user_id=user_id)
    params: dict = {}
    for item in dbs:
        comment = item["comment"]
        if comment is not None and len(comment) > 0:
            params.update({item["db_name"]: comment})
    return params


def knowledge_list_info():
    """return knowledge space list"""
    params: dict = {}
    request = KnowledgeSpaceRequest()
    spaces = knowledge_service.get_knowledge_space(request)
    for space in spaces:
        params.update({space.name: space.desc})
    return params


def knowledge_list(user_id: str = None):
    """return knowledge space list"""
    request = KnowledgeSpaceRequest(user_id=user_id)
    spaces = knowledge_service.get_knowledge_space(request)
    space_list = []
    for space in spaces:
        params: dict = {}
        params.update({"param": space.name})
        params.update({"type": "space"})
        params.update({"space_id": space.id})
        space_list.append(params)
    return space_list


def get_model_controller() -> BaseModelController:
    controller = CFG.SYSTEM_APP.get_component(
        ComponentType.MODEL_CONTROLLER, BaseModelController
    )
    return controller


def get_worker_manager() -> WorkerManager:
    worker_manager = CFG.SYSTEM_APP.get_component(
        ComponentType.WORKER_MANAGER_FACTORY, WorkerManagerFactory
    ).create()
    return worker_manager


def get_fs() -> FileStorageClient:
    return FileStorageClient.get_instance(CFG.SYSTEM_APP)


def get_dag_manager() -> DAGManager:
    """Get the global default DAGManager"""
    return DAGManager.get_instance(CFG.SYSTEM_APP)


def get_chat_flow() -> FlowService:
    """Get Chat Flow Service."""
    return FlowService.get_instance(CFG.SYSTEM_APP)


def get_executor() -> Executor:
    """Get the global default executor"""
    return CFG.SYSTEM_APP.get_component(
        ComponentType.EXECUTOR_DEFAULT,
        ExecutorFactory,
        or_register_component=DefaultExecutorFactory,
    ).create()


@router.get("/v1/chat/db/list", response_model=Result)
async def db_connect_list(
    db_name: Optional[str] = Query(default=None, description="database name"),
    user_info: UserRequest = Depends(get_user_from_headers),
):
    results = CFG.local_db_manager.get_db_list(
        db_name=db_name, user_id=user_info.user_id
    )
    # 排除部分数据库不允许用户访问
    if results and len(results):
        results = [
            d
            for d in results
            if d.get("db_name") not in ["auth", "dbgpt", "test", "public"]
        ]
    return Result.succ(results)


@router.post("/v1/chat/db/add", response_model=Result)
async def db_connect_add(
    db_config: DBConfig = Body(),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    return Result.succ(CFG.local_db_manager.add_db(db_config, user_token.user_id))


@router.get("/v1/permission/db/list", response_model=Result[List])
async def permission_db_list(
    db_name: str = None,
    user_token: UserRequest = Depends(get_user_from_headers),
):
    return Result.succ()


@router.post("/v1/chat/db/edit", response_model=Result)
async def db_connect_edit(
    db_config: DBConfig = Body(),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    return Result.succ(CFG.local_db_manager.edit_db(db_config))


@router.post("/v1/chat/db/delete", response_model=Result[bool])
async def db_connect_delete(db_name: str = None):
    CFG.local_db_manager.db_summary_client.delete_db_profile(db_name)
    return Result.succ(CFG.local_db_manager.delete_db(db_name))


@router.post("/v1/chat/db/refresh", response_model=Result[bool])
async def db_connect_refresh(db_config: DBConfig = Body()):
    CFG.local_db_manager.db_summary_client.delete_db_profile(db_config.db_name)
    success = await CFG.local_db_manager.async_db_summary_embedding(
        db_config.db_name, db_config.db_type
    )
    return Result.succ(success)


async def async_db_summary_embedding(db_name, db_type):
    db_summary_client = DBSummaryClient(system_app=CFG.SYSTEM_APP)
    db_summary_client.db_summary_embedding(db_name, db_type)


@router.post("/v1/chat/db/test/connect", response_model=Result[bool])
async def test_connect(
    db_config: DBConfig = Body(),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    try:
        # TODO Change the synchronous call to the asynchronous call
        CFG.local_db_manager.test_connect(db_config)
        return Result.succ(True)
    except Exception as e:
        return Result.failed(code="E1001", msg=str(e))


@router.post("/v1/chat/db/summary", response_model=Result[bool])
async def db_summary(db_name: str, db_type: str):
    # TODO Change the synchronous call to the asynchronous call
    async_db_summary_embedding(db_name, db_type)
    return Result.succ(True)


@router.get("/v1/chat/db/support/type", response_model=Result[List[DbTypeInfo]])
async def db_support_types():
    support_types = CFG.local_db_manager.get_all_completed_types()
    db_type_infos = []
    for type in support_types:
        db_type_infos.append(
            DbTypeInfo(db_type=type.value(), is_file_db=type.is_file_db())
        )
    return Result[DbTypeInfo].succ(db_type_infos)


@router.post("/v1/chat/dialogue/scenes", response_model=Result[List[ChatSceneVo]])
async def dialogue_scenes(user_info: UserRequest = Depends(get_user_from_headers)):
    scene_vos: List[ChatSceneVo] = []
    new_modes: List[ChatScene] = [
        ChatScene.ChatWithDbExecute,
        ChatScene.ChatWithDbQA,
        ChatScene.ChatExcel,
        ChatScene.ChatKnowledge,
        ChatScene.ChatDashboard,
        ChatScene.ChatAgent,
    ]
    for scene in new_modes:
        scene_vo = ChatSceneVo(
            chat_scene=scene.value(),
            scene_name=scene.scene_name(),
            scene_describe=scene.describe(),
            param_title=",".join(scene.param_types()),
            show_disable=scene.show_disable(),
        )
        scene_vos.append(scene_vo)
    return Result.succ(scene_vos)


@router.post("/v1/resource/params/list", response_model=Result[List[dict]])
async def resource_params_list(
    resource_type: str,
    user_token: UserRequest = Depends(get_user_from_headers),
):
    if resource_type == "database":
        result = get_db_list()
    elif resource_type == "knowledge":
        result = knowledge_list()
    elif resource_type == "tool":
        result = plugins_select_info()
    else:
        return Result.succ()
    return Result.succ(result)


@router.post("/v1/chat/mode/params/list", response_model=Result[List[dict]])
async def params_list(
    chat_mode: str = ChatScene.ChatNormal.value(),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    if ChatScene.ChatWithDbQA.value() == chat_mode:
        result = get_db_list()
    elif ChatScene.ChatWithDbExecute.value() == chat_mode:
        result = get_db_list()
    elif ChatScene.ChatDashboard.value() == chat_mode:
        result = get_db_list()
    elif ChatScene.ChatExecution.value() == chat_mode:
        result = plugins_select_info()
    elif ChatScene.ChatKnowledge.value() == chat_mode:
        result = knowledge_list()
    elif ChatScene.ChatKnowledge.ExtractRefineSummary.value() == chat_mode:
        result = knowledge_list()
    else:
        return Result.succ()
    return Result.succ(result)


@router.post("/v1/resource/file/upload")
async def file_upload(
    chat_mode: str,
    conv_uid: str,
    temperature: Optional[float] = None,
    max_new_tokens: Optional[int] = None,
    sys_code: Optional[str] = None,
    model_name: Optional[str] = None,
    doc_files: List[UploadFile] = File(...),
    user_token: UserRequest = Depends(get_user_from_headers),
    fs: FileStorageClient = Depends(get_fs),
):
    logger.info(
        f"file_upload:{conv_uid}, files:{[file.filename for file in doc_files]}"
    )

    bucket = "dbgpt_app_file"
    file_params = []

    for doc_file in doc_files:
        file_name = doc_file.filename
        custom_metadata = {
            "user_name": user_token.user_id,
            "sys_code": sys_code,
            "conv_uid": conv_uid,
        }

        file_uri = await blocking_func_to_async(
            CFG.SYSTEM_APP,
            fs.save_file,
            bucket,
            file_name,
            doc_file.file,
            custom_metadata=custom_metadata,
        )

        _, file_extension = os.path.splitext(file_name)
        file_param = {
            "is_oss": True,
            "file_path": file_uri,
            "file_name": file_name,
            "file_learning": False,
            "bucket": bucket,
        }
        file_params.append(file_param)
    if chat_mode == ChatScene.ChatExcel.value():
        if len(file_params) != 1:
            return Result.failed(msg="Only one file is supported for Excel chat.")
        file_param = file_params[0]
        _, file_extension = os.path.splitext(file_param["file_name"])
        if file_extension.lower() in [".xls", ".xlsx", ".csv", ".json", ".parquet"]:
            # Prepare the chat
            file_param["file_learning"] = True
            dialogue = ConversationVo(
                user_input="Learn from the file",
                conv_uid=conv_uid,
                chat_mode=chat_mode,
                select_param=file_param,
                model_name=model_name,
                user_name=user_token.user_id,
                sys_code=sys_code,
            )

            if temperature is not None:
                dialogue.temperature = temperature
            if max_new_tokens is not None:
                dialogue.max_new_tokens = max_new_tokens

            chat: BaseChat = await get_chat_instance(dialogue)
            await chat.prepare()
            # Refresh messages

    # If only one file was uploaded, return the single file_param directly
    # Otherwise return the array of file_params
    result = file_params[0] if len(file_params) == 1 else file_params
    return Result.succ(result)


@router.post("/v1/resource/file/delete")
async def file_delete(
    conv_uid: str,
    file_key: str,
    user_name: Optional[str] = None,
    sys_code: Optional[str] = None,
    user_token: UserRequest = Depends(get_user_from_headers),
):
    logger.info(f"file_delete:{conv_uid},{file_key}")
    oss_file_client = FileClient()

    return Result.succ(
        await oss_file_client.delete_file(conv_uid=conv_uid, file_key=file_key)
    )


@router.post("/v1/resource/file/read")
async def file_read(
    conv_uid: str,
    file_key: str,
    user_name: Optional[str] = None,
    sys_code: Optional[str] = None,
    user_token: UserRequest = Depends(get_user_from_headers),
):
    logger.info(f"file_read:{conv_uid},{file_key}")
    file_client = FileClient()
    res = file_client.read_file(conv_uid=conv_uid, file_key=file_key)
    _, file_extension = os.path.splitext(file_key)
    file_extension = file_extension.lower()
    try:
        if file_extension in [".xls", ".xlsx"]:
            df = pd.read_excel(io.BytesIO(res), index_col=False)
            return Result.succ(
                df.to_json(orient="records", date_format="iso", date_unit="s")
            )
        if file_extension in [".csv", ".tsv"]:
            sep = "\t" if file_extension == ".tsv" else ","
            df = pd.read_csv(io.BytesIO(res), sep=sep)
            return Result.succ(
                df.to_json(orient="records", date_format="iso", date_unit="s")
            )
        if file_extension in [".json", ".jsonl"]:
            df = pd.read_json(io.BytesIO(res), lines=file_extension == ".jsonl")
            return Result.succ(
                df.to_json(orient="records", date_format="iso", date_unit="s")
            )
    except Exception as e:
        logger.exception("file_read parse failed")
        return Result.failed(msg=f"file_read parse failed: {e}")

    try:
        return Result.succ(res.decode("utf-8"))
    except Exception:
        return Result.succ(str(res))


def get_hist_messages(conv_uid: str, user_name: str = None):
    from dbgpt_serve.conversation.service.service import Service as ConversationService

    instance: ConversationService = ConversationService.get_instance(CFG.SYSTEM_APP)
    return instance.get_history_messages({"conv_uid": conv_uid, "user_name": user_name})


async def get_chat_instance(dialogue: ConversationVo = Body()) -> BaseChat:
    logger.info(f"get_chat_instance:{dialogue}")
    if not dialogue.chat_mode:
        dialogue.chat_mode = ChatScene.ChatNormal.value()
    if not dialogue.conv_uid:
        conv_vo = __new_conversation(
            dialogue.chat_mode, dialogue.user_name, dialogue.sys_code
        )
        dialogue.conv_uid = conv_vo.conv_uid

    if not ChatScene.is_valid_mode(dialogue.chat_mode):
        raise StopAsyncIteration(
            Result.failed("Unsupported Chat Mode," + dialogue.chat_mode + "!")
        )

    chat_param = ChatParam(
        chat_session_id=dialogue.conv_uid,
        user_name=dialogue.user_name,
        sys_code=dialogue.sys_code,
        current_user_input=dialogue.user_input,
        select_param=dialogue.select_param,
        model_name=dialogue.model_name,
        app_code=dialogue.app_code,
        ext_info=dialogue.ext_info,
        temperature=dialogue.temperature,
        max_new_tokens=dialogue.max_new_tokens,
        prompt_code=dialogue.prompt_code,
        chat_mode=ChatScene.of_mode(dialogue.chat_mode),
    )
    chat: BaseChat = await blocking_func_to_async(
        CFG.SYSTEM_APP,
        CHAT_FACTORY.get_implementation,
        dialogue.chat_mode,
        CFG.SYSTEM_APP,
        **{"chat_param": chat_param},
    )
    return chat


@router.post("/v1/chat/prepare")
async def chat_prepare(
    dialogue: ConversationVo = Body(),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    logger.info(json.dumps(dialogue.__dict__))
    # dialogue.model_name = CFG.LLM_MODEL
    dialogue.user_name = user_token.user_id if user_token else dialogue.user_name
    logger.info(f"chat_prepare:{dialogue}")
    ## check conv_uid
    chat: BaseChat = await get_chat_instance(dialogue)

    await chat.prepare()

    # Refresh messages
    return Result.succ(get_hist_messages(dialogue.conv_uid, user_token.user_id))


@router.post("/v1/chat/completions")
async def chat_completions(
    dialogue: ConversationVo = Body(),
    flow_service: FlowService = Depends(get_chat_flow),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    logger.info(
        f"chat_completions:{dialogue.chat_mode},{dialogue.select_param},"
        f"{dialogue.model_name}, timestamp={int(time.time() * 1000)}"
    )
    dialogue.user_name = user_token.user_id if user_token else dialogue.user_name
    dialogue = adapt_native_app_model(dialogue)

    # Handle knowledge space selection from ext_info for normal chat mode
    if dialogue.chat_mode == ChatScene.ChatNormal.value() and dialogue.ext_info:
        knowledge_space = dialogue.ext_info.get("knowledge_space")
        if knowledge_space:
            # Switch to chat_knowledge mode with selected space
            dialogue.chat_mode = ChatScene.ChatKnowledge.value()
            dialogue.select_param = knowledge_space
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Transfer-Encoding": "chunked",
    }
    try:
        domain_type = _parse_domain_type(dialogue)
        if dialogue.chat_mode == ChatScene.ChatAgent.value():
            from dbgpt_serve.agent.agents.controller import multi_agents

            dialogue.ext_info.update({"model_name": dialogue.model_name})
            dialogue.ext_info.update({"incremental": dialogue.incremental})
            dialogue.ext_info.update({"temperature": dialogue.temperature})
            return StreamingResponse(
                multi_agents.app_agent_chat(
                    conv_uid=dialogue.conv_uid,
                    chat_mode=dialogue.chat_mode,
                    gpts_name=dialogue.app_code,
                    user_query=dialogue.user_input,
                    user_code=dialogue.user_name,
                    sys_code=dialogue.sys_code,
                    app_code=dialogue.app_code,
                    **dialogue.ext_info,
                ),
                headers=headers,
                media_type="text/event-stream",
            )
        elif dialogue.chat_mode == ChatScene.ChatFlow.value():
            flow_req = CommonLLMHttpRequestBody(
                model=dialogue.model_name,
                messages=dialogue.user_input,
                stream=True,
                conv_uid=dialogue.conv_uid,
                span_id=root_tracer.get_current_span_id(),
                chat_mode=dialogue.chat_mode,
                chat_param=dialogue.select_param,
                user_name=dialogue.user_name,
                sys_code=dialogue.sys_code,
                app_code=dialogue.app_code,
                incremental=dialogue.incremental,
            )
            return StreamingResponse(
                flow_service.chat_stream_flow_str(dialogue.select_param, flow_req),
                headers=headers,
                media_type="text/event-stream",
            )
        elif domain_type is not None and domain_type != "Normal":
            return StreamingResponse(
                chat_with_domain_flow(dialogue, domain_type),
                headers=headers,
                media_type="text/event-stream",
            )

        else:
            with root_tracer.start_span(
                "get_chat_instance", span_type=SpanType.CHAT, metadata=dialogue.dict()
            ):
                chat: BaseChat = await get_chat_instance(dialogue)

            if not chat.prompt_template.stream_out:
                return StreamingResponse(
                    no_stream_generator(chat, dialogue.model_name, dialogue.conv_uid),
                    headers=headers,
                    media_type="text/event-stream",
                )
            else:
                return StreamingResponse(
                    stream_generator(
                        chat,
                        dialogue.incremental,
                        dialogue.model_name,
                        openai_format=dialogue.incremental,
                    ),
                    headers=headers,
                    media_type="text/plain",
                )
    except Exception as e:
        logger.exception(f"Chat Exception!{dialogue}", e)

        async def error_text(err_msg):
            yield f"data:{err_msg}\n\n"

        return StreamingResponse(
            error_text(str(e)),
            headers=headers,
            media_type="text/plain",
        )
    finally:
        # write to recent usage app.
        if dialogue.user_name is not None and dialogue.app_code is not None:
            user_recent_app_dao.upsert(
                user_code=dialogue.user_name,
                sys_code=dialogue.sys_code,
                app_code=dialogue.app_code,
            )


@router.post("/v1/chat/topic/terminate")
async def terminate_topic(
    conv_id: str,
    round_index: int,
    user_token: UserRequest = Depends(get_user_from_headers),
):
    logger.info(f"terminate_topic:{conv_id},{round_index}")
    try:
        from dbgpt_serve.agent.agents.controller import multi_agents

        return Result.succ(await multi_agents.topic_terminate(conv_id))
    except Exception as e:
        logger.exception("Topic terminate error!")
        return Result.failed(code="E0102", msg=str(e))


@router.get("/v1/model/types")
async def model_types(controller: BaseModelController = Depends(get_model_controller)):
    logger.info("/controller/model/types")
    try:
        types = set()
        models = await controller.get_all_instances(healthy_only=True)
        for model in models:
            worker_name, worker_type = model.model_name.split("@")
            if worker_type == "llm" and worker_name not in [
                "codegpt_proxyllm",
                "text2sql_proxyllm",
            ]:
                types.add(worker_name)
        return Result.succ(list(types))

    except Exception as e:
        return Result.failed(code="E000X", msg=f"controller model types error {e}")


@router.get("/v1/test")
async def test():
    return "service status is UP"


@router.get(
    "/v1/model/supports",
    deprecated=True,
    description="This endpoint is deprecated. Please use "
    "`/api/v2/serve/model/model-types` instead. It will be removed in v0.8.0.",
)
async def model_supports(worker_manager: WorkerManager = Depends(get_worker_manager)):
    logger.warning(
        "The endpoint `/api/v1/model/supports` is deprecated. Please use "
        "`/api/v2/serve/model/model-types` instead. It will be removed in v0.8.0."
    )
    try:
        models = await worker_manager.supported_models()
        return Result.succ(FlatSupportedModel.from_supports(models))
    except Exception as e:
        return Result.failed(code="E000X", msg=f"Fetch supportd models error {e}")


async def flow_stream_generator(func, incremental: bool, model_name: str):
    stream_id = f"chatcmpl-{str(uuid.uuid1())}"
    previous_response = ""
    async for chunk in func:
        if chunk:
            msg = chunk.replace("\ufffd", "")
            if incremental:
                incremental_output = msg[len(previous_response) :]
                choice_data = ChatCompletionResponseStreamChoice(
                    index=0,
                    delta=DeltaMessage(role="assistant", content=incremental_output),
                )
                chunk = ChatCompletionStreamResponse(
                    id=stream_id, choices=[choice_data], model=model_name
                )
                _content = json.dumps(
                    chunk.dict(exclude_unset=True), ensure_ascii=False
                )
                yield f"data: {_content}\n\n"
            else:
                # TODO generate an openai-compatible streaming responses
                msg = msg.replace("\n", "\\n")
                yield f"data:{msg}\n\n"
            previous_response = msg
    if incremental:
        yield "data: [DONE]\n\n"


async def no_stream_generator(chat, model_name: str, conv_uid: Optional[str] = None):
    with root_tracer.start_span("no_stream_generator"):
        msg = await chat.nostream_call()
        stream_id = conv_uid or f"chatcmpl-{str(uuid.uuid1())}"
        yield _v1_create_completion_response(msg, None, model_name, stream_id)


async def stream_generator(
    chat,
    incremental: bool,
    model_name: str,
    text_output: bool = True,
    openai_format: bool = False,
    conv_uid: Optional[str] = None,
):
    """Generate streaming responses

    Our goal is to generate an openai-compatible streaming responses.
    Currently, the incremental response is compatible, and the full response will be
    transformed in the future.

    Args:
        chat (BaseChat): Chat instance.
        incremental (bool): Used to control whether the content is returned
            incrementally or in full each time.
        model_name (str): The model name

    Yields:
        _type_: streaming responses
    """
    span = root_tracer.start_span("stream_generator")
    msg = "[LLM_ERROR]: llm server has no output, maybe your prompt template is wrong."

    stream_id = conv_uid or f"chatcmpl-{str(uuid.uuid1())}"
    try:
        if incremental and not openai_format:
            raise ValueError("Incremental response must be openai-compatible format.")
        async for chunk in chat.stream_call(
            text_output=text_output, incremental=incremental
        ):
            if not chunk:
                await asyncio.sleep(0.02)
                continue

            if openai_format:
                # Must be ModelOutput
                output: ModelOutput = cast(ModelOutput, chunk)
                text = None
                think_text = None
                if output.has_text:
                    text = output.text
                if output.has_thinking:
                    think_text = output.thinking_text
                if incremental:
                    choice_data = ChatCompletionResponseStreamChoice(
                        index=0,
                        delta=DeltaMessage(
                            role="assistant", content=text, reasoning_content=think_text
                        ),
                    )
                    chunk = ChatCompletionStreamResponse(
                        id=stream_id, choices=[choice_data], model=model_name
                    )
                    _content = json.dumps(
                        chunk.dict(exclude_unset=True), ensure_ascii=False
                    )
                    yield f"data: {_content}\n\n"
                else:
                    if output.usage:
                        usage = UsageInfo(**output.usage)
                    else:
                        usage = UsageInfo()
                    _content = _v1_create_completion_response(
                        text, think_text, model_name, stream_id, usage
                    )
                    yield _content
            else:
                msg = chunk.replace("\ufffd", "")
                _content = _v1_create_completion_response(
                    msg, None, model_name, stream_id
                )
                yield _content
            await asyncio.sleep(0.02)
        if incremental:
            yield "data: [DONE]\n\n"
        span.end()
    except Exception as e:
        logger.exception("stream_generator error")
        yield f"data: [SERVER_ERROR]{str(e)}\n\n"
        if incremental:
            yield "data: [DONE]\n\n"


def message2Vo(message: dict, order, model_name) -> MessageVo:
    return MessageVo(
        role=message["type"],
        context=message["data"]["content"],
        order=order,
        model_name=model_name,
    )


def _parse_domain_type(dialogue: ConversationVo) -> Optional[str]:
    if dialogue.chat_mode == ChatScene.ChatKnowledge.value():
        # Supported in the knowledge chat
        if dialogue.app_code == "" or dialogue.app_code == "chat_knowledge":
            spaces = knowledge_service.get_knowledge_space(
                KnowledgeSpaceRequest(name=dialogue.select_param)
            )
        else:
            spaces = knowledge_service.get_knowledge_space(
                KnowledgeSpaceRequest(name=dialogue.select_param)
            )
        if len(spaces) == 0:
            raise ValueError(f"Knowledge space {dialogue.select_param} not found")
        dialogue.select_param = spaces[0].name
        if spaces[0].domain_type:
            return spaces[0].domain_type
    else:
        return None


async def chat_with_domain_flow(dialogue: ConversationVo, domain_type: str):
    """Chat with domain flow"""
    dag_manager = get_dag_manager()
    dags = dag_manager.get_dags_by_tag(TAG_KEY_KNOWLEDGE_CHAT_DOMAIN_TYPE, domain_type)
    if not dags or not dags[0].leaf_nodes:
        raise ValueError(f"Cant find the DAG for domain type {domain_type}")

    end_task = cast(BaseOperator, dags[0].leaf_nodes[0])
    space = dialogue.select_param
    connector_manager = CFG.local_db_manager
    # TODO: Some flow maybe not connector
    db_list = [item["db_name"] for item in connector_manager.get_db_list()]
    db_names = [item for item in db_list if space in item]
    if len(db_names) == 0:
        raise ValueError(f"fin repost dbname {space}_fin_report not found.")
    flow_ctx = {"space": space, "db_name": db_names[0]}
    request = CommonLLMHttpRequestBody(
        model=dialogue.model_name,
        messages=dialogue.user_input,
        stream=True,
        extra=flow_ctx,
        conv_uid=dialogue.conv_uid,
        span_id=root_tracer.get_current_span_id(),
        chat_mode=dialogue.chat_mode,
        chat_param=dialogue.select_param,
        user_name=dialogue.user_name,
        sys_code=dialogue.sys_code,
        incremental=dialogue.incremental,
    )
    async for output in safe_chat_stream_with_dag_task(end_task, request, False):
        text = output.gen_text_with_thinking()
        if text:
            text = text.replace("\n", "\\n")
        if output.error_code != 0:
            yield _v1_create_completion_response(
                f"[SERVER_ERROR]{text}", None, dialogue.model_name, dialogue.conv_uid
            )
            break
        else:
            yield _v1_create_completion_response(
                text, None, dialogue.model_name, dialogue.conv_uid
            )
