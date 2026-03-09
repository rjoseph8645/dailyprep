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

  // ── NewsAPI call ─────────────────────────────────────────────
  if (type === "news") {
    const newsKey = process.env.NEWS_API_KEY;
    if (!newsKey) return res.status(500).json({ error: "NEWS_API_KEY not set" });

    const QUERIES = {
      "Notice Parsing & Document Abstraction":
        "loan document automation OR OCR financial services OR document abstraction fintech",
      "Covenant Tracking & Monitoring":
        "covenant monitoring automation OR loan compliance AI OR credit agreement tracking",
      "Cash Application & Fee Validation":
        "payment automation financial services OR loan reconciliation OR fee validation fintech",
      "Trade Break Analysis & Exception Mgmt":
        "trade settlement automation OR syndicated loan exception OR trade break fintech",
      "AI Governance & Implementation":
        "AI governance financial services OR responsible AI banking OR AI controls fintech",
      "Workflow Integration & Modernization":
        "loan operations automation OR LoanIQ OR syndicated loan technology OR fintech workflow",
    };

    const q = QUERIES[topic] || "AI financial services OR loan operations automation OR fintech";
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=6&language=en&apiKey=${newsKey}`;

    try {
      const r = await fetch(url);
      const data = await r.json();
      if (data.status !== "ok") return res.status(500).json({ error: data.message });
      const articles = (data.articles || [])
        .filter(a => a.title && a.url && !a.title.includes("[Removed]"))
        .slice(0, 4)
        .map(a => ({
          headline: a.title,
          source: a.source?.name || "Unknown",
          url: a.url,
          description: a.description || "",
          publishedAt: a.publishedAt,
        }));
      return res.status(200).json({ articles });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid request type" });
}
