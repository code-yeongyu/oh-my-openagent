import { detectKeywordsWithType, removeCodeBlocks } from "./src/hooks/keyword-detector/detector.ts";

const testCases = [
  "帮我写一个todolist的web应用 ulo",
  "ulo do something",
  "ultrapower mode",
  "ultrawork test",
];

for (const text of testCases) {
  const result = detectKeywordsWithType(removeCodeBlocks(text));
  console.log(`Input: "${text}"`);
  console.log(`Result:`, result);
  console.log("---");
}
