export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const { type, body, topic } = req.body || {};

  // ── Claude brief ─────────────────────────────────────────────
  if (type === "claude") {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          } catch (topErr) {
      return res.status(500).json({ error: "News handler crashed: " + topErr.message });
    }
  },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: "Claude call failed: " + err.message });
    }
  }

  // ── News: GDELT + Google News + Akin ─────────────────────────
  if (type === "news") {
    try {
    const PANEL = `Panel: "SMARTER OPERATIONS: HOW AI IS TRANSFORMING LOAN WORKFLOWS"
Themes: loan notice parsing, covenant tracking, cash application, exception management, document abstraction, interest and fee validation, trade break analysis, workflow integration, governance, LoanIQ, ACBS, WSO, NELI, STP.`;

    const GDELT_Q = {
      "Notice Parsing & Document Abstraction": '"document automation" OR "loan notice" OR "OCR" fintech banking',
      "Covenant Tracking & Monitoring": '"covenant monitoring" OR "loan compliance" OR "credit agreement" AI banking',
      "Cash Application & Fee Validation": '"cash application" OR "payment automation" OR "fee validation" OR "loan reconciliation" banking',
      "Trade Break Analysis & Exception Mgmt": '"trade break" OR "trade settlement" OR "syndicated loan" OR "exception management" finance',
      "AI Governance & Implementation": '"AI governance" OR "responsible AI" OR "model risk" banking "financial services"',
      "Workflow Integration & Modernization": '"loan operations" OR "workflow automation" OR "LoanIQ" OR "STP" banking',
    };

    const GOOGLE_Q = {
      "Notice Parsing & Document Abstraction": "loan document automation notice parsing OCR fintech 2026",
      "Covenant Tracking & Monitoring": "loan covenant monitoring automation AI banking 2026",
      "Cash Application & Fee Validation": "cash application fee validation loan banking automation 2026",
      "Trade Break Analysis & Exception Mgmt": "trade break settlement syndicated loan exception fintech 2026",
      "AI Governance & Implementation": "AI governance model risk banking financial services 2026",
      "Workflow Integration & Modernization": "loan operations STP workflow automation fintech banking 2026",
    };

    const DOMAINS = [
      "reuters.com","ft.com","bloomberg.com","wsj.com",
      "americanbanker.com","finextra.com","pymnts.com",
      "risk.net","bankingtech.com","fintechfutures.com",
      "lsta.org","akingump.com"
    ];

    const gq = encodeURIComponent(GDELT_Q[topic] || '"AI financial services" OR "loan automation"');
    const df = DOMAINS.map(d => `domainis:${d}`).join(" OR ");
    const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${gq} (${encodeURIComponent(df)})&mode=artlist&maxrecords=6&format=json&timespan=7d&sourcelang=english`;
    const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(GOOGLE_Q[topic] || "AI loan operations fintech")}&hl=en-US&gl=US&ceid=US:en`;
    const akinUrl = "https://www.akingump.com/en/rss?type=1062568";

    function parseRSS(xml, source, max) {
      const items = [];
      const re = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = re.exec(xml)) !== null && items.length < max) {
        const x = m[1];
        const title = (/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(x)?.[1] || /<title>([\s\S]*?)<\/title>/.exec(x)?.[1] || "").trim();
        const link  = (/<link>([\s\S]*?)<\/link>/.exec(x)?.[1] || "").trim();
        const pub   = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(x)?.[1] || "").trim();
        const src   = source || (/<source[^>]*>([\s\S]*?)<\/source>/.exec(x)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g,"").trim() || "News";
        const desc  = (/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(x)?.[1] || "").replace(/<[^>]+>/g,"").trim().slice(0,300);
        if (title && link) items.push({ headline: title, source: src, url: link, description: desc, publishedAt: pub });
      }
      return items;
    }

    let articles = [];
    const [gdeltRes, googleRes, akinRes] = await Promise.allSettled([
      fetch(gdeltUrl).then(r => r.json()),
      fetch(googleUrl).then(r => r.text()),
      fetch(akinUrl).then(r => r.text()),
    ]);

    if (gdeltRes.status === "fulfilled" && gdeltRes.value?.articles?.length) {
      articles.push(...gdeltRes.value.articles.slice(0, 4).map(a => ({
        headline: a.title, source: a.domain || "News",
        url: a.url, description: "", publishedAt: a.seendate,
      })));
    }
    if (googleRes.status === "fulfilled" && articles.length < 4) {
      articles.push(...parseRSS(googleRes.value, null, 4 - articles.length));
    }
    if (akinRes.status === "fulfilled" && articles.length < 5) {
      articles.push(...parseRSS(akinRes.value, "Akin", 1));
    }

    articles = articles.filter((a, i, s) => a.url && s.findIndex(b => b.url === a.url) === i).slice(0, 5);
    if (!articles.length) {
      const gdeltErr = gdeltRes.status === "rejected" ? gdeltRes.reason?.message : (gdeltRes.value?.error || "no results");
      const googleErr = googleRes.status === "rejected" ? googleRes.reason?.message : "no results";
      return res.status(500).json({ error: `No articles found. GDELT: ${gdeltErr} | Google: ${googleErr}` });
    }

    const prompt = `You are a loan operations analyst preparing a panelist for a conference.

${PANEL}

Today's focus: "${topic}"

For each article, write a clear succinct summary that connects the article to the panel themes. Let the content determine the length — one sentence to a short paragraph. No filler. No repetition.

Articles:
${articles.map((a, i) => `${i + 1}. ${a.headline}\n${a.description || "(headline only)"}`).join("\n\n")}

Return ONLY a valid JSON array with exactly ${articles.length} objects — no markdown, no backticks:
[{"summary":"...","relevance":"one short phrase","tag":"AI & Automation | Market Movement | Regulation | Technology | Operations"}]`;

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
          max_tokens: 800,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const cd = await cr.json();
      const ct = cd.content?.filter(b => b.type === "text").map(b => b.text).join("").trim();
      const ann = JSON.parse(ct.replace(/^```json\s*/,"").replace(/\s*```$/,"").trim());
      return res.status(200).json({
        articles: articles.map((a, i) => ({
          ...a,
          summary: ann[i]?.summary || a.description || "",
          relevance: ann[i]?.relevance || "Relevant to loan ops",
          tag: ann[i]?.tag || "Technology",
        })),
        pulse: null,
      });
    } catch (err) {
      return res.status(200).json({
        articles: articles.map(a => ({ ...a, summary: a.description || "", relevance: "Relevant to loan ops", tag: "Technology" })),
        pulse: null,
      });
    }
  }

  return res.status(400).json({ error: "Invalid request type" });
}
