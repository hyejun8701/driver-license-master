import glob
import json
import re
import pdfplumber


def extract_quiz_ultimate(pdf_path, output_json_path):
    questions = []
    print("PDF 정밀 인덱스 탐색 파싱 시작...")

    full_text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                full_text += text + "\n"

    # 일반/딩뱃 동그라미 숫자 통합 매핑 테이블
    symbol_map = {
        "1": ["①", "➀"],
        "2": ["②", "➁"],
        "3": ["③", "➂"],
        "4": ["④", "➃"],
    }

    # 1. 문제 번호 매칭
    q_matches = list(re.finditer(r"(?:^|\n)\s*(\d+)\s*\.\s*", full_text))

    for idx in range(len(q_matches)):
        start_pos = q_matches[idx].start()
        end_pos = (
            q_matches[idx + 1].start()
            if idx + 1 < len(q_matches)
            else len(full_text)
        )
        block = full_text[start_pos:end_pos]
        q_num = int(q_matches[idx].group(1))

        # 2. 정답 영역 전체 캡처 (다중 정답 대응 핵심 수정 구간)
        ans_match = re.search(
            r"(?:■|\[|\b)\s*정답\s*[:：]?\s*([1-4,\s\n]+)", block
        )
        if not ans_match:
            continue

        # 정답 텍스트 내의 모든 숫자 추출 (예: "3, 4" -> ["3", "4"])
        ans_nums = re.findall(r"[1-4]", ans_match.group(1))
        if not ans_nums:
            continue

        # 3. 정답/해설 구문 분리
        clean_block = re.split(r"■\s*정답|■\s*해설", block)[0]

        # 4. 보기 시작 위치 감지
        opt_pattern = r"[①②③④➀➁➂➃]"
        opt_matches = list(re.finditer(opt_pattern, clean_block))

        if opt_matches:
            first_opt_pos = opt_matches[0].start()
            q_text_raw = clean_block[:first_opt_pos]
            options_block = clean_block[first_opt_pos:]
        else:
            q_text_raw = clean_block
            options_block = ""

        q_text = re.sub(r"^\s*\d+\s*\.\s*", "", q_text_raw).strip()
        q_text = re.sub(r"\s+", " ", q_text)

        # 5. 다중 정답 보기 텍스트 각각 추출
        correct_answers = []
        for num in ans_nums:
            target_symbols = symbol_map.get(num, [])
            if target_symbols and options_block:
                sym_pattern = "|".join([re.escape(s) for s in target_symbols])
                pattern = (
                    rf"({sym_pattern})\s*(.*?)(?=(?:[①②③④➀➁➂➃]|■|\Z))"
                )
                match = re.search(pattern, options_block, re.DOTALL)

                if match and match.group(2).strip():
                    matched_sym = match.group(1)
                    ans_text = re.sub(r"\s+", " ", match.group(2)).strip()
                    correct_answers.append(f"{matched_sym} {ans_text}")
                else:
                    correct_answers.append(f"{target_symbols[0]}")
            elif target_symbols:
                correct_answers.append(f"{target_symbols[0]}")

        if correct_answers:
            questions.append(
                {
                    "id": q_num,
                    "question": f"{q_num}. {q_text}",
                    "answers": correct_answers,
                }
            )

    # 중복 제거 및 정렬
    unique_q = {q["id"]: q for q in questions}.values()
    sorted_q = sorted(unique_q, key=lambda x: x["id"])

    # JSON 저장
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(sorted_q, f, ensure_ascii=False, indent=2)

    print(
        f"완료! 총 {len(sorted_q)}문제가 '{output_json_path}'에 올바르게 저장되었습니다."
    )


# 실행
pdf_files = glob.glob("*.pdf")
if pdf_files:
    print(f"분석 파일: {pdf_files[0]}")
    extract_quiz_ultimate(pdf_files[0], "questions_ans_only.json")