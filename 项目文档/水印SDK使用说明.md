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

1) 激活环境并配置 DeepSeek Key  
```bash
cd /mnt/c/Users/25336/Desktop/AgentMarkWeb
source ~/miniconda3/etc/profile.d/conda.sh && conda activate AgentMark
export DEEPSEEK_API_KEY=sk-你的key
```
2) 启动水印网关（代理 DeepSeek）  
```bash
uvicorn agentmark.proxy.server:app --host 0.0.0.0 --port 8000
```
可选环境变量（推荐至少配置 `AGENTMARK_TWO_PASS=1`）：
```bash
export AGENTMARK_TWO_PASS=1                 # tools 场景下启用两阶段，保证 tool_calls 产出
export AGENTMARK_PAYLOAD_BITS=1101          # 固定水印 payload（可选）
export AGENTMARK_SESSION_DEFAULT=demo       # 无 session 时使用的默认会话 key
export AGENTMARK_PROB_TEMPERATURE=2.0       # 概率温度(>1 更平坦)，提高嵌入命中率
export AGENTMARK_FORCE_UNIFORM=1            # 强制均匀分布（演示用）
```
3) 在另一个终端，运行真实 LLM 集成脚本  
```bash
cd /mnt/c/Users/25336/Desktop/AgentMarkWeb
PYTHONPATH=. DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY \
python3 tests/fake_agent_llm.py \
  --payload 1101 \
  --rounds 1 \
  --task "今天晚上吃什么？"
```
脚本会自动构造 Prompt（附加 JSON 概率指令）、调用 DeepSeek、解析概率→水印采样→解码。输出包含：
- `[raw LLM output]`：模型原始 JSON 响应
- `frontend distribution diff`：原始 vs 水印重组的分布
- `decoded bits (this step)`：应匹配 payload 前缀（默认 1101，可逐步解出前几位）

4) 用户/外部 Agent 只需改调用地址（无需改代码）  
示例最小调用（放在用户侧，如 liteLLM/Swarm 的调用环境）：
```bash
export OPENAI_BASE_URL=http://localhost:8000/v1
export OPENAI_API_KEY=any-string
```
然后正常用 openai 兼容客户端调用即可，示例：
```python
import openai
client = openai.OpenAI(api_key="anything", base_url="http://localhost:8000/v1")
resp = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "system", "content": "你是帮忙决定晚饭的助手"},
        {"role": "user", "content": "今晚吃什么？"}
    ],
    candidates=["点外卖", "做炒饭", "煮面", "不吃"],  # 推荐显式提供
)
print(resp.watermark)  # 包含 action/probabilities_used/frontend_data/decoded_bits/raw_llm_output
```
- 不提供 `candidates` 时，网关会让 LLM 自举候选+概率（降级模式，可靠性较低）。
- 网关响应保留原结构，并附加 `watermark` 字段用于校验。
- 若需要跨请求累积嵌入，请设置同一会话标识（优先用 header）：
  - `X-AgentMark-Session: your-session-id`
  - 或 `extra_body.agentmark.session_id`
- Swarm/天气示例只有 2 个工具，嵌入概率偏低；可设置 `AGENTMARK_PROB_TEMPERATURE=2.0`
  并连续请求多轮，通常会出现 `bits_embedded>0` 与 `decoded_bits`。

5) 其他本地自测（无需网络）：  
```bash
PYTHONPATH=. python tests/smoke_sdk.py
PYTHONPATH=. python tests/batch_consistency.py
PYTHONPATH=. python tests/prompt_dinner.py
```

## 10. 前端柱状图验证（完整流程）
这个流程会把网关返回的水印结果转换成前端需要的 `distribution` 数据，并保存为一个可在前端选择的场景。

### 10.1 启动 Dashboard 后端（端口 8000）
```bash
cd /mnt/c/Users/25336/Desktop/AgentMarkWeb
source ~/miniconda3/etc/profile.d/conda.sh && conda activate AgentMark
python dashboard/server/app.py
```

### 10.2 启动网关（端口 8001，避免与 Dashboard 冲突）
```bash
cd /mnt/c/Users/25336/Desktop/AgentMarkWeb
source ~/miniconda3/etc/profile.d/conda.sh && conda activate AgentMark
export DEEPSEEK_API_KEY=sk-你的key
export TARGET_LLM_MODEL=deepseek-chat
export AGENTMARK_TWO_PASS=1
export AGENTMARK_PROB_TEMPERATURE=2.0
uvicorn agentmark.proxy.server:app --host 0.0.0.0 --port 8001
```

