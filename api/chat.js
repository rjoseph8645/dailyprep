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

  // ── Currents API call ────────────────────────────────────────
  if (type === "news") {
    const currentsKey = process.env.CURRENTS_API_KEY;
    if (!currentsKey) return res.status(500).json({ error: "CURRENTS_API_KEY not set" });

    const QUERIES = {
      "Notice Parsing & Document Abstraction":
        "document automation loan processing fintech",
      "Covenant Tracking & Monitoring":
        "loan covenant compliance automation financial",
      "Cash Application & Fee Validation":
        "payment automation reconciliation fintech banking",
      "Trade Break Analysis & Exception Mgmt":
        "trade settlement syndicated loan exception management",
      "AI Governance & Implementation":
        "AI governance banking regulation artificial intelligence financial services",
      "Workflow Integration & Modernization":
        "loan operations automation fintech banking workflow",
    };

    const q = encodeURIComponent(QUERIES[topic] || "AI financial services loan automation fintech");

    // Target only relevant financial/fintech domains
    const domains = [
      "reuters.com","ft.com","bloomberg.com","wsj.com",
      "finextra.com","pymnts.com","americanbanker.com",
      "risk.net","bankingtech.com","fintechfutures.com",
      "theclearinghouse.org","lsta.org"
    ].join(",");

    const url = `https://api.currentsapi.services/v1/search?keywords=${q}&domains=${encodeURIComponent(domains)}&language=en&page_size=6&apiKey=${currentsKey}`;

    try {
      const r = await fetch(url);
      const data = await r.json();

      if (data.status !== "ok") {
        // Fallback: retry without domain restriction if no results
        const fallbackUrl = `https://api.currentsapi.services/v1/search?keywords=${q}&language=en&page_size=6&apiKey=${currentsKey}`;
        const r2 = await fetch(fallbackUrl);
        const data2 = await r2.json();

        if (data2.status !== "ok" || !data2.news?.length) {
          return res.status(500).json({ error: "No relevant articles found: " + (data2.message || data.message) });
        }

        const articles = data2.news.slice(0, 4).map(a => ({
          headline: a.title,
          source: a.author || new URL(a.url).hostname.replace("www.",""),
          url: a.url,
          description: a.description || "",
          publishedAt: a.published,
        }));
        return res.status(200).json({ articles });
      }

      const articles = (data.news || []).slice(0, 4).map(a => ({
        headline: a.title,
        source: a.author || new URL(a.url).hostname.replace("www.",""),
        url: a.url,
        description: a.description || "",
        publishedAt: a.published,
      }));

      return res.status(200).json({ articles });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid request type" });
}
