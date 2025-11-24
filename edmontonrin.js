const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://www.edmontonrin.ca/events", {
    waitUntil: "networkidle",
  });

  // Today at midnight to filter past events
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();


  //V1: Scrape listing page + filter future events
  const events = await page.$$eval(
    "article.eventlist-event",
    (articles, todayTime) => {
      const output = [];

      for (const article of articles) {
        const getText = (sel) =>
          article.querySelector(sel)?.innerText.trim() || null;

        const title = getText(".eventlist-title");
        if (!title) continue;

        const dateString = getText(".eventlist-meta-date");
        if (!dateString) continue;

        const d = new Date(dateString);
        if (isNaN(d)) continue;

        d.setHours(0, 0, 0, 0);
        if (d.getTime() < todayTime) continue; // skip past events

        const startTime = getText(".event-time-12hr-start");
        const endTime = getText(".event-time-12hr-end");
        
        let location = getText(".eventlist-meta-address");
        if (location) location = location.replace("(map)", "").trim();

        const excerpt = getText(".eventlist-excerpt");

        // Event URL from title link
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


  //Visit each event page and extract fullDescription
  for (const evt of events) {
    if (!evt.eventUrl) continue;

    await page.goto(evt.eventUrl, { waitUntil: "domcontentloaded" });

    const fullDescription = await page.evaluate(() => {
      const body = document.querySelector(
        ".eventitem-column-content .sqs-layout"
      );
      if (!body) return null;

      const ps = Array.from(body.querySelectorAll("p"));
      return ps
        .map((p) => (p.innerText || "").trim())
        .filter((t) => t.length > 0)
        .join("\n\n");
    });

    evt.fullDescription = fullDescription;
  }

  console.log(JSON.stringify(events, null, 2));

  await browser.close();
})();
