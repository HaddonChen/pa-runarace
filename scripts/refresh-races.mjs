
import fs from "node:fs/promises";
import * as cheerio from "cheerio";

const DAYS = 90;
const OUTPUT = new URL("../public/data/races.json", import.meta.url);
const TIMEOUT_MS = 12000;

const sources = [
  {
    name: "Running in the USA",
    url: "https://www.runningintheusa.com/race/list/upcoming/palo%20alto-ca/sort-by-open-date"
  },
  {
    name: "SweatTracker",
    url: "https://sweattracker.com/Find/Calendar"
  },
  {
    name: "Fleet Feet Palo Alto",
    url: "https://www.fleetfeet.com/races/ca/palo-alto"
  },
  {
    name: "Palo Alto Online Moonlight Run",
    url: "https://www.paloaltoonline.com/moonlight-run/"
  },
  {
    name: "RunSignup Moonlight Run",
    url: "https://runsignup.com/Race/CA/PaloAlto/PaloAltoWeeklyMoonlightRun"
  },
  {
    name: "RunGuides Byxbee parkrun",
    url: "https://www.runguides.com/event/14137/byxbee-parkrun"
  },
  {
    name: "Byxbee parkrun",
    url: "https://www.parkrun.us/byxbee/"
  },
  {
    name: "Palo Alto Run Club",
    url: "https://parunclub.com/activities/"
  },
  {
    name: "UltraSignup",
    url: "https://ultrasignup.com/"
  },
  {
    name: "Brazen Racing",
    url: "https://brazenracing.com/"
  },
  {
    name: "Coastal Trail Runs",
    url: "https://www.coastaltrailruns.com/"
  },
  {
    name: "Pacific Association USATF",
    url: "https://www.pausatf.org/"
  }
];

function classify(text) {
  const value = text.toLowerCase();
  const types = [];

  if (/\bultra\b|\b50k\b|\b100k\b|\b50 mile\b|\b100 mile\b/.test(value)) {
    types.push("ULTRA");
  }
  if (/trail|mountain|foothill/.test(value)) {
    types.push("TRAIL");
  }
  if (/road|marathon|\b5k\b|\b10k\b|\b15k\b|\b10 mile\b/.test(value)) {
    types.push("ROAD");
  }
  if (/parkrun|group run|run club|weekly run/.test(value)) {
    types.push("COMMUNITY");
  }

  return types.length ? types : ["ROAD"];
}

function distances(text) {
  return [...new Set(
    (text.match(/\b(?:5k|10k|15k|20k|25k|30k|50k|100k|half marathon|marathon|50 mile|100 mile)\b/gi) || [])
      .map((value) => value.toUpperCase())
  )];
}

