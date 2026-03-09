export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, body, topic } = req.body;

  // ── Claude call ──────────────────────────────────────────────
  if (type === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
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

  // ── Guardian News call ───────────────────────────────────────
  if (type === "news") {
    const guardianKey = process.env.GUARDIAN_API_KEY;
    if (!guardianKey) return res.status(500).json({ error: "GUARDIAN_API_KEY not set in environment variables" });

    const QUERIES = {
      "Notice Parsing & Document Abstraction":
        "document automation OR loan processing OR OCR fintech",
      "Covenant Tracking & Monitoring":
        "loan covenant OR credit compliance OR financial monitoring automation",
      "Cash Application & Fee Validation":
        "payment automation OR loan reconciliation OR fintech payments",
      "Trade Break Analysis & Exception Mgmt":
        "trade settlement OR syndicated loan OR financial exception management",
      "AI Governance & Implementation":
        "AI governance OR responsible AI OR artificial intelligence banking regulation",
      "Workflow Integration & Modernization":
        "loan operations technology OR fintech automation OR banking workflow",
    };

    const q = QUERIES[topic] || "AI financial services OR loan automation OR fintech";

    const url = `https://content.guardianapis.com/search?q=${encodeURIComponent(q)}&section=business|technology&order-by=newest&page-size=6&show-fields=headline,trailText,shortUrl&api-key=${guardianKey}`;

    try {
      const r = await fetch(url);
      const data = await r.json();

      if (data.response?.status !== "ok") {
        return res.status(500).json({ error: "Guardian API error: " + JSON.stringify(data.response || data) });
      }

      const articles = (data.response?.results || [])
        .filter(a => a.fields?.headline || a.webTitle)
        .slice(0, 4)
        .map(a => ({
          headline: a.fields?.headline || a.webTitle,
          source: "The Guardian",
          url: a.fields?.shortUrl || a.webUrl,
          description: a.fields?.trailText || "",
          publishedAt: a.webPublicationDate,
        }));

      return res.status(200).json({ articles });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid request type" });
}
