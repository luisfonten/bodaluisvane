import re

with open(r"c:\Users\HP\Documents\ia - pruebas\Vanessa\Boda\version_celular_boda\app.js", "r", encoding="utf-8") as f:
    js_lines = f.readlines()

output = []
for i, line in enumerate(js_lines):
    matches = re.findall(r"\bformat[A-Za-z0-9_]*\b", line)
    if matches:
        output.append(f"Line {i+1}: {matches} | {line.strip()[:100]}\n")

with open(r"c:\Users\HP\Documents\ia - pruebas\Vanessa\Boda\version_celular_boda\format_search.txt", "w", encoding="utf-8") as f:
    f.writelines(output)
print(f"Total lines with format: {len(output)}")
