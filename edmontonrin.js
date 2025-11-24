const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://www.edmontonrin.ca/events", { waitUntil: "networkidle" });

  // Define today's date at midnight and pass to browser
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();


  //Scrape listing page + filter before adding
  
  const events = await page.$$eval(
    "article.eventlist-event",
    (articles, todayTime) => {
      const output = [];

      for (const article of articles) {
        const getText = (sel) =>
          article.querySelector(sel)?.innerText.trim() || null;

        // Basic fields
        const title = getText(".eventlist-title");
        const excerpt = getText(".eventlist-excerpt");

        // Date
        const dateString = getText(".eventlist-meta-date");
        if (!dateString) continue;

        const d = new Date(dateString);
        if (isNaN(d)) continue;

        // Filter past events here
        d.setHours(0, 0, 0, 0);
        if (d.getTime() < todayTime) continue;

        // Time
        const startTime = getText(".event-time-12hr-start");
        const endTime = getText(".event-time-12hr-end");

        // Location
        let location = getText(".eventlist-meta-address");
        if (location) location = location.replace("(map)", "").trim();

        // Event URL
        const titleLink = article.querySelector(".eventlist-title a");
        const eventUrl = titleLink ? titleLink.href : null;
        
        output.push({
          title,
          date: dateString,
          startTime,
          endTime,
          location,
          excerpt,
          eventUrl,
        });
      }

      return output;
    },
    todayTime
  );

  console.log("Upcoming events found:", events.length);

  // --------------------------------------------------
  // V2: Visit each event page to get full description
  // --------------------------------------------------
  for (const evt of events) {
    if (!evt.eventUrl) continue;

    await page.goto(evt.eventUrl, { waitUntil: "domcontentloaded" });

    const fullDescription = await page.evaluate(() => {
      // Only use the main content column
      const contentCol = document.querySelector(".eventitem-column-content");
      if (!contentCol) return null;

      // Grab all paragraphs
      const ps = Array.from(contentCol.querySelectorAll("p"));
      const texts = ps
        .map((p) => (p.innerText || "").trim())
        .filter((t) => t.length > 0);

      // Remove footer lines like "Source::" and "Posted in"
      const cleaned = texts.filter(
        (t) => !/^Source::/i.test(t) && !/^Posted in/i.test(t)
      );

      return cleaned.join("\n\n");
    });

    evt.fullDescription = fullDescription;
  }

  // Save everything
  fs.writeFileSync("events-clean.json", JSON.stringify(events, null, 2));
  console.log("Saved: events-clean.json");

  await browser.close();
})();
