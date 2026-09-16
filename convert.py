import glob
import json
import os
import re
import pdfplumber


def extract_full_quiz(pdf_path, output_json_path, image_output_dir="extracted_images", extract_images=True):
    questions = []
    print(f"PDF 데이터 추출 시작 (이미지 추출 모드: {extract_images})...")

    if extract_images:
        os.makedirs(image_output_dir, exist_ok=True)

    symbol_map = {
        '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5,
        '➀': 1, '➁': 2, '➂': 3, '➃': 4, '➄': 5,
        '❶': 1, '❷': 2, '❸': 3, '❹': 4, '❺': 5,
        'ⓛ': 1, '②': 2, '③': 3, '④': 4, '⑤': 5
    }
    opt_symbols = r"[①-⑤➀-➄❶-❺ⓛ]"

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if not page_text:
                continue

            words = page.extract_words()

            # 문제 번호 매칭 (1~1000번 전체)
            q_matches = list(re.finditer(r"(?:^|\n)\s*(\d+)\s*\.\s*", page_text))
            if not q_matches:
                continue

            q_blocks = []
            for idx in range(len(q_matches)):
                start_pos = q_matches[idx].start()
                end_pos = (
                    q_matches[idx + 1].start()
                    if idx + 1 < len(q_matches)
                    else len(page_text)
                )
                block = page_text[start_pos:end_pos]
                q_num = int(q_matches[idx].group(1))

                # 문제 번호 Y (top) 좌표 구하기
                q_top = 0
                for w in words:
                    clean_w = w["text"].strip()
                    if clean_w.startswith(f"{q_num}.") or clean_w == str(q_num):
                        q_top = w["top"]
                        break

                q_blocks.append({
                    "q_num": q_num,
                    "block": block,
                    "q_top": q_top
                })

            # 문제 Y좌표 순 정렬
            q_blocks.sort(key=lambda x: x["q_top"])

            # 이미지 추출 플래그가 켜져 있을 때만 페이지 이미지 준비
            page_images = []
            if extract_images:
                page_images = [img for img in page.images if img["width"] > 40 and img["height"] > 40]
                page_images.sort(key=lambda x: x["top"])

            for idx, q_info in enumerate(q_blocks):
                q_num = q_info["q_num"]
                block = q_info["block"]
                q_top = q_info["q_top"]
                next_q_top = q_blocks[idx + 1]["q_top"] if idx + 1 < len(q_blocks) else page.height

                # 1. 정답 파싱
                ans_match = re.search(
                    r"(?:■|\[|\b)\s*정답\s*[:：]?\s*([1-5,\s\n①-⑤➀-➄❶-❺ⓛ]+)", block
                )
                if not ans_match:
                    continue

                raw_ans = ans_match.group(1)
                ans_nums = []

                for n in re.findall(r"[1-5]", raw_ans):
                    ans_nums.append(int(n))

                for char in raw_ans:
                    if char in symbol_map and symbol_map[char] not in ans_nums:
                        ans_nums.append(symbol_map[char])

                if not ans_nums:
                    continue

                # 2. 정답/해설 영역과 문제 영역 분리
                split_ans = re.split(r"■\s*정답|■\s*해설|\[정답\]", block)
                question_and_context = split_ans[0]  # 정답 나오기 전 전체 영역

                # 3. 보기(①~⑤) 추출
                split_parts = re.split(f"({opt_symbols})", question_and_context)

                options = []
                q_title = split_parts[0]  # 문제 제목 및 지문
                extra_context = ""        # 보기 뒤, 정답 전에 있는 상황 설명 문구 (■ ...)

                for i in range(1, len(split_parts), 2):
                    sym = split_parts[i]
                    txt = split_parts[i + 1] if i + 1 < len(split_parts) else ""

                    # 마지막 보기 뒤에 붙은 설명 문구 분리
                    if i + 2 >= len(split_parts):
                        ctx_split = re.split(r"(■\s*[^정답\n].*)", txt, flags=re.DOTALL)
                        opt_txt = ctx_split[0]
                        if len(ctx_split) > 1:
                            extra_context = "".join(ctx_split[1:])
                    else:
                        opt_txt = txt

                    clean_txt = re.sub(r"\s+", " ", opt_txt).strip()
                    options.append(f"{sym} {clean_txt}")

                # 문제 지문 정리 (기본 지문)
                q_text = re.sub(r"^\s*\d+\s*\.\s*", "", q_title).strip()
                q_text = re.sub(r"\s+", " ", q_text)

                # 상황 설명 문구(■ ...)를 문제 지문에서 제외하고 별도 필드로 분리
                image_description = ""
                if extra_context:
                    clean_ctx = extra_context.strip()
                    image_description = re.sub(r"\n\s*", " ", clean_ctx) # 줄바꿈을 공백 또는 보기 좋게 정리

                # 4. 이미지 추출 (플래그가 True이고 지정된 번호 범위일 때)
                image_rel_path = None
                img_filename = f"q{q_num}.png"
                expected_img_path = os.path.join(image_output_dir, img_filename)

                if extract_images and 681 <= q_num <= 965 and page_images:
                    matched_img = None

                    # 1차: 페이지 내 문제 수 = 이미지 수 일치 시 1:1 매칭
                    if len(page_images) == len(q_blocks):
                        matched_img = page_images[idx]
                    else:
                        # 2차: Y축 위치 기반 매칭
                        for img in page_images:
                            img_center = (img["top"] + img["bottom"]) / 2
                            if (q_top - 30) <= img_center < (next_q_top + 20):
                                matched_img = img
                                break

                    if matched_img:
                        try:
                            x0 = max(0, matched_img["x0"])
                            top = max(0, matched_img["top"])
                            x1 = min(page.width, matched_img["x1"])
                            bottom = min(page.height, matched_img["bottom"])

                            if x1 > x0 and bottom > top:
                                cropped_img = page.crop((x0, top, x1, bottom)).to_image()
                                cropped_img.save(expected_img_path)
                                image_rel_path = f"{image_output_dir}/{img_filename}"
                                if matched_img in page_images:
                                    page_images.remove(matched_img)
                        except Exception as e:
                            print(f"이미지 추출 오류 (문제 {q_num}): {e}")
                else:
                    # 이미지를 새로 추출하지 않는 경우, 파일이 실제로 존재하면 경로 유지
                    if os.path.exists(expected_img_path):
                        image_rel_path = f"{image_output_dir}/{img_filename}"

                if options:
                    q_data = {
                        "id": q_num,
                        "question": f"{q_num}. {q_text}",
                        "image_description": image_description,  # 분리된 이미지/상황 설명 문구
                        "image": image_rel_path,
                        "options": options,
                        "answers": sorted(list(set(ans_nums))),
                    }
                    questions.append(q_data)

    # 중복 제거 및 정렬
    unique_q = {q["id"]: q for q in questions}.values()
    sorted_q = sorted(unique_q, key=lambda x: x["id"])

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(sorted_q, f, ensure_ascii=False, indent=2)

    print(f"완료! 총 {len(sorted_q)}문제가 '{output_json_path}'에 저장되었습니다.")


# 실행 예시
pdf_files = glob.glob("*.pdf")
if pdf_files:
    # 최초 실행 시에는 이미지를 추출하기 위해 extract_images=True (또는 생략)
    # 이후 속도를 빠르게 하려면 extract_images=False 로 변경하여 실행하세요!
    extract_full_quiz(pdf_files[0], "questions_full.json", extract_images=False)