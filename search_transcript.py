import json

transcript_path = r"C:\Users\HP\.gemini\antigravity\brain\e377aae6-8bf5-481e-9f07-074e7889ce97\.system_generated\logs\transcript.jsonl"
with open(transcript_path, 'r', encoding='utf-8') as f:
    for line_idx, line in enumerate(f):
        data = json.loads(line)
        content = data.get("content", "") or ""
        thinking = data.get("thinking", "") or ""
        if "embudo" in content.lower() or "embudo" in thinking.lower():
            print(f"Line {line_idx}: found in {data.get('type')}, source {data.get('source')}")
            # print surrounding snippet
            text = content if "embudo" in content.lower() else thinking
            idx = text.lower().find("embudo")
            print("Snippet:", text[max(0, idx-100):min(len(text), idx+150)])
