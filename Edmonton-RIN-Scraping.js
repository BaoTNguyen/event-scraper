const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const url = "https://www.edmontonrin.ca/events";

  console.log(`Navigating to ${url} ...`);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // today at midnight for filtering future events
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  // --------- V1 PART: scrape listing page ----------
  const events = await page.$$eval(
    "a",
    (links, todayTime) => {
      const hasTimePattern = (str) =>
        /\d{1,2}:\d{2}\s?(AM|PM)/i.test(str || "");

      const viewLinks = links.filter((a) =>
        (a.innerText || "").toLowerCase().includes("view event")
      );

      return viewLinks
        .map((viewLink) => {
          const card =
            viewLink.closest("article") ||
            viewLink.closest("div") ||
            viewLink.parentElement;

          if (!card) return null;

          const lines = (card.innerText || "")
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);

          if (lines.length === 0) return null;

          // ----- DATE LINE -----
          const dateLine =
            lines.find((l) =>
              /(January|February|March|April|May|June|July|August|September|October|November|December)/i.test(
                l
              )
            ) || null;

          // skip banners like "TO NOV 15"
          if (!dateLine) return null;

          // ----- FILTER PAST EVENTS -----
          const parsed = new Date(dateLine);
          if (!isNaN(parsed)) {
            const d = new Date(
              parsed.getFullYear(),
              parsed.getMonth(),
              parsed.getDate()
            );
            if (d.getTime() < todayTime) return null;
          }

          // ----- TITLE -----
          let title = null;
          const idxDate = lines.indexOf(dateLine);
          if (idxDate > 0) title = lines[idxDate - 1];

          if (!title) {
            title =
              lines.find(
                (l) =>
                  l.length > 5 &&
                  !/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(l)
              ) || lines[0];
          }

          // ----- TIME -----
          const timeLine = lines.find(hasTimePattern) || null;

          // ----- LOCATION -----
          let locationLine = null;

          if (timeLine) {
            const idx = lines.indexOf(timeLine);
            for (let i = idx + 1; i < lines.length; i++) {
              const l = lines[i];
              if (
                /google calendar/i.test(l) ||
                /\bICS\b/.test(l) ||
                hasTimePattern(l)
              ) {
                continue;
              }
              locationLine = l;
              break;
            }
          }

          let location = locationLine;
          if (location) {
            location = location.replace(/\(map\)/i, "").trim();
          }

          // ----- SHORT DESCRIPTION (from listing) -----
          let description = null;

          if (locationLine) {
            const locIdx = lines.indexOf(locationLine);
            for (let i = locIdx + 1; i < lines.length; i++) {
              const l = lines[i];
              if (
                /google calendar/i.test(l) ||
                /\bICS\b/.test(l) ||
                hasTimePattern(l) ||
                /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(l) ||
                /^[0-9]{1,2}$/.test(l) ||
                l === title ||
                l === dateLine ||
                l === locationLine
              ) {
                continue;
              }
              description = l;
              break;
            }
          }

          if (!description) {
            description =
              lines
                .filter(
                  (l) =>
                    !/google calendar/i.test(l) &&
                    !/\bICS\b/.test(l) &&
                    !hasTimePattern(l) &&
                    !/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(
                      l
                    ) &&
                    !/^[0-9]{1,2}$/.test(l) &&
                    l !== title &&
                    l !== dateLine &&
                    l !== locationLine
                )
                .sort((a, b) => b.length - a.length)[0] || null;
          }

          // ----- CATEGORIES -----
          const allLinks = Array.from(card.querySelectorAll("a")).map((a) => ({
            text: (a.innerText || "").trim(),
            href: a.href,
          }));

          let categories = allLinks
            .filter((l) => {
              const t = l.text;
              return (
                t &&
                t.length > 2 &&
                t !== title &&
                !/view event/i.test(t) &&
                !/google calendar/i.test(t) &&
                !/\bICS\b/.test(t) &&
                !/\(map\)/i.test(t) &&
                !/google\.com/.test(l.href) &&
                !/maps\.google\.com/.test(l.href) &&
                !/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(t)
              );
            })
            .map((l) => l.text);

          categories = Array.from(new Set(categories));

          // ----- TIMES -----
          let startTime = null;
          let endTime = null;
          let startDate = dateLine;
          let endDate = dateLine;

          if (timeLine) {
            const tokens = timeLine.split(/\s+/);
            const ampm = tokens
              .map((t, i) => ({ t, i }))
              .filter((x) => /AM|PM/i.test(x.t));

            if (ampm.length >= 1) {
              const i1 = ampm[0].i;
              if (i1 > 0) startTime = `${tokens[i1 - 1]} ${tokens[i1]}`;
            }
            if (ampm.length >= 2) {
              const i2 = ampm[1].i;
              if (i2 > 0) endTime = `${tokens[i2 - 1]} ${tokens[i2]}`;
            }
          }

          return {
            title,
            startDate,
            endDate,
            startTime,
            endTime,
            location,
            description, // short listing blurb
            categories,
            eventUrl: viewLink.href,
          };
        })
        .filter((e) => e && e.title);
    },
    todayTime
  );

  console.log(`Found ${events.length} upcoming events on listing page.`);

  // --------- V2 PART: click into each event for fullDescription ----------
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    try {
      console.log(`[${i + 1}/${events.length}] Opening: ${evt.title}`);
      await page.goto(evt.eventUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);

      // Only grab paragraphs inside the <article> content area
      const fullDescription = await page.evaluate(() => {
        const article = document.querySelector("article");
        if (!article) return null;

        // Prefer .content p; if none, fall back to all <article> p
        let ps = article.querySelectorAll(".content p");
        if (!ps || ps.length === 0) {
          ps = article.querySelectorAll("p");
        }

        const texts = Array.from(ps)
          .map((p) => (p.innerText || "").trim())
          .filter((t) => t.length > 0);

        return texts.join("\n\n");
      });

      evt.fullDescription = fullDescription || null;
    } catch (err) {
      console.error(`Error fetching full description for ${evt.title}:`, err);
      evt.fullDescription = null;
    }
  }

  // --------- SAVE V2 OUTPUT ----------
  const outputPath = "edmontonrin-events-v2.json";
  fs.writeFileSync(outputPath, JSON.stringify(events, null, 2), "utf-8");
  console.log(`Saved events with full descriptions to ${outputPath}`);

  await browser.close();
})();
