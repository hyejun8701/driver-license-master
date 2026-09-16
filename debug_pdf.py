import glob
import pdfplumber

pdf_files = glob.glob("*.pdf")
if pdf_files:
    with pdfplumber.open(pdf_files[0]) as pdf:
        # 1페이지와 2페이지 텍스트 출력
        for page_num in range(min(3, len(pdf.pages))):
            print(
                f"=== {page_num + 1} 페이지 텍스트 ==="
            )
            print(pdf.pages[page_num].extract_text()[:1000])
            print("\n" + "=" * 40 + "\n")