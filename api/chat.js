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

  // ── Multi-source news (GDELT + Google News + Akin RSS) ───────
  if (type === "news") {
    const TOPIC_QUERIES = {
      "Notice Parsing & Document Abstraction":
        '"document automation" OR "loan processing" OR "OCR" OR "document abstraction" fintech',
      "Covenant Tracking & Monitoring":
        '"covenant monitoring" OR "loan compliance" OR "credit agreement" AI banking',
      "Cash Application & Fee Validation":
        '"payment automation" OR "loan reconciliation" OR "fee validation" banking fintech',
      "Trade Break Analysis & Exception Mgmt":
        '"trade settlement" OR "syndicated loan" OR "trade break" OR "exception management" finance',
      "AI Governance & Implementation":
        '"AI governance" OR "responsible AI" OR "AI regulation" banking "financial services"',
      "Workflow Integration & Modernization":
        '"loan operations" OR "workflow automation" OR "LoanIQ" OR "fintech integration" banking',
    };

    const GOOGLE_QUERIES = {
      "Notice Parsing & Document Abstraction": "loan document automation OCR fintech banking",
      "Covenant Tracking & Monitoring": "loan covenant monitoring AI compliance banking",
      "Cash Application & Fee Validation": "payment automation reconciliation fintech banking",
      "Trade Break Analysis & Exception Mgmt": "trade settlement syndicated loan automation fintech",
      "AI Governance & Implementation": "AI governance banking regulation financial services 2026",
      "Workflow Integration & Modernization": "loan operations automation fintech banking workflow",
    };

    // Target domains for GDELT
    const DOMAINS = [
      "reuters.com", "ft.com", "bloomberg.com", "wsj.com",
      "americanbanker.com", "finextra.com", "pymnts.com",
      "risk.net", "bankingtech.com", "fintechfutures.com",
      "lsta.org", "akingump.com"
    ];

    const gdeltQuery = encodeURIComponent(TOPIC_QUERIES[topic] || '"AI financial services" OR "loan automation"');
    const domainFilter = DOMAINS.map(d => `domainis:${d}`).join(" OR ");
    const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${gdeltQuery} (${encodeURIComponent(domainFilter)})&mode=artlist&maxrecords=6&format=json&timespan=7d&sourcelang=english`;

    const googleQuery = encodeURIComponent(GOOGLE_QUERIES[topic] || "AI financial services loan automation");
    const googleUrl = `https://news.google.com/rss/search?q=${googleQuery}&hl=en-US&gl=US&ceid=US:en`;

    const akinUrl = `https://www.akingump.com/en/rss?type=1062568`; // Finance & restructuring feed

    let articles = [];

    // Helper: parse Google RSS
    function parseGoogleRSS(xml) {
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRegex.exec(xml)) !== null && items.length < 3) {
        const i = m[1];
        const title  = (/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(i)?.[1] || /<title>([\s\S]*?)<\/title>/.exec(i)?.[1] || "").trim();
        const link   = (/<link>([\s\S]*?)<\/link>/.exec(i)?.[1] || "").trim();
        const pubDate= (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(i)?.[1] || "").trim();
        const source = (/<source[^>]*>([\s\S]*?)<\/source>/.exec(i)?.[1] || "Google News").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
        const desc   = (/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(i)?.[1] || "").replace(/<[^>]+>/g,"").trim().slice(0,200);
        if (title && link) items.push({ headline: title, source, url: link, description: desc, publishedAt: pubDate });
      }
      return items;
    }

    // Helper: parse Akin RSS
    function parseAkinRSS(xml) {
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRegex.exec(xml)) !== null && items.length < 2) {
        const i = m[1];
        const title  = (/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(i)?.[1] || /<title>([\s\S]*?)<\/title>/.exec(i)?.[1] || "").trim();
        const link   = (/<link>([\s\S]*?)<\/link>/.exec(i)?.[1] || "").trim();
        const pubDate= (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(i)?.[1] || "").trim();
        const desc   = (/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(i)?.[1] || "").replace(/<[^>]+>/g,"").trim().slice(0,200);
        if (title && link) items.push({ headline: title, source: "Akin", url: link, description: desc, publishedAt: pubDate });
      }
      return items;
    }

    // Fetch all sources in parallel
    const [gdeltRes, googleRes, akinRes] = await Promise.allSettled([
      fetch(gdeltUrl).then(r => r.json()),
      fetch(googleUrl).then(r => r.text()),
      fetch(akinUrl).then(r => r.text()),
    ]);

    // GDELT articles
    if (gdeltRes.status === "fulfilled" && gdeltRes.value?.articles?.length) {
      const gdeltArticles = gdeltRes.value.articles.slice(0, 4).map(a => ({
        headline: a.title,
        source: a.domain || "News",
        url: a.url,
        description: "",
        publishedAt: a.seendate,
      }));
      articles.push(...gdeltArticles);
    }

    // Google News RSS fallback/supplement
    if (googleRes.status === "fulfilled" && articles.length < 4) {
      const googleArticles = parseGoogleRSS(googleRes.value);
      articles.push(...googleArticles.slice(0, 4 - articles.length));
    }

    // Akin supplement
    if (akinRes.status === "fulfilled" && articles.length < 5) {
      const akinArticles = parseAkinRSS(akinRes.value);
      articles.push(...akinArticles.slice(0, 1));
    }

    // Deduplicate by URL
    articles = articles.filter((a, i, self) => a.url && self.findIndex(b => b.url === a.url) === i).slice(0, 5);

    if (!articles.length) return res.status(500).json({ error: "No articles found from any source" });

    // Annotate with Claude
    const annotatePrompt = `You are a loan operations analyst preparing a panelist for an AI in loan operations conference.

Topic: "${topic}"

Articles:
${articles.map((a, i) => `${i + 1}. ${a.headline}\n${a.description || "(no description)"}`).join("\n\n")}

Return ONLY a valid JSON array with exactly ${articles.length} objects in the same order — no markdown, no backticks:
[{
  "summary": "A clear, succinct summary of the article. Let the content determine the length — could be one sentence or a short paragraph. No filler words. No repetition. Just what the article says and why it matters to loan operations.",
  "relevance": "one short phrase connecting this to the panel topic",
  "tag": "one of: AI & Automation | Market Movement | Regulation | Technology | Operations"
}]`;

    try {
      const cr = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          messages: [{ role: "user", content: annotatePrompt }],
        }),
      });

      const cd = await cr.json();
      const ctext = cd.content?.filter(b => b.type === "text").map(b => b.text).join("").trim();
      const annotations = JSON.parse(ctext.replace(/^```json\s*/,"").replace(/\s*```$/,"").trim());

      const annotated = articles.map((a, i) => ({
        ...a,
        summary: annotations[i]?.summary || a.description || "",
        relevance: annotations[i]?.relevance || "Relevant to loan ops automation",
        tag: annotations[i]?.tag || "Technology",
      }));

      return res.status(200).json({ articles: annotated, pulse: null });
    } catch {
      // Return unannotated if Claude annotation fails
      return res.status(200).json({
        articles: articles.map(a => ({ ...a, relevance: "Relevant to loan ops", tag: "Technology" })),
        pulse: null
      });
    }
  }

  return res.status(400).json({ error: "Invalid request type" });
}
