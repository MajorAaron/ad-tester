const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
const GEMINI_IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`;

const TONE_INSTRUCTIONS = {
  professional: {
    copy: "Use a polished, authoritative, corporate tone. Avoid slang. Write like a premium brand — confident and trustworthy.",
    image: "Clean, corporate design. Use navy, white, and subtle gold accents. Minimalist layout with professional photography. Serif or refined sans-serif typography.",
  },
  playful: {
    copy: "Use a fun, energetic, conversational tone. Light humor is welcome. Write like a cool friend recommending something awesome.",
    image: "Bright, vibrant colors (coral, teal, yellow). Rounded shapes, playful illustrations or lifestyle photos. Friendly, approachable sans-serif fonts.",
  },
  bold: {
    copy: "Use a punchy, high-energy, confrontational tone. Short sentences. Strong verbs. Write like a challenger brand that demands attention.",
    image: "High contrast design. Black backgrounds with neon or electric accents (red, orange, electric blue). Bold uppercase typography. Dynamic angles and strong visual impact.",
  },
  minimal: {
    copy: "Use a calm, understated, elegant tone. Less is more. Write like a luxury brand — let the product speak for itself.",
    image: "Lots of white space. Muted color palette (off-white, light gray, soft beige). Thin, elegant typography. Single focal point. No visual clutter.",
  },
};

async function scrapeUrl(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AdTester/1.0)" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
  const html = await res.text();

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)?.[1]?.trim() ||
    html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i)?.[1]?.trim() ||
    "";
  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([\s\S]*?)["']/i)?.[1]?.trim() || "";
  const ogDesc =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["']/i)?.[1]?.trim() || "";
  const ogImage =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([\s\S]*?)["']/i)?.[1]?.trim() || "";

  const headings = [];
  const hRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let match;
  while ((match = hRegex.exec(html)) !== null && headings.length < 10) {
    const clean = match[1].replace(/<[^>]+>/g, "").trim();
    if (clean) headings.push(clean);
  }

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);

  return { url, title: ogTitle || title, description: ogDesc || metaDesc, image: ogImage, headings, bodyExcerpt: body };
}

async function callGeminiText(prompt) {
  const res = await fetch(GEMINI_TEXT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini text API error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini text response");
  return JSON.parse(text);
}

async function generateImage(imagePrompt) {
  try {
    console.log("[IMAGE] Starting generation...");
    const res = await fetch(GEMINI_IMAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "2K",
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[IMAGE] API error ${res.status}: ${errText.slice(0, 500)}`);
      return null;
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    console.log(`[IMAGE] Got ${parts.length} parts: ${parts.map(p => p.inlineData ? 'IMAGE' : 'TEXT').join(', ')}`);

    for (const part of parts) {
      if (part.inlineData) {
        const b64 = part.inlineData.data;
        console.log(`[IMAGE] Success - ${part.inlineData.mimeType}, ${b64.length} chars base64`);
        return `data:${part.inlineData.mimeType};base64,${b64}`;
      }
    }

    console.error("[IMAGE] No inlineData found in parts:", JSON.stringify(parts.map(p => Object.keys(p))));
    return null;
  } catch (err) {
    console.error("[IMAGE] Exception:", err.message);
    return null;
  }
}

function buildImagePrompt(ad, productContext, tone) {
  const toneDirective = tone && TONE_INSTRUCTIONS[tone]
    ? `\nVisual style directive: ${TONE_INSTRUCTIONS[tone].image}`
    : "";

  return `Create a complete, ready-to-post Facebook/Instagram ad creative image for: ${productContext}

The image MUST include this text rendered directly on the image in a professional ad layout:

HEADLINE TEXT (large, bold, prominent): "${ad.headline}"
SUBTEXT (smaller, below or near headline): "${ad.description}"
CTA BUTTON (styled as a button at the bottom): "${ad.cta}"

Design requirements:
- Professional ad creative layout like a real Facebook/Meta ad
- High-quality product photography or lifestyle imagery as background
- Text is rendered as part of the image with strong typography
- Use elegant serif or bold sans-serif fonts for the headline
- CTA should look like a clickable button (rounded rectangle with text)
- Dark or blurred background areas behind text for readability
- Premium, polished, scroll-stopping design
- Square format (1:1 aspect ratio)${toneDirective}`;
}

function buildPromptFromIdea(idea, tone) {
  const toneDirective = tone && TONE_INSTRUCTIONS[tone]
    ? `\nTONE/STYLE: ${TONE_INSTRUCTIONS[tone].copy}\n`
    : "";

  return `You are an expert Meta/Facebook Ads copywriter. Generate exactly 5 ad variants for the following business idea.

BUSINESS IDEA: ${idea}
${toneDirective}
Each variant must use a DIFFERENT psychological angle:
1. PROBLEM_AGITATE — Lead with the pain point, make it visceral
2. SOLUTION_BENEFIT — Lead with the transformation / positive outcome
3. CURIOSITY — Provocative or unexpected hook that stops the scroll
4. SOCIAL_PROOF — Lead with authority, numbers, or testimonials ("Join 10,000+ who..." / "Trusted by...")
5. URGENCY — Create scarcity or time pressure ("Limited spots..." / "Only available until...")

For each variant, provide:
- "angle": The psychological angle name (exactly one of: PROBLEM_AGITATE, SOLUTION_BENEFIT, CURIOSITY, SOCIAL_PROOF, URGENCY)
- "headline": Max 40 characters. Punchy, benefit-driven.
- "primary_text": The main ad body copy, 2-3 sentences. Conversational, direct. Include a clear value prop.
- "description": One-liner shown below the headline. Max 30 characters.
- "cta": One of: "Learn More", "Sign Up", "Get Offer", "Shop Now", "Download"
- "target_audience": A short description of who this ad targets

Return a JSON object with this exact structure:
{
  "ads": [
    {
      "angle": "...",
      "headline": "...",
      "primary_text": "...",
      "description": "...",
      "cta": "...",
      "target_audience": "..."
    }
  ]
}`;
}

