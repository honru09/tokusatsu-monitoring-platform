export function splitPublishingText(value) {
  const lines=String(value).replace(/^\uFEFF/," ").replace(/\r\n?/g,"\n").split("\n");
  return {title:(lines.shift()??"").trim(),body:lines.join("\n").trim()};
}
