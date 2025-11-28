const { firefox } = require("playwright");
const cheerio = require("cheerio");

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://www.platformcalgary.com/events", { waitUntil: "networkidle" });

  await page.locator("#community").scrollIntoViewIfNeeded();
  await page.waitForSelector('section#community [fs-cmsfilter-element="list"] .w-dyn-item', { timeout: 15000 });
  await page.waitForTimeout(1200);

  const $ = cheerio.load(await page.content());
  const events = [];

  const monthMap = {
    Jan: "01",
    January: "01",
    Feb: "02",
    February: "02",
    Mar: "03",
    March: "03",
    Apr: "04",
    April: "04",
    May: "05",
    Jun: "06",
    June: "06",
    Jul: "07",
    July: "07",
    Aug: "08",
    August: "08",
    Sep: "09",
    Sept: "09",
    September: "09",
    Oct: "10",
    October: "10",
    Nov: "11",
    November: "11",
    Dec: "12",
    December: "12",
  };

  const cardEvents = $('section#community [fs-cmsfilter-element="list"] .w-dyn-item');
  const currentYear = new Date().getFullYear();

  cardEvents.each((_, el) => {
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

    let description = null;
    const descAttr = card.find('p[fs-cmsfilter-field="description"]').first();
    if (descAttr.length) {
      const text = descAttr.text().trim();
      if (text !== "") {
        description = text;
      }
    }
    if (!description) {
      const fallback = card
        .find("p")
        .filter((_, p) => !$(p).attr("fs-cmsfilter-field"))
        .first()
        .text()
        .trim();
      description = fallback === "" ? null : fallback;
    }

    if (!title && !href) {
      return;
    }

    let date = null;
    if (month && day) {
      const monthNumber = monthMap[month] || null;
      if (monthNumber) {
        date = `${monthNumber}/${day.padStart(2, "0")}/${currentYear}`;
      }
    }

    events.push({
      platform: "platformcalgary",
      title,
      event_url: href,
      date,
      day_of_week: dow || null,
      start_time: startTime,
      end_time: endTime,
      location,
      description,
      needsDetail: !location || !date || !description || description.length < 180,
    });
  });

  const sanitize = (text) => {
    if (!text) return null;
    const cleaned = text.replace(/\s+/g, " ").trim();
    return cleaned === "" ? null : cleaned;
  };

  const detailTargets = events.filter((evt) => evt.needsDetail && evt.event_url);

  if (detailTargets.length > 0) {
    const detailPage = await browser.newPage();
    for (const evt of detailTargets) {
      try {
        await detailPage.goto(evt.event_url, { waitUntil: "domcontentloaded" });
        await detailPage.waitForTimeout(700);
        const detailHtml = await detailPage.content();
        const $$ = cheerio.load(detailHtml);
        const mainCol = $$(".col.col-lg-8.col-sm-12").first();

        if (mainCol.length) {
          const paragraphs = mainCol
            .find("p")
            .map((_, p) => sanitize($$(p).text()))
            .get()
            .filter(Boolean);
          if (paragraphs.length && (!evt.description || evt.description.length < 180)) {
            evt.description = paragraphs.join("\n\n");
          }

          const infoItems = mainCol.find(".card .card-body ul li");
          const dateText = sanitize(infoItems.eq(0).text());
          if (dateText) {
            const parsed = new Date(dateText);
            if (!Number.isNaN(parsed.getTime())) {
              const month = String(parsed.getMonth() + 1).padStart(2, "0");
              const dDay = String(parsed.getDate()).padStart(2, "0");
              const year = parsed.getFullYear();
              evt.date = `${month}/${dDay}/${year}`;
              evt.day_of_week = parsed.toLocaleString("en-US", { weekday: "long" });
            }
          }

          const timeText = sanitize(infoItems.eq(1).text());
          if (timeText) {
            const parts = timeText.split(/[-–—]/).map((part) => part.trim());
            if (parts.length >= 1) {
              evt.start_time = parts[0] || evt.start_time;
            }
            if (parts.length >= 2) {
              evt.end_time = parts[1] || evt.end_time;
            }
          }

          const locationText = sanitize(infoItems.eq(2).text());
          if (locationText) {
            evt.location = locationText;
          }
        }

        if (!evt.description) {
          const bodyText = sanitize($$("body").text());
          if (bodyText) {
            evt.description = bodyText;
          }
        }
      } catch (err) {
        console.error(`Failed to fetch detail for ${evt.title || evt.event_url}:`, err.message);
      } finally {
        evt.needsDetail = false;
      }
    }
    await detailPage.close();
  }

  events.forEach((evt) => {
    delete evt.needsDetail;
  });

  console.log(JSON.stringify(events, null, 2));
  await browser.close();
})();