### 10.3 生成前端场景（自动写入数据库）
```bash
cd /mnt/c/Users/25336/Desktop/AgentMarkWeb
source ~/miniconda3/etc/profile.d/conda.sh && conda activate AgentMark
python tests/frontend_bar_demo.py \
  --proxy-base http://localhost:8001/v1 \
  --dashboard-base http://localhost:8000 \
  --rounds 5 \
  --session demo
```
输出会显示保存的 `scenario_id`，并在 `tests/frontend_demo_scenario.json` 写入完整步骤数据。

### 10.4 启动前端并查看柱状图
```bash
cd /mnt/c/Users/25336/Desktop/AgentMarkWeb/dashboard
npm install
npm run dev
```
浏览器打开 `http://localhost:5173/`，在场景列表中选择 “AgentMark Watermark Demo”，即可看到柱状图和 `isSelected` 标记。

## 11. 多动作追踪与打印请求/原始输出
用于观察**多工具候选**下的完整链路，并打印每次请求和 LLM 原始返回文本。

1) 启动网关并打开调试日志：
```bash
cd /mnt/c/Users/25336/Desktop/AgentMarkWeb
source ~/miniconda3/etc/profile.d/conda.sh && conda activate AgentMark
export DEEPSEEK_API_KEY=sk-你的key
export TARGET_LLM_MODEL=deepseek-chat
export AGENTMARK_TWO_PASS=1
export AGENTMARK_DEBUG=1
uvicorn agentmark.proxy.server:app --host 0.0.0.0 --port 8001
```

2) 运行多动作追踪脚本：
```bash
cd /mnt/c/Users/25336/Desktop/AgentMarkWeb
source ~/miniconda3/etc/profile.d/conda.sh && conda activate AgentMark
python tests/multi_action_trace.py --proxy-base http://localhost:8001/v1 --session demo
```

输出包括：
- `[request]`：发送到网关的原始请求
- `[llm_raw_output]`：第一阶段 LLM 的 JSON 原文
- `[watermark]`：网关返回的完整水印结构
- 网关控制台同时会打印 `[agentmark:inbound_request] / [agentmark:scoring_request] / [agentmark:tool_request]` 等调试日志

## 9. 插件（网关代理）规范与字段
- 接口：OpenAI 兼容 `/v1/chat/completions`，保持原 response 结构，新增 `watermark` 字段。
- 请求体：
  - 标准字段：`model/messages/temperature/max_tokens/...`
- 可选字段（由 Agent 代码自动填充，非终端用户输入）：
    - `tools/functions`：优先提取为候选（推荐）。
    - `system`：可在 system message 中放置 agentmark JSON 元数据（见下方示例）。
    - `extra_body.agentmark.candidates`：Agent 可在此传入候选列表。
    - 顶层 `candidates`：仅供 Agent 端调用时使用（非终端用户手输）。
    - `context` / `extra_body.agentmark.context` / `extra_body.context`：用于水印解码。
    - `extra_body.agentmark.session_id`：用于跨请求维持水印状态（推荐）。
  - 网关注入：新增一条 system message 写入 JSON 评分指令；不修改用户原 prompt。
- 候选提取优先级：`tools/functions` > `system(agentmark.candidates)` > `extra_body.agentmark.candidates`/顶层 `candidates`（由 Agent 端提供）> 无候选则 bootstrap（显式标记）。
- system 元数据示例（放在 system message 的 content 中）：
  ```json
  {
    "agentmark": {
      "candidates": ["候选1", "候选2", "候选3"],
      "context": "task123||step1"
    }
  }
  ```
- 响应附加字段 `watermark`（原结构保留），示例：
  ```json
  {
    "watermark": {
      "mode": "tools|system|extra_body|bootstrap",
      "candidates_used": ["候选1","候选2"],
      "probabilities_used": {"候选1":0.4, "候选2":0.6},
      "action": "候选2",
      "action_args": {},
      "frontend_data": {...},      // 含 bits_embedded/bit_index 等
      "decoded_bits": "11",
      "context_used": "proxy||step1",
      "round_num": 0,
      "raw_llm_output": "原始 LLM 文本"
    }
  }
  ```
- two-pass 模式暂未开启，如需更高稳定性可扩展；当前为单次取概率+采样。

## 10. Swarm / 其他 Agent 调用提示
- 无需改业务代码，只需在启动/运行环境设置 BASE_URL 指向网关，例如：
  ```bash
  export OPENAI_BASE_URL=http://localhost:8000/v1    # 对应 openai sdk
  export OPENAI_API_BASE=http://localhost:8000/v1   # 一些框架使用此名
  export OPENAI_API_KEY=anything
  ```
- 自定义字段统一由 Agent 端放到 `extra_body`，示例：
  ```python
  resp = client.chat.completions.create(
      model="deepseek-chat",
      messages=[...],
      extra_body={
          "candidates": ["候选1","候选2"],
          "context": "task||step1"
      }
  )
  ```
  网关会解析 tools/system/extra_body/candidates，注入评分指令，返回带 `watermark` 的响应。