function dateOnly(value) {
  if (typeof value !== "string") return null;

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;

  const date = new Date(`${match[1]}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : match[1];
}

function inHorizon(value, today, end) {
  return value && value >= today && value < end;
}

function cityFrom(text) {
  const cities = [
    "Palo Alto", "Stanford", "Menlo Park", "Mountain View",
    "Los Altos", "Woodside", "Sunnyvale", "San Jose"
  ];

  return cities.find((city) =>
    text.toLowerCase().includes(city.toLowerCase())
  ) || "Palo Alto";
}

function collectEvents(value, result) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const child of value) collectEvents(child, result);
    return;
  }

  const obj = value;
  const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
  const isEvent = types.some((type) =>
    typeof type === "string" && /Event/i.test(type)
  );

  if (isEvent) result.push(obj);

  for (const [key, child] of Object.entries(obj)) {
    if (key !== "parent" && child && typeof child === "object") {
      collectEvents(child, result);
    }
  }
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PaloAltoRaceFinder/2.0 (community race calendar)",
        "Accept": "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const events = [];

    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        collectEvents(JSON.parse($(element).contents().text()), events);
      } catch {
        // Ignore malformed structured data in this script.
      }
    });

    // Fallback: inspect ordinary HTML event listings.
    // Only accept a date when it appears in the same listing as a title.
    const seenLinks = new Set();

    $("a[href]").each((_, element) => {
      const link = $(element);
      const name = link.text().replace(/\s+/g, " ").trim();

      if (!name || name.length < 5 || name.length > 180) return;

      let href;
      try {
        const parsed = new URL(link.attr("href"), source.url);
        if (!["http:", "https:"].includes(parsed.protocol)) return;
        href = parsed.href;
      } catch {
        return;
      }

      if (seenLinks.has(href)) return;
      seenLinks.add(href);

      // Inspect the link and its nearest parent containers.
      let container = link;
      let listingText = "";

      for (let level = 0; level < 5 && container.length; level++) {
        const text = container.text()
          .replace(/\s+/g, " ")
          .trim();

        if (
          text.length >= name.length &&
          text.length <= 1800 &&
          /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/i.test(text)
        ) {
          listingText = text;
          break;
        }

        container = container.parent();
      }

      if (!listingText) return;

      const dateMatch = listingText.match(
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/i
      );

      if (!dateMatch) return;

      let startDate = dateMatch[0];
      if (!/\b\d{4}\b/.test(startDate)) {
        startDate += `, ${now.getUTCFullYear()}`;
      }

      const parsedDate = new Date(startDate);
      if (Number.isNaN(parsedDate.getTime())) return;

      const isoDate = [
        parsedDate.getFullYear(),
        String(parsedDate.getMonth() + 1).padStart(2, "0"),
        String(parsedDate.getDate()).padStart(2, "0")
      ].join("-");

      // Reject obvious navigation links and generic page links.
      if (/^(home|about|contact|login|register|learn more|view all)$/i.test(name)) {
        return;
      }

      events.push({
        name,
        startDate: isoDate,
        url: href,
        description: listingText.slice(0, 1200),
        location: {},
        organizer: { name: source.name }
      });
    });

    return events.map((event) => {
      const name = typeof event.name === "string" ? event.name.trim() : "";
      const startDate = dateOnly(event.startDate);
      const description = typeof event.description === "string"
        ? event.description.replace(/<[^>]*>/g, " ").slice(0, 1200)
        : "";

      const location = event.location && typeof event.location === "object"
        ? event.location
        : {};
      const address = location.address && typeof location.address === "object"
        ? location.address
        : {};

      const context = `${name} ${description} ${JSON.stringify(location)}`;
      let url = source.url;

      if (typeof event.url === "string") {
        try {
          const parsed = new URL(event.url, source.url);
          if (["http:", "https:"].includes(parsed.protocol)) url = parsed.href;
        } catch {
          // Keep the source page as the link.
        }
      }

      return {
        name,
        startDate,
        city: typeof address.addressLocality === "string"
          ? address.addressLocality
          : cityFrom(context),
        state: typeof address.addressRegion === "string"
          ? address.addressRegion
          : "CA",
        venue: typeof location.name === "string" ? location.name : "",
        description,
        organizer: typeof event.organizer?.name === "string"
          ? event.organizer.name
          : "",
        distances: distances(`${name} ${description}`),
        types: classify(`${name} ${description}`),
        officialUrl: url,
        registrationUrl: "",
        sourceName: source.name,
        sourceUrl: source.url,
        verificationStatus: "NEEDS_REVIEW"
      };
    }).filter((event) => event.name && event.startDate);
  } finally {
    clearTimeout(timer);
  }
}

const now = new Date();
const today = now.toISOString().slice(0, 10);
const endDate = new Date(now);
endDate.setUTCDate(endDate.getUTCDate() + DAYS);
const end = endDate.toISOString().slice(0, 10);

const results = [];
const errors = [];

for (const source of sources) {
  try {
    const events = await fetchSource(source);
    const upcoming = events.filter((event) =>
      inHorizon(event.startDate, today, end)
    );

    results.push(...upcoming);
    console.log(`${source.name}: ${upcoming.length} upcoming events`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ source: source.name, error: message });
    console.warn(`${source.name}: ${message}`);
  }
}

// Merge repeated discoveries for the same named event on the same date.
const merged = new Map();

for (const event of results) {
  const key = `${event.name.toLowerCase()}|${event.startDate}`;
  const existing = merged.get(key);

  if (!existing) {
    merged.set(key, event);
  } else {
    existing.sourceUrls = [...new Set([
      ...(existing.sourceUrls || [existing.sourceUrl]),
      event.sourceUrl
    ])];
    existing.sources = [...new Set([
      ...(existing.sources || [existing.sourceName]),
      event.sourceName
    ])];
  }
}

const output = {
  generatedAt: now.toISOString(),
  region: "Palo Alto, California",
  horizonDays: DAYS,
  sourceCount: sources.length,
  successfulSources: sources.length - errors.length,
  errors,
  races: [...merged.values()].sort((a, b) =>
    a.startDate.localeCompare(b.startDate) ||
    a.name.localeCompare(b.name)
  )
};

await fs.mkdir(new URL("../public/data/", import.meta.url), {
  recursive: true
});
await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Saved ${output.races.length} unique events.`);
console.log(`${errors.length} sources failed; see data/races.json for details.`);

