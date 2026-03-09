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
      const akinUrl = "https://www.akingump.com/en/rss?type=1062568";

      // ── News sources ──────────────────────────────────────────

      const GDELT_Q = {
        "Notice Parsing & Document Abstraction": '("document abstraction" OR "notice parsing" OR "loan notice automation" OR "OCR loan") ("syndicated loan" OR "loan operations" OR "LoanIQ" OR "ACBS")',
        "Covenant Tracking & Monitoring": '("covenant monitoring" OR "covenant tracking" OR "covenant breach") ("syndicated loan" OR "credit agreement" OR "loan operations") AI',
        "Cash Application & Fee Validation": '("cash application" OR "interest validation" OR "fee reconciliation" OR "payment matching") ("syndicated loan" OR "loan operations" OR "loan accounting")',
        "Trade Break Analysis & Exception Mgmt": '("trade break" OR "settlement exception" OR "exception management" OR "predictive exception") ("syndicated loan" OR "loan operations" OR "trade settlement")',
        "AI Governance & Implementation": '("AI governance" OR "model risk management" OR "AI controls" OR "responsible AI") ("loan operations" OR "syndicated lending" OR "financial services workflow")',
        "Workflow Integration & Modernization": '("workflow automation" OR "STP" OR "straight-through processing" OR "loan workflow") ("LoanIQ" OR "ACBS" OR "WSO" OR "syndicated loan" OR "loan operations")',
      };

      const GOOGLE_Q = {
        "Notice Parsing & Document Abstraction": "syndicated loan notice parsing document abstraction automation 2025 OR 2026",
        "Covenant Tracking & Monitoring": "syndicated loan covenant monitoring automation AI 2025 OR 2026",
        "Cash Application & Fee Validation": "syndicated loan cash application interest fee validation automation 2025 OR 2026",
        "Trade Break Analysis & Exception Mgmt": "syndicated loan trade break exception management predictive AI 2025 OR 2026",
        "AI Governance & Implementation": "AI governance controls loan operations syndicated lending implementation 2025 OR 2026",
        "Workflow Integration & Modernization": "loan operations workflow automation STP LoanIQ ACBS modernization 2025 OR 2026",
      };

      const DOMAINS = [
        "reuters.com","ft.com","bloomberg.com","wsj.com",
        "americanbanker.com","finextra.com","pymnts.com",
        "risk.net","bankingtech.com","fintechfutures.com",
        "lsta.org","akingump.com"
      ];

      const rawQuery = GDELT_Q[topic] || '"AI financial services" OR "loan automation"';
      const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(rawQuery)}&mode=artlist&maxrecords=6&format=json&timespan=7d&sourcelang=english`;
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
      // Reuters and FT block server fetches; use feeds known to work from Vercel
      const RSS_FEEDS = [
        { url: "https://www.pymnts.com/feed/",                      source: "PYMNTS"   },
        { url: "https://fintechmagazine.com/rss",                   source: "Fintech Magazine" },
        { url: "https://www.bankingtech.com/feed/",                 source: "Banking Tech"     },
        { url: "https://www.fintechfutures.com/feed/",              source: "Fintech Futures"  },
      ];
      // Pick first two to stay within Vercel timeout
      const [feed1Url, feed2Url] = RSS_FEEDS.map(f => f.url);
      const [feed1Src, feed2Src] = RSS_FEEDS.map(f => f.source);

      const [gdeltRes, rss1Res, rss2Res, akinRes] = await Promise.allSettled([
        fetch(gdeltUrl).then(async r => {
          const text = await r.text();
          if (!text.trim().startsWith("{") && !text.trim().startsWith("["))
            throw new Error("GDELT non-JSON: " + text.slice(0, 120));
          return JSON.parse(text);
        }),
        fetch(feed1Url).then(r => r.text()),
        fetch(feed2Url).then(r => r.text()),
        fetch(akinUrl).then(r => r.text()),
      ]);

      if (gdeltRes.status === "fulfilled" && gdeltRes.value?.articles?.length) {
        articles.push(...gdeltRes.value.articles.slice(0, 3).map(a => ({
          headline: a.title, source: a.domain || "News",
          url: a.url, description: "", publishedAt: a.seendate,
        })));
      }
      if (rss1Res.status === "fulfilled" && articles.length < 4)
        articles.push(...parseRSS(rss1Res.value, feed1Src, 4 - articles.length));
      if (rss2Res.status === "fulfilled" && articles.length < 4)
        articles.push(...parseRSS(rss2Res.value, feed2Src, 4 - articles.length));
      if (akinRes.status === "fulfilled" && articles.length < 5)
        articles.push(...parseRSS(akinRes.value, "Akin", 1));

      articles = articles.filter((a, i, s) => a.url && s.findIndex(b => b.url === a.url) === i).slice(0, 5);
      if (!articles.length) {
        const gdeltErr = gdeltRes.status === "rejected" ? gdeltRes.reason?.message : (gdeltRes.value?.error || "no results");
        const r1Err = rss1Res.status === "rejected" ? rss1Res.reason?.message : "no results";
        const r2Err = rss2Res.status === "rejected" ? rss2Res.reason?.message : "no results";
        return res.status(500).json({ error: `No articles found. GDELT: ${gdeltErr} | ${feed1Src}: ${r1Err} | ${feed2Src}: ${r2Err}` });
      }

      const PANEL_CONTEXT = `CONFERENCE PANEL: "SMARTER OPERATIONS: HOW AI IS TRANSFORMING LOAN WORKFLOWS"

The panel is specifically about practical AI implementation in syndicated loan operations. Core topics:
- Parsing loan notices and abstracting structured data from documents
- Automated covenant monitoring and breach detection in credit agreements
- Cash application, interest/fee validation, and payment reconciliation
- Predictive exception management and trade break resolution
- Integration into existing systems: LoanIQ, ACBS, WSO, NELI
- AI governance, controls, and auditability in loan ops workflows
- Straight-through processing (STP) and modernization of manual loan processes

The audience is senior loan operations professionals at banks and asset managers.`;

      const prompt = `You are a conference prep analyst helping a panelist at a syndicated loan operations conference.

${PANEL_CONTEXT}

Today's panel sub-topic: "${topic}"

Below are news articles. For each one:
1. Write a focused 1-3 sentence summary connecting the article DIRECTLY to the panel sub-topic. Be specific — name the mechanism (e.g. "notice parsing", "covenant breach detection", "fee reconciliation"). Skip generic AI hype.
2. Write a tight relevance phrase (e.g. "Directly supports STP argument", "Validates exception mgmt ROI case").
3. Assign the most accurate tag.

If an article has only loose relevance, still summarize it but note the indirect connection honestly.

Articles:
${articles.map((a, i) => `${i + 1}. ${a.headline}\n${a.description || "(headline only)"}`).join("\n\n")}

Return ONLY a valid JSON array with exactly ${articles.length} objects — no markdown, no backticks:
[{"summary":"...","relevance":"...","tag":"AI & Automation | Market Movement | Regulation | Technology | Operations"}]`;

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
    } catch (topErr) {
      return res.status(500).json({ error: "News handler crashed: " + topErr.message });
    }
  }

  return res.status(400).json({ error: "Invalid request type" });
}
