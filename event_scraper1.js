// SCRAPES EVENTS FROM PLATFORM CALGARY
const { firefox } = require("playwright");

const cheerio = require("cheerio");

(async () => {

  const browser = await firefox.launch({ headless: true });

  const page = await browser.newPage();

  // Go to Platform Calgary's events page
  await page.goto("https://www.platformcalgary.com/events");

  await page.waitForLoadState("networkidle");

  const content = await page.content();

  const $ = cheerio.load(content);

  const events = [];

  // Select each event card in the "All Upcoming Events" section
  $('section#community .w-dyn-list [fs-cmsfilter-element="list"] .w-dyn-item')
    .each((i, el) => {
      const card = $(el).find('.card.link.u-h-100').first();

      // URL (relative -> absolute)
      let href = card.find('a.u-link-cover').attr('href') || null;
      if (href && !href.startsWith('http')) {
        href = `https://www.platformcalgary.com${href}`;
      }

      // Date pieces
      const dateWrap = card.find('.event-date-wrap').first();
      const dow = dateWrap.find('.cc-text-caps').text().trim() || null;
      const day = dateWrap.find('.h3').text().trim() || null;
      const month = dateWrap.find('.label-text').first().text().trim() || null;

      // Title
      const title = card
        .find('h3[fs-cmsfilter-field="title"]')
        .first()
        .text()
        .trim() || null;

      // Time range inside .card-body.u-p-16
      const timeLabels = card
        .find('.card-body.u-p-16 .u-d-flex .label-text.dark')
        .map((j, t) => $(t).text().trim())
        .get();

      let startTime = null;
      let endTime = null;
      if (timeLabels.length >= 3) {
        startTime = timeLabels[0];
        endTime = timeLabels[2];
      } else if (timeLabels.length === 1) {
        startTime = timeLabels[0];
      }

      // Location = last .label-text.dark in that card-body
      const locationCandidates = card.find('.card-body.u-p-16 .label-text.dark');
      let location = null;
      if (locationCandidates.length > 0) {
        location = $(locationCandidates[locationCandidates.length - 1])
          .text()
          .trim() || null;
      }

      // Audience / guide (may be empty)
      const guideRaw = card
        .find('p[fs-cmsfilter-field="guide"]')
        .first()
        .text()
        .trim();
      const guide = guideRaw === '' ? null : guideRaw;

      // Description
      const descriptionRaw = card
        .find('p[fs-cmsfilter-field="description"]')
        .first()
        .text()
        .trim();
      const description = descriptionRaw === '' ? null : descriptionRaw;

      // Categories labels under divider-top
      const categories = card
        .find('.card-body.divider-top [fs-cmsfilter-field="category"]')
        .map((j, c) => $(c).text().trim())
        .get();

      events.push({
        native_id: href, // you can later replace with slug from href if you want
        platform: 'platformcalgary',
        title,
        event_url: href,
        date_day_of_week: dow,
        date_day: day,
        date_month: month,
        start_time: startTime,
        end_time: endTime,
        location,
        guide,
        description,
        categories,
      });
    });

  console.log(JSON.stringify(events, null, 2));

  await browser.close();
})();

// 