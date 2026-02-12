import json
import logging
import re
from typing import Any, Dict, Optional

from dbgpt.agent import Action, ActionOutput, AgentResource, Resource, ResourceType
from dbgpt.util.json_utils import parse_or_raise_error

from ...resource.tool.base import BaseTool, ToolParameter
from ...resource.tool.pack import ToolPack
from ...util.react_parser import ReActOutputParser, ReActStep
from .tool_action import ToolAction, run_tool

logger = logging.getLogger(__name__)


class Terminate(Action[None], BaseTool):
    """Terminate action.

    It is a special action to terminate the conversation, at same time, it can be a
    tool to return the final answer.
    """

    async def run(
        self,
        ai_message: str,
        resource: Optional[AgentResource] = None,
        rely_action_out: Optional[ActionOutput] = None,
        need_vis_render: bool = True,
        **kwargs,
    ) -> ActionOutput:
        return ActionOutput(
            is_exe_success=True,
            terminate=True,
            content=ai_message,
        )

    @classmethod
    def get_action_description(cls) -> str:
        return (
            "Terminate action representing the task is finished, or you think it is"
            " impossible for you to complete the task"
        )

    @classmethod
    def parse_action(
        cls,
        ai_message: str,
        default_action: "Action",
        resource: Optional[Resource] = None,
        **kwargs,
    ) -> Optional["Action"]:
        """Parse the action from the message.

        If you want skip the action, return None.
        """
        if "parser" in kwargs and isinstance(kwargs["parser"], ReActOutputParser):
            parser = kwargs["parser"]
        else:
            parser = ReActOutputParser()
        steps = parser.parse(ai_message)
        if len(steps) != 1:
            return None
        step: ReActStep = steps[0]
        if not step.action:
            return None
        if step.action.lower() == default_action.name.lower():
            return default_action
        return None

    @property
    def name(self):
        return "terminate"

    @property
    def description(self):
        return self.get_action_description()

    @property
    def args(self):
        return {
            "output": ToolParameter(
                type="string",
                name="output",
                description=(
                    "Final answer to the task, or the reason why you think it "
                    "is impossible to complete the task"
                ),
            ),
        }

    def execute(self, *args, **kwargs):
        if "output" in kwargs:
            return kwargs["output"]
        if "final_answer" in kwargs:
            return kwargs["final_answer"]
        return args[0] if args else "terminate unknown"

    async def async_execute(self, *args, **kwargs):
        return self.execute(*args, **kwargs)