function buildPromptFromScrape(scraped, tone) {
  const toneDirective = tone && TONE_INSTRUCTIONS[tone]
    ? `\nTONE/STYLE: ${TONE_INSTRUCTIONS[tone].copy}\n`
    : "";

  return `You are an expert Meta/Facebook Ads copywriter. I've scraped a website and need you to generate 5 ad variants that would effectively advertise this product/service.

SCRAPED WEBSITE DATA:
- URL: ${scraped.url}
- Title: ${scraped.title}
- Description: ${scraped.description}
- Key Headings: ${scraped.headings.join(" | ")}
- Page Content Excerpt: ${scraped.bodyExcerpt.slice(0, 1500)}
${toneDirective}
Analyze what this product/service does, who it's for, and what problems it solves. Then generate 5 ad variants.

Each variant must use a DIFFERENT psychological angle:
1. PROBLEM_AGITATE — Lead with the pain point, make it visceral
2. SOLUTION_BENEFIT — Lead with the transformation / positive outcome
3. CURIOSITY — Provocative or unexpected hook that stops the scroll
4. SOCIAL_PROOF — Lead with authority, numbers, or testimonials ("Join 10,000+ who..." / "Trusted by...")
5. URGENCY — Create scarcity or time pressure ("Limited spots..." / "Only available until...")

For each variant, provide:
- "angle": The psychological angle name (exactly one of: PROBLEM_AGITATE, SOLUTION_BENEFIT, CURIOSITY, SOCIAL_PROOF, URGENCY)
- "headline": Max 40 characters. Punchy, benefit-driven.
- "primary_text": The main ad body copy, 2-3 sentences. Conversational, direct. Include a clear value prop.
- "description": One-liner shown below the headline. Max 30 characters.
- "cta": One of: "Learn More", "Sign Up", "Get Offer", "Shop Now", "Download"
- "target_audience": A short description of who this ad targets
- "product_summary": A one-sentence summary of what you understood from the page

Return a JSON object with this exact structure:
{
  "product_summary": "...",
  "ads": [
    {
      "angle": "...",
      "headline": "...",
      "primary_text": "...",
      "description": "...",
      "cta": "...",
      "target_audience": "..."
    }
  ]
}`;
}

function buildScorePrompt(ads) {
  const adSummaries = ads.map((ad, i) =>
    `Ad ${i + 1} (${ad.angle}):\n  Headline: ${ad.headline}\n  Primary Text: ${ad.primary_text}\n  Description: ${ad.description}\n  CTA: ${ad.cta}`
  ).join("\n\n");

  return `You are an expert ad quality analyst. Score each of the following Meta/Facebook ads on a scale of 1-10 for each criterion.

${adSummaries}

For EACH ad, score these criteria (1-10):
- "hook_strength": How well does the opening grab attention?
- "clarity": Is the value proposition immediately clear?
- "emotional_impact": Does it trigger an emotional response?
- "cta_effectiveness": Is the call-to-action compelling and well-matched?

Also provide:
- "overall": A weighted overall score (1-10)
- "tip": One specific, actionable sentence to improve this ad

Return a JSON object:
{
  "scores": [
    {
      "hook_strength": 8,
      "clarity": 7,
      "emotional_impact": 6,
      "cta_effectiveness": 9,
      "overall": 7,
      "tip": "..."
    }
  ]
}`;
}

async function scoreAds(ads) {
  try {
    console.log("[SCORE] Starting ad scoring...");
    const result = await callGeminiText(buildScorePrompt(ads));
    console.log(`[SCORE] Got scores for ${result.scores?.length} ads`);
    return result.scores || [];
  } catch (err) {
    console.error("[SCORE] Scoring failed:", err.message);
    return [];
  }
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };
  }

  try {
    const { idea, url, tone } = JSON.parse(event.body || "{}");

    if (!idea && !url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Provide either 'idea' or 'url'" }),
      };
    }

    let prompt;
    let scraped = null;

    if (url) {
      scraped = await scrapeUrl(url);
      prompt = buildPromptFromScrape(scraped, tone);
    } else {
      prompt = buildPromptFromIdea(idea, tone);
    }

    // Step 1: Generate ad copy
    console.log("[COPY] Generating ad copy...");
    const result = await callGeminiText(prompt);
    console.log(`[COPY] Got ${result.ads?.length} ads`);
    const productContext = idea || `${scraped.title} - ${scraped.description}`;

    // Step 2: Generate images + scores in parallel
    console.log("[IMAGES] Starting parallel image generation...");
    const imagePromises = (result.ads || []).map((ad, i) => {
      console.log(`[IMAGES] Queuing image ${i + 1} for angle: ${ad.angle}`);
      return generateImage(buildImagePrompt(ad, productContext, tone));
    });

    const scorePromise = scoreAds(result.ads || []);

    const [images, scores] = await Promise.all([
      Promise.all(imagePromises),
      scorePromise,
    ]);
    console.log(`[IMAGES] Done. Results: ${images.map(img => img ? 'OK' : 'NULL').join(', ')}`);

    // Attach images and scores to ads
    result.ads.forEach((ad, i) => {
      ad.image = images[i] || null;
      ad.score = scores[i] || null;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        source: url ? "url" : "idea",
        input: url || idea,
        tone: tone || null,
        scraped: scraped ? { title: scraped.title, description: scraped.description, image: scraped.image } : null,
        ...result,
      }),
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
