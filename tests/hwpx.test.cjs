// node tests/hwpx.test.cjs <out.hwpx> - 견본 마크다운을 hwpx로 만든다(검증은 python-hwpx가 tests/hwpx_check.py에서)
const fs = require("fs");
const path = require("path");
const md = require("../web/markdown.js");
global.MDX = md;
const { HWPX } = require("../web/hwpx.js");
const T = path.join(__dirname, "..", "assets", "hwpx-template");
const read = (n) => fs.readFileSync(path.join(T, n), "utf8");
const template = { header: read("header.xml"), section: read("section0.xml"), version: read("version.xml"), settings: read("settings.xml"), container: read("container.xml"), containerRdf: read("container.rdf"), manifest: read("manifest.xml") };
const sample = `# 2026년 스마트농업 추진 계획

농촌진흥청은 **스마트농업** 확산을 위해 *세 가지* 과제를 추진한다. 자세한 것은 [별첨](별첨.md) 참고.
<span style="color:#c00000">빨간 글</span> <span style="background-color:#ffff00">형광펜</span> <span style="font-family:궁서;font-size:14pt">궁서 14pt</span> <u>밑줄</u>

## 1. 추진 과제

| 과제 | 담당 | 예산(억 원) |
| --- | :---: | ---: |
| 데이터 표준화 | 기술융합과 | 3.2 |
| GPU 서버 구축 | 정보화담당관 | 1.3 |
| 현장 실증 | 농업공학부 | 12 |

- 표준 항목 128개 정비
  - 토양 센서 단위 통일
- [x] 1단계 완료
- [ ] 2단계 착수

1. 첫째
2. 둘째

> [!WARNING]
> 연내 집행이 안 되면 이월해야 한다.

> 인용문입니다.

\`\`\`
코드 한 줄
코드 두 줄 <tag>&
\`\`\`

---

<!-- pagebreak -->

## 2. 그림

![농막](icon.png)
`;
HWPX.build(sample, { template, title: "시험 문서", readImage: async (src) => new Uint8Array(fs.readFileSync(path.join(__dirname, "..", "assets", "icon-64.png"))) })
  .then((bytes) => { fs.writeFileSync(process.argv[2], bytes); console.log("written", bytes.length); });
