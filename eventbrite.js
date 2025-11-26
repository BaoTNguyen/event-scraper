const { firefox } = require("playwright");
const cheerio = require("cheerio");

const listingUrl =
  "https://www.eventbrite.ca/d/canada--edmonton/business--events--next-week/?page=1";

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 600;

      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - 800) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

async function scrapeAllListingPages(page, startingUrl) {
  let currentPageUrl = startingUrl;
  const allEventUrls = new Set();

  while (currentPageUrl) {
    await page.goto(currentPageUrl, { waitUntil: "domcontentloaded" });
    await autoScroll(page);
    await page.waitForTimeout(2000);

    const eventLinks = await page.$$eval(
      ".discover-vertical-event-card a.event-card-link",
      (links) => {
        const unique = new Map();
        links.forEach((link) => {
          const id = link.getAttribute("data-event-id");
          const href = link.href;
          if (id && href) unique.set(id, href);
        });
        return [...unique.values()];
      }
    );

    eventLinks.forEach((url) => allEventUrls.add(url));

    const nextButton = await page.$(
      'button[data-testid="page-next"]:not([aria-disabled="true"])'
    );

    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(3000);
      currentPageUrl = page.url();
    } else {
      currentPageUrl = null;
    }
  }

  return [...allEventUrls];
}

const normalizeDate = (input) => {
  if (!input) {
    return { date: null, dayOfWeek: null };
  }
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

const normalizeTimeText = (str) => {
  if (!str) return null;
  const trimmed = str.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/(\d{1,2}(?::\d{2})?)/);
  const suffix = trimmed.match(/(am|pm)/i);
  if (match && suffix) {
    return `${match[0]} ${suffix[0].toLowerCase()}`;
  }
  return trimmed;
};

const parseTimeRange = (raw) => {
  if (!raw) return { start: null, end: null };
  const matches = raw.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi);
  if (!matches || matches.length === 0) {
    return { start: null, end: null };
  }
  const start = normalizeTimeText(matches[0]);
  const end = matches.length > 1 ? normalizeTimeText(matches[1]) : null;
  return { start, end };
};

async function scrapeEventPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const html = await page.content();
  const $ = cheerio.load(html);

  const clean = (str) => {
    if (!str) return null;
    let normalized = str.normalize("NFKC");
    normalized = normalized
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/\u2028|\u2029/g, "\n")
      .replace(/\n+/g, " ");

    let result = "";
    for (const ch of normalized) {
      const code = ch.codePointAt(0);
      const isAllowedWhitespace =
        code === 9 || code === 10 || code === 13 || code === 32;
      const isPrintable = code >= 33 && code <= 0x10ffff;
      if (isAllowedWhitespace || isPrintable) {
        result += ch;
      }
    }
    const trimmed = result.trim();
    return trimmed === "" ? null : trimmed;
  };

  const title = clean($("h1[event-title], h1.event-title").first().text());

  const rawDate = $("time").first().attr("datetime") || null;
  const dateInfo = normalizeDate(rawDate);
  const rawTimeText = clean($("time").first().text());
  const times = parseTimeRange(rawTimeText);

  const location = clean($(".start-date-and-location__location").first().text());

  const description = clean(
    $("#event-description, .event-description__content").first().text()
  );

  return {
    platform: "eventbrite",
    title,
    event_url: url,
    date: dateInfo.date,
    day_of_week: dateInfo.dayOfWeek,
    start_time: times.start,
    end_time: times.end,
    location,
    description,
  };
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  const eventsData = [];

  try {
    const eventUrls = await scrapeAllListingPages(page, listingUrl);

    for (const url of eventUrls) {
      try {
        const data = await scrapeEventPage(page, url);
        eventsData.push(data);
      } catch (err) {
        console.error(`Failed to scrape ${url}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Error during Eventbrite listing scraping:", err);
  } finally {
    await browser.close();
  }

  // Print ONLY JSON for downstream consumers (stderr reserved for logs/errors)
  console.log(JSON.stringify(eventsData, null, 2));
})();
