
const $ = (selector) => document.querySelector(selector);

const searchInput = $("#search");
const cityInput = $("#city");
const showUnverified = $("#show-unverified");
const grid = $("#race-grid");
const status = $("#status");
const count = $("#result-count");

let races = [];
let selectedType = "ALL";

const categoryNames = {
  ROAD: "Road race",
  TRAIL: "Trail race",
  ULTRA: "Ultramarathon",
  COMMUNITY: "Community run"
};

function safeDate(value) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = safeDate(value);
  return date
    ? date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
    : "Date to be confirmed";
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function eventUrl(race) {
  const candidate = race.registrationUrl || race.officialUrl || race.url;
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function primaryType(race) {
  const types = race.types || [];
  if (types.includes("ULTRA")) return "ULTRA";
  if (types.includes("TRAIL")) return "TRAIL";
  if (types.includes("ROAD")) return "ROAD";
  return "COMMUNITY";
}

function withinHorizon(race) {
  const date = safeDate(race.startDate);
  if (!date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const end = new Date(today);
  end.setDate(end.getDate() + 90);

  return date >= today && date < end;
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const city = cityInput.value.toLowerCase();

  const filtered = races
    .filter(withinHorizon)
    .filter((race) => showUnverified.checked ||
      race.verificationStatus === "VERIFIED")
    .filter((race) => selectedType === "ALL" ||
      (race.types || []).includes(selectedType))
    .filter((race) => !city || (race.city || "").toLowerCase() === city)
    .filter((race) => {
      const searchable = [
        race.name,
        race.city,
        race.venue,
        race.organizer,
        race.description,
        ...(race.distances || []),
        ...(race.types || [])
      ].join(" ").toLowerCase();

      return searchable.includes(query);
    })
    .sort((a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.name.localeCompare(b.name)
    );

  count.textContent =
    `${filtered.length} ${filtered.length === 1 ? "event" : "events"}`;

  if (!filtered.length) {
    grid.innerHTML = "";
    status.textContent =
      "No matching events found. Try another filter or include unverified listings.";
    return;
  }

  status.textContent = "";

  grid.innerHTML = filtered.map((race) => {
    const type = primaryType(race);
    const verified = race.verificationStatus === "VERIFIED";
    const href = eventUrl(race);
    const distances = (race.distances || []).map((distance) =>
      `<span class="tag">${escapeHTML(distance)}</span>`
    ).join("");

    const source = race.sourceName || "Race calendar";
    const location = [race.venue, race.city, race.state || "CA"]
      .filter(Boolean).join(", ");

    return `
      <article class="race-card">
        <div class="card-top">
          <span class="category-icon" aria-hidden="true">${
            type === "TRAIL" ? "⛰" :
            type === "ULTRA" ? "↗" :
            type === "ROAD" ? "🏁" : "◷"
          }</span>
          <span class="badge ${verified ? "verified" : "review"}">${
            verified ? "Verified" : "Needs review"
          }</span>
        </div>
        <p class="race-date">${formatDate(race.startDate)}</p>
        <h3>${escapeHTML(race.name)}</h3>
        <p class="location">⌖ ${escapeHTML(location || "Location to be confirmed")}</p>
        <div class="tags">
          ${distances || '<span class="tag">Distance TBA</span>'}
          <span class="tag">${categoryNames[type]}</span>
        </div>
        ${race.description
          ? `<p class="description">${escapeHTML(race.description.slice(0, 180))}</p>`
          : ""}
        <div class="card-footer">
          <span>${escapeHTML(source)}</span>
          ${href
            ? `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">Event details ↗</a>`
            : "<span>Details pending</span>"}
        </div>
      </article>
    `;
  }).join("");
}

async function initialize() {
  try {
    const response = await fetch("./data/races.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load race data.");

    const data = await response.json();
    races = Array.isArray(data.races) ? data.races : [];

    $("#updated").textContent = data.generatedAt
      ? `Calendar last refreshed: ${new Date(data.generatedAt).toLocaleString()}`
      : "Race data has not been refreshed yet.";

    render();
  } catch (error) {
    count.textContent = "Calendar unavailable";
    status.textContent =
      "Could not load race data. Try refreshing the page.";
    console.error(error);
  }
}

searchInput.addEventListener("input", render);
cityInput.addEventListener("change", render);
showUnverified.addEventListener("change", render);

$("#filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-type]");
  if (!button) return;

  selectedType = button.dataset.type;

  $("#filters").querySelectorAll("button").forEach((item) => {
    item.classList.toggle("active", item === button);
  });

  render();
});

const sources = [
  ["Running in the USA", "https://www.runningintheusa.com/race/list/upcoming/palo%20alto-ca/sort-by-open-date"],
  ["SweatTracker", "https://sweattracker.com/Find/Calendar"],
  ["Fleet Feet Palo Alto", "https://www.fleetfeet.com/races/ca/palo-alto"],
  ["Palo Alto Online Moonlight Run", "https://www.paloaltoonline.com/moonlight-run/"],
  ["RunSignup", "https://runsignup.com/"],
  ["Byxbee parkrun", "https://www.parkrun.us/byxbee/"],
  ["Palo Alto Run Club", "https://parunclub.com/activities/"],
  ["UltraSignup", "https://ultrasignup.com/"],
  ["Brazen Racing", "https://brazenracing.com/"],
  ["Coastal Trail Runs", "https://www.coastaltrailruns.com/"],
  ["Pacific Association USATF", "https://www.pausatf.org/"],
  ["City of Palo Alto", "https://www.paloalto.gov/"]
];

$("#source-links").innerHTML = sources.map(([name, url]) =>
  `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(name)} ↗</a>`
).join("");

initialize();

