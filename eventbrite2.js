import fs from "fs";
import { firefox } from "playwright";
import * as cheerio from "cheerio";

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
    await page.goto(currentPageUrl, { waitUntil: "networkidle" });
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

async function scrapeEventPage(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const html = await page.content();
  const $ = cheerio.load(html);

  const title =
    $("h1[event-title], h1.event-title").first().text().trim() || null;

  const date = $("time").first().attr("datetime") || null;
  const time = $("time").first().text().trim() || null;

  const location =
    $(".start-date-and-location__location").first().text().trim() || null;

  const description =
    $("#event-description, .event-description__content")
      .first()
      .text()
      .trim() || null;

  return { title, event_url: url, date, time, location, description };
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const eventUrls = await scrapeAllListingPages(page, listingUrl);

    const eventsData = [];
    for (const url of eventUrls) {
      const data = await scrapeEventPage(page, url);
      eventsData.push(data);
    }

    // IMPORTANT: Print ONLY JSON for R
    console.log(JSON.stringify(eventsData, null, 2));
    await browser.close();
  }
})();
