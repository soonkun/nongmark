"""python-hwpx로 농막이 만든 hwpx를 연다: 구조 검증(validate), 표가 진짜 표인지, 쪽 설정·쪽 나눔·그림."""
import sys, zipfile, re
from hwpx import HwpxDocument
path = sys.argv[1]
z = zipfile.ZipFile(path)
assert z.infolist()[0].filename == "mimetype" and z.read("mimetype") == b"application/hwp+zip"
doc = HwpxDocument.open(path)
rep = doc.validate()
print("validate issues:", rep.issues)
assert rep.issues == ()
sec = z.read("Contents/section0.xml").decode()
tables = doc.tables if hasattr(doc, "tables") else []
print("tables:", len(tables))
assert sec.count("<hp:tbl ") == 3, sec.count("<hp:tbl ")  # 표 + 코드 상자 + 콜아웃 상자
assert 'rowCnt="4" colCnt="3"' in sec and "데이터 표준화" in sec and "|" not in re.sub(r"<[^>]+>", "", sec.split("데이터 표준화")[0][-200:])
assert 'left="5669" right="5669" top="8504" bottom="8504"' in sec, "여백"
assert 'pageBreak="1"' in sec, "쪽 나눔"
assert "<hp:pic " in sec and any(n.startswith("BinData/") for n in z.namelist()), "그림"
assert "&lt;tag&gt;&amp;" in sec
text = doc.export_text() if hasattr(doc, "export_text") else ""
print(text[:400])
print("OK")
