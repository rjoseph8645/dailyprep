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
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Claude with web search (news) ────────────────────────────
  if (type === "news") {
    const QUERIES = {
      "Notice Parsing & Document Abstraction":
        "Search for the latest news articles about document automation, loan notice processing, OCR in financial services, or document abstraction in fintech. Find real articles from Reuters, FT, Bloomberg, Finextra, American Banker, or similar financial publications published in the last 7 days.",
      "Covenant Tracking & Monitoring":
        "Search for the latest news articles about loan covenant monitoring, credit compliance automation, covenant breach detection, or AI in credit agreement management. Find real articles from Reuters, FT, Bloomberg, Risk.net, or American Banker published in the last 7 days.",
      "Cash Application & Fee Validation":
        "Search for the latest news articles about payment automation in banking, loan fee reconciliation, cash application technology, or interest payment processing in financial services. Find real articles from Reuters, FT, Bloomberg, Finextra, or PYMNTS published in the last 7 days.",
      "Trade Break Analysis & Exception Mgmt":
        "Search for the latest news articles about trade settlement automation, syndicated loan operations, trade break resolution, or exception management in financial services. Find real articles from Reuters, FT, Bloomberg, Risk.net, or The Clearing House published in the last 7 days.",
      "AI Governance & Implementation":
        "Search for the latest news articles about AI governance in banking, responsible AI in financial services, AI regulation for banks, or AI implementation controls in fintech. Find real articles from Reuters, FT, Bloomberg, American Banker, or Risk.net published in the last 7 days.",
      "Workflow Integration & Modernization":
        "Search for the latest news articles about loan operations modernization, banking workflow automation, LoanIQ or loan management system upgrades, or fintech integration in syndicated lending. Find real articles from Reuters, FT, Bloomberg, Finextra, or American Banker published in the last 7 days.",
    };

    const searchPrompt = QUERIES[topic] || "Search for the latest news about AI in financial services and loan operations automation from the last 7 days.";

    const newsSystemPrompt = `You are a financial services news researcher. Use web search to find real, current news articles relevant to the topic provided.

After searching, return ONLY a valid JSON object — no markdown, no explanation, no backticks:
{
  "pulse": "one sentence summary of the current market mood on this topic",
  "items": [
    {
      "headline": "exact article headline",
      "source": "publication name",
      "url": "full article URL",
      "description": "2 sentence summary of what the article covers and why it matters to loan ops",
      "publishedAt": "publication date if available",
      "relevance": "one phrase connecting this to AI in loan operations",
      "tag": "one of: AI & Automation | Market Movement | Regulation | Technology | Operations"
    }
  ]
}

Rules:
- Only include articles you actually found via web search
- URLs must be real and from the actual search results
- Return 3-4 items maximum
- If you cannot find enough relevant articles, return fewer items rather than fabricating any`;

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
          max_tokens: 2000,
          system: newsSystemPrompt,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: searchPrompt }],
        }),
      });

      const data = await r.json();
      if (data.error) return res.status(500).json({ error: data.error.message });

      // Extract the final text block after web search tool use
      const textBlock = data.content?.filter(b => b.type === "text").map(b => b.text).join("").trim();
      if (!textBlock) return res.status(500).json({ error: "No response from Claude" });

      const clean = textBlock.replace(/^```json\s*/,"").replace(/\s*```$/,"").trim();
      const parsed = JSON.parse(clean);

      return res.status(200).json({ articles: parsed.items, pulse: parsed.pulse });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid request type" });
}
