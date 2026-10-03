// node --test tests/markdown.test.cjs  - 렌더러 안전성(XSS)과 기본 문법
const test = require("node:test");
const assert = require("node:assert");
const md = require("../web/markdown.js");

const ATTACKS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x](java\tscript:alert(1))",
  "[x](\u0001javascript:alert(1))",
  "[x](data:text/html,<script>alert(1)</script>)",
  "[x](vbscript:msgbox)",
  "[x](file:///C:/Windows/System32)",
  "[x](//evil.example/a)",
  "![a](javascript:alert(1))",
  "![a](data:image/svg+xml;base64,PHN2Zy8+)",
  "![a](http://evil.example/track.png)",
  '[x](http://a" onmouseover="alert(1))',
  "**<b onclick=alert(1)>x</b>**",
  "`<script>`",
  "```\n<script>alert(1)</script>\n```",
  "| <img src=x onerror=1> | b |\n|---|---|\n| <svg onload=1> | c |",
  "> [!NOTE] <iframe src=x>\n> <object data=x>",
  "- [ ] <a href=javascript:1>x</a>",
  "# <style>body{}</style>",
  "[a](<javascript:alert(1)>)",
];

test("공격 문자열이 실행 가능한 HTML이 되지 않는다", () => {
  for (const attack of ATTACKS) {
    const html = md.renderDoc(attack);
    assert.ok(!/<(script|iframe|object|embed|style|svg|form|base|meta|link)\b/i.test(html), `${attack} → ${html}`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/&[a-z#0-9]+;/gi, "")) || !/<[^>]*\son[a-z]+\s*=/i.test(html), `${attack} → ${html}`);
    assert.ok(!/href="\s*(javascript|data|vbscript|file):/i.test(html), `${attack} → ${html}`);
    assert.ok(!/src="(?!data:image\/(png|jpe?g|gif|webp);base64,)/i.test(html), `${attack} → ${html}`);
  }
});

test("허용 링크·그림은 남는다", () => {
  assert.match(md.renderDoc("[a](https://example.org/x?a=1&b=2)"), /href="https:\/\/example.org\/x\?a=1&amp;b=2"/);
  assert.match(md.renderDoc("[a](./other.md)"), /data-href="\.\/other\.md"/);
  assert.match(md.renderDoc("![b](assets/p.png)"), /data-src="assets\/p\.png"/);
});

test("블록 나누기와 문법", () => {
  assert.deepStrictEqual(md.splitBlocks("# 제목\n문단 1\n이어짐\n\n- a\n  - b\n- c\n```js\nx\n\ny\n```\n---"), ["# 제목", "문단 1\n이어짐", "- a\n  - b\n- c", "```js\nx\n\ny\n```", "---"]);
  assert.match(md.renderDoc("- a\n  - b\n- c"), /<ul><li>a<ul><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
  assert.match(md.renderDoc("1. a\n2. b"), /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(md.renderDoc("- [x] 끝\n- [ ] 남음"), /class="task done".*checked.*class="task"/s);
  assert.match(md.renderDoc("**굵게** *기울임* ~~취소~~ `코드`"), /<strong>굵게<\/strong> <em>기울임<\/em> <del>취소<\/del> <code>코드<\/code>/);
  assert.match(md.renderDoc("| a | b |\n|:--|--:|\n| 1 | 2 |"), /<th>a<\/th><th class="a-right">b<\/th>.*<td>1<\/td>/s);
  assert.match(md.renderDoc("> [!WARNING]\n> 조심"), /class="callout c-warning".*주의.*조심/s);
  assert.strictEqual(md.toggleTask("- [ ] a\n- [x] b", 0), "- [x] a\n- [x] b");
  assert.strictEqual(md.toggleTask("- [ ] a\n- [x] b", 1), "- [ ] a\n- [ ] b");
  assert.strictEqual(md.titleOf("\n\n# 회의록\n본문"), "회의록");
});

test("병적 입력에도 금방 끝난다", () => {
  const t = Date.now();
  md.renderDoc("*".repeat(5000) + "_".repeat(5000) + "[".repeat(3000) + "`".repeat(3000));
  md.renderDoc("> ".repeat(2000) + "x");
  assert.ok(Date.now() - t < 2000);
});

test("독립 검토 지적 - 백슬래시 외부 주소·상대 링크·긴 줄·제목·깊은 목록", () => {
  for (const a of ["[x](/\\evil.example/a)", "[x](\\\\server\\share)", "[x](/etc/passwd)", "![a](/\\evil/a.png)"]) {
    const html = md.renderDoc(a);
    assert.ok(!/\shref=/.test(html) && !/data-src="\/|data-href="\//.test(html), `${a} → ${html}`);
  }
  assert.ok(!/\shref=/.test(md.renderDoc("[x](./a.md)")), "상대 링크는 href 없이");
  let t = Date.now();
  md.renderDoc("# a" + " ".repeat(10000) + "x");
  md.renderDoc("[".repeat(200000));
  md.renderDoc(Array.from({ length: 12000 }, (_, i) => " ".repeat(i) + "- x").join("\n"));
  assert.ok(Date.now() - t < 3000, `${Date.now() - t}ms`);
  assert.match(md.renderDoc("## 제목 ##"), /<h2>제목<\/h2>/);
  assert.match(md.renderDoc("# C#"), /<h1>C#<\/h1>/);
});

test("글자 꾸밈 인라인 HTML: 검사된 값만 data-속성으로, 그 밖의 태그·속성은 글자로", () => {
  const out = md.inline('<span style="color:#c00; background-color: rgb(255,255,0); font-family: 바탕, serif; font-size:14pt">빨강</span> <u>밑줄</u> 줄<br>바꿈 \\*별\\*');
  assert.equal(out, '<span class="st" data-color="#cc0000" data-bg="#ffff00" data-font="바탕" data-size="14pt">빨강</span> <u>밑줄</u> 줄<br>바꿈 *별*');
  assert.equal(md.inline('<span style="color:#c00" onclick="x">a</span>'), "&lt;span style=&quot;color:#c00&quot; onclick=&quot;x&quot;&gt;a&lt;/span&gt;");
  assert.equal(md.inline('<span style="color:url(x);font-family:a;b">x</span>'), '<span class="st" data-font="a">x</span>'); // 틀린 값(color)만 버린다
  assert.equal(md.inline('<span style="color:url(x)">x</span>'), "x"); // 남는 값이 없으면 꾸밈 없이 글자만
  assert.equal(md.inline('<span style="background:expression(1)">x</span><img src=x onerror=alert(1)>'), "x&lt;img src=x onerror=alert(1)&gt;");
  assert.deepEqual(md.inlineRuns('<span style="color:#c00000">**굵**</span>'), [{ color: "#c00000", b: true, text: "굵" }]);
  assert.equal(md.parseStyle("font-size: 400pt; color: red"), null);
});
