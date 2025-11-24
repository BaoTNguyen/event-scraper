// Scrapes Eventbrite listings and prints JSON to stdout (logs to stderr)
const fs = require("fs");
const { firefox } = require("playwright");
const cheerio = require("cheerio");

const listingUrl = 'https://www.eventbrite.ca/d/canada--edmonton/business--events--next-week/?page=2';
const jsonFile = 'events.json';

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

async function scrapeListingPage(page, url) {
  console.error('Visiting listing page:', url);
  await page.goto(url, { waitUntil: 'networkidle' });

  // Scroll to force React to load full list
  await autoScroll(page);
  await page.waitForTimeout(3000);

  // Select only actual vertical event cards
  const eventLinks = await page.$$eval(
    '.discover-vertical-event-card a.event-card-link',
    (links) => {
      const unique = new Map();
      links.forEach((link) => {
        const id = link.getAttribute('data-event-id');
        const href = link.href;
        if (id && href) unique.set(id, href);
      });
      return [...unique.values()];
    }
  );

  console.error(`Found ${eventLinks.length} unique events`);
  return eventLinks;
}

async function scrapeEventPage(page, url) {
  console.error('Visiting event page:', url);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const html = await page.content();
  const $ = cheerio.load(html);

  const title = $('h1[event-title], h1.event-title').first().text().trim() || null;

  let date = $('time').first().attr('datetime') || null;
  let time = $('time').first().text().trim() || null;

  const location = $('.start-date-and-location__location').first().text().trim() || null;

  const description =
    $('#event-description, .event-description__content').first().text().trim() || null;

  return { title, event_url: url, date, time, location, description };
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const eventUrls = await scrapeListingPage(page, listingUrl);

    const eventsData = [];
    for (const url of eventUrls) {
      const data = await scrapeEventPage(page, url);
      eventsData.push(data);
    }

    // Write JSON file for reference
    fs.writeFileSync(jsonFile, JSON.stringify(eventsData, null, 2));

    // Emit pure JSON to stdout for downstream tools (e.g., R system()/fromJSON)
    console.log(JSON.stringify(eventsData, null, 2));

  } catch (err) {
    console.error('Error during scraping:', err);
  } finally {
    await browser.close();
  }
})();
