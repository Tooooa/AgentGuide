"""
Fake Response Generator for ToolBench
Mimics the logic in StableToolBench/server/main.py to generate fake responses when cache/real API fails.
"""

import json
import time
from typing import List, Dict, Any, Optional

def is_valid_json(result: str) -> bool:
    try:
        json.loads(result)
        return True
    except Exception:
        return False

def generate_fake_response(
    client: Any,
    model: str,
    api_doc: Dict,
    tool_input: Dict,
    api_examples: List[Any],
    temperature: float = 0.0,
    query: str = ""
) -> Dict:
    """
    Generates a fake response using the LLM based on API docs and examples.
    
    Args:
        client: OpenAI client instance
        model: Model name to use
        api_doc: API documentation dictionary
        tool_input: The input arguments for the tool
        api_examples: List of (input, output) tuples from cache
        temperature: Sampling temperature
        query: The original user query/goal
        
    Returns:
        Dict: The generated fake response
    """
    if not client:
        return {"error": "No LLM client provided for fake response generation", "response": ""}

    # Check for missing required parameters
    required_params_raw = api_doc.get("required_parameters", [])
    required_names = []
    for p in required_params_raw:
        if isinstance(p, dict):
            required_names.append(p.get("name"))
        elif isinstance(p, str):
            required_names.append(p)
            
    # Ensure tool_input is a dict
    if not isinstance(tool_input, dict):
        tool_input = {}
        
    missing_params = [name for name in required_names if name and name not in tool_input]
    
    if missing_params:
        # Warn but proceed to allow LLM to hallucinate/mock the missing data
        print(f"[WARN] Missing required parameters: {', '.join(missing_params)}. Proceeding with fake generation.")
        # We do NOT return error here anymore.
        # error_msg = f"Missing required parameters: {', '.join(missing_params)}"
        # return {"error": error_msg, "response": ""}

    system_prompt = '''
You are a high-fidelity API Mock Server. Your job is to generate realistic, structured JSON responses for API calls based on their documentation.
You are operating in a testing environment where real APIs are offline, so you must SIMULATE successful data retrieval.

CRITICAL INSTRUCTIONS:
1. **GENERATE REALISTIC DATA**: Do NOT return a description of what the API does. Return ACTUAL DATA (e.g., video titles, user IDs, URLs, weather data).
2. **JSON FORMAT**: Your response must be a valid JSON object following the structure below.
3. **SUCCESS BIAS**: Assume the API call is successful unless the input is blatantly invalid. Even if parameters are missing, try to return default/sample data instead of an error.
4. **CONTEXTUAL RELEVANCE**: The mock data MUST match the User Goal and input arguments. If the user searches for "cats", return videos about cats. If they ask for "family movies", return family movies. Do NOT return generic random data.
5. **NO HELP TEXT**: Never return "This API does X..." or "Please provide Y...". specific error messages are allowed if input is truly broken, but prefer mock data.
6. **CONCISENESS**: Limit lists to 3-5 items to ensure the response fits within the token limit and remains valid JSON.

RESPONSE STRUCTURE:
{
    "error": "",
    "response": "<YOUR_MOCK_DATA_JSON_STRING>"
}
* The "error" field should be empty string for success.
* The "response" field must be a string (often a stringified JSON object) containing the mock data.

EXAMPLE 1 (Good):
API: Get YouTube Video (id="123")
Output:
{
    "error": "",
    "response": "{\\"id\\": \\"123\\", \\"title\\": \\"Amazing Cat Video\\", \\"views\\": 100000, \\"url\\": \\"https://youtube.com/watch?v=123\\"}"
}

EXAMPLE 2 (Bad - Do NOT do this):
Output:
{
    "error": "",
    "response": "This API returns a video. Please provide an ID."
}
    '''
    
    # Truncate examples if too long (logic from official code)
    example_num = len(api_examples)
    while len(str(api_examples)) > 2048 and example_num > 1:
        example_num -= 1
        api_examples = api_examples[:example_num]

    query_context = f"User Goal/Query: {query}\n" if query else ""
    user_prompt_content = query_context + "API Documentation:"+str(api_doc)+"\n"+"API Examples:"+str(api_examples)[:2048]+"\n"+"API Input:"+str(tool_input)+"\n"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt_content}
    ]

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=4096,
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            result = response.choices[0].message.content
            # DEBUG PRINT
            print(f"[DEBUG] Fake Response Attempt {attempt+1} (Query: {query[:50]}...): {result}")
            
            if "```json" in result:
                result = result.replace("```json", "").replace("```", "").strip()
            
            if is_valid_json(result):
                return json.loads(result)
            else:
                print(f"[WARN] Invalid JSON response from fake generator on attempt {attempt+1}. Retrying...")
            time.sleep(1) # Add a small delay before retrying
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[ERROR] Fake generation failed on attempt {attempt+1}: {e}")
            time.sleep(1)

    return {
        "error": "Failed to generate fake response",
        "response": "",
    }
