const path = require("path");
const { loadLocations } = require("./locations");
const { log } = require("../../utils/logger");

// Supported location datasets (US + UK + Italy + Australia + Canada)
const LOCATION_FILES = [
  path.join(__dirname, "..", "..", "..", "data", "locations_usa.csv"),
  path.join(__dirname, "..", "..", "..", "data", "locations_uk.csv"),
  path.join(__dirname, "..", "..", "..", "data", "locations_italy.csv"),
  path.join(__dirname, "..", "..", "..", "data", "locations_au.csv"),
  path.join(__dirname, "..", "..", "..", "data", "locations_ca.csv"),
];

let cachedLocations = null;

/**
 * Load and cache all supported locations
 * @returns {Promise<object[]>} - Combined location dataset
 */
async function loadAllLocations() {
  if (cachedLocations) {
    return cachedLocations;
  }

  const combined = [];

  for (const filePath of LOCATION_FILES) {
    try {
      const locations = await loadLocations(filePath);
      const normalized = locations.map((loc) => {
        const country = loc.CountryCode?.toLowerCase?.() || "us";
        return {
          ...loc,
          CountryCode: country,
          countryCode: country,
          state: loc.state?.trim() || "",
          city: loc.city?.trim() || "",
        };
      });
      combined.push(
        ...normalized
      );
    } catch (error) {
      log(`Error loading locations from ${path.basename(filePath)}: ${error.message}`);
    }
  }

  cachedLocations = combined;
  return cachedLocations;
}

/**
 * Parse location from user input
 * @param {string} input - User input in format "State/Region, City"
 * @returns {object|null} - Location object with state/region and city
 */
function parseLocationInput(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const parts = input.split(",");
  if (parts.length < 2) return null;

  return {
    state: parts[0] ? parts[0].trim() : null,
    city: parts[1] ? parts[1].trim() : null,
  };
}

/**
 * Find location in CSV database
 * @param {string} state - State name
 * @param {string} city - City name
 * @returns {object|null} - Location object from database
 */
async function findLocation(state, city) {
  if (!state || !city) {
    return null;
  }

  try {
    const locations_source = await loadAllLocations();
    if (!locations_source.length) {
      return null;
    }

    for (const loc of locations_source) {
      if (
        loc.city.toLowerCase() === city.toLowerCase() &&
        loc.state.toLowerCase() === state.toLowerCase()
      ) {
        log(`Location found: ${JSON.stringify(loc)}`);
        return loc;
      }
    }

    return null;
  } catch (error) {
    log(`Error finding location: ${error.message}`);
    return null;
  }
}

/**
 * Validate location input format
 * @param {string} input - User input
 * @returns {object} - Validation result with success boolean and message
 */
function validateLocationInput(input) {
  if (!input || typeof input !== 'string') {
    return {
      success: false,
      message: "❌ Please provide a location in the format 'State/Region, City'. Examples: 'California, Los Angeles' or 'England, London'"
    };
  }

  const parsed = parseLocationInput(input);
  if (!parsed) {
    return {
      success: false,
      message: "❌ Invalid format. Please use 'State/Region, City'. Examples: 'California, Los Angeles' or 'England, London'"
    };
  }

  if (!parsed.state || !parsed.city) {
    return {
      success: false,
      message: "❌ Both state/region and city are required. Format: 'State/Region, City'"
    };
  }

  return {
    success: true,
    message: "Valid location format",
    parsed: parsed
  };
}

/**
 * Find and validate location from user input
 * @param {string} locationInput - User input
 * @returns {Promise<object>} - Result with location data or error
 */
async function findAndValidateLocation(locationInput) {
  // First validate the input format
  const validation = validateLocationInput(locationInput);
  if (!validation.success) {
    return {
      success: false,
      error: validation.message
    };
  }

  // Try to find the location in the database
  const location = await findLocation(
    validation.parsed.state,
    validation.parsed.city
  );

  if (!location) {
    return {
      success: false,
      error: `❌ Location '${validation.parsed.city}, ${validation.parsed.state}' not found. Please check the spelling and try another city/state combination in the US, UK, Italy, Australia, or Canada.`
    };
  }

  return {
    success: true,
    location: location,
    input: validation.parsed
  };
}

/**
 * Get location suggestions for partial matches
 * @param {string} partialInput - Partial location input
 * @param {number} limit - Maximum number of suggestions
 * @returns {Promise<Array>} - Array of location suggestions
 */
async function getLocationSuggestions(partialInput, limit = 5) {
  if (!partialInput || partialInput.length < 2) {
    return [];
  }

  try {
    const locations_source = await loadAllLocations();

    const searchTerm = partialInput.toLowerCase();
    const suggestions = [];

    for (const loc of locations_source) {
      if (suggestions.length >= limit) break;

      const cityMatch = loc.city.toLowerCase().includes(searchTerm);
      const stateMatch = loc.state.toLowerCase().includes(searchTerm);
      const fullMatch = `${loc.city}, ${loc.state}`.toLowerCase().includes(searchTerm);
      const countryCode = loc.CountryCode ? loc.CountryCode.toUpperCase() : "";

      if (cityMatch || stateMatch || fullMatch) {
        suggestions.push({
          city: loc.city,
          state: loc.state,
          countryCode,
          display: countryCode ? `${loc.city}, ${loc.state} (${countryCode})` : `${loc.city}, ${loc.state}`,
          matchType: cityMatch ? 'city' : (stateMatch ? 'state' : 'full')
        });
      }
    }

    return suggestions;
  } catch (error) {
    log(`Error getting location suggestions: ${error.message}`);
    return [];
  }
}

/**
 * Format location for display
 * @param {object} location - Location object
 * @returns {string} - Formatted location string
 */
function formatLocationDisplay(location) {
  if (!location || !location.city || !location.state) {
    return "Unknown location";
  }

  const countryCode = location.CountryCode || location.countryCode || location.country;
  const countrySuffix = countryCode ? ` (${String(countryCode).toUpperCase()})` : "";
  return `${location.city}, ${location.state}${countrySuffix}`;
}

/**
 * Check if two locations are the same
 * @param {object} loc1 - First location
 * @param {object} loc2 - Second location
 * @returns {boolean} - True if locations match
 */
function locationsMatch(loc1, loc2) {
  if (!loc1 || !loc2) return false;
  
  const country1 = loc1.CountryCode || loc1.countryCode || "";
  const country2 = loc2.CountryCode || loc2.countryCode || "";

  return (
    loc1.city?.toLowerCase() === loc2.city?.toLowerCase() &&
    loc1.state?.toLowerCase() === loc2.state?.toLowerCase() &&
    (country1 || country2 ? country1.toLowerCase() === country2.toLowerCase() : true)
  );
}

module.exports = {
  parseLocationInput,
  findLocation,
  validateLocationInput,
  findAndValidateLocation,
  getLocationSuggestions,
  formatLocationDisplay,
  locationsMatch,
};
