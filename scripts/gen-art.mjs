// Generates Pioneer's photographic artwork with a Gemini image model.
// Usage: node --env-file=.env.local scripts/gen-art.mjs [name ...]
import { writeFileSync } from "node:fs";

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";
if (!KEY) {
  console.error("Set GEMINI_API_KEY to generate artwork.");
  process.exit(1);
}

const ART = {
  hero: {
    aspect: "16:9",
    prompt:
      "Hyper-realistic macro photograph. A slab of golden natural honeycomb fills the right two thirds of the frame, hexagonal wax cells glistening with thick amber honey, a few cells sealed with pale wax caps. Four honeybees crawl on the comb in sharp focus, every hair and wing vein visible. One single cell near the centre glows deep red from within like a warning light, and the bees nearest to it are turning away from it. The left third of the frame is clean, even, saturated honey-yellow (#f6cf1b) studio backdrop with nothing on it. Bright even studio lighting, crisp detail, shallow depth of field at the edges, no text, no logos, no watermark.",
  },
  comb: {
    aspect: "16:9",
    prompt:
      "Hyper-realistic top-down macro photograph of a flat sheet of natural honeycomb, perfectly regular hexagonal wax cells, most filled with glossy amber honey catching soft highlights, some sealed with pale wax caps, evenly lit, edge to edge, no bees, no text, no watermark.",
  },
  bee: {
    aspect: "1:1",
    prompt:
      "Hyper-realistic studio macro photograph of a single honeybee seen from directly above, wings spread, legs visible, every hair in sharp focus, centred, isolated on a pure white seamless background with a very soft shadow, no text, no watermark.",
  },
  stop: {
    aspect: "16:9",
    prompt:
      "Hyper-realistic macro photograph inside a beehive: one honeybee pressing its head against another bee that is mid waggle dance on the honeycomb, the stop signal, surrounded by a ring of attentive worker bees, warm amber honey light, glistening comb, cinematic shallow depth of field, no text, no watermark.",
  },
};

async function generate(name) {
  const art = ART[name];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: art.prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: art.aspect } },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${name}: ${json?.error?.message ?? res.status}`);
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error(`${name}: the model returned no image`);
  const ext = part.inlineData.mimeType?.includes("png") ? "png" : "jpg";
  const file = `public/art/${name}.${ext}`;
  writeFileSync(file, Buffer.from(part.inlineData.data, "base64"));
  return file;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ART);
const results = await Promise.allSettled(names.map(generate));
results.forEach((r, i) => console.log(r.status === "fulfilled" ? `ok   ${r.value}` : `fail ${names[i]}: ${String(r.reason?.message ?? r.reason).slice(0, 200)}`));
