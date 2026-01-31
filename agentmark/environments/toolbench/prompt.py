"""ToolBench prompt builder."""

from typing import Dict, List, Tuple


def build_system_prompt() -> str:
    return (
        "You are a tool-use agent. First write a short Thought, then output a JSON block only with keys: "
        '"action_weights" (probabilities for EVERY candidate tool, sum to 1) and '
        '"action_args" (arguments for EVERY candidate tool; if Finish prob is low, keep its args null). '
        "Do not output prose outside the Thought + JSON. Use only the provided tool names. "
        "If a tool returns an error or no data, please inform the user truthfully and do not make up information. "
        "IMPORTANT: If the user's query is a greeting, chat, or general knowledge question that does not require the available tools, "
        "you MUST explicitly choose 'Finish' with a polite and helpful response in 'final_answer'."
    )


def format_tools(tool_summaries: List[Dict]) -> str:
    lines = []
    for idx, tool in enumerate(tool_summaries, start=1):
        desc = tool.get("description", "").replace("\n", " ")
        # Show required/optional param name+type+desc for model guidance
        def fmt_params(params):
            out = []
            for p in params or []:
                name = p.get("name", "")
                ptype = p.get("type", "")
                pdesc = p.get("description", "")
                out.append(f"{name}({ptype}): {pdesc}")
            return out

        req = fmt_params(tool.get("required_parameters", []))
        opt = fmt_params(tool.get("optional_parameters", []))
        param_hint = ""
        if req:
            param_hint += " required_params=[" + "; ".join(req[:4]) + "]"
        if opt:
            param_hint += " optional_params=[" + "; ".join(opt[:4]) + "]"
        lines.append(f"{idx}. {tool['name']}: {desc[:280]}{param_hint}")
    lines.append(f"{len(tool_summaries)+1}. Finish: call when you can answer or give up.")
    return "\n".join(lines)


def build_user_prompt(query: str, tool_summaries: List[Dict], admissible_commands: List[str]) -> str:
    tools_block = format_tools(tool_summaries)
    example_weights = ", ".join([f'\"{cmd}\": 0.1' for cmd in admissible_commands[:3]]) + " ..."
    return (
        f"User Query:\n{query}\n\n"
        f"Tools:\n{tools_block}\n\n"
        "Respond with a Thought line, then a JSON block. Include probabilities and arguments for EVERY tool. Example:\n"
        "Thought: I have checked the API health and it is operational. Now I need to retrieve the project list to answer the user's request. I should not finish yet because I haven't got the list.\n"
        '{\n'
        f'  "action_weights": {{{example_weights}}},\n'
        '  "action_args": {\n'
        '    "Tool_A": {"q": "good_args_A"},\n'
        '    "Tool_B": {"q": "good_args_B"},\n'
        '    "Finish": {"final_answer": null}\n'
        '  }\n'
        "}\n"
        "Ensure every candidate tool (including Finish) appears in action_weights and action_args. "
        "If Finish prob is low, keep its args empty/null; when you choose Finish, put the final_answer there."
    )


def build_messages(
    query: str, tool_summaries: List[Dict], admissible_commands: List[str]
) -> List[Dict]:
    system_prompt = build_system_prompt()
    user_prompt = build_user_prompt(query, tool_summaries, admissible_commands)
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def extract_finish_action_input(model_output: Dict) -> Tuple[str, Dict]:
    """Extract Finish input from model output (helper for main loop)."""
    action_input = model_output.get("selected_action_input", {})
    if isinstance(action_input, str):
        return action_input, {"final_answer": action_input}
    return action_input.get("final_answer", ""), action_input
