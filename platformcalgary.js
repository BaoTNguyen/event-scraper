// SCRAPES EVENTS FROM PLATFORM CALGARY
const { firefox } = require("playwright");
const cheerio = require("cheerio");

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://www.platformcalgary.com/events", { waitUntil: "networkidle" });

  // Scroll to events section to trigger FinSweet lazy load and wait for cards to render
  await page.locator("#community").scrollIntoViewIfNeeded();
  await page.waitForSelector('section#community [fs-cmsfilter-element="list"] .w-dyn-item', { timeout: 15000 });
  await page.waitForTimeout(1200);

  const $ = cheerio.load(await page.content());
  const events = [];

  $('section#community [fs-cmsfilter-element="list"] .w-dyn-item').each((_, el) => {
    const card = $(el).find(".card.link.u-h-100").first();
    const linkEl = card.find("a.u-link-cover").first();

    let href = linkEl.attr("href") || null;
    if (href && !href.startsWith("http")) {
      href = `https://www.platformcalgary.com${href}`;
    }

    const dateWrap = card.find(".event-date-wrap").first();
    const dow = dateWrap.find(".cc-text-caps").text().trim() || null;
    const day = dateWrap.find(".h3").text().trim() || null;
    const month = dateWrap.find(".label-text").first().text().trim() || null;

    const title = card.find('h3[fs-cmsfilter-field="title"]').first().text().trim() || null;

    const timeLabels = card
      .find(".card-body.u-p-16 .u-d-flex .label-text.dark")
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

    const locationCandidates = card.find(".card-body.u-p-16 .label-text.dark");
    const location =
      locationCandidates.length > 0
        ? $(locationCandidates[locationCandidates.length - 1]).text().trim() || null
        : null;

    const guideRaw = card.find('p[fs-cmsfilter-field="guide"]').first().text().trim();
    const guide = guideRaw === "" ? null : guideRaw;

    const descriptionRaw = card.find('p[fs-cmsfilter-field="description"]').first().text().trim();
    const description = descriptionRaw === "" ? null : descriptionRaw;

    const categories = card
      .find('.card-body.divider-top [fs-cmsfilter-field="category"]')
      .map((j, c) => $(c).text().trim())
      .get();

    // Skip placeholders if title and href are missing
    if (!title && !href) {
      return;
    }

    events.push({
      native_id: href,
      platform: "platformcalgary",
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