class ReActAction(ToolAction):
    """React action class."""

    def __init__(self, **kwargs):
        """Tool action init."""
        super().__init__(**kwargs)

    @property
    def resource_need(self) -> Optional[ResourceType]:
        """Return the resource type needed for the action."""
        return None

    @classmethod
    def parse_action(
        cls,
        ai_message: str,
        default_action: "ReActAction",
        resource: Optional[Resource] = None,
        **kwargs,
    ) -> Optional["ReActAction"]:
        """Parse the action from the message.

        If you want skip the action, return None.
        """
        return default_action

    async def run(
        self,
        ai_message: str,
        resource: Optional[AgentResource] = None,
        rely_action_out: Optional[ActionOutput] = None,
        need_vis_render: bool = True,
        **kwargs,
    ) -> ActionOutput:
        """Perform the action."""

        if "parser" in kwargs and isinstance(kwargs["parser"], ReActOutputParser):
            parser = kwargs["parser"]
        else:
            parser = ReActOutputParser()
        steps = parser.parse(ai_message)
        if len(steps) != 1:
            raise ValueError("Only one action is allowed each time.")
        step = steps[0]
        act_out = await self._do_run(ai_message, step, need_vis_render=need_vis_render)
        if not act_out.action:
            act_out.action = step.action
        if step.thought:
            act_out.thoughts = step.thought
        if (
            not act_out.action_input
            and step.action_input
            and isinstance(step.action_input, str)
        ):
            act_out.action_input = step.action_input
        return act_out

    @staticmethod
    def _fallback_parse_args(
        tool_name: str,
        raw_input: Any,
        resource: Optional[Resource],
    ) -> Dict[str, Any]:
        """Infer tool args when JSON parsing fails.

        Strategy:
        1. For single-param tools: regex extract the value, or pass raw input.
        2. For multi-param tools: find each param key position and extract
           the string value between quote delimiters.
        3. Return empty dict as last resort.
        """
        if not resource or not tool_name or not raw_input:
            return {}

        tool_packs = ToolPack.from_resource(resource)
        if not tool_packs:
            return {}
        tool_pack: ToolPack = tool_packs[0]
        try:
            tl = tool_pack._get_execution_tool(tool_name)
        except Exception:
            return {}

        param_names = list(tl.args.keys()) if tl.args else []
        if not param_names:
            return {}

        raw_str = str(raw_input)

        def _unescape(s: str) -> str:
            return (
                s.replace("\\n", "\n")
                .replace("\\t", "\t")
                .replace('\\"', '"')
                .replace("\\\\", "\\")
            )

        if len(param_names) == 1:
            param_name = param_names[0]
            pattern = re.compile(
                r'["\']?' + re.escape(param_name) + r'["\']?\s*:\s*"(.*)"',
                re.DOTALL,
            )
            m = pattern.search(raw_str)
            if m:
                return {param_name: _unescape(m.group(1))}
            return {param_name: raw_str}

        # Multi-param: locate each "param_name": position in raw text,
        # then extract the quoted value following each key.
        key_positions: list[tuple[str, int]] = []
        for pname in param_names:
            pat = re.compile(
                r'["\']?' + re.escape(pname) + r'["\']?\s*:\s*"',
            )
            m = pat.search(raw_str)
            if m:
                key_positions.append((pname, m.end()))

        key_positions.sort(key=lambda x: x[1])

        result: Dict[str, Any] = {}
        for idx, (pname, val_start) in enumerate(key_positions):
            if idx + 1 < len(key_positions):
                next_start = key_positions[idx + 1][1]
                # Walk backwards from next key to find the boundary:
                # value ends at the last `"` before `, "next_key"`
                segment = raw_str[val_start:next_start]
                # Find last `",` or `" ,` pattern as value end
                boundary = segment.rfind('",')
                if boundary == -1:
                    boundary = segment.rfind('"')
                if boundary >= 0:
                    result[pname] = _unescape(segment[:boundary])
                else:
                    result[pname] = _unescape(segment)
            else:
                # Last param: take everything up to the last `"` before `}`
                remaining = raw_str[val_start:]
                # Strip trailing `"}` or `" }` etc.
                end = remaining.rfind('"')
                if end >= 0:
                    result[pname] = _unescape(remaining[:end])
                else:
                    result[pname] = _unescape(remaining.rstrip().rstrip('}'))

        if result:
            return result
        return {}

    async def _do_run(
        self,
        ai_message: str,
        parsed_step: ReActStep,
        need_vis_render: bool = True,
    ) -> ActionOutput:
        """Perform the action."""
        tool_args = {}
        name = parsed_step.action
        action_input = parsed_step.action_input
        action_input_str = action_input

        if not name:
            terminal_content = str(action_input_str if action_input_str else ai_message)
            return ActionOutput(
                is_exe_success=True,
                content=terminal_content,
                observations=terminal_content,
                terminate=True,
            )

        try:
            # Try to parse the action input to dict
            if action_input and isinstance(action_input, str):
                tool_args = parse_or_raise_error(action_input)
            elif isinstance(action_input, dict) or isinstance(action_input, list):
                tool_args = action_input
                action_input_str = json.dumps(action_input, ensure_ascii=False)
        except (json.JSONDecodeError, ValueError):
            if parsed_step.action == "terminate":
                tool_args = {"output": action_input}
            else:
                # JSON parsing failed — try to infer args from the tool definition.
                # If the tool has exactly one required parameter, treat the raw
                # action_input as that parameter's value.
                tool_args = self._fallback_parse_args(
                    name, action_input, self.resource
                )
            if not tool_args:
                logger.warning(f"Failed to parse the args: {action_input}")
        act_out = await run_tool(
            name,
            tool_args,
            self.resource,
            self.render_protocol,
            need_vis_render=need_vis_render,
            raw_tool_input=action_input_str,
        )
        if not act_out.action_input:
            act_out.action_input = action_input_str
        return act_out
