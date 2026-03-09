export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, body, topic } = req.body;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  // ── Claude call (brief) ──────────────────────────────────────
  if (type === "claude") {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) return res.status(200).json({ debug: data.error });
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message, debug: "fetch failed" });
    }
  }

  // ── Claude news intelligence ─────────────────────────────────
  if (type === "news") {
    const newsSystem = `You are a senior market intelligence analyst specialising in syndicated loan operations, financial services technology, and AI automation in banking.

Generate 4 highly relevant market intelligence briefings for a panelist preparing for an AI in loan operations conference. These must reflect real trends, real companies, real regulatory developments, and real market dynamics as of early 2026.

Return ONLY a valid JSON object — no markdown, no backticks, no explanation:
{
  "pulse": "one sentence on the current market mood for this topic in financial services",
  "items": [
    {
      "headline": "realistic, specific news headline — reference real companies, regulations, or technologies",
      "source": "one of: Reuters | Financial Times | Bloomberg | American Banker | Finextra | Risk.net | PYMNTS | The Clearing House | Wall Street Journal",
      "description": "2 sentences: what is happening and why it matters specifically to loan operations teams",
      "relevance": "one phrase directly connecting this to AI in loan ops",
      "tag": "one of: AI & Automation | Market Movement | Regulation | Technology | Operations"
    }
  ]
}

Rules:
- Headlines must be specific — reference real vendors, regulators, banks, or technologies (e.g. LoanIQ, ACBS, SOFR, OCC, Fed, ISDA, Broadridge, ION Group, Finastra)
- No generic headlines like 'Banks explore AI' — be concrete and credible
- All 4 items must be directly relevant to the panel topic
- Reflect the market reality of Q1 2026`;

    const userPrompt = `Panel topic: "${topic}"
Date: ${new Date().toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" })}

Generate 4 market intelligence briefings that a panelist speaking on this topic would find genuinely useful and credible. Focus on: vendor moves, regulatory changes, bank implementations, market adoption stats, and operational challenges.`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: newsSystem,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      const data = await r.json();
      if (data.error) return res.status(500).json({ error: data.error.message });

      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("").trim();
      if (!text) return res.status(500).json({ error: "No response from Claude" });

      const clean = text.replace(/^```json\s*/,"").replace(/\s*```$/,"").trim();
      const parsed = JSON.parse(clean);

      return res.status(200).json({ articles: parsed.items, pulse: parsed.pulse });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid request type" });
}
