import fs from 'fs';
import { firefox } from "playwright";
import * as cheerio from "cheerio";

// Start at page 1
const listingUrl = 'https://www.eventbrite.ca/d/canada--edmonton/business--events--next-week/?page=1';
const jsonFile = 'events.json';
const platformName = 'Eventbrite'; // platform field for JSON

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

// Scrape all listing pages and collect card date/time AND card location
async function scrapeAllListingPages(page, startingUrl) {
  let currentPageUrl = startingUrl;
  const allEvents = []; // store { url, cardDateTime, cardLocation }

  while (currentPageUrl) {
    console.log('Visiting listing page:', currentPageUrl);
    await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' });
    await autoScroll(page);
    await page.waitForTimeout(2000);

    const eventsOnPage = await page.$$eval('.event-card', (cards) => {
      return cards.map((card) => {
        const linkEl = card.querySelector('a.event-card-link');
        const url = linkEl ? linkEl.href : null;

        let cardDateTime = null;
        let cardLocation = null;

        // In your HTML, both datetime and location are p.event-card__clamp-line--one
        const infoEls = card.querySelectorAll('p.event-card__clamp-line--one');

        infoEls.forEach((el) => {
          const text = el.textContent.trim();

          // Heuristic: if it looks like it has a time or starts with a weekday, treat as datetime
          const hasTime = /\b\d{1,2}:\d{2}\s*[APap][Mm]\b/.test(text);
          const startsWithWeekday = /^(Mon|Tue|Tues|Wed|Thu|Thurs|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test(text);

          if (hasTime || startsWithWeekday) {
            cardDateTime = text;
          } else {
            cardLocation = text;
          }
        });

        return { url, cardDateTime, cardLocation };
      }).filter(e => e.url);
    });

    eventsOnPage.forEach(e =>
      console.log('[CARD DATETIME]', e.cardDateTime, ' [CARD LOCATION]', e.cardLocation, '->', e.url)
    );

    console.log(`Found ${eventsOnPage.length} events on this page`);
    allEvents.push(...eventsOnPage);

    const nextButton = await page.$('button[data-testid="page-next"]:not([aria-disabled="true"])');
    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(3000);
      currentPageUrl = page.url();
    } else {
      currentPageUrl = null;
    }
  }

  return allEvents;
}

// Parse Eventbrite datetime into JSON format
function parseEventTime(timeString) {
  if (!timeString) {
    return {
      date: null,
      day_of_week: null,
      start_time: null,
      end_time: null
    };
  }

  let datePart = null;
  let startTime = null;
  let endTime = null;

  // 1) Range format: "Dec 3 from 11am to 1:30pm MST"
  const regexRange = /([A-Za-z]+ \d{1,2}) from (\d{1,2}:\d{0,2}[ap]m) to (\d{1,2}:\d{0,2}[ap]m)/i;
  const matchRange = timeString.match(regexRange);
  if (matchRange) {
    datePart = matchRange[1];
    startTime = matchRange[2];
    endTime = matchRange[3];
  } else {
    // 2) Single full format: "Tue, Dec 2, 9:00 AM"
    const regexSingle = /^[A-Za-z]{3}, ([A-Za-z]+ \d{1,2}), (\d{1,2}:\d{2} [APap][Mm])$/;
    const matchSingle = timeString.match(regexSingle);
    if (matchSingle) {
      datePart = matchSingle[1];
      startTime = matchSingle[2];
      endTime = null;
    } else {
      // 3) Weekday + "at" format: "Monday at 9:00 AM + 2 more"
      const regexWeekdayAt = /at\s+(\d{1,2}:\d{2}\s*[APap][Mm])\b/;
      const matchWeekdayAt = timeString.match(regexWeekdayAt);
      if (matchWeekdayAt) {
        startTime = matchWeekdayAt[1];
        // no explicit date component in this string -> leave datePart null
      }
    }
  }

  if (!datePart) {
    return {
      date: null,
      day_of_week: null,
      start_time: startTime,
      end_time: endTime
    };
  }

  // Convert to mm/dd/yyyy using current year
  const currentYear = new Date().getFullYear();
  const dateObj = new Date(`${datePart} ${currentYear}`);
  if (isNaN(dateObj)) {
    return {
      date: null,
      day_of_week: null,
      start_time: startTime,
      end_time: endTime
    };
  }

  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const yyyy = dateObj.getFullYear();
  const formattedDate = `${mm}/${dd}/${yyyy}`;

  const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

  return {
    date: formattedDate,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime
  };
}

// Scrape event page; fallback to card date/time and card location if page missing them
async function scrapeEventPage(page, url, fallbackDateTime, fallbackLocation) {
  console.log('Visiting event page:', url);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const html = await page.content();
  const $ = cheerio.load(html);

  const title =
    $('h1[event-title], h1.event-title').first().text().trim() || null;

  // Page-level time, with fallback to card datetime
  let pageTimeText = $('time').first().text().trim() || null;
  let parsedTime = parseEventTime(pageTimeText || '');

  if (!pageTimeText || (!parsedTime.date && !parsedTime.start_time && fallbackDateTime)) {
    console.log('[FALLING BACK TO CARD DATETIME]', fallbackDateTime);
    pageTimeText = fallbackDateTime || null;
    parsedTime = parseEventTime(pageTimeText || '');
  }

  console.log('[USED TIME TEXT]', pageTimeText);

  let location =
    $('.start-date-and-location__location').first().text().trim() || null;
  if (!location && fallbackLocation) {
    location = fallbackLocation;
  }

  const description =
    $('#event-description, .event-description__content')
      .first()
      .text()
      .trim() || null;

  const { date, day_of_week, start_time, end_time } = parsedTime;

  return {
    platform: platformName,
    title,
    event_url: url,
    date,
    day_of_week,
    start_time,
    end_time,
    location,
    description
  };
}

// Main
(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const listingEvents = await scrapeAllListingPages(page, listingUrl);
    console.log(`Total unique events found: ${listingEvents.length}`);

    const eventsData = [];
    for (const { url, cardDateTime, cardLocation } of listingEvents) {
      const data = await scrapeEventPage(page, url, cardDateTime, cardLocation);
      eventsData.push(data);
    }

    fs.writeFileSync(jsonFile, JSON.stringify(eventsData, null, 2));
    console.log(`Scraped ${eventsData.length} events. Data saved to ${jsonFile}`);
  } catch (err) {
    console.error('Error during scraping:', err);
  } finally {
    await browser.close();
  }
})();
