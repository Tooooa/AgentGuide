# AgentMark 水印 SDK 使用说明（初版）

本说明基于新增的 `agentmark/sdk/watermarker.py` 封装，便于其他 Agent 开发者快速集成行为水印，并为前端可视化提供结构化日志。

## 1. 主要接口

```python
from agentmark.sdk import AgentWatermarker

wm = AgentWatermarker(payload_text="team123", mock=False)

# 采样（嵌入水印）
result = wm.sample(
    probabilities={"Search": 0.5, "Reply": 0.3, "Finish": 0.2},
    context="task123||step1",          # 建议接入方自定义，需在日志里保存
    history=["last observation"],      # 备用：若 context 为空，使用 history 生成 key
)
print(result.action)                   # 选中的动作
print(result.distribution_diff)        # 给前端画概率对比的结构化数据

# 解码（验证水印）
bits = wm.decode(
    probabilities={"Search": 0.5, "Reply": 0.3, "Finish": 0.2},
    selected_action=result.action,
    context=result.context_used,
    round_num=result.round_num,
)
print(bits)
```

### 返回对象 `WatermarkSampleResult`
- `action`: 本步被选中的动作。
- `bits_embedded`: 本步嵌入的比特数。
- `bit_index`: 当前累积指针（下次采样从这里继续）。
- `payload_length`: 整个水印比特串长度。
- `context_used`: 生成密钥的上下文（需在日志中保存，解码用）。
- `round_num`: 使用的轮次编号（默认内部自增，亦可外部传入）。
- `target_behaviors`: 编码期的“目标集合”（检测用）。
- `distribution_diff`: 给前端的可视化数据（原始概率/水印后分布/目标标记）。
- `is_mock`: 是否为 mock 模式（前端联调用）。

## 2. 必备输入契约

- **候选动作 + 概率**：必须提供一个 `Dict[str, float]`，算法会归一化。若接入方只能拿到最终动作文本而没有候选概率，则无法使用此行为水印方案。
- **context_for_key**：建议格式如 `task_id||step_id||obs_hash`，务必随日志存储，用于解码和验水印。
- **轮次 round_num**：默认内部自增；若接入方已有自己的 step 序号，可通过 `round_num` 传入保持同步。

## 3. Mock 模式（前端联调）

初始化传入 `mock=True` 即可：`AgentWatermarker(..., mock=True)`。此模式返回伪造的 `distribution_diff`，方便前端先联调 UI，记得在展示层标注为 mock。

## 4. 日志建议字段

- `step_id` / `round_num`
- `context`（与编码一致）
- `probabilities`（行为名及概率）
- `selected_action`
- `target_behaviors`
- `bits_embedded` / `bit_index`
- `distribution_diff`（可选，前端展示用）

## 5. 依赖说明

封装内部复用了 `agentmark/core/watermark_sampler.py`，仍依赖 `torch`。若接入方环境较轻量，可在后续迭代提供纯 Python 版本或 HTTP 服务封装。

## 6. Prompt 驱动（黑盒 API）集成示例

当外部 LLM 只能通过 Prompt 返回自报概率时，可以使用 `agentmark/sdk/prompt_adapter.py` 里的辅助函数。

### Prompt 模板示例
在系统提示中强制 LLM 输出 JSON（覆盖所有候选，或 Top-K）：
```
你必须返回 JSON：
{
  "action_weights": {"Action1": 0.8, "Action2": 0.15, "Action3": 0.05},
  "action_args": {"Action1": {...}, "Action2": {...}, "Action3": {...}},
  "thought": "简要原因"
}
要求 action_weights 覆盖候选，值可不精确归一化，我们会归一化；不得输出 JSON 以外的文本。
```

### 解析与采样代码示例
```python
from agentmark.sdk import AgentWatermarker
from agentmark.sdk.prompt_adapter import (
    choose_action_from_prompt_output,
    PromptWatermarkWrapper,
    get_prompt_instruction,
)

wm = AgentWatermarker(payload_text="team123")

# raw_output 为 LLM 返回的文本（包含 JSON），如果你有候选列表则传入（推荐），否则置 None
selected, probs_used = choose_action_from_prompt_output(
    wm,
    raw_output=llm_response_text,
    fallback_actions=["Search", "Reply", "Finish"],  # 若无候选可传 None；解析不到概率且无候选会抛错
    context="task123||step1",
    history=["last observation"],
)

# 或者使用高层包装器，自动获取提示词与处理
wrapper = PromptWatermarkWrapper(wm)
system_prompt = base_system_prompt + "\n" + wrapper.get_instruction()
result = wrapper.process(
    raw_output=llm_response_text,
    fallback_actions=["Search", "Reply", "Finish"],  # 可选；无候选且无概率时会抛错
    context="task123||step1",
    history=["last observation"],
)
# result["action"] 供执行；result["frontend_data"] 直接给前端/日志

# selected: 选中的动作；probs_used: 解析/归一化后用于采样的概率
# 继续执行 selected，对日志记录 probs_used、selected、context、round 等信息
```

> 注意：自报概率的可信度低于真实 logits，统计显著性可能受影响；解析失败时会回退为均分分布。

## 7. 打包与安装（pip 形态）
- 本仓库根目录已加入 `pyproject.toml`，可打包为 `agentmark-sdk`：
  ```bash
  # 创建/启用虚拟环境后
  pip install build
  python -m build
  # 生成的 wheel/dist 在 dist/ 下
  pip install dist/agentmark_sdk-0.1.0-py3-none-any.whl
  ```
- 外部项目安装后直接：
  ```python
  from agentmark.sdk import AgentWatermarker, PromptWatermarkWrapper
  ```

## 8. 真实 LLM 测试（DeepSeek 示例）
脚本：`tests/fake_agent_llm.py`

运行（需网络与 API Key，勿硬编码 Key）：
```bash
export DEEPSEEK_API_KEY=sk-你的key
PYTHONPATH=. python3 tests/fake_agent_llm.py \
  --payload 1101 \
  --rounds 1 \
  --task "今天晚上吃什么？"
```
说明：
- 脚本会在 system prompt 中自动拼接严格的 JSON 概率指令，调用 DeepSeek，解析 `action_weights`，跑水印采样并解码。
- 输出包含 `[raw LLM output]`、`frontend distribution diff`、`decoded bits (this step)`；解码比特应匹配 payload 前缀（默认 1101）。
- 可通过 `--rounds` 多跑几轮，累积解码比特，检查前缀一致性。
