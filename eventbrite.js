const { firefox } = require('playwright');
const cheerio = require('cheerio');

const listingUrl = 'https://www.eventbrite.ca/d/canada--edmonton/business--events--next-week/?page=1';

const normalizeDate = (input) => {
  if (!input) return { date: null, dayOfWeek: null };
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return { date: null, dayOfWeek: null };
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const year = parsed.getFullYear();
  return {
    date: `${month}/${day}/${year}`,
    dayOfWeek: parsed.toLocaleString('en-US', { weekday: 'long' }),
  };
};

const extractTimes = (text) => {
  if (!text) return { start: null, end: null };
  const matches = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi);
  if (!matches || matches.length === 0) return { start: null, end: null };
  const start = matches[0].toLowerCase();
  const end = matches.length > 1 ? matches[1].toLowerCase() : null;
  return { start, end };
};

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
    await page.goto(currentPageUrl, {
      waitUntil: 'domcontentloaded',    // less likely to hang than "networkidle"
      timeout: 45000
    });
    await autoScroll(page);
    await page.waitForTimeout(2000);

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

    eventLinks.forEach((url) => allEventUrls.add(url));

    const nextButton = await page.$('button[data-testid="page-next"]:not([aria-disabled="true"])');
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
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',  // again, less likely to hang
      timeout: 45000
    });
    await page.waitForTimeout(2000);

    const html = await page.content();
    const $ = cheerio.load(html);

    const title = $('h1[event-title], h1.event-title').first().text().trim() || null;
    const rawDate = $('time').first().attr('datetime') || null;
    const rawTime = $('time').first().text().trim() || null;
    const location = $('.start-date-and-location__location').first().text().trim() || null;
    const description =
      $('#event-description, .event-description__content').first().text().trim() || null;

    const dateInfo = normalizeDate(rawDate);
    const timeInfo = extractTimes(rawTime);

    return {
      platform: 'eventbrite',
      title,
      event_url: url,
      date: dateInfo.date,
      day_of_week: dateInfo.dayOfWeek,
      start_time: timeInfo.start,
      end_time: timeInfo.end,
      location,
      description,
    };
  } catch (err) {
    return null;
  }
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const eventUrls = await scrapeAllListingPages(page, listingUrl);

    const eventsData = [];
    for (const url of eventUrls) {
      const data = await scrapeEventPage(page, url);
      if (data) eventsData.push(data);  
    }

    console.log(JSON.stringify(eventsData, null, 2));
  } finally {
    await browser.close();
  }
})();
