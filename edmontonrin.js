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
          platform: "edmontonrin",
          title,
          event_url: eventUrl,
          _rawDate: dateString,
          start_time: startTime,
          end_time: endTime,
          location,
          description: excerpt,
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

    if (fullDescription) {
      evt.description = fullDescription;
    }
  }

  const toDateParts = (input) => {
    if (!input) return { date: null, dayOfWeek: null };
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      return { date: null, dayOfWeek: null };
    }
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    const year = parsed.getFullYear();
    return {
      date: `${month}/${day}/${year}`,
      dayOfWeek: parsed.toLocaleString("en-US", { weekday: "long" }),
    };
  };

  const normalized = events.map((evt) => {
    const dateInfo = toDateParts(evt._rawDate);
    return {
      platform: evt.platform,
      title: evt.title || null,
      event_url: evt.event_url || null,
      date: dateInfo.date,
      day_of_week: dateInfo.dayOfWeek,
      start_time: evt.start_time || null,
      end_time: evt.end_time || null,
      location: evt.location || null,
      description: evt.description || null,
    };
  });

  console.log(JSON.stringify(normalized, null, 2));

  await browser.close();
})();
