import json

# 1. 기존 추출된 JSON 파일 로드
with open("questions_ans_only.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# 2. 누락된 문제 번호 계산
extracted_ids = set(q["id"] for q in data)
all_ids = set(range(1, 1001))  # 1번부터 1000번까지
missing_ids = sorted(list(all_ids - extracted_ids))

# 3. 결과 출력
print(f"📌 누락된 문제 번호 목록 ({len(missing_ids)}개): {missing_ids}")